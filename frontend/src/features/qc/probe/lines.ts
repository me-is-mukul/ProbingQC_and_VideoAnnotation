/**
 * State of every chart's probe line: a pure reducer. A line is *inactive* until the user
 * moves it; inactive lines do not take part in the plan (otherwise one untouched chart
 * would make the intersection empty).
 */

import type { ProbeDirection } from "./selection";

export interface LineState {
  active: boolean;
  value: number;
  direction: ProbeDirection;
}

export type LinesState = Readonly<Record<string, LineState>>;

export type LinesAction =
  | { type: "move"; id: string; value: number }
  | { type: "direction"; id: string; direction: ProbeDirection }
  | { type: "reset"; id: string }
  | { type: "resetAll" };

export const INACTIVE_LINE: LineState = Object.freeze({ active: false, value: 0, direction: "below" });

export const initialLines: LinesState = Object.freeze({});

export function lineOf(state: LinesState, id: string): LineState {
  return state[id] ?? INACTIVE_LINE;
}

export function linesReducer(state: LinesState, action: LinesAction): LinesState {
  switch (action.type) {
    case "move": {
      if (!Number.isFinite(action.value)) return state;
      const current = lineOf(state, action.id);
      if (current.active && current.value === action.value) return state;
      return { ...state, [action.id]: { ...current, active: true, value: action.value } };
    }
    case "direction": {
      const current = lineOf(state, action.id);
      if (current.direction === action.direction) return state;
      return { ...state, [action.id]: { ...current, direction: action.direction } };
    }
    case "reset": {
      if (!(action.id in state)) return state;
      const next = { ...state };
      delete next[action.id];
      return next;
    }
    case "resetAll":
      return Object.keys(state).length ? initialLines : state;
  }
}

export function activeCount(state: LinesState): number {
  return Object.values(state).filter((l) => l.active).length;
}
