import { buildInitialGameState, gameReducer } from "../../game/gameReducer";
import { scorePlayer } from "../../game/scorePlayer";
import type {
  DailyGame,
  GameAction,
  GameState,
  Player,
  Position,
} from "../../game/types";

type SolverStep =
  | {
      kind: "sign";
      position: Position;
      playerName: string;
      player: Player;
    }
  | {
      kind: "cut";
      position: Position;
      fromPlayerName: string;
      toPlayerName: string;
      player: Player;
    }
  | {
      kind: "trade";
      position: Position;
      fromPlayerName: string;
      toPlayerName: string;
      player: Player;
    };

export type BeatTheScoreSolution = {
  finalScore: number;
  finalState: GameState;
  path: SolverStep[];
  uniqueStateCount: number;
  terminalCount: number;
};

type SearchNode = {
  state: GameState;
  path: SolverStep[];
};

const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];
const YIELD_INTERVAL = 500;
const CHALLENGE_FLOOR_PERCENTILE = 0.80;
const CHALLENGE_CAP_PERCENTILE = 0.99;
const INITIAL_SCORE_MULTIPLIER_CAP = 1.15;

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
  path: SolverStep[],
): SearchNode[] {
  if (state.gameOver) {
    return [];
  }

  const results: SearchNode[] = [];

  for (const position of POSITIONS) {
    const row = state.rows[position];

    if (row.locked) {
      continue;
    }

    {
      const nextState = applyAction(game, state, {
        type: "SIGN_PLAYER",
        position,
      });

      if (nextState !== state) {
        results.push({
          state: nextState,
          path: [
            ...path,
            {
              kind: "sign",
              position,
              playerName: row.currentPlayer.name,
              player: row.currentPlayer,
            },
          ],
        });
      }
    }

    if (state.movesRemaining <= 0) {
      continue;
    }

    const nextOptionNode = game.positions[position]?.options?.[row.optionIndex + 1];

    if (nextOptionNode?.player) {
      const nextState = applyAction(game, state, {
        type: "CUT_PLAYER",
        position,
      });

      if (nextState !== state) {
        results.push({
          state: nextState,
          path: [
            ...path,
            {
              kind: "cut",
              position,
              fromPlayerName: row.currentPlayer.name,
              toPlayerName: nextOptionNode.player.name,
              player: nextOptionNode.player,
            },
          ],
        });
      }
    }

    const currentOptionNode = game.positions[position]?.options?.[row.optionIndex] ?? null;

    if (currentOptionNode?.trades?.length) {
      for (const tradePlayer of currentOptionNode.trades) {
        const nextState = applyAtomicTrade(game, state, position, tradePlayer.id);

        if (nextState !== state) {
          results.push({
            state: nextState,
            path: [
              ...path,
              {
                kind: "trade",
                position,
                fromPlayerName: row.currentPlayer.name,
                toPlayerName: tradePlayer.name,
                player: tradePlayer,
              },
            ],
          });
        }
      }
    }
  }

  return results;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

const JACKPOT_SCORE_MULTIPLIER = 1.1;

function isJackpotTradeCandidate(basePlayer: Player, candidate: Player): boolean {
  return scorePlayer(candidate) >= scorePlayer(basePlayer) * JACKPOT_SCORE_MULTIPLIER;
}

function getPercentileScore(sortedNodes: SearchNode[], percentile: number): number {
  if (sortedNodes.length === 0) {
    return 0;
  }

  const clampedPercentile = Math.min(1, Math.max(0, percentile));
  const index = Math.min(
    sortedNodes.length - 1,
    Math.floor((sortedNodes.length - 1) * clampedPercentile),
  );

  return sortedNodes[index]?.state.finalScore ?? 0;
}

type CpuNodeEvaluation = {
  node: SearchNode;
  missedVisibleJackpotTrade: boolean;
  jackpotTradeTakeCount: number;
};

function evaluateCpuNode(game: DailyGame, node: SearchNode): CpuNodeEvaluation {
  let state = cloneState(buildInitialGameState(game));
  let missedVisibleJackpotTrade = false;
  let jackpotTradeTakeCount = 0;

  for (const step of node.path) {
    if (step.kind === "trade") {
      const row = state.rows[step.position];
      const currentOptionNode =
        game.positions[step.position]?.options?.[row.optionIndex] ?? null;
      const visibleJackpotTrades = (currentOptionNode?.trades ?? []).filter((candidate) =>
        isJackpotTradeCandidate(row.currentPlayer, candidate),
      );

      if (visibleJackpotTrades.length > 0) {
        const choseVisibleJackpot = visibleJackpotTrades.some(
          (candidate) => candidate.id === step.player.id,
        );

        if (choseVisibleJackpot) {
          jackpotTradeTakeCount += 1;
        } else {
          missedVisibleJackpotTrade = true;
        }
      }

      state = applyAtomicTrade(game, state, step.position, step.player.id);
      continue;
    }

    if (step.kind === "cut") {
      state = applyAction(game, state, {
        type: "CUT_PLAYER",
        position: step.position,
      });
      continue;
    }

    state = applyAction(game, state, {
      type: "SIGN_PLAYER",
      position: step.position,
    });
  }

  return {
    node,
    missedVisibleJackpotTrade,
    jackpotTradeTakeCount,
  };
}

function pickCpuNode(game: DailyGame, terminalNodes: SearchNode[], initialBoardScore: number): SearchNode {
  if (terminalNodes.length === 0) {
    throw new Error("Could not build a Beat The Score opponent.");
  }

  const sortedNodes = [...terminalNodes].sort(
    (a, b) => (a.state.finalScore ?? 0) - (b.state.finalScore ?? 0),
  );
  const percentile80Score = getPercentileScore(sortedNodes, CHALLENGE_FLOOR_PERCENTILE);
  const percentile99Score = getPercentileScore(sortedNodes, CHALLENGE_CAP_PERCENTILE);
  const challengeFloor = Math.max(initialBoardScore, percentile80Score);
  const scaledInitialCap = Math.min(
    percentile99Score,
    initialBoardScore * INITIAL_SCORE_MULTIPLIER_CAP,
  );
  const challengeCeiling = Math.max(percentile80Score, scaledInitialCap);

  const inBand = sortedNodes.filter((node) => {
    const score = node.state.finalScore ?? 0;
    return score >= challengeFloor && score <= challengeCeiling;
  });

  if (inBand.length > 0) {
    const evaluatedInBand = inBand.map((node) => evaluateCpuNode(game, node));
    const jackpotAwareInBand = evaluatedInBand.filter(
      (entry) => !entry.missedVisibleJackpotTrade,
    );
    const preferredPool =
      jackpotAwareInBand.length > 0 ? jackpotAwareInBand : evaluatedInBand;
    const maxJackpotTradeTakeCount = Math.max(
      ...preferredPool.map((entry) => entry.jackpotTradeTakeCount),
    );
    const strongestJackpotPool = preferredPool.filter(
      (entry) => entry.jackpotTradeTakeCount === maxJackpotTradeTakeCount,
    );

    return strongestJackpotPool[
      Math.floor(Math.random() * strongestJackpotPool.length)
    ].node;
  }

  const targetScore = (challengeFloor + challengeCeiling) * 0.5;
  return sortedNodes.reduce((closest, node) => {
    const closestDelta = Math.abs((closest.state.finalScore ?? 0) - targetScore);
    const nodeDelta = Math.abs((node.state.finalScore ?? 0) - targetScore);
    return nodeDelta < closestDelta ? node : closest;
  }, sortedNodes[0]);
}

export async function solveBeatTheScore(
  game: DailyGame,
): Promise<BeatTheScoreSolution> {
  
  const initialState = buildInitialGameState(game);
  const initialBoardScore = Number((initialState.finalScore ?? 0).toFixed(1));
  const stack: SearchNode[] = [{ state: cloneState(initialState), path: [] }];
  const visited = new Set<string>();
  const terminalNodes: SearchNode[] = [];

  let terminalCount = 0;
  let processedCount = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      break;
    }

    const key = stateKey(current.state);
    if (visited.has(key)) {
      continue;
    }

    visited.add(key);
    processedCount += 1;

    if (processedCount % YIELD_INTERVAL === 0) {
      await yieldToBrowser();
    }

    if (current.state.gameOver) {
      if (current.state.finalScore !== null) {
        terminalNodes.push({
          state: cloneState(current.state),
          path: [...current.path],
        });
      }

      terminalCount += 1;
      continue;
    }

    const nextStates = getLegalNextStates(game, current.state, current.path);
    for (const next of nextStates) {
      stack.push({
        state: cloneState(next.state),
        path: next.path,
      });
    }
  }

  const selectedNode = pickCpuNode(game, terminalNodes, initialBoardScore);

  if (selectedNode.state.finalScore === null) {
    throw new Error("Could not build a Beat The Score opponent.");
  }

  return {
    finalScore: Number(selectedNode.state.finalScore.toFixed(1)),
    finalState: selectedNode.state,
    path: selectedNode.path,
    uniqueStateCount: visited.size,
    terminalCount,
  };
}
