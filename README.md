# My Logseq Toolkit

A growing collection of tools for Logseq. Its first module is an Obsidian-style local graph and synchronized references panel for Logseq DB graphs. The center follows the current Logseq page or zoomed block, while traversal uses semantic page hops and preserves the exact source and target blocks behind every visual edge.

## Toolkit commands

- **Open DB local graph** opens the local graph and references workspace.
- **Toolkit: Preview empty journal pages** lists journal pages that appear empty in the local DB, with dates and exclusion counts. It never deletes or changes pages. Today's journal, content, user properties, custom tags, references, and unverifiable pages are excluded from the list. Automatic creator/editor metadata does not count as content. The former cleanup command is now preview-only: a local journal can look empty before remote notes arrive, and sync can replay an unconditional deletion after those notes arrive. Automatic cleanup must remain disabled until emptiness can also be checked during sync replay. Reload this unpacked plugin in Logseq after updating it to activate the protection.

The journal preview checks sync automatically before scanning. It waits up to 30 seconds for an open connection, zero pending note/asset uploads and server operations, no missing upload files, and matching local/server versions and nonempty checksums. The same state must remain stable for two seconds. The sync graph UUID must match the active graph's persisted sync identity; a graph switch aborts the command. Missing, malformed, or unreadable status blocks the scan. If sync changes during the scan, the results are discarded and the scan is repeated after sync settles, within the same deadline. A timeout shows the reason instead of a journal list.

The status comes from Logseq's observed `rtc/state`, exposed by `App.getStateFromStore`; it is not a fresh server transaction barrier. It cannot include notes another offline device has not uploaded. The command therefore remains read-only, and a sync check must not be used to re-enable unconditional deletes.

## V1 behavior

- Page centers inspect every block on the page.
- Block centers inspect only the focused block and its descendants.
- External block endpoints are displayed as their containing page.
- Reached pages expand as a whole without consuming block-tree hops.
- Incoming and outgoing page references, block references, embeds, and external URLs are supported.
- Repeated and mixed relationships collapse to one visual edge while retaining occurrence-level provenance.
- Suggested relationships are visually distinct overlays and never affect actual traversal.
- Pan, zoom, node drag, fit, filtering, navigation, and graph/reference cross-highlighting run against the in-memory model.
- The force layout runs in a dedicated Web Worker and the graph renders on one high-DPI canvas rather than one DOM/SVG element per node and edge.
- The settings surface follows Obsidian's Filters, Display, and Forces organization, including label fade, node size, link thickness, and force controls.
- Same-depth page expansion uses bounded concurrency, duplicate SDK reads share in-flight promises, and the references panel incrementally mounts large occurrence lists.
- Route and database changes refresh with debouncing and latest-request-wins protection.

## Install for development

```bash
npm install
npm run build
```

In Logseq, enable Developer mode, choose **Load unpacked plugin**, and select this directory. Use the graph icon in the toolbar or run a toolkit command from the command palette.

## Commands

```bash
npm test       # semantic traversal and parser fixtures
npm run build  # type-check and production build
npm run dev    # Vite development server
```

## Injecting suggestions

V1 renders suggestions but does not generate them. Another plugin can invoke the provided model method `setLocalGraphSuggestions` with an array shaped like this:

```ts
type SuggestedRelationship = {
  id: string;
  source: { kind: "page" | "block" | "url"; id?: string; url?: string; pageId?: string; label?: string };
  target: { kind: "page" | "block" | "url"; id?: string; url?: string; pageId?: string; label?: string };
  score?: number;
  reason?: string;
  providerMetadata?: Record<string, unknown>;
};
```

Block endpoint IDs are Logseq database entity IDs. Supplying `pageId` avoids a lookup, but is optional. Suggestions disconnected from the visible actual graph are ignored, and suggestions duplicating an actual visible relationship are suppressed.

## Architecture

The renderer has no traversal or database logic. `LogseqRelationReader` reads exact occurrences; `traversal.ts` performs bounded-concurrency visible-node breadth-first traversal; `projector.ts` applies center/page promotion; `model.ts` aggregates edges; and `suggestions.ts` overlays hypothetical links after actual traversal is complete. `layoutWorker.ts` owns force simulation while `GraphCanvas.tsx` performs a single imperative canvas draw per animation frame.

The adapter follows the current Logseq SDK's DB graph fields (`:block/title`, `:block/refs`, `:block/page`) and keeps SDK-specific shapes outside the graph core.
