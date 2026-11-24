import { centerNodeId } from "./ids";
import { addActualOccurrence, createGraphModel } from "./model";
import {
  createCenterNode,
  projectOccurrenceSource,
  projectOccurrenceTarget,
  type Projection
} from "./projector";
import type {
  ExpansionContent,
  GraphCenter,
  GraphFilters,
  GraphModel,
  GraphNode,
  RelationOccurrence,
  RelationReader
} from "./types";

interface ProjectedRelation {
  relation: RelationOccurrence;
  source: Projection;
  target: Projection;
}

async function mapLimit<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function expansionContent(
  node: GraphNode,
  center: GraphCenter,
  reader: RelationReader
): Promise<ExpansionContent> {
  if (node.id === centerNodeId(center)) {
    return {
      blockIds: center.contentBlockIds,
      pageId: center.kind === "page" ? center.pageId : undefined
    };
  }
  if (node.kind === "page" && node.pageId) {
    const blocks = await reader.getPageBlocks(node.pageId);
    return { blockIds: new Set(blocks.map((block) => block.id)), pageId: node.pageId };
  }
  return { blockIds: new Set() };
}

function ensureNode(model: GraphModel, candidate: GraphNode, depth: number): GraphNode {
  const existing = model.nodes.get(candidate.id);
  if (existing) {
    if (depth < existing.depth) existing.depth = depth;
    if (!candidate.suggestedOnly) existing.suggestedOnly = false;
    return existing;
  }
  candidate.depth = depth;
  model.nodes.set(candidate.id, candidate);
  return candidate;
}

async function projectExpansion(
  current: GraphNode,
  center: GraphCenter,
  filters: GraphFilters,
  reader: RelationReader
): Promise<ProjectedRelation[]> {
  const content = await expansionContent(current, center, reader);
  const relations = await reader.getRelations(content, filters);
  const candidateDepth = current.depth + 1;
  const projected = await mapLimit(relations, 24, async (relation) => {
    const [source, target] = await Promise.all([
      projectOccurrenceSource(relation, center, candidateDepth, reader),
      projectOccurrenceTarget(relation, center, candidateDepth, reader)
    ]);
    return source && target ? { relation, source, target } : null;
  });
  return projected.filter((item): item is ProjectedRelation => item !== null);
}

/**
 * Breadth-first traversal over semantic visible nodes. Expansions at the same
 * depth are read concurrently (bounded to protect the Logseq bridge), then
 * merged deterministically on the UI thread.
 */
export async function buildActualGraph(
  center: GraphCenter,
  filters: GraphFilters,
  reader: RelationReader
): Promise<GraphModel> {
  const centerNode = createCenterNode(center);
  const model = createGraphModel(center, centerNode);
  const expanded = new Set<string>();
  let frontier: GraphNode[] = [centerNode];

  for (let depth = 0; depth < filters.depth && frontier.length > 0; depth += 1) {
    const currentFrontier = frontier.filter(
      (node) => !expanded.has(node.id) && node.kind !== "url" && node.depth < filters.depth
    );
    currentFrontier.forEach((node) => expanded.add(node.id));
    const batches = await mapLimit(currentFrontier, 6, async (node) => ({
      node,
      relations: await projectExpansion(node, center, filters, reader)
    }));
    const next = new Map<string, GraphNode>();

    for (const { node: current, relations } of batches) {
      const candidateDepth = current.depth + 1;
      for (const { relation, source, target } of relations) {
        if (source.nodeId === target.nodeId) continue;
        if (source.nodeId !== current.id && target.nodeId !== current.id) continue;

        const sourceDepth = source.nodeId === current.id ? current.depth : candidateDepth;
        const targetDepth = target.nodeId === current.id ? current.depth : candidateDepth;
        const sourceNode = ensureNode(model, source.node, sourceDepth);
        const targetNode = ensureNode(model, target.node, targetDepth);
        addActualOccurrence(model, {
          occurrence: relation,
          sourceNodeId: sourceNode.id,
          targetNodeId: targetNode.id
        });

        const neighbor = sourceNode.id === current.id ? targetNode : sourceNode;
        if (neighbor.kind === "page" && neighbor.depth < filters.depth && !expanded.has(neighbor.id)) {
          next.set(neighbor.id, neighbor);
        }
      }
    }
    frontier = [...next.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  return model;
}
