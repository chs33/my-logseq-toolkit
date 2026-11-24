import type { Entity } from "./journalSnapshot";

export const today = new Date(2026, 10, 5, 12);
export const graphUuid = "7d75242f-11ed-49d7-b627-a0250ef5c121";
export const graphInfo = { url: "logseq_db_logseq-notes", name: "logseq-notes", path: "/graphs/logseq-notes" };

// getStateFromStore camel-cases unqualified keys, unlike datascriptQuery.
export const syncedState = (extra: Entity = {}): Entity => ({
  rtcState: { wsState: "open" },
  rtcLock: true,
  graphUuid,
  unpushedBlockUpdateCount: 0,
  pendingServerOpsCount: 0,
  pendingAssetOpsCount: 0,
  missingAssetUploadFilesCount: 0,
  missingAssetUploadFiles: [],
  localTx: 18049,
  remoteTx: 18049,
  localChecksum: "0123456789abcdef",
  remoteChecksum: "0123456789abcdef",
  ...extra
});
// Persisted fields of the empty Nov 4 journal, including Logseq's own metadata.
export const emptyJournal = (extra: Entity = {}): Entity => ({
  "db/id": 15416,
  "block/uuid": "00000001-2026-1104-0000-000000000000",
  "block/name": "nov 4th, 2026",
  "block/title": "2026_11_04",
  "block/journal-day": 20261104,
  "block/created-at": 1793768401146,
  "block/updated-at": 1793768401146,
  "logseq.property/created-by-ref": { "db/id": 12939 },
  "block/tags": [{ "db/id": 159, "db/ident": "logseq.class/Journal" }],
  "block/refs": [
    { "db/id": 21, "db/ident": "block/tags" },
    { "db/id": 159, "db/ident": "logseq.class/Journal" }
  ],
  ...extra
});

// logseq/sdk/utils.cljs: normalize-keyword-for-json(result, false), as used by
// datascriptQuery: block/db namespaces stripped, hyphens retained.
export function sdkQueryShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sdkQueryShape);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [
    /^(block|db|file)\//u.test(key) ? key.split("/")[1] : `:${key}`,
    key === "db/ident" && typeof val === "string"
      ? (/^(block|db|file)\//u.test(val) ? val.split("/")[1] : `:${val}`)
      : sdkQueryShape(val)
  ]));
}
