export interface InteractionFocus {
  nodeId?: string;
  edgeId?: string;
  occurrenceId?: string;
}

export const EMPTY_FOCUS: InteractionFocus = {};

export function isSameFocus(a: InteractionFocus, b: InteractionFocus): boolean {
  return a.nodeId === b.nodeId && a.edgeId === b.edgeId && a.occurrenceId === b.occurrenceId;
}
