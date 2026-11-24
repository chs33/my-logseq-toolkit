import type { SuggestedRelationship } from "../core/types";

type Listener = () => void;

class SuggestionStore {
  private suggestions: SuggestedRelationship[] = [];
  private listeners = new Set<Listener>();

  get(): SuggestedRelationship[] {
    return this.suggestions;
  }

  set(suggestions: SuggestedRelationship[]): void {
    this.suggestions = [...suggestions];
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const suggestionStore = new SuggestionStore();
