import fs from "node:fs";
import path from "node:path";

import { buildInitialGameState, gameReducer } from "../src/game/gameReducer";
import type {
  DailyGame,
  GameAction,
  GameState,
  Position,
} from "../src/game/types";

const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isIsoDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseArgs(): { date: string } {
  const args = process.argv.slice(2);
  let date = todayIsoDate();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--date") {
      const nextValue = args[i + 1];
      if (!nextValue) {
        throw new Error("Missing value for --date. Expected YYYY-MM-DD.");
      }
      if (!isIsoDateString(nextValue)) {
        throw new Error(`Invalid --date value: ${nextValue}. Expected YYYY-MM-DD.`);
      }
      date = nextValue;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { date };
}

function getGamePath(date: string): string {
  return path.resolve(process.cwd(), `src/data/games/game_${date}.json`);
}

function getSolutionPath(date: string): string {
  return path.resolve(process.cwd(), `src/data/solutions/game_${date}_solution.json`);
}

const CLI_ARGS = parseArgs();
const TARGET_DATE = CLI_ARGS.date;
const GAME_PATH = getGamePath(TARGET_DATE);
const SOLUTION_PATH = getSolutionPath(TARGET_DATE);

type SolverStep =
  | {
      kind: "sign";
      position: Position;
      playerName: string;
    }
  | {
      kind: "cut";
      position: Position;
      fromPlayerName: string;
      toPlayerName: string;
    }
  | {
      kind: "trade";
      position: Position;
      fromPlayerName: string;
      toPlayerName: string;
    };

type TerminalResult = {
  score: number;
  path: SolverStep[];
  state: GameState;
};

type SolveSummary = {
  best: TerminalResult;
  worst: TerminalResult;
  terminalCount: number;
  uniqueStateCount: number;
};

type GameSolutionSummary = {
  date: string;
  bestScore: number;
  worstScore: number;
  spread: number;
  terminalCount: number;
  uniqueStateCount: number;
};

type SearchNode = {
  state: GameState;
  path: SolverStep[];
};

function readGame(): DailyGame {
  const raw = fs.readFileSync(GAME_PATH, "utf-8");
  return JSON.parse(raw) as DailyGame;
}

function writeSolution(solution: GameSolutionSummary): void {
  fs.mkdirSync(path.dirname(SOLUTION_PATH), { recursive: true });
  fs.writeFileSync(
    SOLUTION_PATH,
    JSON.stringify(solution, null, 2) + "\n",
    "utf-8",
  );
}

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isTerminal(state: GameState): boolean {
  return state.gameOver;
}

function getCurrentOptionNode(
  game: DailyGame,
  position: Position,
  optionIndex: number,
) {
  return game.positions[position]?.options?.[optionIndex] ?? null;
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
            },
          ],
        });
      }
    }

    if (state.movesRemaining <= 0) {
      continue;
    }

    {
      const nextOptionNode =
        game.positions[position]?.options?.[row.optionIndex + 1];

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
              },
            ],
          });
        }
      }
    }

    const currentOptionNode = getCurrentOptionNode(game, position, row.optionIndex);

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
              },
            ],
          });
        }
      }
    }
  }

  return results;
}

function terminalScore(state: GameState): number {
  return state.finalScore ?? 0;
}

function better(current: TerminalResult | null, candidate: TerminalResult): TerminalResult {
  if (!current) {
    return candidate;
  }
  return candidate.score > current.score ? candidate : current;
}

function worse(current: TerminalResult | null, candidate: TerminalResult): TerminalResult {
  if (!current) {
    return candidate;
  }
  return candidate.score < current.score ? candidate : current;
}

export function solveGame(game: DailyGame): SolveSummary {

  const initialState = buildInitialGameState(game);

  const stack: SearchNode[] = [
    {
      state: cloneState(initialState),
      path: [],
    },
  ];

  const visited = new Set<string>();

  let bestResult: TerminalResult | null = null;
  let worstResult: TerminalResult | null = null;
  let terminalCount = 0;

  const startedAt = Date.now();
  let processedCount = 0;
  let lastLogTime = 0;

  const LOG_INTERVAL_MS = 50;

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

    const now = Date.now();
    if (now - lastLogTime > LOG_INTERVAL_MS) {
      lastLogTime = now;

      const elapsed = (now - startedAt) / 1000;
      const bestScore = bestResult ? bestResult.score.toFixed(1) : "--";
      const worstScore = worstResult ? worstResult.score.toFixed(1) : "--";
      const statesPerSec = (processedCount / Math.max(elapsed, 0.001)).toFixed(0);
      const terminalRate =
        visited.size > 0
          ? ((terminalCount / visited.size) * 100).toFixed(1)
          : "0.0";

      const line =
        `[solve] visited=${visited.size} ` +
        `stack=${stack.length} ` +
        `terminals=${terminalCount} (${terminalRate}%) ` +
        `best=${bestScore} worst=${worstScore} ` +
        `speed=${statesPerSec}/s ` +
        `elapsed=${elapsed.toFixed(1)}s`;

      process.stdout.write("\r" + line);
    }

    if (isTerminal(current.state)) {
      const result: TerminalResult = {
        score: terminalScore(current.state),
        path: current.path,
        state: current.state,
      };

      bestResult = better(bestResult, result);
      worstResult = worse(worstResult, result);
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

  process.stdout.write("\n");

  if (!bestResult || !worstResult) {
    throw new Error("Solver found no terminal states.");
  }

  return {
    best: bestResult,
    worst: worstResult,
    terminalCount,
    uniqueStateCount: visited.size,
  };
}

function describeStep(step: SolverStep): string {
  switch (step.kind) {
    case "sign":
      return `SIGN ${step.position} -> ${step.playerName}`;
    case "cut":
      return `CUT ${step.position}: ${step.fromPlayerName} -> ${step.toPlayerName}`;
    case "trade":
      return `TRADE ${step.position}: ${step.fromPlayerName} -> ${step.toPlayerName}`;
    default:
      return "UNKNOWN";
  }
}

function printFinalRoster(state: GameState): void {
  console.log("\nFinal roster:");
  for (const position of POSITIONS) {
    const row = state.rows[position];
    const scoreText =
      row.playerScore !== null ? row.playerScore.toFixed(1) : "null";

    console.log(
      `  ${position}: ${row.currentPlayer.name} (${row.currentPlayer.team}) | locked=${row.lockedReason} | score=${scoreText}`,
    );
  }
}

function main(): void {
  const game = readGame();
  const summary = solveGame(game);

  const bestScore = Number(summary.best.score.toFixed(1));
  const worstScore = Number(summary.worst.score.toFixed(1));
  const spread = Number((bestScore - worstScore).toFixed(1));

  const solution: GameSolutionSummary = {
    date: game.date,
    bestScore,
    worstScore,
    spread,
    terminalCount: summary.terminalCount,
    uniqueStateCount: summary.uniqueStateCount,
  };

  writeSolution(solution);

  console.log(`Solved game for ${game.date}`);
  console.log(`Unique states explored: ${summary.uniqueStateCount}`);
  console.log(`Terminal states found: ${summary.terminalCount}`);

  console.log("\n=== BEST RESULT ===");
  console.log(`Best score: ${bestScore.toFixed(1)}`);
  for (const step of summary.best.path) {
    console.log(`  - ${describeStep(step)}`);
  }
  printFinalRoster(summary.best.state);

  console.log("\n=== WORST RESULT ===");
  console.log(`Worst score: ${worstScore.toFixed(1)}`);
  for (const step of summary.worst.path) {
    console.log(`  - ${describeStep(step)}`);
  }
  printFinalRoster(summary.worst.state);

  console.log("\n=== RANGE ===");
  console.log(`Spread: ${spread.toFixed(1)}`);

  console.log(`\nWrote solution summary to ${SOLUTION_PATH}`);
}

main();
