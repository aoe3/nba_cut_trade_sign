import { buildInitialGameState, gameReducer } from "../../game/gameReducer";
import type { DailyGame, GameAction, GameState, Position } from "../../game/types";

type SolveStatusCallback = (status: string) => void;

type SolveSummary = {
  bestScore: number;
  worstScore: number;
  spread: number;
  terminalCount: number;
  uniqueStateCount: number;
};

type SearchNode = {
  state: GameState;
};

const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];
const YIELD_INTERVAL = 500;

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isTerminal(state: GameState): boolean {
  return state.gameOver;
}

function stateKey(state: GameState): string {
  const rowBits = POSITIONS.map((position) => {
    const row = state.rows[position];
    return [
      position,
      row.optionIndex,
      row.currentPlayer.id,
      row.locked ? 1 : 0,
      row.lockedReason ?? "null",
    ].join(":");
  }).join("|");

  return [
    `moves=${state.movesRemaining}`,
    `gameOver=${state.gameOver ? 1 : 0}`,
    rowBits,
  ].join("||");
}

function applyAction(
  game: DailyGame,
  state: GameState,
  action: GameAction,
): GameState {
  return gameReducer(state, action, game);
}

function applyAtomicTrade(
  game: DailyGame,
  state: GameState,
  position: Position,
  tradePlayerId: string,
): GameState {
  let next = applyAction(game, state, { type: "START_TRADE", position });
  next = applyAction(game, next, {
    type: "SELECT_TRADE_CANDIDATE",
    playerId: tradePlayerId,
  });
  next = applyAction(game, next, { type: "EXECUTE_TRADE" });
  return next;
}

function getLegalNextStates(
  game: DailyGame,
  state: GameState,
): SearchNode[] {
  if (state.gameOver) return [];

  const results: SearchNode[] = [];

  for (const position of POSITIONS) {
    const row = state.rows[position];

    if (row.locked) continue;

    {
      const signState = applyAction(game, state, { type: "SIGN_PLAYER", position });
      if (signState !== state) results.push({ state: signState });
    }

    if (state.movesRemaining <= 0) continue;

    const nextOptionNode =
      game.positions[position]?.options?.[row.optionIndex + 1];

    if (nextOptionNode?.player) {
      const cutState = applyAction(game, state, { type: "CUT_PLAYER", position });
      if (cutState !== state) results.push({ state: cutState });
    }

    const currentOptionNode =
      game.positions[position]?.options?.[row.optionIndex] ?? null;

    if (currentOptionNode?.trades?.length) {
      for (const tradePlayer of currentOptionNode.trades) {
        const tradeState = applyAtomicTrade(game, state, position, tradePlayer.id);
        if (tradeState !== state) results.push({ state: tradeState });
      }
    }
  }

  return results;
}

function terminalScore(state: GameState): number {
  return state.finalScore ?? 0;
}

async function yieldToBrowser(): Promise<void> {
  await Promise.resolve();
}

export async function solveForeverGame(
  game: DailyGame,
  onStatus?: SolveStatusCallback,
): Promise<SolveSummary> {

  const initialState = buildInitialGameState(game);
  const stack: SearchNode[] = [{ state: cloneState(initialState) }];
  const visited = new Set<string>();

  let bestScore = Number.NEGATIVE_INFINITY;
  let worstScore = Number.POSITIVE_INFINITY;
  let terminalCount = 0;
  let processedCount = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;

    const key = stateKey(current.state);
    if (visited.has(key)) continue;

    visited.add(key);
    processedCount += 1;

    if (processedCount % YIELD_INTERVAL === 0) {
      const bestText = Number.isFinite(bestScore) ? bestScore.toFixed(1) : "--";
      const worstText = Number.isFinite(worstScore) ? worstScore.toFixed(1) : "--";

      onStatus?.(
        `Solving… visited ${visited.size.toLocaleString()} states, terminals ${terminalCount.toLocaleString()}, best ${bestText}, worst ${worstText}.`,
      );

      await yieldToBrowser();
    }

    if (isTerminal(current.state)) {
      const score = terminalScore(current.state);
      bestScore = Math.max(bestScore, score);
      worstScore = Math.min(worstScore, score);
      terminalCount += 1;
      continue;
    }

    const nextStates = getLegalNextStates(game, current.state);
    for (const next of nextStates) {
      stack.push({ state: cloneState(next.state) });
    }
  }

  if (!Number.isFinite(bestScore) || !Number.isFinite(worstScore)) {
    throw new Error("Solver found no terminal states.");
  }

  return {
    bestScore: Number(bestScore.toFixed(1)),
    worstScore: Number(worstScore.toFixed(1)),
    spread: Number((bestScore - worstScore).toFixed(1)),
    terminalCount,
    uniqueStateCount: visited.size,
  };
}