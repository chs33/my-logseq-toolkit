import { useCallback, useEffect, useRef, useState } from "react";
import { buildActualGraph } from "../core/traversal";
import { overlaySuggestions } from "../core/suggestions";
import type { GraphFilters, GraphModel } from "../core/types";
import { resolveCurrentCenter } from "../logseq/currentView";
import { LogseqRelationReader } from "../logseq/LogseqRelationReader";
import { suggestionStore } from "../suggestions/store";

interface GraphState {
  model: GraphModel | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useGraphModel(filters: GraphFilters, showSuggestions: boolean): GraphState {
  const [model, setModel] = useState<GraphModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(debounce);
      debounce = setTimeout(refresh, 180);
    };
    const offRoute = logseq.App.onRouteChanged(schedule) as unknown as (() => void) | undefined;
    const offDb = logseq.DB.onChanged(schedule) as unknown as (() => void) | undefined;
    const offSuggestions = suggestionStore.subscribe(schedule);
    return () => {
      clearTimeout(debounce);
      offRoute?.();
      offDb?.();
      offSuggestions();
    };
  }, [refresh]);

  useEffect(() => {
    const currentRequest = ++request.current;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const reader = new LogseqRelationReader();
        const center = await resolveCurrentCenter(reader);
        if (!center) {
          if (request.current === currentRequest) setModel(null);
          return;
        }
        let next = await buildActualGraph(center, filters, reader);
        if (showSuggestions) next = await overlaySuggestions(next, suggestionStore.get(), reader);
        if (request.current === currentRequest) setModel(next);
      } catch (reason) {
        console.error("DB Local Graph build failed", reason);
        if (request.current === currentRequest) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setModel(null);
        }
      } finally {
        if (request.current === currentRequest) setLoading(false);
      }
    })();
  }, [filters, showSuggestions, revision]);

  return { model, loading, error, refresh };
}
