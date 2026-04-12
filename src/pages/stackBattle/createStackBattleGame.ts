import players from "../../data/players.json";
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
  tradeTargets: StackBattlePlayer[];
};

export type StackPool = {
  options: StackOption[];
  currentIndex: number;
};

export type StackBattleGame = {
  pools: Record<BattleSlot, StackPool>;
};

const typedPlayers = players as StackBattlePlayer[];

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

function buildPool(
  filterFn: (player: StackBattlePlayer) => boolean,
): StackPool {
  const poolPlayers = shuffleInPlace(typedPlayers.filter(filterFn).slice());

  const selectedPlayers = poolPlayers.slice(0, 12);

  while (selectedPlayers.length < 12 && poolPlayers.length > 0) {
    selectedPlayers.push(
      poolPlayers[Math.floor(Math.random() * poolPlayers.length)],
    );
  }

  const options = selectedPlayers.map((player, playerIndex) => {
    const tradePool = selectedPlayers.filter(
      (candidate, candidateIndex) =>
        candidateIndex !== playerIndex && candidate.id !== player.id,
    );
    shuffleInPlace(tradePool);

    return {
      player,
      stats: pickRandomStats(player),
      tradeTargets: tradePool.slice(0, 3),
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
