import { addSuggestedEdge } from "./model";
import { projectSuggestedEndpoint } from "./projector";
import type { GraphModel, RelationReader, SuggestedRelationship } from "./types";

export async function overlaySuggestions(
  model: GraphModel,
  suggestions: SuggestedRelationship[],
  reader: RelationReader
): Promise<GraphModel> {
  for (const suggestion of suggestions) {
    const [source, target] = await Promise.all([
      projectSuggestedEndpoint(suggestion.source, model.center, 1, reader),
      projectSuggestedEndpoint(suggestion.target, model.center, 1, reader)
    ]);
    if (!source || !target || source.nodeId === target.nodeId) continue;
    const sourceVisible = model.nodes.has(source.nodeId);
    const targetVisible = model.nodes.has(target.nodeId);
    if (!sourceVisible && !targetVisible) continue;

    const anchor = sourceVisible ? model.nodes.get(source.nodeId)! : model.nodes.get(target.nodeId)!;
    const introduced = sourceVisible ? target : source;
    introduced.node.depth = Math.min(3, anchor.depth + 1);
    introduced.node.suggestedOnly = true;
    if (!model.nodes.has(introduced.nodeId)) model.nodes.set(introduced.nodeId, introduced.node);

    addSuggestedEdge(model, source.nodeId, target.nodeId, suggestion);
  }
  return model;
}
