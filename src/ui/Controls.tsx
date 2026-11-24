import type { GraphFilters, RelationKind } from "../core/types";
import type { GraphDisplaySettings, GraphForceSettings } from "./graphSettings";

interface ControlsProps {
  open: boolean;
  filters: GraphFilters;
  showSuggestions: boolean;
  display: GraphDisplaySettings;
  forces: GraphForceSettings;
  onClose: () => void;
  onFiltersChange: (filters: GraphFilters) => void;
  onToggleSuggestions: () => void;
  onDisplayChange: (settings: GraphDisplaySettings) => void;
  onForcesChange: (settings: GraphForceSettings) => void;
}

const RELATIONS: Array<[RelationKind, string]> = [
  ["page_reference", "Page references"],
  ["block_reference", "Block references"],
  ["embed", "Embeds"],
  ["external_url", "External URLs"]
];

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="lg-setting-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <i aria-hidden="true" />
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="lg-setting-slider">
      <span>{label}<b>{Number.isInteger(value) ? value : value.toFixed(2)}</b></span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export function Controls({
  open,
  filters,
  showSuggestions,
  display,
  forces,
  onClose,
  onFiltersChange,
  onToggleSuggestions,
  onDisplayChange,
  onForcesChange
}: ControlsProps) {
  if (!open) return null;
  const toggleType = (kind: RelationKind) => {
    const relationTypes = new Set(filters.relationTypes);
    if (relationTypes.has(kind)) relationTypes.delete(kind);
    else relationTypes.add(kind);
    onFiltersChange({ ...filters, relationTypes });
  };

  return (
    <aside className="lg-settings-panel" aria-label="Local graph settings">
      <div className="lg-settings-title"><span>Graph settings</span><button onClick={onClose} aria-label="Close settings">×</button></div>
      <details open>
        <summary>Filters</summary>
        <div className="lg-settings-section">
          <Slider label="Depth" value={filters.depth} min={1} max={3} step={1} onChange={(depth) => onFiltersChange({ ...filters, depth: depth as 1 | 2 | 3 })} />
          <Toggle checked={filters.incoming} label="Incoming links" onChange={() => onFiltersChange({ ...filters, incoming: !filters.incoming })} />
          <Toggle checked={filters.outgoing} label="Outgoing links" onChange={() => onFiltersChange({ ...filters, outgoing: !filters.outgoing })} />
          {RELATIONS.map(([kind, label]) => (
            <Toggle key={kind} checked={filters.relationTypes.has(kind)} label={label} onChange={() => toggleType(kind)} />
          ))}
          <Toggle checked={showSuggestions} label="Suggestions" onChange={onToggleSuggestions} />
        </div>
      </details>
      <details>
        <summary>Display</summary>
        <div className="lg-settings-section">
          <Toggle checked={display.arrows} label="Arrows" onChange={() => onDisplayChange({ ...display, arrows: !display.arrows })} />
          <Slider label="Text fade threshold" value={display.textFadeThreshold} min={0} max={1} step={0.05} onChange={(textFadeThreshold) => onDisplayChange({ ...display, textFadeThreshold })} />
          <Slider label="Node size" value={display.nodeSize} min={2} max={9} step={0.5} onChange={(nodeSize) => onDisplayChange({ ...display, nodeSize })} />
          <Slider label="Link thickness" value={display.linkThickness} min={0.5} max={3} step={0.25} onChange={(linkThickness) => onDisplayChange({ ...display, linkThickness })} />
        </div>
      </details>
      <details>
        <summary>Forces</summary>
        <div className="lg-settings-section">
          <Slider label="Center force" value={forces.centerForce} min={0} max={1.5} step={0.05} onChange={(centerForce) => onForcesChange({ ...forces, centerForce })} />
          <Slider label="Repel force" value={forces.repelForce} min={0} max={2} step={0.05} onChange={(repelForce) => onForcesChange({ ...forces, repelForce })} />
          <Slider label="Link force" value={forces.linkForce} min={0} max={1.5} step={0.05} onChange={(linkForce) => onForcesChange({ ...forces, linkForce })} />
          <Slider label="Link distance" value={forces.linkDistance} min={45} max={220} step={5} onChange={(linkDistance) => onForcesChange({ ...forces, linkDistance })} />
        </div>
      </details>
    </aside>
  );
}
