import type { GraphNode, ProjectedOccurrence } from "../core/types";

export async function navigateNode(node: GraphNode): Promise<void> {
  if (node.kind === "url" && node.url) {
    await logseq.App.openExternalLink(node.url);
    return;
  }
  if (node.kind === "page" && node.pageId) {
    const page = await logseq.Editor.getPage(/^\d+$/u.test(node.pageId) ? Number(node.pageId) : node.pageId);
    if (page) logseq.App.pushState("page", { name: page.name ?? page.uuid });
    return;
  }
  if (node.kind === "center_block" && node.blockUuid) {
    const block = await logseq.Editor.getBlock(node.blockUuid);
    const page = block?.page ? await logseq.Editor.getPage(block.page as any) : null;
    if (page) logseq.Editor.scrollToBlockInPage(page.name, node.blockUuid);
  }
}

export async function navigateOccurrence(
  projected: ProjectedOccurrence,
  direction: "outgoing" | "incoming" = "outgoing"
): Promise<void> {
  const relation = projected.occurrence;
  if (direction === "incoming" && relation.sourceBlockUuid) {
    const page = await logseq.Editor.getPage(/^\d+$/u.test(relation.sourcePageId)
      ? Number(relation.sourcePageId)
      : relation.sourcePageId);
    if (page) logseq.Editor.scrollToBlockInPage(page.name, relation.sourceBlockUuid);
    return;
  }
  if (relation.kind === "external_url" && relation.targetUrl) {
    await logseq.App.openExternalLink(relation.targetUrl);
    return;
  }
  if (relation.targetKind === "block" && relation.targetBlockUuid) {
    const page = relation.targetBlockPageId
      ? await logseq.Editor.getPage(/^\d+$/u.test(relation.targetBlockPageId)
        ? Number(relation.targetBlockPageId)
        : relation.targetBlockPageId)
      : null;
    if (page) logseq.Editor.scrollToBlockInPage(page.name, relation.targetBlockUuid);
    return;
  }
  if (relation.targetKind === "page" && relation.targetPageId) {
    const page = await logseq.Editor.getPage(/^\d+$/u.test(relation.targetPageId)
      ? Number(relation.targetPageId)
      : relation.targetPageId);
    if (page) logseq.App.pushState("page", { name: page.name ?? page.uuid });
    return;
  }
  if (relation.sourceBlockUuid) {
    const page = await logseq.Editor.getPage(/^\d+$/u.test(relation.sourcePageId)
      ? Number(relation.sourcePageId)
      : relation.sourcePageId);
    if (page) logseq.Editor.scrollToBlockInPage(page.name, relation.sourceBlockUuid);
  }
}
