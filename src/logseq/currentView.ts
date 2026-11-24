import type { GraphCenter } from "../core/types";
import { LogseqRelationReader, logseqEntity } from "./LogseqRelationReader";

type RawEntity = Record<string, any>;

function isPage(raw: RawEntity): boolean {
  return Boolean(raw.name ?? raw["block/name"] ?? raw[":block/name"] ?? raw.type === "page");
}

function readableLabel(value: string): string {
  const plain = value
    .replace(/\{\{[^}]+\}\}/gu, "")
    .replace(/\[\[([^\]]+)\]\]/gu, "$1")
    .replace(/\(\(([^)]+)\)\)/gu, "$1")
    .replace(/[*_`#>]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return plain.length > 58 ? `${plain.slice(0, 55)}…` : plain || "Untitled block";
}

export async function resolveCurrentCenter(
  reader: LogseqRelationReader
): Promise<GraphCenter | null> {
  const current = (await logseq.Editor.getCurrentPage()) as RawEntity | null;
  if (!current) return null;

  if (!isPage(current)) {
    const blockId = logseqEntity.entityId(current);
    const block = await reader.getBlock(blockId);
    if (!block) return null;
    const subtree = await reader.getBlockSubtree(block.id);
    return {
      kind: "block",
      blockId: block.id,
      blockUuid: block.uuid,
      pageId: block.pageId,
      label: readableLabel(block.title),
      contentBlockIds: new Set(subtree.map((item) => item.id))
    };
  }

  const pageId = logseqEntity.entityId(current);
  const page = await reader.getPage(pageId);
  if (!page) return null;
  const blocks = await reader.getPageBlocks(pageId);
  return {
    kind: "page",
    pageId,
    label: page.label,
    contentBlockIds: new Set(blocks.map((block) => block.id))
  };
}
