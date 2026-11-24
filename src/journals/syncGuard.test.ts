import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { graphInfo, graphUuid, syncedState } from "./journalFixtures";
import { GRAPH_UUID_QUERY, inspectSyncState, readAfterSync, SyncGuardError } from "./syncGuard";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const getCurrentGraph = vi.fn().mockResolvedValue(graphInfo);
  const getStateFromStore = vi.fn().mockResolvedValue(syncedState());
  const datascriptQuery = vi.fn().mockResolvedValue(graphUuid);
  vi.stubGlobal("logseq", { App: { getCurrentGraph, getStateFromStore }, DB: { datascriptQuery } });
  return { getCurrentGraph, getStateFromStore, datascriptQuery };
}

describe("observed sync readiness", () => {
  it("accepts the SDK camel-case shape and raw keyword-shaped state", () => {
    expect(inspectSyncState(syncedState(), graphUuid).ready).toBe(true);
    expect(inspectSyncState({
      ":rtc-state": { ":ws-state": ":open" }, ":rtc-lock": true, ":graph-uuid": graphUuid,
      ":unpushed-block-update-count": 0, ":pending-server-ops-count": 0,
      ":pending-asset-ops-count": 0, ":missing-asset-upload-files-count": 0,
      ":missing-asset-upload-files": [], ":local-tx": 7, ":remote-tx": 7,
      ":local-checksum": "same", ":remote-checksum": "same"
    }, graphUuid).ready).toBe(true);
  });

  it.each([
    { rtcState: { wsState: "closed" } }, { rtcLock: false },
    { unpushedBlockUpdateCount: 1 }, { pendingServerOpsCount: 1 },
    { pendingAssetOpsCount: 1 }, { missingAssetUploadFilesCount: 1 },
    { missingAssetUploadFiles: ["missing.png"] }, { localTx: 1 },
    { localChecksum: "different" }, { localChecksum: "" }, { remoteChecksum: undefined },
    { graphUuid: "00000000-0000-0000-0000-000000000000" }, { graphUuid: undefined },
    { lastError: { message: "sync failed" } }, { pendingServerOpsCount: undefined },
    { pendingAssetOpsCount: "0" }, { unpushedBlockUpdateCount: -1 }, { localTx: NaN },
    { remoteTx: 0.5 }, { missingAssetUploadFiles: undefined }
  ])("fails closed for an unsafe or incomplete state: %j", extra => {
    expect(inspectSyncState(syncedState(extra), graphUuid).ready).toBe(false);
  });

  it("rejects missing state and an unknown expected graph identity", () => {
    for (const value of [null, undefined, {}, []]) expect(inspectSyncState(value, graphUuid).ready).toBe(false);
    expect(inspectSyncState(syncedState({ graphUuid: undefined }), "").ready).toBe(false);
  });
});

describe("automatic sync wait and scan", () => {
  it("waits for two stable seconds before reading journals", async () => {
    const { getStateFromStore, datascriptQuery } = setup();
    const read = vi.fn().mockResolvedValue("fresh rows");
    const result = readAfterSync(read);
    await vi.advanceTimersByTimeAsync(1999);
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("fresh rows");
    expect(read).toHaveBeenCalledOnce();
    expect(datascriptQuery).toHaveBeenCalledExactlyOnceWith(GRAPH_UUID_QUERY);
    expect(getStateFromStore).toHaveBeenCalledWith("rtc/state");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("automatically waits for pending downloads, then reads the new contents", async () => {
    const { getStateFromStore } = setup();
    getStateFromStore.mockResolvedValue(syncedState({ pendingServerOpsCount: 2 }));
    const read = vi.fn().mockResolvedValue(["downloaded note"]);
    const result = readAfterSync(read);
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).not.toHaveBeenCalled();
    getStateFromStore.mockResolvedValue(syncedState());
    await vi.advanceTimersByTimeAsync(2500);
    await expect(result).resolves.toEqual(["downloaded note"]);
  });

  it("restarts the stability interval after a disconnect", async () => {
    const { getStateFromStore } = setup();
    const read = vi.fn().mockResolvedValue("rows");
    const result = readAfterSync(read);
    await vi.advanceTimersByTimeAsync(1000);
    getStateFromStore.mockResolvedValue(syncedState({ rtcLock: false }));
    await vi.advanceTimersByTimeAsync(500);
    getStateFromStore.mockResolvedValue(syncedState());
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBe("rows");
  });

  it("discards a scan and rescans when sync advances during the read", async () => {
    const { getStateFromStore } = setup();
    const read = vi.fn().mockImplementationOnce(async () => {
      getStateFromStore.mockResolvedValue(syncedState({ localTx: 18050, remoteTx: 18050 }));
      return "stale rows";
    }).mockResolvedValue("fresh rows");
    const result = readAfterSync(read);
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2500);
    await expect(result).resolves.toBe("fresh rows");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("blocks even with empty queues when checksums differ", async () => {
    const { getStateFromStore } = setup();
    getStateFromStore.mockResolvedValue(syncedState({ remoteChecksum: "different" }));
    const read = vi.fn();
    const outcome = readAfterSync(read, { timeoutMs: 1000 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toBeInstanceOf(SyncGuardError);
    expect(await outcome).toMatchObject({ message: expect.stringContaining("checksums do not match") });
    expect(read).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("blocks unavailable sync state rather than treating it as idle", async () => {
    const { getStateFromStore } = setup();
    getStateFromStore.mockResolvedValue(null);
    const read = vi.fn();
    const outcome = readAfterSync(read, { timeoutMs: 1000 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toMatchObject({ message: expect.stringContaining("Sync status is unavailable") });
    expect(read).not.toHaveBeenCalled();
  });

  it("bounds an SDK call that never resolves", async () => {
    const { getStateFromStore } = setup();
    getStateFromStore.mockReturnValue(new Promise(() => {}));
    const read = vi.fn();
    const outcome = readAfterSync(read, { timeoutMs: 1000 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toBeInstanceOf(SyncGuardError);
    expect(read).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts when the active graph changes while waiting", async () => {
    const { getCurrentGraph } = setup();
    const read = vi.fn();
    const outcome = readAfterSync(read).catch(error => error);
    await vi.advanceTimersByTimeAsync(500);
    getCurrentGraph.mockResolvedValue({ ...graphInfo, url: "another graph" });
    await vi.advanceTimersByTimeAsync(500);
    expect(await outcome).toMatchObject({ message: expect.stringContaining("graph changed") });
    expect(read).not.toHaveBeenCalled();
  });

  it("discards results when the active graph changes during the scan", async () => {
    const { getCurrentGraph } = setup();
    const read = vi.fn(async () => {
      getCurrentGraph.mockResolvedValue({ ...graphInfo, url: "another graph" });
      return "wrong graph rows";
    });
    const outcome = readAfterSync(read).catch(error => error);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await outcome).message).toContain("graph changed");
  });

  it("fails immediately when the graph sync identity is unavailable", async () => {
    const { datascriptQuery } = setup();
    datascriptQuery.mockResolvedValue(null);
    const read = vi.fn();
    await expect(readAfterSync(read)).rejects.toThrow("known identity is required");
    expect(read).not.toHaveBeenCalled();
  });

  it("fails closed when the SDK rejects the sync status request", async () => {
    const { getStateFromStore } = setup();
    getStateFromStore.mockRejectedValue(new Error("SDK unavailable"));
    const read = vi.fn();
    await expect(readAfterSync(read)).rejects.toThrow("Sync status could not be read");
    expect(read).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rescans when a pending upload appears during the scan", async () => {
    const { getStateFromStore } = setup();
    const read = vi.fn().mockImplementationOnce(async () => {
      getStateFromStore.mockResolvedValue(syncedState({ unpushedBlockUpdateCount: 1 }));
      return "stale rows";
    }).mockResolvedValue("fresh rows");
    const result = readAfterSync(read);
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledOnce();
    getStateFromStore.mockResolvedValue(syncedState());
    await vi.advanceTimersByTimeAsync(2500);
    await expect(result).resolves.toBe("fresh rows");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("cleans up the timeout when the journal read fails", async () => {
    setup();
    const outcome = readAfterSync(async () => { throw new Error("Query failed"); }).catch(error => error);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await outcome).message).toBe("Query failed");
    expect(vi.getTimerCount()).toBe(0);
  });
});
