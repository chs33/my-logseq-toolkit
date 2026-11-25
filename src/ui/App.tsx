import { useCallback, useEffect, useState } from "react";
import { DEFAULT_FILTERS, type GraphFilters } from "../core/types";
import { navigateNode, navigateOccurrence } from "../logseq/navigation";
import { Controls } from "./Controls";
import { EdgeInspector } from "./EdgeInspector";
import { GraphCanvas } from "./GraphCanvas";
import { EMPTY_FOCUS, isSameFocus, type InteractionFocus } from "./interaction";
import { ReferencesPanel } from "./ReferencesPanel";
import { useGraphModel } from "./useGraphModel";
import {
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_FORCE_SETTINGS,
  type GraphDisplaySettings,
  type GraphForceSettings
} from "./graphSettings";

export function App() {
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showReferences, setShowReferences] = useState(true);
  const [display, setDisplay] = useState<GraphDisplaySettings>(DEFAULT_DISPLAY_SETTINGS);
  const [forces, setForces] = useState<GraphForceSettings>(DEFAULT_FORCE_SETTINGS);
  const [focus, setFocus] = useState<InteractionFocus>(EMPTY_FOCUS);
  const [fitToken, setFitToken] = useState(0);
  const { model, loading, error, refresh } = useGraphModel(filters, showSuggestions);

  const handleFocus = useCallback((next: InteractionFocus) => {
    setFocus((current) => isSameFocus(current, next) ? current : next);
  }, []);

  useEffect(() => handleFocus(EMPTY_FOCUS), [model, handleFocus]);

  return (
    <div className="lg-workspace">
      <main className="lg-shell">
        <header className="lg-header">
          <div className="lg-title-wrap">
            <svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="3" r="1.8"/><circle cx="4" cy="12.5" r="1.8"/><circle cx="14" cy="12.5" r="1.8"/><path d="M8 4.5 5 11m5-6.5 3 6M6 12.5h6"/></svg>
            <strong>Local Graph</strong>
            <span>{model?.center.label ?? "Current view"}</span>
          </div>
          <div className="lg-header-actions">
            {model && <span className="lg-graph-count">{model.nodes.size} nodes · {model.edges.size} links</span>}
            <button type="button" onClick={() => setFitToken((value) => value + 1)} title="Fit graph" aria-label="Fit graph">⌗</button>
            <button type="button" className={showReferences ? "is-active" : ""} onClick={() => setShowReferences((value) => !value)} title="Toggle references" aria-label="Toggle references">≡</button>
            <button type="button" className={showSettings ? "is-active" : ""} onClick={() => setShowSettings((value) => !value)} title="Graph settings" aria-label="Graph settings">⚙</button>
            <button type="button" onClick={refresh} title="Refresh graph" aria-label="Refresh graph">↻</button>
          </div>
        </header>
        <div className={`lg-content ${showReferences ? "" : "references-hidden"}`}>
          <section className="lg-graph-wrap">
            {loading && <div className="lg-status"><span className="lg-spinner" />Building semantic neighborhood…</div>}
            {!loading && error && (
              <div className="lg-status is-error"><strong>Couldn’t build the graph</strong><span>{error}</span><button onClick={refresh}>Try again</button></div>
            )}
            {!loading && !error && !model && (
              <div className="lg-status"><strong>No page or block in view</strong><span>Open a page or zoom into a block, then refresh.</span></div>
            )}
            {model && (
              <>
                <GraphCanvas model={model} focus={focus} fitToken={fitToken} display={display} forces={forces} onFocus={handleFocus} onNodeClick={navigateNode} />
                <Controls
                  open={showSettings}
                  filters={filters}
                  showSuggestions={showSuggestions}
                  display={display}
                  forces={forces}
                  onClose={() => setShowSettings(false)}
                  onFiltersChange={setFilters}
                  onToggleSuggestions={() => setShowSuggestions((value) => !value)}
                  onDisplayChange={setDisplay}
                  onForcesChange={setForces}
                />
                <EdgeInspector model={model} focus={focus} />
                <div className="lg-legend">
                  <span><i className="actual" />Actual</span>
                  <span><i className="suggested" />Suggested</span>
                  <span>Scroll to zoom · drag to pan · click to open</span>
                </div>
              </>
            )}
          </section>
          {showReferences && model ? (
            <ReferencesPanel model={model} focus={focus} onFocus={handleFocus} onNavigate={navigateOccurrence} />
          ) : showReferences ? (
            <aside className="lg-references"><div className="lg-references-heading"><span>References</span></div></aside>
          ) : null}
        </div>
      </main>
    </div>
  );
}
