import { CURRENT_GAME_DATE } from "../data/dates/currentDate";
import type { DailyGame } from "../game/types";

type DailyGameModule = DailyGame | { default: DailyGame };

const gameModules = import.meta.glob("../data/games/game_*.json", {
  eager: true,
}) as Record<string, DailyGameModule>;

/**
 * Extracts an ISO date from an imported game filename.
 */
function extractDateFromPath(path: string): string | null {
  const match = path.match(/game_(\d{4}-\d{2}-\d{2})\.json$/);
  return match?.[1] ?? null;
}

/**
 * Normalizes eager JSON imports so both default-exported and raw modules work.
 */
function normalizeGameModule(module: DailyGameModule): DailyGame {
  return "default" in module ? module.default : module;
}

const dailyGameEntries = Object.entries(gameModules)
  .map(([path, module]) => {
    const date = extractDateFromPath(path);

    if (!date) {
      return null;
    }

    return [date, normalizeGameModule(module)] as const;
  })
  .filter((entry): entry is readonly [string, DailyGame] => entry !== null)
  .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate));

const dailyGameMap = new Map<string, DailyGame>(dailyGameEntries);
const availableDailyDates = dailyGameEntries.map(([date]) => date);

/**
 * Returns all known Daily puzzle dates in chronological order.
 */
export function getAvailableDailyDates(): string[] {
  return [...availableDailyDates];
}

/**
 * Looks up a Daily puzzle by date.
 */
export function getDailyGameByDate(date: string): DailyGame | null {
  return dailyGameMap.get(date) ?? null;
}

/**
 * Checks whether a Daily puzzle file exists for a given date.
 */
export function isAvailableDailyDate(date: string): boolean {
  return dailyGameMap.has(date);
}

/**
 * Chooses the initial Daily date, preferring the published current date when available.
 */
export function getInitialDailyDate(): string {
  if (availableDailyDates.length === 0) {
    return CURRENT_GAME_DATE;
  }

  if (dailyGameMap.has(CURRENT_GAME_DATE)) {
    return CURRENT_GAME_DATE;
  }

  return availableDailyDates[availableDailyDates.length - 1];
}
