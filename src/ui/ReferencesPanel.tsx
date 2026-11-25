import { memo, useEffect, useMemo, useState } from "react";
import type { GraphModel, ProjectedOccurrence, SuggestedRelationship, VisualEdge } from "../core/types";
import { EMPTY_FOCUS, type InteractionFocus } from "./interaction";

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

const ReferenceRow = memo(function ReferenceRow({ item, edgeId, direction, active, onFocus, onNavigate }: {
  item: ProjectedOccurrence;
  edgeId?: string;
  direction: "outgoing" | "incoming";
  active: boolean;
  onFocus: ReferencesPanelProps["onFocus"];
  onNavigate: ReferencesPanelProps["onNavigate"];
}) {
  return (
    <button
      type="button"
      className={`lg-reference ${active ? "is-active" : ""}`}
      onMouseEnter={() => onFocus({ occurrenceId: item.occurrence.id, edgeId })}
      onMouseLeave={() => onFocus(EMPTY_FOCUS)}
      onClick={() => onNavigate(item, direction)}
    >
      <span className={`lg-relation-badge is-${item.occurrence.kind}`}>{TYPE_LABEL[item.occurrence.kind]}</span>
      <span className="lg-reference-context">{item.occurrence.sourceContext || "Open exact occurrence"}</span>
    </button>
  );
});

const SuggestionRow = memo(function SuggestionRow({ suggestion, edgeId, active, onFocus }: {
  suggestion: SuggestedRelationship;
  edgeId: string;
  active: boolean;
  onFocus: ReferencesPanelProps["onFocus"];
}) {
  return (
    <button
      type="button"
      className={`lg-reference is-suggestion ${active ? "is-active" : ""}`}
      onMouseEnter={() => onFocus({ edgeId })}
      onMouseLeave={() => onFocus(EMPTY_FOCUS)}
    >
      <span className="lg-relation-badge">Suggestion{suggestion.score !== undefined ? ` · ${Math.round(suggestion.score * 100)}%` : ""}</span>
      <span className="lg-reference-context">{suggestion.reason ?? "Suggested relationship"}</span>
    </button>
  );
});

const ReferenceSection = memo(function ReferenceSection({
  title,
  direction,
  items,
  model,
  focus,
  edgeByOccurrence,
  onFocus,
  onNavigate
}: {
  title: string;
  direction: "outgoing" | "incoming";
  items: ProjectedOccurrence[];
  model: GraphModel;
  focus: InteractionFocus;
  edgeByOccurrence: ReadonlyMap<string, VisualEdge>;
  onFocus: (focus: InteractionFocus) => void;
  onNavigate: (occurrence: ProjectedOccurrence, direction: "outgoing" | "incoming") => void;
}) {
  const [limit, setLimit] = useState(120);
  useEffect(() => setLimit(120), [model]);
  const groups = useMemo(() => {
    const grouped = new Map<string, ProjectedOccurrence[]>();
    for (const item of items.slice(0, limit)) {
      const label = neighborFor(model, item);
      const group = grouped.get(label) ?? [];
      group.push(item);
      grouped.set(label, group);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items, limit, model]);

  return (
    <section className="lg-reference-section">
      <h3>{title}<span>{items.length}</span></h3>
      {groups.length === 0 && <p className="lg-empty-small">None in this neighborhood</p>}
      {groups.map(([label, entries]) => (
        <div className="lg-reference-group" key={label}>
          <div className="lg-reference-group-title"><span>{label}</span><b>{entries.length}</b></div>
          {entries.map((item) => {
            const edge = edgeByOccurrence.get(item.occurrence.id);
            const active = focus.occurrenceId === item.occurrence.id || (edge !== undefined && focus.edgeId === edge.id) ||
              focus.nodeId === item.sourceNodeId || focus.nodeId === item.targetNodeId;
            return (
              <ReferenceRow
                key={item.occurrence.id}
                item={item}
                edgeId={edge?.id}
                direction={direction}
                active={active}
                onFocus={onFocus}
                onNavigate={onNavigate}
              />
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
});

export const ReferencesPanel = memo(function ReferencesPanel({ model, focus, onFocus, onNavigate }: ReferencesPanelProps) {
  const { actual, outgoing, incoming, suggestions, suggestionCount, edgeByOccurrence } = useMemo(() => {
    const actualItems = [...model.occurrences.values()];
    const edgeIndex = new Map<string, VisualEdge>();
    const suggestedEdges: VisualEdge[] = [];
    let suggestionCount = 0;
    for (const edge of model.edges.values()) {
      if (edge.suggested) {
        suggestedEdges.push(edge);
        suggestionCount += edge.suggestions.length;
      }
      for (const item of edge.actualOccurrences) edgeIndex.set(item.occurrence.id, edge);
    }
    return {
      actual: actualItems,
      outgoing: actualItems.filter((item) => referenceDirection(model, item) === "outgoing"),
      incoming: actualItems.filter((item) => referenceDirection(model, item) === "incoming"),
      suggestions: suggestedEdges,
      suggestionCount,
      edgeByOccurrence: edgeIndex
    };
  }, [model]);
  return (
    <aside className="lg-references">
      <div className="lg-references-heading">
        <span>References</span>
        <b>{actual.length + suggestionCount}</b>
      </div>
      <div className="lg-references-scroll">
        <ReferenceSection title="Outgoing" direction="outgoing" items={outgoing} model={model} focus={focus} edgeByOccurrence={edgeByOccurrence} onFocus={onFocus} onNavigate={onNavigate} />
        <ReferenceSection title="Incoming" direction="incoming" items={incoming} model={model} focus={focus} edgeByOccurrence={edgeByOccurrence} onFocus={onFocus} onNavigate={onNavigate} />
        <section className="lg-reference-section">
          <h3>Suggested<span>{suggestionCount}</span></h3>
          {suggestions.length === 0 && <p className="lg-empty-small">No visible suggestions</p>}
          {suggestions.flatMap((edge) => edge.suggestions.map((suggestion) => {
            const active = focus.edgeId === edge.id;
            return (
              <SuggestionRow
                key={suggestion.id}
                suggestion={suggestion}
                edgeId={edge.id}
                active={active}
                onFocus={onFocus}
              />
            );
          }))}
        </section>
      </div>
    </aside>
  );
});
