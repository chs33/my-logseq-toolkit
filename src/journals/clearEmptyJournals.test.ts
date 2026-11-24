import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewEmptyJournalPages } from "./clearEmptyJournals";
import { JOURNAL_SCAN_QUERY } from "./journalSnapshot";
import { GRAPH_UUID_QUERY } from "./syncGuard";
import { emptyJournal, graphInfo, graphUuid, sdkQueryShape, syncedState, today } from "./journalFixtures";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(today);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(rows: unknown = [[emptyJournal()]]) {
  const journalQuery = vi.fn().mockResolvedValue(sdkQueryShape(rows));
  const query = vi.fn((q: string) => q === GRAPH_UUID_QUERY ? Promise.resolve(graphUuid) : journalQuery(q));
  const deletePage = vi.fn().mockResolvedValue(undefined);
  const showMsg = vi.fn().mockResolvedValue(undefined);
  const confirm = vi.fn(() => true);
  const App = {
    getCurrentGraph: vi.fn().mockResolvedValue(graphInfo),
    getStateFromStore: vi.fn().mockResolvedValue(syncedState())
  };
  vi.stubGlobal("logseq", { App, DB: { datascriptQuery: query }, Editor: { deletePage }, UI: { showMsg } });
  vi.stubGlobal("window", { confirm });
  return { query, journalQuery, deletePage, showMsg, confirm, App };
}

async function finishPreview() {
  const result = previewEmptyJournalPages();
  await vi.advanceTimersByTimeAsync(2000);
  await result;
}

describe("read-only empty journal preview", () => {
  it("previews locally empty journals without issuing a deletion, even if confirmation would succeed", async () => {
    const { query, deletePage, showMsg, confirm } = setup();
    await finishPreview();
    expect(query).toHaveBeenNthCalledWith(1, GRAPH_UUID_QUERY);
    expect(query).toHaveBeenNthCalledWith(2, JOURNAL_SCAN_QUERY);
    expect(query).toHaveBeenCalledTimes(2);
    expect(confirm).not.toHaveBeenCalled();
    expect(deletePage).not.toHaveBeenCalled();
    expect(showMsg).toHaveBeenCalledWith(
      expect.stringContaining("2026_11_04"), "info", expect.any(Object)
    );
    expect(showMsg).toHaveBeenCalledWith(
      expect.stringContaining("Automatic deletion is disabled"), "info", expect.any(Object)
    );
  });

  it("works when the host exposes no write APIs at all", async () => {
    const { showMsg, query, App } = setup();
    vi.stubGlobal("logseq", {
      App,
      DB: { datascriptQuery: query },
      Editor: new Proxy({}, { get: () => { throw new Error("Write API must not be accessed"); } }),
      UI: { showMsg }
    });
    await finishPreview();
    expect(showMsg).toHaveBeenCalledWith(
      expect.stringContaining("Preview only"), "info", expect.any(Object)
    );
  });

  it("reports exclusions for populated journals and user properties", async () => {
    const { journalQuery, deletePage, showMsg } = setup([
      [emptyJournal({ "block/_page": [{ "db/id": 123, "block/title": "Keep this note" }] })],
      [emptyJournal({ "user.property/mood": false })]
    ]);
    await finishPreview();
    expect(journalQuery).toHaveBeenCalledOnce();
    expect(deletePage).not.toHaveBeenCalled();
    expect(showMsg).toHaveBeenCalledWith(
      expect.stringContaining("0 appear empty locally; 0 today, 1 with content/tags, 1 with properties"),
      "info", expect.any(Object)
    );
  });

  it("warns when a journal cannot be verified", async () => {
    const { showMsg, deletePage } = setup([[emptyJournal({ "block/_page": null })]]);
    await finishPreview();
    expect(showMsg).toHaveBeenCalledWith(
      expect.stringContaining("1 could not be verified"), "warning", expect.any(Object)
    );
    expect(deletePage).not.toHaveBeenCalled();
  });

  it("reports query failure and releases the running guard", async () => {
    const { journalQuery, deletePage, showMsg } = setup();
    journalQuery.mockRejectedValueOnce(new Error("Worker unavailable"));
    await finishPreview();
    expect(showMsg).toHaveBeenCalledWith(expect.stringContaining("could not read"), "error");
    await finishPreview();
    expect(showMsg).toHaveBeenCalledWith(expect.stringContaining("Preview only"), "info", expect.any(Object));
    expect(deletePage).not.toHaveBeenCalled();
  });

  it("rejects overlapping previews without a second query", async () => {
    const { journalQuery, showMsg, deletePage } = setup();
    let resolveQuery!: (value: unknown) => void;
    journalQuery.mockImplementationOnce(() => new Promise(resolve => { resolveQuery = resolve; }));
    const first = previewEmptyJournalPages();
    await vi.advanceTimersByTimeAsync(2000);
    await previewEmptyJournalPages();
    expect(showMsg).toHaveBeenCalledWith(expect.stringContaining("already running"), "warning");
    resolveQuery(sdkQueryShape([[emptyJournal()]]));
    await first;
    expect(journalQuery).toHaveBeenCalledOnce();
    expect(deletePage).not.toHaveBeenCalled();
  });

  it("blocks the journal query on timeout and lets a later attempt run once sync is ready", async () => {
    const { App, journalQuery, showMsg, deletePage } = setup();
    App.getStateFromStore.mockResolvedValue(syncedState({ pendingServerOpsCount: 1 }));
    const blocked = previewEmptyJournalPages();
    await vi.advanceTimersByTimeAsync(30000);
    await blocked;
    expect(journalQuery).not.toHaveBeenCalled();
    expect(showMsg).toHaveBeenCalledWith(
      expect.stringContaining("Sync did not settle within 30 seconds"), "warning", expect.any(Object)
    );
    App.getStateFromStore.mockResolvedValue(syncedState());
    await finishPreview();
    expect(journalQuery).toHaveBeenCalledOnce();
    expect(deletePage).not.toHaveBeenCalled();
  });
});
