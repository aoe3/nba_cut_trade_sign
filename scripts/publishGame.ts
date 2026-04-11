import fs from "node:fs";
import path from "node:path";

import type { DailyGame } from "../src/game/types";

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

type GameSolutionSummary = {
  date: string;
  bestScore: number;
  worstScore: number;
  spread: number;
  terminalCount: number;
  uniqueStateCount: number;
};

type PublishedGame = DailyGame & {
  bestScore?: number;
  worstScore?: number;
  solutionSpread?: number;
  terminalCount?: number;
  uniqueStateCount?: number;
};

function readJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

function main(): void {
  const game = readJsonFile<DailyGame>(GAME_PATH);
  const solution = readJsonFile<GameSolutionSummary>(SOLUTION_PATH);

  if (game.date !== solution.date) {
    throw new Error(
      `Date mismatch: game_${game.date}.json has ${game.date}, but game_${solution.date}_solution.json has ${solution.date}.`,
    );
  }

  const publishedGame: PublishedGame = {
    ...game,
    bestScore: solution.bestScore,
    worstScore: solution.worstScore,
    solutionSpread: solution.spread,
    terminalCount: solution.terminalCount,
    uniqueStateCount: solution.uniqueStateCount,
  };

  writeJsonFile(GAME_PATH, publishedGame);

  console.log(`Published solved game_${game.date}.json`);
  console.log(`bestScore=${solution.bestScore.toFixed(1)}`);
  console.log(`worstScore=${solution.worstScore.toFixed(1)}`);
  console.log(`spread=${solution.spread.toFixed(1)}`);
  console.log(`terminalCount=${solution.terminalCount}`);
  console.log(`uniqueStateCount=${solution.uniqueStateCount}`);
  console.log(`Updated ${GAME_PATH}`);
}

main();
