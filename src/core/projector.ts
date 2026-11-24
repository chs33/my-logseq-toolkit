import { blockNodeId, centerNodeId, pageNodeId, urlNodeId } from "./ids";
import { normalizeExternalUrl, urlLabel } from "./url";
import type {
  GraphCenter,
  GraphNode,
  RelationOccurrence,
  RelationReader,
  SuggestedEndpoint
} from "./types";

export interface Projection {
  node: GraphNode;
  nodeId: string;
}

function centerProjection(center: GraphCenter): Projection {
  if (center.kind === "page") {
    const id = pageNodeId(center.pageId);
    return {
      nodeId: id,
      node: {
        id,
        kind: "page",
        pageId: center.pageId,
        label: center.label,
        depth: 0,
        isCenter: true,
        suggestedOnly: false
      }
    };
  }
  const id = blockNodeId(center.blockId);
  return {
    nodeId: id,
    node: {
      id,
      kind: "center_block",
      blockId: center.blockId,
      blockUuid: center.blockUuid,
      pageId: center.pageId,
      label: center.label,
      depth: 0,
      isCenter: true,
      suggestedOnly: false
    }
  };
}

export function createCenterNode(center: GraphCenter): GraphNode {
  return centerProjection(center).node;
}

async function pageProjection(
  pageId: string,
  label: string | undefined,
  depth: number,
  reader: RelationReader,
  suggestedOnly = false
): Promise<Projection | null> {
  const page = label ? { id: pageId, label } : await reader.getPage(pageId);
  if (!page) return null;
  const id = pageNodeId(pageId);
  return {
    nodeId: id,
    node: {
      id,
      kind: "page",
      pageId,
      label: page.label,
      depth,
      isCenter: false,
      suggestedOnly
    }
  };
}

export async function projectOccurrenceSource(
  occurrence: RelationOccurrence,
  center: GraphCenter,
  depth: number,
  reader: RelationReader
): Promise<Projection | null> {
  if (center.contentBlockIds.has(occurrence.sourceBlockId)) return centerProjection(center);
  return pageProjection(
    occurrence.sourcePageId,
    occurrence.sourcePageLabel,
    depth,
    reader
  );
}

export async function projectOccurrenceTarget(
  occurrence: RelationOccurrence,
  center: GraphCenter,
  depth: number,
  reader: RelationReader
): Promise<Projection | null> {
  if (occurrence.targetKind === "url" && occurrence.targetUrl) {
    const normalized = normalizeExternalUrl(occurrence.targetUrl);
    if (!normalized) return null;
    const id = urlNodeId(normalized);
    return {
      nodeId: id,
      node: {
        id,
        kind: "url",
        url: normalized,
        label: urlLabel(normalized),
        depth,
        isCenter: false,
        suggestedOnly: false
      }
    };
  }

  if (occurrence.targetKind === "block" && occurrence.targetBlockId) {
    if (center.contentBlockIds.has(occurrence.targetBlockId)) return centerProjection(center);
    const pageId = occurrence.targetBlockPageId;
    if (!pageId) return null;
    return pageProjection(pageId, occurrence.targetPageLabel, depth, reader);
  }

  if (occurrence.targetKind === "page" && occurrence.targetPageId) {
    if (center.kind === "page" && occurrence.targetPageId === center.pageId) {
      return centerProjection(center);
    }
    return pageProjection(
      occurrence.targetPageId,
      occurrence.targetPageLabel,
      depth,
      reader
    );
  }
  return null;
}

export async function projectSuggestedEndpoint(
  endpoint: SuggestedEndpoint,
  center: GraphCenter,
  depth: number,
  reader: RelationReader
): Promise<Projection | null> {
  if (endpoint.kind === "url" && endpoint.url) {
    const normalized = normalizeExternalUrl(endpoint.url);
    if (!normalized) return null;
    const id = urlNodeId(normalized);
    return {
      nodeId: id,
      node: {
        id,
        kind: "url",
        url: normalized,
        label: endpoint.label ?? urlLabel(normalized),
        depth,
        isCenter: false,
        suggestedOnly: true
      }
    };
  }

  if (endpoint.kind === "page" && endpoint.id) {
    if (center.kind === "page" && endpoint.id === center.pageId) return centerProjection(center);
    return pageProjection(endpoint.id, endpoint.label, depth, reader, true);
  }

  if (endpoint.kind === "block" && endpoint.id) {
    if (center.contentBlockIds.has(endpoint.id)) return centerProjection(center);
    let pageId = endpoint.pageId;
    let label = endpoint.label;
    if (!pageId) {
      const block = await reader.getBlock(endpoint.id);
      if (!block) return null;
      pageId = block.pageId;
    }
    const page = await pageProjection(pageId, undefined, depth, reader, true);
    if (page && label && !page.node.label) page.node.label = label;
    return page;
  }
  return null;
}

export { centerNodeId };
