import type { GraphModel } from "../core/types";
import type { InteractionFocus } from "./interaction";

const LABELS = {
  page_reference: "page references",
  block_reference: "block references",
  embed: "embeds",
  external_url: "external URLs"
} as const;

export function EdgeInspector({ model, focus }: { model: GraphModel; focus: InteractionFocus }) {
  let edge = focus.edgeId ? model.edges.get(focus.edgeId) : undefined;
  if (!edge && focus.occurrenceId) {
    edge = [...model.edges.values()].find((candidate) =>
      candidate.actualOccurrences.some((item) => item.occurrence.id === focus.occurrenceId)
    );
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
}
