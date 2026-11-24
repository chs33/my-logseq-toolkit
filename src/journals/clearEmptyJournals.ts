import {
  attribute,
  JOURNAL_SCAN_QUERY,
  parseJournalRows,
  summarizeJournals
} from "./journalSnapshot";
import { readAfterSync, SyncGuardError } from "./syncGuard";

let cleanupRunning = false;

export async function previewEmptyJournalPages(): Promise<void> {
  if (cleanupRunning) {
    await logseq.UI.showMsg("Empty journal preview is already running.", "warning");
    return;
  }

  cleanupRunning = true;
  try {
    await logseq.UI.showMsg("Checking sync before scanning journals…", "info", { timeout: 3000 });
    const rows = await readAfterSync(() => logseq.DB.datascriptQuery(JOURNAL_SCAN_QUERY));
    const pages = parseJournalRows(rows);
    const { candidates, excluded, journals } = summarizeJournals(pages);
    const breakdown = `Checked ${journals} journals: ${candidates.length} appear empty locally; ` +
      `${excluded.today} today, ${excluded.content} with content/tags, ` +
      `${excluded.properties} with properties, ${excluded.references} referenced, ` +
      `${excluded.unreadable} could not be verified.`;
    const dates = candidates.slice(0, 10).map(page => String(attribute(page, "block/title"))).join(", ");
    console.info("Empty journal preview:", breakdown, candidates.map(page => attribute(page, "block/title")));
    // Local checks cannot protect a delete replayed after remote notes arrive.
    // Keep this read-only until emptiness can also be checked during sync replay.
    await logseq.UI.showMsg(
      "Preview only: no journal pages were deleted.\n\n" + breakdown +
      (dates ? `\n\n${dates}${candidates.length > 10 ? ", …" : ""}` : "") +
      "\n\nSync status was stable with empty queues and matching local/server versions and checksums. " +
      "Notes on an offline device may still arrive later. Automatic deletion is disabled to protect those notes.",
      excluded.unreadable ? "warning" : "info",
      { timeout: 20000 }
    );
  } catch (error) {
    if (error instanceof SyncGuardError) {
      await logseq.UI.showMsg(`Journal preview blocked: ${error.message} No journal pages were changed.`, "warning", { timeout: 20000 });
      return;
    }
    console.error("Empty journal preview failed", error);
    await logseq.UI.showMsg("Journal preview could not read the graph. See the console for details.", "error");
  } finally {
    cleanupRunning = false;
  }
}
