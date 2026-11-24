import type { BlockRecord, PageRecord, RelationKind, RelationOccurrence } from "../core/types";
import { normalizeExternalUrl } from "../core/url";

export interface ParseResolver {
  resolvePage(value: string): Promise<PageRecord | null>;
  resolveBlock(value: string): Promise<BlockRecord | null>;
  getPageLabel(pageId: string): Promise<string | undefined>;
}

interface TextMatch {
  start: number;
  end: number;
  value: string;
  targetKind: "page" | "block" | "url";
  kind: RelationKind;
}

const inside = (position: number, ranges: Array<[number, number]>): boolean =>
  ranges.some(([start, end]) => position >= start && position < end);

function contextFor(title: string): string {
  const compact = title.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}

function collectMatches(title: string): TextMatch[] {
  const matches: TextMatch[] = [];
  const embedRanges: Array<[number, number]> = [];
  const embedPattern = /\{\{\s*embed\s+(?:\[\[([^\]]+)\]\]|\(\(([^)]+)\)\))\s*\}\}/giu;
  for (const match of title.matchAll(embedPattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    embedRanges.push([start, end]);
    matches.push({
      start,
      end,
      value: (match[1] ?? match[2]).trim(),
      targetKind: match[1] ? "page" : "block",
      kind: "embed"
    });
  }

  for (const match of title.matchAll(/\[\[([^\]]+)\]\]/gu)) {
    const start = match.index ?? 0;
    if (inside(start, embedRanges)) continue;
    matches.push({
      start,
      end: start + match[0].length,
      value: match[1].trim(),
      targetKind: "page",
      kind: "page_reference"
    });
  }

  for (const match of title.matchAll(/\(\(([^)]+)\)\)/gu)) {
    const start = match.index ?? 0;
    if (inside(start, embedRanges)) continue;
    matches.push({
      start,
      end: start + match[0].length,
      value: match[1].trim(),
      targetKind: "block",
      kind: "block_reference"
    });
  }

  for (const match of title.matchAll(/https?:\/\/[^\s<>\]"']+/giu)) {
    const start = match.index ?? 0;
    let value = match[0].replace(/[.,;:!?]+$/u, "");
    while (value.endsWith(")") && (value.match(/\(/g)?.length ?? 0) < (value.match(/\)/g)?.length ?? 0)) {
      value = value.slice(0, -1);
    }
    if (!normalizeExternalUrl(value)) continue;
    matches.push({
      start,
      end: start + value.length,
      value,
      targetKind: "url",
      kind: "external_url"
    });
  }
  return matches.sort((a, b) => a.start - b.start);
}

export async function parseBlockRelationships(
  block: BlockRecord,
  resolver: ParseResolver,
  enabledTypes: ReadonlySet<RelationKind>
): Promise<RelationOccurrence[]> {
  const matches = collectMatches(block.title).filter((match) => enabledTypes.has(match.kind));
  if (matches.length === 0) return [];
  const sourcePageLabel = await resolver.getPageLabel(block.pageId);
  const occurrences = await Promise.all(matches.map(async (match): Promise<RelationOccurrence | null> => {
    const base = {
      id: `${block.id}:${match.kind}:${match.start}:${match.value}`,
      kind: match.kind,
      sourceBlockId: block.id,
      sourceBlockUuid: block.uuid,
      sourcePageId: block.pageId,
      sourcePageLabel,
      sourceContext: contextFor(block.title)
    } as const;

    if (match.targetKind === "url") {
      return { ...base, targetKind: "url", targetUrl: match.value };
    }

    if (match.targetKind === "page") {
      const page = await resolver.resolvePage(match.value);
      if (!page) return null;
      return {
        ...base,
        targetKind: "page",
        targetPageId: page.id,
        targetPageLabel: page.label
      };
    }

    const target = await resolver.resolveBlock(match.value);
    if (!target) return null;
    return {
      ...base,
      targetKind: "block",
      targetBlockId: target.id,
      targetBlockUuid: target.uuid,
      targetBlockPageId: target.pageId,
      targetBlockLabel: contextFor(target.title),
      targetPageLabel: await resolver.getPageLabel(target.pageId)
    };
  }));
  return occurrences.filter((item): item is RelationOccurrence => item !== null);
}

export const __private__ = { collectMatches };
