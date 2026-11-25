import "@logseq/libs";
import type { SuggestedRelationship } from "./core/types";
import { previewEmptyJournalPages } from "./journals/clearEmptyJournals";
import { suggestionStore } from "./suggestions/store";
import { registerGraphSidebar } from "./ui/sidebar";

async function main() {
  const unregisterCommands: Array<() => void> = [];
  const sidebar = await registerGraphSidebar();
  const openGraph = sidebar.open;
  logseq.provideModel({
    openDbLocalGraph: openGraph,
    toggleDbLocalGraph: sidebar.toggle,
    setLocalGraphSuggestions: (suggestions: SuggestedRelationship[]) => {
      suggestionStore.set(Array.isArray(suggestions) ? suggestions : []);
    }
  });

  logseq.App.registerUIItem("toolbar", {
    key: "db-local-graph-toolbar",
    template: `
      <a class="button" data-on-click="toggleDbLocalGraph" title="Toggle DB local graph in right sidebar (Ctrl+Alt+G / ⌘+Option+G)" aria-label="Toggle DB local graph in right sidebar">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M4 5.5 9 2l5 3.5M4 5.5l1 7L9 16m5-10.5-1 7L9 16M4 5.5l9 7M14 5.5l-9 7" stroke="currentColor" stroke-width="1.4"/>
          <circle cx="4" cy="5.5" r="1.7" fill="currentColor"/><circle cx="14" cy="5.5" r="1.7" fill="currentColor"/><circle cx="9" cy="2" r="1.7" fill="currentColor"/><circle cx="5" cy="12.5" r="1.7" fill="currentColor"/><circle cx="13" cy="12.5" r="1.7" fill="currentColor"/><circle cx="9" cy="16" r="1.7" fill="currentColor"/>
        </svg>
      </a>`
  });

  const unregisterGraphCommand = logseq.App.registerCommandPalette(
    { key: "open-db-local-graph", label: "Open DB local graph" },
    openGraph
  );
  if (typeof unregisterGraphCommand === "function") unregisterCommands.push(unregisterGraphCommand);

  const unregisterGraphToggle = logseq.App.registerCommandPalette(
    {
      key: "toggle-db-local-graph",
      label: "Toggle DB local graph",
      keybinding: { binding: "mod+alt+g", mode: "global" }
    },
    sidebar.toggle
  );
  if (typeof unregisterGraphToggle === "function") unregisterCommands.push(unregisterGraphToggle);

  const unregisterJournalCleanup = logseq.App.registerCommandPalette(
    {
      key: "clear-empty-journal-pages",
      label: "Toolkit: Preview empty journal pages"
    },
    previewEmptyJournalPages
  );
  if (typeof unregisterJournalCleanup === "function") {
    unregisterCommands.push(unregisterJournalCleanup);
  }

  logseq.beforeunload(async () => {
    sidebar.dispose();
    unregisterCommands.forEach((unregister) => unregister());
  });
  logseq.hideMainUI({ restoreEditingCursor: true });
}

logseq.ready(main).catch((error) => console.error("My Logseq Toolkit failed to start", error));
