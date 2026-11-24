// This reads Logseq's observed sync state. It is not a server-side barrier and
// cannot account for notes another device has not uploaded yet.
export const GRAPH_UUID_QUERY = `[:find ?uuid .
  :where [?entity :db/ident :logseq.kv/graph-uuid] [?entity :kv/value ?uuid]]`;

export class SyncGuardError extends Error {}

type ReadyState = { ready: true; fingerprint: string };
type WaitingState = { ready: false; reason: string };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function field(value: unknown, camel: string, kebab: string): unknown {
  if (!record(value)) return undefined;
  for (const key of [camel, kebab, `:${kebab}`]) {
    if (Object.hasOwn(value, key)) return value[key];
  }
  return undefined;
}

function graphUuid(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)
    ? value.toLowerCase() : undefined;
}

export function inspectSyncState(raw: unknown, expectedGraphUuid: string): ReadyState | WaitingState {
  const waiting = (reason: string): WaitingState => ({ ready: false, reason });
  if (!record(raw)) return waiting("Sync status is unavailable.");
  const expected = graphUuid(expectedGraphUuid);
  if (!expected || graphUuid(field(raw, "graphUuid", "graph-uuid")) !== expected) {
    return waiting("Sync status does not match the current graph.");
  }
  const ws = field(field(raw, "rtcState", "rtc-state"), "wsState", "ws-state");
  if ((ws !== "open" && ws !== ":open") || field(raw, "rtcLock", "rtc-lock") !== true) {
    return waiting("The sync connection is not open.");
  }
  const error = field(raw, "lastError", "last-error");
  if (error !== undefined && error !== null) return waiting("Sync reports an error.");

  const queues = [
    field(raw, "unpushedBlockUpdateCount", "unpushed-block-update-count"),
    field(raw, "pendingServerOpsCount", "pending-server-ops-count"),
    field(raw, "pendingAssetOpsCount", "pending-asset-ops-count"),
    field(raw, "missingAssetUploadFilesCount", "missing-asset-upload-files-count")
  ];
  if (queues.some(value => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
    return waiting("Sync queue counts could not be verified.");
  }
  const missing = field(raw, "missingAssetUploadFiles", "missing-asset-upload-files");
  if (!Array.isArray(missing)) return waiting("Asset sync status could not be verified.");
  if (queues.some(value => value !== 0) || missing.length > 0) {
    return waiting("Notes or assets are still waiting to sync.");
  }

  const localTx = field(raw, "localTx", "local-tx");
  const remoteTx = field(raw, "remoteTx", "remote-tx");
  if (typeof localTx !== "number" || !Number.isSafeInteger(localTx) || localTx < 0 ||
      typeof remoteTx !== "number" || !Number.isSafeInteger(remoteTx) || remoteTx < 0) {
    return waiting("Local and server versions could not be verified.");
  }
  if (localTx !== remoteTx) return waiting("Local and server versions do not match.");
  const localChecksum = field(raw, "localChecksum", "local-checksum");
  const remoteChecksum = field(raw, "remoteChecksum", "remote-checksum");
  if (typeof localChecksum !== "string" || !localChecksum.trim() ||
      typeof remoteChecksum !== "string" || !remoteChecksum.trim()) {
    return waiting("Local and server checksums could not be verified.");
  }
  if (localChecksum !== remoteChecksum) return waiting("Local and server checksums do not match.");
  return { ready: true, fingerprint: JSON.stringify([expected, localTx, localChecksum]) };
}

interface SyncWaitOptions {
  timeoutMs?: number;
  pollMs?: number;
  stableMs?: number;
}

// The same deadline bounds SDK calls, polling, and reads that need to be retried.
// The read must be non-mutating: a changed sync state causes its result to be
// discarded and read again after sync settles.
export async function readAfterSync<T>(read: () => Promise<T>, options: SyncWaitOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const pollMs = options.pollMs ?? 500;
  const stableMs = options.stableMs ?? 2000;
  const deadline = performance.now() + timeoutMs;
  let reason = "Sync status could not be verified.";
  const timeout = () => new SyncGuardError(`Sync did not settle within ${timeoutMs / 1000} seconds. ${reason}`);

  async function bounded<V>(request: () => Promise<V>): Promise<V> {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw timeout();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(request),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timeout()), remaining); })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function currentGraphUrl(): Promise<string> {
    try {
      const graph = await bounded(() => logseq.App.getCurrentGraph());
      if (!graph || typeof graph.url !== "string" || !graph.url) throw new Error("No active graph");
      return graph.url;
    } catch (error) {
      if (error instanceof SyncGuardError) throw error;
      throw new SyncGuardError("The current graph could not be verified.");
    }
  }

  const graphUrl = await currentGraphUrl();
  let expectedUuid: string | undefined;
  try {
    expectedUuid = graphUuid(await bounded(() => logseq.DB.datascriptQuery(GRAPH_UUID_QUERY)));
  } catch (error) {
    if (error instanceof SyncGuardError) throw error;
    throw new SyncGuardError("The graph's sync identity could not be read.");
  }
  if (!expectedUuid) throw new SyncGuardError("A sync-enabled graph with a known identity is required.");

  async function sample(): Promise<ReadyState | WaitingState> {
    if (await currentGraphUrl() !== graphUrl) throw new SyncGuardError("The graph changed. Run the preview again.");
    let raw: unknown;
    try {
      raw = await bounded(() => logseq.App.getStateFromStore("rtc/state"));
    } catch (error) {
      if (error instanceof SyncGuardError) throw error;
      throw new SyncGuardError("Sync status could not be read.");
    }
    if (await currentGraphUrl() !== graphUrl) throw new SyncGuardError("The graph changed. Run the preview again.");
    return inspectSyncState(raw, expectedUuid!);
  }

  let stable: { fingerprint: string; since: number } | undefined;
  while (true) {
    const state = await sample();
    if (!state.ready) {
      stable = undefined;
      reason = state.reason;
    } else {
      if (stable?.fingerprint !== state.fingerprint) {
        stable = { fingerprint: state.fingerprint, since: performance.now() };
      }
      reason = "Waiting for sync to remain stable.";
      if (performance.now() - stable.since >= stableMs) {
        reason = "The journal scan did not finish with a stable sync state.";
        const result = await bounded(read);
        const after = await sample();
        if (after.ready && after.fingerprint === stable.fingerprint) return result;
        reason = after.ready ? "Sync changed while the journal pages were being read." : after.reason;
        stable = undefined;
      }
    }
    await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, Math.min(pollMs, deadline - performance.now()))));
  }
}
