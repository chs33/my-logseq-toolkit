import type { EntityId, GraphCenter } from "./types";

export const pageNodeId = (pageId: EntityId): string => `page:${pageId}`;
export const blockNodeId = (blockId: EntityId): string => `block:${blockId}`;
export const urlNodeId = (url: string): string => `url:${url}`;

export const centerNodeId = (center: GraphCenter): string =>
  center.kind === "page" ? pageNodeId(center.pageId) : blockNodeId(center.blockId);

export const edgeId = (left: string, right: string, suggested = false): string => {
  const [a, b] = [left, right].sort();
  return `${suggested ? "suggested" : "actual"}:${a}--${b}`;
};
