import type { GameState, Position } from "./types";

const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];

/**
 * Sums locked-in player scores for the current roster.
 */
export function scoreRoster(state: GameState): number | null {
  let total = 0;
  let hasAnyLockedScore = false;

  for (const position of POSITIONS) {
    const row = state.rows[position];
    if (row.playerScore !== null) {
      total += row.playerScore;
      hasAnyLockedScore = true;
    }
  }

  if (!hasAnyLockedScore) {
    return null;
  }

  return Number(total.toFixed(1));
}