import { memo, useMemo } from "react";
import type { GraphModel, VisualEdge } from "../core/types";
import type { InteractionFocus } from "./interaction";

const LABELS = {
  page_reference: "page references",
  block_reference: "block references",
  embed: "embeds",
  external_url: "external URLs"
} as const;

export const EdgeInspector = memo(function EdgeInspector({ model, focus }: { model: GraphModel; focus: InteractionFocus }) {
  const edgeByOccurrence = useMemo(() => {
    const index = new Map<string, VisualEdge>();
    for (const edge of model.edges.values()) {
      for (const item of edge.actualOccurrences) index.set(item.occurrence.id, edge);
    }
    return index;
  }, [model]);
  let edge = focus.edgeId ? model.edges.get(focus.edgeId) : undefined;
  if (!edge && focus.occurrenceId) {
    edge = edgeByOccurrence.get(focus.occurrenceId);
  }
  if (!edge) return null;
  const a = model.nodes.get(edge.nodeA);
  const b = model.nodes.get(edge.nodeB);
  return (
    <div className="lg-edge-inspector">
      <strong>{a?.label} {edge.suggested ? "⇢" : "↔"} {b?.label}</strong>
      {edge.suggested ? (
        <span>{edge.suggestions.length} suggested relationship{edge.suggestions.length === 1 ? "" : "s"}</span>
      ) : (
        <>
          <span>{edge.actualOccurrences.length} occurrence{edge.actualOccurrences.length === 1 ? "" : "s"}</span>
          <span>{edge.countsByDirection.aToB} → · {edge.countsByDirection.bToA} ←</span>
          {Object.entries(edge.countsByType).filter(([, count]) => count > 0).map(([kind, count]) => (
            <span key={kind}>{count} {LABELS[kind as keyof typeof LABELS]}</span>
          ))}
        </>
      )}
    </div>
  );
});
