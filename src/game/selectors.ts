import type { GameState, Position, RowState } from "./types";

const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];

/**
 * Returns rows in the canonical PG-to-C order used by the UI and solvers.
 */
export function getOrderedRows(state: GameState): RowState[] {
  return POSITIONS.map((position) => state.rows[position]);
}