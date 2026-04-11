import playersData from "../../data/players.json";
import { scorePlayer } from "../../game/scorePlayer";
import type { DailyGame, Player, Position } from "../../game/types";

type BuildStatusCallback = (status: string) => void;

type ScoredPlayer = Player & {
  gameScore: number;
};

const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];

const SALARY_CAP = 150_000_000;
const STARTER_COUNT_PER_POSITION = 6;
const TRADES_PER_PLAYER = 3;
const CUTS_PER_POSITION = 5;

const STARTER_STAR_POSITIONS_MIN = 1;
const STARTER_STAR_POSITIONS_MAX = 3;

const STARTER_MID_MIN_PERCENTILE = 0.65;
const STARTER_MID_MAX_PERCENTILE = 0.87;
const STARTER_STAR_MIN_PERCENTILE = 0.87;
const STARTER_STAR_MAX_PERCENTILE = 0.96;

const TRADE_SCORE_WINDOW = 1.6;
const FALLBACK_TRADE_SCORE_WINDOW = 2.5;

const TRADE_JACKPOT_CHANCE = 0.05;
const TRADE_JACKPOT_MIN_PERCENTILE = 0.75;

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

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function readPlayers(): ScoredPlayer[] {
  const parsed = playersData as Player[];

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
        (Number.isFinite(player.minutesPlayed) ||
          Number.isFinite(player.minutesPerGame) ||
          Number.isFinite(player.activeMinuteShare))
      );
    })
    .map((player) => ({
      ...player,
      gameScore: scorePlayer(player),
    }));
}

function groupByPosition(
  players: ScoredPlayer[],
): Record<Position, ScoredPlayer[]> {
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

function pickStarter(
  players: ScoredPlayer[],
  isStarSlot: boolean,
): ScoredPlayer {
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

function pickNormalTradeTargets(
  allPositionPlayers: ScoredPlayer[],
  basePlayer: ScoredPlayer,
): ScoredPlayer[] {
  let pool = allPositionPlayers.filter((candidate) => {
    return (
      candidate.id !== basePlayer.id &&
      Math.abs(candidate.gameScore - basePlayer.gameScore) <=
        TRADE_SCORE_WINDOW
    );
  });

  if (pool.length < TRADES_PER_PLAYER) {
    pool = allPositionPlayers.filter((candidate) => {
      return (
        candidate.id !== basePlayer.id &&
        Math.abs(candidate.gameScore - basePlayer.gameScore) <=
          FALLBACK_TRADE_SCORE_WINDOW
      );
    });
  }

  if (pool.length < TRADES_PER_PLAYER) {
    pool = [...allPositionPlayers]
      .filter((candidate) => candidate.id !== basePlayer.id)
      .sort(
        (a, b) =>
          Math.abs(a.gameScore - basePlayer.gameScore) -
          Math.abs(b.gameScore - basePlayer.gameScore),
      )
      .slice(0, Math.max(TRADES_PER_PLAYER, 12));
  }

  const picked = pickN(uniqueById(pool), TRADES_PER_PLAYER);

  if (picked.length < TRADES_PER_PLAYER) {
    throw new Error(
      `Could not find ${TRADES_PER_PLAYER} trade targets for ${basePlayer.name}.`,
    );
  }

  return picked;
}

function maybeInjectJackpotTradeTarget(
  allPositionPlayers: ScoredPlayer[],
  basePlayer: ScoredPlayer,
  normalTargets: ScoredPlayer[],
): ScoredPlayer[] {
  if (Math.random() >= TRADE_JACKPOT_CHANCE) {
    return normalTargets;
  }

  const jackpotStartIndex = percentileIndex(
    allPositionPlayers.length,
    TRADE_JACKPOT_MIN_PERCENTILE,
  );

  const existingIds = new Set<string>([
    basePlayer.id,
    ...normalTargets.map((player) => player.id),
  ]);

  const jackpotPool = allPositionPlayers
    .slice(jackpotStartIndex)
    .filter((candidate) => !existingIds.has(candidate.id));

  if (jackpotPool.length === 0) {
    return normalTargets;
  }

  const jackpotTarget = sampleOne(jackpotPool);
  const replacedIndex = randomInt(0, normalTargets.length - 1);
  const nextTargets = [...normalTargets];

  nextTargets[replacedIndex] = jackpotTarget;
  return nextTargets;
}

function pickTradeTargets(
  allPositionPlayers: ScoredPlayer[],
  basePlayer: ScoredPlayer,
): ScoredPlayer[] {
  const normalTargets = pickNormalTradeTargets(allPositionPlayers, basePlayer);
  return maybeInjectJackpotTradeTarget(
    allPositionPlayers,
    basePlayer,
    normalTargets,
  );
}

function pickCutAlternatives(
  allPositionPlayers: ScoredPlayer[],
  starter: ScoredPlayer,
): ScoredPlayer[] {
  const chosen = [...allPositionPlayers]
    .filter((candidate) => candidate.id !== starter.id)
    .sort(
      (a, b) =>
        Math.abs(a.gameScore - starter.gameScore) -
        Math.abs(b.gameScore - starter.gameScore),
    )
    .slice(0, CUTS_PER_POSITION * 9);

  const picked = shuffle(uniqueById(chosen)).slice(0, CUTS_PER_POSITION);

  if (picked.length < CUTS_PER_POSITION) {
    throw new Error(
      `Could not find ${CUTS_PER_POSITION} cut alternatives for ${starter.name}.`,
    );
  }

  return picked;
}

function pickStarPositions(): Set<Position> {
  const starCount = randomInt(
    STARTER_STAR_POSITIONS_MIN,
    STARTER_STAR_POSITIONS_MAX,
  );
  return new Set(pickN(POSITIONS, starCount));
}

async function yieldToBrowser(): Promise<void> {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

export async function generateForeverGame(
  onStatus?: BuildStatusCallback,
): Promise<DailyGame> {
  onStatus?.("Loading and scoring the player pool…");
  const players = readPlayers();
  const grouped = groupByPosition(players);
  const starPositions = pickStarPositions();

  await yieldToBrowser();
  onStatus?.("Selecting starters, cuts, and trade targets…");

  const positions: DailyGame["positions"] = {
    PG: { options: [] },
    SG: { options: [] },
    SF: { options: [] },
    PF: { options: [] },
    C: { options: [] },
  };

  for (const position of POSITIONS) {
    const positionPlayers = grouped[position];

    if (
      positionPlayers.length <
      STARTER_COUNT_PER_POSITION + TRADES_PER_PLAYER
    ) {
      throw new Error(`Not enough players available for ${position}.`);
    }

    const starter = pickStarter(positionPlayers, starPositions.has(position));
    const cuts = pickCutAlternatives(positionPlayers, starter);
    const offeredPlayers = [starter, ...cuts];
    const seenOptionIds = new Set<string>();
    const options: DailyGame["positions"][Position]["options"] = [];

    for (const offeredPlayer of offeredPlayers) {
      if (seenOptionIds.has(offeredPlayer.id)) continue;

      seenOptionIds.add(offeredPlayer.id);
      options.push({
        player: offeredPlayer,
        trades: pickTradeTargets(positionPlayers, offeredPlayer),
      });
    }

    if (options.length !== STARTER_COUNT_PER_POSITION) {
      throw new Error(
        `Expected ${STARTER_COUNT_PER_POSITION} options for ${position}, got ${options.length}.`,
      );
    }

    positions[position] = { options };
    onStatus?.(`Built ${position} chain.`);
    await yieldToBrowser();
  }

  return {
    date: todayIsoDate(),
    salaryCap: SALARY_CAP,
    positions,
  };
}