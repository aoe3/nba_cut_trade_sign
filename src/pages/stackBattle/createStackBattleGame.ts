import playersData from "../../data/players.json";
import { scorePlayer } from "../../game/scorePlayer";
import type { Player } from "../../game/types";

export type BattleSlot = "G" | "F" | "C";

export type StackBattleOptionNode = {
  player: Player;
  trades: [Player, Player, Player] | Player[];
};

export type StackBattleGame = {
  date: string;
  pools: Record<BattleSlot, { options: StackBattleOptionNode[] }>;
};

type ScoredPlayer = Player & {
  gameScore: number;
};

const BATTLE_SLOTS: BattleSlot[] = ["G", "F", "C"];
const STACK_DEPTH = 12;
const TRADES_PER_PLAYER = 3;

const STARTER_STAR_SLOTS_MIN = 1;
const STARTER_STAR_SLOTS_MAX = 2;
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

  for (let index = arr.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [arr[index], arr[swapIndex]] = [arr[swapIndex], arr[index]];
  }

  return arr;
}

function pickN<T>(items: T[], count: number): T[] {
  if (count <= 0) return [];
  return shuffle(items).slice(0, count);
}

function uniqueById(players: ScoredPlayer[]): ScoredPlayer[] {
  const seen = new Set<string>();
  const out: ScoredPlayer[] = [];

  for (const player of players) {
    if (seen.has(player.id)) continue;
    seen.add(player.id);
    out.push(player);
  }

  return out;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function mapPlayerToBattleSlot(player: Player): BattleSlot | null {
  if (player.position === "PG" || player.position === "SG") return "G";
  if (player.position === "SF" || player.position === "PF") return "F";
  if (player.position === "C") return "C";
  return null;
}

function readPlayers(): ScoredPlayer[] {
  const parsed = playersData as Player[];

  return parsed
    .filter((player) => {
      return (
        mapPlayerToBattleSlot(player) !== null &&
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

function groupByBattleSlot(
  players: ScoredPlayer[],
): Record<BattleSlot, ScoredPlayer[]> {
  const grouped: Record<BattleSlot, ScoredPlayer[]> = {
    G: [],
    F: [],
    C: [],
  };

  for (const player of players) {
    const slot = mapPlayerToBattleSlot(player);
    if (!slot) continue;
    grouped[slot].push(player);
  }

  for (const slot of BATTLE_SLOTS) {
    grouped[slot].sort((a, b) => a.gameScore - b.gameScore);
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

function pickNormalTradeTargets(
  allSlotPlayers: ScoredPlayer[],
  basePlayer: ScoredPlayer,
): ScoredPlayer[] {
  let pool = allSlotPlayers.filter((candidate) => {
    return (
      candidate.id !== basePlayer.id &&
      Math.abs(candidate.gameScore - basePlayer.gameScore) <= TRADE_SCORE_WINDOW
    );
  });

  if (pool.length < TRADES_PER_PLAYER) {
    pool = allSlotPlayers.filter((candidate) => {
      return (
        candidate.id !== basePlayer.id &&
        Math.abs(candidate.gameScore - basePlayer.gameScore) <=
          FALLBACK_TRADE_SCORE_WINDOW
      );
    });
  }

  if (pool.length < TRADES_PER_PLAYER) {
    pool = [...allSlotPlayers]
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
  allSlotPlayers: ScoredPlayer[],
  basePlayer: ScoredPlayer,
  normalTargets: ScoredPlayer[],
): ScoredPlayer[] {
  if (Math.random() >= TRADE_JACKPOT_CHANCE) {
    return normalTargets;
  }

  const jackpotStartIndex = percentileIndex(
    allSlotPlayers.length,
    TRADE_JACKPOT_MIN_PERCENTILE,
  );

  const existingIds = new Set<string>([
    basePlayer.id,
    ...normalTargets.map((player) => player.id),
  ]);

  const jackpotPool = allSlotPlayers
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
  allSlotPlayers: ScoredPlayer[],
  basePlayer: ScoredPlayer,
): ScoredPlayer[] {
  const normalTargets = pickNormalTradeTargets(allSlotPlayers, basePlayer);
  return maybeInjectJackpotTradeTarget(allSlotPlayers, basePlayer, normalTargets);
}

function pickStackAlternatives(
  allSlotPlayers: ScoredPlayer[],
  starter: ScoredPlayer,
): ScoredPlayer[] {
  const chosen = [...allSlotPlayers]
    .filter((candidate) => candidate.id !== starter.id)
    .sort(
      (a, b) =>
        Math.abs(a.gameScore - starter.gameScore) -
        Math.abs(b.gameScore - starter.gameScore),
    )
    .slice(0, STACK_DEPTH * 9);

  const picked = shuffle(uniqueById(chosen)).slice(0, STACK_DEPTH - 1);

  if (picked.length < STACK_DEPTH - 1) {
    throw new Error(
      `Could not find ${STACK_DEPTH - 1} stack alternatives for ${starter.name}.`,
    );
  }

  return picked;
}

function pickStarSlots(): Set<BattleSlot> {
  const starCount = randomInt(STARTER_STAR_SLOTS_MIN, STARTER_STAR_SLOTS_MAX);
  return new Set(pickN(BATTLE_SLOTS, starCount));
}

export function createStackBattleGame(): StackBattleGame {
  const players = readPlayers();
  const grouped = groupByBattleSlot(players);
  const starSlots = pickStarSlots();

  const pools: StackBattleGame["pools"] = {
    G: { options: [] },
    F: { options: [] },
    C: { options: [] },
  };

  for (const slot of BATTLE_SLOTS) {
    const slotPlayers = grouped[slot];

    if (slotPlayers.length < STACK_DEPTH + TRADES_PER_PLAYER) {
      throw new Error(`Not enough players available for ${slot} pool.`);
    }

    const starter = pickStarter(slotPlayers, starSlots.has(slot));
    const cuts = pickStackAlternatives(slotPlayers, starter);
    const offeredPlayers = [starter, ...cuts];
    const seenOptionIds = new Set<string>();
    const options: StackBattleOptionNode[] = [];

    for (const offeredPlayer of offeredPlayers) {
      if (seenOptionIds.has(offeredPlayer.id)) continue;
      seenOptionIds.add(offeredPlayer.id);

      options.push({
        player: offeredPlayer,
        trades: pickTradeTargets(slotPlayers, offeredPlayer),
      });
    }

    if (options.length !== STACK_DEPTH) {
      throw new Error(
        `Expected ${STACK_DEPTH} options for ${slot}, got ${options.length}.`,
      );
    }

    pools[slot] = { options };
  }

  return {
    date: todayIsoDate(),
    pools,
  };
}
