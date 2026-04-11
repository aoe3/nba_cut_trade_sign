import fs from "fs";
import path from "path";

import players from "../src/data/players.json";
import { scorePlayer } from "../src/game/scorePlayer";
import type { Player } from "../src/game/types";

type PlayerWithExtras = Player & {
  minutesPerGame?: number;
  minutesPlayed?: number;
  ppg?: number;
  rpg?: number;
  apg?: number;
  spg?: number;
  bpg?: number;
  fgPct?: number;
  threePct?: number;
  ftPct?: number;
};

type ScoredPlayer = {
  rank: number;
  name: string;
  team: string;
  position: string;
  score: number;
  bpm: number | null;
  per: number | null;
  ws48: number | null;
  usgPct: number | null;
  age: number | null;
  salary: number | null;
  gamesPlayed: number | null;
  teamGamesPlayed: number | null;
  minutesPerGame: number | null;
  minutesPlayed: number | null;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  spg: number | null;
  bpg: number | null;
  fgPct: number | null;
  threePct: number | null;
  ftPct: number | null;
};

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatNumber(value: number | null, digits = 1): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

function formatPct(value: number | null, digits = 3): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

function formatMoney(value: number | null): string {
  if (value === null) return "n/a";
  return `$${Math.round(value).toLocaleString()}`;
}

function main(): void {
  const playerList = players as PlayerWithExtras[];

  const scoredPlayers: ScoredPlayer[] = playerList
    .map((player) => ({
      rank: 0,
      name: player.name,
      team: player.team,
      position: player.position,
      score: scorePlayer(player),
      bpm: safeNumber(player.bpm),
      per: safeNumber(player.per),
      ws48: safeNumber(player.ws48),
      usgPct: safeNumber(player.usgPct),
      age: safeNumber(player.age),
      salary: safeNumber(player.salary),
      gamesPlayed: safeNumber(player.gamesPlayed),
      teamGamesPlayed: safeNumber(player.teamGamesPlayed),
      minutesPerGame: safeNumber(player.minutesPerGame),
      minutesPlayed: safeNumber(player.minutesPlayed),
      ppg: safeNumber(player.ppg),
      rpg: safeNumber(player.rpg),
      apg: safeNumber(player.apg),
      spg: safeNumber(player.spg),
      bpg: safeNumber(player.bpg),
      fgPct: safeNumber(player.fgPct),
      threePct: safeNumber(player.threePct),
      ftPct: safeNumber(player.ftPct),
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((player, index) => ({
      ...player,
      rank: index + 1,
    }));

  const outputLines: string[] = [];

  outputLines.push(`Scored ${scoredPlayers.length} players`);
  outputLines.push("");

  for (const player of scoredPlayers) {
    outputLines.push(
      [
        `${String(player.rank).padStart(3, " ")}.`,
        `${player.name}`,
        `${player.team}`,
        `${player.position}`,
        `Score ${player.score.toFixed(1)}`,
        `BPM ${formatNumber(player.bpm, 1)}`,
        `PER ${formatNumber(player.per, 1)}`,
        `WS/48 ${formatNumber(player.ws48, 3)}`,
        `USG% ${formatNumber(player.usgPct, 1)}`,
        `Age ${formatNumber(player.age, 0)}`,
        `MPG ${formatNumber(player.minutesPerGame, 1)}`,
        `Min ${formatNumber(player.minutesPlayed, 0)}`,
        `PPG ${formatNumber(player.ppg, 1)}`,
        `RPG ${formatNumber(player.rpg, 1)}`,
        `APG ${formatNumber(player.apg, 1)}`,
        `SPG ${formatNumber(player.spg, 1)}`,
        `BPG ${formatNumber(player.bpg, 1)}`,
        `FG% ${formatPct(player.fgPct, 3)}`,
        `3P% ${formatPct(player.threePct, 3)}`,
        `FT% ${formatPct(player.ftPct, 3)}`,
        `GP ${player.gamesPlayed ?? "n/a"}/${player.teamGamesPlayed ?? "n/a"}`,
        `Salary ${formatMoney(player.salary)}`,
      ].join(" | ")
    );
  }

  const outputPath = path.resolve(process.cwd(), "testlogs/scoreTestLog.txt");
  fs.writeFileSync(outputPath, `${outputLines.join("\n")}\n`, "utf8");

  console.log(`Wrote ${scoredPlayers.length} scores to ${outputPath}`);
}

main();