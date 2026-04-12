import players from "../../data/players.json";
import { scorePlayer } from "../../game/scorePlayer";
import type { Player } from "../../game/types";

export type BattleSlot = "G" | "F" | "C";

export type StackBattlePlayer = Player & (typeof players)[number];

export type StackBattleStat = {
  key: string;
  label: string;
  value: string;
};

export type StackOption = {
  player: StackBattlePlayer;
  stats: StackBattleStat[];
  tradeTargets: (StackBattlePlayer & { isJackpot?: boolean })[];
};

export type StackPool = {
  options: StackOption[];
  currentIndex: number;
};

export type StackBattleGame = {
  pools: Record<BattleSlot, StackPool>;
};

type ScoredStackBattlePlayer = StackBattlePlayer & {
  gameScore: number;
};

const STACK_DEPTH = 12;
const TRADE_TARGET_COUNT = 3;
const TRADE_SCORE_WINDOW = 2.4;
const FALLBACK_TRADE_SCORE_WINDOW = 4.2;
const TRADE_JACKPOT_CHANCE = 0.08;
const TRADE_JACKPOT_SCORE_MULTIPLIER = 1.1;
const START_MIN_PERCENTILE = 0.58;
const START_MAX_PERCENTILE = 0.9;

const typedPlayers = (players as StackBattlePlayer[]).map((player) => ({
  ...player,
  gameScore: scorePlayer(player),
}));

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

function shuffleInPlace<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
}

function formatStatValue(key: string, value: number): string {
  if (key === "fgPct" || key === "threePct") {
    return `${(value * 100).toFixed(1)}%`;
  }

  return value.toFixed(1);
}

function pickRandomStats(player: StackBattlePlayer): StackBattleStat[] {
  const statPool = [
    { key: "ppg", label: "PPG", value: player.ppg },
    { key: "rpg", label: "RPG", value: player.rpg },
    { key: "apg", label: "APG", value: player.apg },
    { key: "spg", label: "SPG", value: player.spg },
    { key: "bpg", label: "BPG", value: player.bpg },
    { key: "fgPct", label: "FG%", value: player.fgPct },
    { key: "threePct", label: "3P%", value: player.threePct },
  ].filter((stat): stat is { key: string; label: string; value: number } => {
    return typeof stat.value === "number" && Number.isFinite(stat.value);
  });

  shuffleInPlace(statPool);

  return statPool.slice(0, 3).map((stat) => ({
    key: stat.key,
    label: stat.label,
    value: formatStatValue(stat.key, stat.value),
  }));
}

function pickStarterBand(playersByScore: ScoredStackBattlePlayer[]): ScoredStackBattlePlayer {
  const startIndex = percentileIndex(playersByScore.length, START_MIN_PERCENTILE);
  const endIndex = percentileIndex(playersByScore.length, START_MAX_PERCENTILE);
  const band = playersByScore.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1);

  return sampleOne(band.length > 0 ? band : playersByScore);
}

function rankClosest(playersPool: ScoredStackBattlePlayer[], targetScore: number): ScoredStackBattlePlayer[] {
  return [...playersPool].sort((a, b) => {
    const da = Math.abs(a.gameScore - targetScore);
    const db = Math.abs(b.gameScore - targetScore);
    return da - db;
  });
}

function pickNextPlayer(
  remaining: ScoredStackBattlePlayer[],
  basePlayer: ScoredStackBattlePlayer,
): ScoredStackBattlePlayer {
  const nearPool = remaining.filter(
    (candidate) =>
      Math.abs(candidate.gameScore - basePlayer.gameScore) <= TRADE_SCORE_WINDOW,
  );

  const fallbackPool =
    nearPool.length > 0
      ? nearPool
      : remaining.filter(
          (candidate) =>
            Math.abs(candidate.gameScore - basePlayer.gameScore) <=
            FALLBACK_TRADE_SCORE_WINDOW,
        );

  const ranked = rankClosest(
    fallbackPool.length > 0 ? fallbackPool : remaining,
    basePlayer.gameScore,
  );

  const jackpotEligible = remaining.filter(
    (candidate) => candidate.gameScore >= basePlayer.gameScore * TRADE_JACKPOT_SCORE_MULTIPLIER,
  );

  if (jackpotEligible.length > 0 && Math.random() < TRADE_JACKPOT_CHANCE) {
    const rankedJackpot = [...jackpotEligible].sort(
      (a, b) => b.gameScore - a.gameScore,
    );
    return sampleOne(rankedJackpot.slice(0, Math.min(6, rankedJackpot.length)));
  }

  return sampleOne(ranked.slice(0, Math.min(8, ranked.length)));
}

function buildOrderedPool(
  filteredPlayers: ScoredStackBattlePlayer[],
): ScoredStackBattlePlayer[] {
  if (filteredPlayers.length < STACK_DEPTH) {
    throw new Error("Not enough players to build Draft Battle pool.");
  }

  const playersByScore = [...filteredPlayers].sort(
    (a, b) => a.gameScore - b.gameScore,
  );

  const ordered: ScoredStackBattlePlayer[] = [];
  const usedIds = new Set<string>();

  const firstPlayer = pickStarterBand(playersByScore);
  ordered.push(firstPlayer);
  usedIds.add(firstPlayer.id);

  while (ordered.length < STACK_DEPTH) {
    const remaining = playersByScore.filter((player) => !usedIds.has(player.id));

    if (remaining.length === 0) {
      break;
    }

    const basePlayer = ordered[ordered.length - 1];
    const nextPlayer = pickNextPlayer(remaining, basePlayer);

    ordered.push(nextPlayer);
    usedIds.add(nextPlayer.id);
  }

  return ordered.slice(0, STACK_DEPTH);
}

function buildTradeTargets(
  orderedPlayers: ScoredStackBattlePlayer[],
  playerIndex: number,
): (StackBattlePlayer & { isJackpot?: boolean })[] {
  const basePlayer = orderedPlayers[playerIndex];
  const remainingAhead = orderedPlayers.slice(playerIndex + 1);

  const nearby = rankClosest(remainingAhead, basePlayer.gameScore);

  const selected = nearby.slice(0, TRADE_TARGET_COUNT);

  const shouldHaveJackpot = Math.random() < 0.18; // tune this (0.15–0.25 feels good)

  const jackpotIndex = shouldHaveJackpot
    ? Math.floor(Math.random() * selected.length)
    : -1;

  return selected.map((candidate, index) => {
    const { gameScore: _gameScore, ...player } = candidate;

    return {
      ...player,
      isJackpot: index === jackpotIndex,
    };
  });
}

function buildPool(
  filterFn: (player: StackBattlePlayer) => boolean,
): StackPool {
  const scoredPool = typedPlayers.filter(filterFn);
  const orderedPlayers = buildOrderedPool(scoredPool);

  const options = orderedPlayers.map((player, playerIndex) => {
    const { gameScore: _gameScore, ...rawPlayer } = player;

    return {
      player: rawPlayer,
      stats: pickRandomStats(rawPlayer),
      tradeTargets: buildTradeTargets(orderedPlayers, playerIndex),
    };
  });

  return {
    options,
    currentIndex: 0,
  };
}

export function createStackBattleGame(): StackBattleGame {
  return {
    pools: {
      G: buildPool(
        (player) => player.position === "PG" || player.position === "SG",
      ),
      F: buildPool(
        (player) => player.position === "SF" || player.position === "PF",
      ),
      C: buildPool((player) => player.position === "C"),
    },
  };
}
