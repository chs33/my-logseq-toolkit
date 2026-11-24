import { edgeId } from "./ids";
import type {
  GraphCenter,
  GraphModel,
  GraphNode,
  ProjectedOccurrence,
  RelationKind,
  SuggestedRelationship,
  VisualEdge
} from "./types";

const emptyCounts = (): Record<RelationKind, number> => ({
  page_reference: 0,
  block_reference: 0,
  embed: 0,
  external_url: 0
});

export function createGraphModel(center: GraphCenter, centerNode: GraphNode): GraphModel {
  return {
    center,
    nodes: new Map([[centerNode.id, centerNode]]),
    edges: new Map(),
    occurrences: new Map()
  };
}

export function addActualOccurrence(
  model: GraphModel,
  projected: ProjectedOccurrence
): VisualEdge | null {
  if (projected.sourceNodeId === projected.targetNodeId) return null;
  if (model.occurrences.has(projected.occurrence.id)) return null;

  const [nodeA, nodeB] = [projected.sourceNodeId, projected.targetNodeId].sort();
  const id = edgeId(nodeA, nodeB);
  let edge = model.edges.get(id);
  if (!edge) {
    edge = {
      id,
      nodeA,
      nodeB,
      actualOccurrences: [],
      countsByDirection: { aToB: 0, bToA: 0 },
      countsByType: emptyCounts(),
      suggested: false,
      suggestions: []
    };
    model.edges.set(id, edge);
  }

  edge.actualOccurrences.push(projected);
  edge.countsByType[projected.occurrence.kind] += 1;
  if (projected.sourceNodeId === nodeA) edge.countsByDirection.aToB += 1;
  else edge.countsByDirection.bToA += 1;
  model.occurrences.set(projected.occurrence.id, projected);
  return edge;
}

export function addSuggestedEdge(
  model: GraphModel,
  sourceNodeId: string,
  targetNodeId: string,
  suggestion: SuggestedRelationship
): VisualEdge | null {
  if (sourceNodeId === targetNodeId) return null;
  if (model.edges.has(edgeId(sourceNodeId, targetNodeId))) return null;

  const [nodeA, nodeB] = [sourceNodeId, targetNodeId].sort();
  const id = edgeId(nodeA, nodeB, true);
  let edge = model.edges.get(id);
  if (!edge) {
    edge = {
      id,
      nodeA,
      nodeB,
      actualOccurrences: [],
      countsByDirection: { aToB: 0, bToA: 0 },
      countsByType: emptyCounts(),
      suggested: true,
      suggestions: []
    };
    model.edges.set(id, edge);
  }
  edge.suggestions.push(suggestion);
  return edge;
}
