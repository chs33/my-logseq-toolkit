import { useEffect, useMemo, useState } from "react";
import type { GraphModel, ProjectedOccurrence, VisualEdge } from "../core/types";
import type { InteractionFocus } from "./interaction";

interface ReferencesPanelProps {
  model: GraphModel;
  focus: InteractionFocus;
  onFocus: (focus: InteractionFocus) => void;
  onNavigate: (occurrence: ProjectedOccurrence, direction: "outgoing" | "incoming") => void;
}

const TYPE_LABEL = {
  page_reference: "Page reference",
  block_reference: "Block reference",
  embed: "Embed",
  external_url: "External URL"
} as const;

function referenceDirection(model: GraphModel, item: ProjectedOccurrence): "outgoing" | "incoming" {
  const source = model.nodes.get(item.sourceNodeId)!;
  const target = model.nodes.get(item.targetNodeId)!;
  return source.depth <= target.depth ? "outgoing" : "incoming";
}

function neighborFor(model: GraphModel, item: ProjectedOccurrence): string {
  const source = model.nodes.get(item.sourceNodeId)!;
  const target = model.nodes.get(item.targetNodeId)!;
  return source.depth <= target.depth ? target.label : source.label;
}

function ReferenceSection({
  title,
  items,
  model,
  focus,
  edgeByOccurrence,
  onFocus,
  onNavigate
}: {
  title: string;
  items: ProjectedOccurrence[];
  model: GraphModel;
  focus: InteractionFocus;
  edgeByOccurrence: ReadonlyMap<string, VisualEdge>;
  onFocus: (focus: InteractionFocus) => void;
  onNavigate: (occurrence: ProjectedOccurrence, direction: "outgoing" | "incoming") => void;
}) {
  const [limit, setLimit] = useState(120);
  useEffect(() => setLimit(120), [model]);
  const visibleItems = items.slice(0, limit);
  const groups = useMemo(() => {
    const grouped = new Map<string, ProjectedOccurrence[]>();
    for (const item of visibleItems) {
      const label = neighborFor(model, item);
      const group = grouped.get(label) ?? [];
      group.push(item);
      grouped.set(label, group);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visibleItems, model]);

  return (
    <section className="lg-reference-section">
      <h3>{title}<span>{items.length}</span></h3>
      {groups.length === 0 && <p className="lg-empty-small">None in this neighborhood</p>}
      {groups.map(([label, entries]) => (
        <div className="lg-reference-group" key={label}>
          <div className="lg-reference-group-title"><span>{label}</span><b>{entries.length}</b></div>
          {entries.map((item) => {
            const edge = edgeByOccurrence.get(item.occurrence.id);
            const direction = referenceDirection(model, item);
            const active = focus.occurrenceId === item.occurrence.id || focus.edgeId === edge?.id ||
              (focus.nodeId && (focus.nodeId === item.sourceNodeId || focus.nodeId === item.targetNodeId));
            return (
              <button
                type="button"
                className={`lg-reference ${active ? "is-active" : ""}`}
                key={item.occurrence.id}
                onMouseEnter={() => onFocus({ occurrenceId: item.occurrence.id, edgeId: edge?.id })}
                onMouseLeave={() => onFocus({})}
                onClick={() => onNavigate(item, direction)}
              >
                <span className={`lg-relation-badge is-${item.occurrence.kind}`}>{TYPE_LABEL[item.occurrence.kind]}</span>
                <span className="lg-reference-context">{item.occurrence.sourceContext || "Open exact occurrence"}</span>
              </button>
            );
          })}
        </div>
      ))}
      {limit < items.length && (
        <button className="lg-load-more" type="button" onClick={() => setLimit((value) => value + 120)}>
          Show 120 more
        </button>
      )}
    </section>
  );
}

export function ReferencesPanel({ model, focus, onFocus, onNavigate }: ReferencesPanelProps) {
  const { actual, outgoing, incoming, suggestions, edgeByOccurrence } = useMemo(() => {
    const actualItems = [...model.occurrences.values()];
    const edgeIndex = new Map<string, VisualEdge>();
    const suggestedEdges: VisualEdge[] = [];
    for (const edge of model.edges.values()) {
      if (edge.suggested) suggestedEdges.push(edge);
      for (const item of edge.actualOccurrences) edgeIndex.set(item.occurrence.id, edge);
    }
    return {
      actual: actualItems,
      outgoing: actualItems.filter((item) => referenceDirection(model, item) === "outgoing"),
      incoming: actualItems.filter((item) => referenceDirection(model, item) === "incoming"),
      suggestions: suggestedEdges,
      edgeByOccurrence: edgeIndex
    };
  }, [model]);
  return (
    <aside className="lg-references">
      <div className="lg-references-heading">
        <span>References</span>
        <b>{actual.length + suggestions.reduce((total, edge) => total + edge.suggestions.length, 0)}</b>
      </div>
      <div className="lg-references-scroll">
        <ReferenceSection title="Outgoing" items={outgoing} model={model} focus={focus} edgeByOccurrence={edgeByOccurrence} onFocus={onFocus} onNavigate={onNavigate} />
        <ReferenceSection title="Incoming" items={incoming} model={model} focus={focus} edgeByOccurrence={edgeByOccurrence} onFocus={onFocus} onNavigate={onNavigate} />
        <section className="lg-reference-section">
          <h3>Suggested<span>{suggestions.reduce((total, edge) => total + edge.suggestions.length, 0)}</span></h3>
          {suggestions.length === 0 && <p className="lg-empty-small">No visible suggestions</p>}
          {suggestions.flatMap((edge) => edge.suggestions.map((suggestion) => {
            const active = focus.edgeId === edge.id;
            return (
              <button
                type="button"
                className={`lg-reference is-suggestion ${active ? "is-active" : ""}`}
                key={suggestion.id}
                onMouseEnter={() => onFocus({ edgeId: edge.id })}
                onMouseLeave={() => onFocus({})}
              >
                <span className="lg-relation-badge">Suggestion{suggestion.score !== undefined ? ` · ${Math.round(suggestion.score * 100)}%` : ""}</span>
                <span className="lg-reference-context">{suggestion.reason ?? "Suggested relationship"}</span>
              </button>
            );
          }))}
        </section>
      </div>
    </aside>
  );
}
