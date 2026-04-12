import fs from "node:fs";
import path from "node:path";
import { scorePlayer } from "../src/game/scorePlayer";

type Position = "PG" | "SG" | "SF" | "PF" | "C";

type Player = {
  id: string;
  nbaPlayerId: number | null;
  name: string;
  team: string;
  position: Position;
  age: number;
  bpm: number;
  per: number;
  ws48: number;
  usgPct: number;
  salary: number;
  gamesPlayed: number;
  teamGamesPlayed: number;
  isRookie: boolean;
  durability?: number;
  minutesPlayed?: number;
  minutesPerGame?: number;
  minuteShareOfTeam?: number;
  activeMinuteShare?: number;
  ppg?: number;
  rpg?: number;
  apg?: number;
  spg?: number;
  bpg?: number;
  fgPct?: number;
  threePct?: number;
  ftPct?: number;
  headshotUrl?: string;
};

type ScoredPlayer = Player & {
  gameScore: number;
};

type GamePlayer = Player;

type GameOption = {
  player: GamePlayer;
  trades: GamePlayer[];
};

type GamePosition = {
  options: GameOption[];
};

type DailyGame = {
  date: string;
  salaryCap: number;
  positions: Record<Position, GamePosition>;
};

const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];

const PLAYERS_PATH = path.resolve(process.cwd(), "src/data/players.json");

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

const CLI_ARGS = parseArgs();
const TARGET_DATE = CLI_ARGS.date;
const GAME_PATH = getGamePath(TARGET_DATE);

/**
 * Salary cap and selection windows tune how often a board feels plausible, volatile, and interesting.
 */
const SALARY_CAP = 150_000_000;

const STARTER_COUNT_PER_POSITION = 6;
const TRADES_PER_PLAYER = 3;
const CUTS_PER_POSITION = 5;

const STARTER_STAR_POSITIONS_MIN = 1;
const STARTER_STAR_POSITIONS_MAX = 2;

const STARTER_MID_MIN_PERCENTILE = 0.65;
const STARTER_MID_MAX_PERCENTILE = 0.87;
const STARTER_STAR_MIN_PERCENTILE = 0.87;
const STARTER_STAR_MAX_PERCENTILE = 0.96;

const TRADE_SCORE_WINDOW = 1.6;
const CUT_NEAR_SCORE_WINDOW = 2.0;

const CUT_VOL_LOW_MIN = -3.6;
const CUT_VOL_LOW_MAX = -1.0;
const CUT_VOL_HIGH_MIN = 1.0;
const CUT_VOL_HIGH_MAX = 4.8;

const FALLBACK_TRADE_SCORE_WINDOW = 2.5;
const FALLBACK_CUT_NEAR_SCORE_WINDOW = 2.9;

const TRADE_JACKPOT_CHANCE = 0.05;
const TRADE_JACKPOT_MIN_PERCENTILE = 0.75;

/**
 * Loads the filtered player pool and attaches game scores used during puzzle generation.
 */
function readPlayers(): ScoredPlayer[] {
  const raw = fs.readFileSync(PLAYERS_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Player[];

  return parsed
    .filter((player) => {
      return (
        POSITIONS.includes(player.position) &&
        Number.isFinite(player.salary) &&
        Number.isFinite(player.age) &&
        Number.isFinite(player.bpm) &&
        Number.isFinite(player.per) &&
        Number.isFinite(player.ws48) &&
        Number.isFinite(player.usgPct) &&
        (
          Number.isFinite(player.minutesPlayed) ||
          Number.isFinite(player.minutesPerGame) ||
          Number.isFinite(player.activeMinuteShare)
        )
      );
    })
    .map((player) => ({
      ...player,
      gameScore: scorePlayer(player),
    }));
}

/**
 * Writes the generated puzzle into the dated games directory.
 */
function writeGame(game: DailyGame): void {
  fs.mkdirSync(path.dirname(GAME_PATH), { recursive: true });
  fs.writeFileSync(GAME_PATH, JSON.stringify(game, null, 2) + "\n", "utf-8");
}

function groupByPosition(players: ScoredPlayer[]): Record<Position, ScoredPlayer[]> {
  const grouped: Record<Position, ScoredPlayer[]> = {
    PG: [],
    SG: [],
    SF: [],
    PF: [],
    C: [],
  };

  for (const player of players) {
    grouped[player.position].push(player);
  }

  for (const position of POSITIONS) {
    grouped[position].sort((a, b) => a.gameScore - b.gameScore);
  }

  return grouped;
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length - 1, index));
}

function percentileIndex(length: number, percentile: number): number {
  return clampIndex(Math.floor((length - 1) * percentile), length);
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sampleOne<T>(items: T[]): T {
  if (items.length === 0) {
    throw new Error("Cannot sample from empty array.");
  }
  return items[randomInt(0, items.length - 1)];
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function uniqueById(players: ScoredPlayer[]): ScoredPlayer[] {
  const seen = new Set<string>();
  const out: ScoredPlayer[] = [];

  for (const player of players) {
    if (!seen.has(player.id)) {
      seen.add(player.id);
      out.push(player);
    }
  }

  return out;
}

function pickN<T>(items: T[], n: number): T[] {
  if (n <= 0) return [];
  return shuffle(items).slice(0, n);
}

function pickNWeightedByClosestScore(
  players: ScoredPlayer[],
  targetScore: number,
  n: number,
): ScoredPlayer[] {
  const ranked = [...players].sort((a, b) => {
    const da = Math.abs(a.gameScore - targetScore);
    const db = Math.abs(b.gameScore - targetScore);
    return da - db;
  });

  return ranked.slice(0, n);
}

function toGamePlayer(player: ScoredPlayer): GamePlayer {
  const { gameScore: _gameScore, ...rest } = player;
  return { ...rest };
}

function pickStarterFromBand(
  players: ScoredPlayer[],
  minPct: number,
  maxPct: number,
): ScoredPlayer {
  const minIndex = percentileIndex(players.length, minPct);
  const maxIndex = percentileIndex(players.length, maxPct);

  const lower = Math.min(minIndex, maxIndex);
  const upper = Math.max(minIndex, maxIndex);

  const band = players.slice(lower, upper + 1);
  if (band.length === 0) {
    return players[Math.floor(players.length / 2)];
  }

  return sampleOne(band);
}

function pickStarter(players: ScoredPlayer[], isStarSlot: boolean): ScoredPlayer {
  if (isStarSlot) {
    return pickStarterFromBand(
      players,
      STARTER_STAR_MIN_PERCENTILE,
      STARTER_STAR_MAX_PERCENTILE,
    );
  }

  return pickStarterFromBand(
    players,
    STARTER_MID_MIN_PERCENTILE,
    STARTER_MID_MAX_PERCENTILE,
  );
}

function scoreInWindow(
  players: ScoredPlayer[],
  targetScore: number,
  minDelta: number,
  maxDelta: number,
): ScoredPlayer[] {
  return players.filter((player) => {
    const diff = player.gameScore - targetScore;
    return diff >= minDelta && diff <= maxDelta;
  });
}

function buildTradePool(
  positionPlayers: ScoredPlayer[],
  starter: ScoredPlayer,
  usedIds: Set<string>,
): ScoredPlayer[] {
  const jackpotEligible = positionPlayers.filter(
    (player) =>
      !usedIds.has(player.id) &&
      player.id !== starter.id &&
      player.gameScore >=
        positionPlayers[percentileIndex(positionPlayers.length, TRADE_JACKPOT_MIN_PERCENTILE)]
          .gameScore,
  );

  const nearPlayers = scoreInWindow(
    positionPlayers,
    starter.gameScore,
    -TRADE_SCORE_WINDOW,
    TRADE_SCORE_WINDOW,
  ).filter((player) => !usedIds.has(player.id) && player.id !== starter.id);

  const fallbackNearPlayers = scoreInWindow(
    positionPlayers,
    starter.gameScore,
    -FALLBACK_TRADE_SCORE_WINDOW,
    FALLBACK_TRADE_SCORE_WINDOW,
  ).filter((player) => !usedIds.has(player.id) && player.id !== starter.id);

  const trades: ScoredPlayer[] = [];
  const localUsed = new Set<string>([starter.id]);

  if (Math.random() < TRADE_JACKPOT_CHANCE && jackpotEligible.length > 0) {
    const jackpot = sampleOne(jackpotEligible);
    trades.push(jackpot);
    localUsed.add(jackpot.id);
  }

  const remainingNear = nearPlayers.filter((player) => !localUsed.has(player.id));
  for (const player of pickN(remainingNear, TRADES_PER_PLAYER - trades.length)) {
    trades.push(player);
    localUsed.add(player.id);
  }

  if (trades.length < TRADES_PER_PLAYER) {
    const remainingFallback = fallbackNearPlayers.filter(
      (player) => !localUsed.has(player.id),
    );
    for (const player of pickN(remainingFallback, TRADES_PER_PLAYER - trades.length)) {
      trades.push(player);
      localUsed.add(player.id);
    }
  }

  if (trades.length < TRADES_PER_PLAYER) {
    const closest = pickNWeightedByClosestScore(
      positionPlayers.filter((player) => !localUsed.has(player.id) && !usedIds.has(player.id)),
      starter.gameScore,
      TRADES_PER_PLAYER - trades.length,
    );

    for (const player of closest) {
      trades.push(player);
      localUsed.add(player.id);
    }
  }

  return uniqueById(trades).slice(0, TRADES_PER_PLAYER);
}

function buildCutPool(
  positionPlayers: ScoredPlayer[],
  starter: ScoredPlayer,
  usedIds: Set<string>,
): ScoredPlayer[] {
  const lowerBand = scoreInWindow(
    positionPlayers,
    starter.gameScore,
    CUT_VOL_LOW_MIN,
    CUT_VOL_LOW_MAX,
  ).filter((player) => !usedIds.has(player.id) && player.id !== starter.id);

  const higherBand = scoreInWindow(
    positionPlayers,
    starter.gameScore,
    CUT_VOL_HIGH_MIN,
    CUT_VOL_HIGH_MAX,
  ).filter((player) => !usedIds.has(player.id) && player.id !== starter.id);

  const nearBand = scoreInWindow(
    positionPlayers,
    starter.gameScore,
    -CUT_NEAR_SCORE_WINDOW,
    CUT_NEAR_SCORE_WINDOW,
  ).filter((player) => !usedIds.has(player.id) && player.id !== starter.id);

  const fallbackNearBand = scoreInWindow(
    positionPlayers,
    starter.gameScore,
    -FALLBACK_CUT_NEAR_SCORE_WINDOW,
    FALLBACK_CUT_NEAR_SCORE_WINDOW,
  ).filter((player) => !usedIds.has(player.id) && player.id !== starter.id);

  const cuts: ScoredPlayer[] = [];
  const localUsed = new Set<string>([starter.id]);

  for (const player of pickN(lowerBand, Math.min(2, CUTS_PER_POSITION - cuts.length))) {
    cuts.push(player);
    localUsed.add(player.id);
  }

  for (const player of pickN(higherBand, Math.min(2, CUTS_PER_POSITION - cuts.length))) {
    if (cuts.length >= CUTS_PER_POSITION) break;
    cuts.push(player);
    localUsed.add(player.id);
  }

  if (cuts.length < CUTS_PER_POSITION) {
    const remainingNear = nearBand.filter((player) => !localUsed.has(player.id));
    for (const player of pickN(remainingNear, CUTS_PER_POSITION - cuts.length)) {
      cuts.push(player);
      localUsed.add(player.id);
    }
  }

  if (cuts.length < CUTS_PER_POSITION) {
    const remainingFallback = fallbackNearBand.filter((player) => !localUsed.has(player.id));
    for (const player of pickN(remainingFallback, CUTS_PER_POSITION - cuts.length)) {
      cuts.push(player);
      localUsed.add(player.id);
    }
  }

  if (cuts.length < CUTS_PER_POSITION) {
    const closest = pickNWeightedByClosestScore(
      positionPlayers.filter((player) => !localUsed.has(player.id) && !usedIds.has(player.id)),
      starter.gameScore,
      CUTS_PER_POSITION - cuts.length,
    );

    for (const player of closest) {
      cuts.push(player);
      localUsed.add(player.id);
    }
  }

  return uniqueById(cuts)
    .sort((a, b) => a.gameScore - b.gameScore)
    .slice(0, CUTS_PER_POSITION);
}

function buildPositionOptions(
  positionPlayers: ScoredPlayer[],
  isStarSlot: boolean,
): GameOption[] {
  const starter = pickStarter(positionPlayers, isStarSlot);
  const usedIds = new Set<string>([starter.id]);

  const cuts = buildCutPool(positionPlayers, starter, usedIds);
  for (const player of cuts) {
    usedIds.add(player.id);
  }

  const orderedPlayers = [starter, ...cuts];

  return orderedPlayers.map((player) => ({
    player: toGamePlayer(player),
    trades: buildTradePool(positionPlayers, player, usedIds).map(toGamePlayer),
  }));
}

function pickStarPositions(): Set<Position> {
  const starCount = randomInt(STARTER_STAR_POSITIONS_MIN, STARTER_STAR_POSITIONS_MAX);
  return new Set(pickN(POSITIONS, starCount));
}

function buildGame(players: ScoredPlayer[]): DailyGame {
  const grouped = groupByPosition(players);
  const starPositions = pickStarPositions();

  const positions = POSITIONS.reduce<Record<Position, GamePosition>>((acc, position) => {
    const positionPlayers = grouped[position];

    if (positionPlayers.length < STARTER_COUNT_PER_POSITION + TRADES_PER_PLAYER) {
      throw new Error(`Not enough players for position ${position}`);
    }

    acc[position] = {
      options: buildPositionOptions(positionPlayers, starPositions.has(position)),
    };

    return acc;
  }, {
    PG: { options: [] },
    SG: { options: [] },
    SF: { options: [] },
    PF: { options: [] },
    C: { options: [] },
  });

  return {
    date: TARGET_DATE,
    salaryCap: SALARY_CAP,
    positions,
  };
}

function main(): void {
  const players = readPlayers();
  const game = buildGame(players);
  writeGame(game);

  console.log(`Generated game for ${game.date}`);
  console.log(`Wrote ${GAME_PATH}`);
}

main();
