import { useCallback, useEffect, useMemo, useState } from "react";

import type { AppMode } from "../App";
import { HowToPlayModal } from "../components/HowToPlayModal";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { ModeDropdown } from "../components/ModeDropdown";
import { ShootoutCoinFlipModal } from "../components/ShootoutCoinFlipModal";
import { ShootoutMoveCounter } from "../components/ShootoutMoveCounter";
import { scorePlayer } from "../game/scorePlayer";
import {
  createDraftBattleGame,
  type BattleSlot,
  type DraftBattleGame,
  type DraftBattlePlayer,
  type StackOption,
} from "./draftBattle/createDraftBattleGame";

type DraftBattlePageProps = {
  activeMode: AppMode;
  onChangeMode: (mode: AppMode) => void;
};

type TurnOwner = "user" | "cpu";
type GameWinner = TurnOwner | "tie" | null;
type TradeTarget = DraftBattlePlayer & { isJackpot?: boolean };

type SignedLineupSlot = {
  player: DraftBattlePlayer;
  score: number;
};

type DraftBattleLineup = Record<BattleSlot, SignedLineupSlot | null>;

type HistoryEntry = {
  id: string;
  owner: TurnOwner | "system";
  text: string;
};

type DraftBattleSession = {
  activeTurn: TurnOwner | null;
  initialTurn: TurnOwner | null;
  setupComplete: boolean;
  userMovesRemaining: number;
  cpuMovesRemaining: number;
  userLineup: DraftBattleLineup;
  cpuLineup: DraftBattleLineup;
  gameOver: boolean;
  winner: GameWinner;
  history: HistoryEntry[];
};

const BATTLE_SLOTS: BattleSlot[] = ["G", "F", "C"];
const DRAFT_BATTLE_GAME_STORAGE_KEY = "cut-trade-sign:draft-battle-game";
const DRAFT_BATTLE_INITIAL_GAME_STORAGE_KEY =
  "cut-trade-sign:draft-battle-initial-game";
const DRAFT_BATTLE_SESSION_STORAGE_KEY = "cut-trade-sign:draft-battle-session";
const CPU_TURN_DELAY_MS = 850;
const AUTO_SIGN_DELAY_MS = 600;
const CPU_SIGN_SCORE_THRESHOLD = 57;
const CPU_TRADE_SCORE_THRESHOLD = 61;
const CPU_DEFENSIVE_CUT_THRESHOLD = 58;
const CPU_FISH_IMPROVEMENT_THRESHOLD = 3.5;
const CPU_TRADE_IMPROVEMENT_THRESHOLD = 7;
const CPU_BIG_THREAT_MARGIN = 5.5;
const CPU_LOOKAHEAD_DEPTH = 4;

function getPoolLabel(slot: BattleSlot): string {
  switch (slot) {
    case "G":
      return "Guard Pool";
    case "F":
      return "Forward Pool";
    case "C":
      return "Center Pool";
    default:
      return slot;
  }
}

function createEmptyLineup(): DraftBattleLineup {
  return {
    G: null,
    F: null,
    C: null,
  };
}

function createInitialSession(): DraftBattleSession {
  return {
    activeTurn: null,
    initialTurn: null,
    setupComplete: false,
    userMovesRemaining: 5,
    cpuMovesRemaining: 5,
    userLineup: createEmptyLineup(),
    cpuLineup: createEmptyLineup(),
    gameOver: false,
    winner: null,
    history: [],
  };
}

function normalizeStoredSession(raw: unknown): DraftBattleSession | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const parsed = raw as Partial<DraftBattleSession>;
  const base = createInitialSession();

  return {
    ...base,
    ...parsed,
    userMovesRemaining:
      typeof parsed.userMovesRemaining === "number"
        ? parsed.userMovesRemaining
        : base.userMovesRemaining,
    cpuMovesRemaining:
      typeof parsed.cpuMovesRemaining === "number"
        ? parsed.cpuMovesRemaining
        : base.cpuMovesRemaining,
    userLineup: {
      ...base.userLineup,
      ...(parsed.userLineup ?? {}),
    },
    cpuLineup: {
      ...base.cpuLineup,
      ...(parsed.cpuLineup ?? {}),
    },
    gameOver: Boolean(parsed.gameOver),
    winner:
      parsed.winner === "user" ||
      parsed.winner === "cpu" ||
      parsed.winner === "tie"
        ? parsed.winner
        : null,
    history: Array.isArray(parsed.history) ? parsed.history : [],
  };
}

function loadGameFromStorage(key: string): DraftBattleGame | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as DraftBattleGame;
  } catch {
    return null;
  }
}

function loadStoredGame(): DraftBattleGame | null {
  return loadGameFromStorage(DRAFT_BATTLE_GAME_STORAGE_KEY);
}

function loadInitialGame(): DraftBattleGame | null {
  return loadGameFromStorage(DRAFT_BATTLE_INITIAL_GAME_STORAGE_KEY);
}

function loadStoredSession(): DraftBattleSession | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_BATTLE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    return normalizeStoredSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

function persistGame(game: DraftBattleGame) {
  window.localStorage.setItem(
    DRAFT_BATTLE_GAME_STORAGE_KEY,
    JSON.stringify(game),
  );
}

function persistInitialGame(game: DraftBattleGame) {
  window.localStorage.setItem(
    DRAFT_BATTLE_INITIAL_GAME_STORAGE_KEY,
    JSON.stringify(game),
  );
}

function persistSession(session: DraftBattleSession) {
  window.localStorage.setItem(
    DRAFT_BATTLE_SESSION_STORAGE_KEY,
    JSON.stringify(session),
  );
}

function getCurrentOption(
  game: DraftBattleGame,
  slot: BattleSlot,
): StackOption | null {
  const pool = game.pools[slot];
  return pool.options[pool.currentIndex] ?? null;
}

function getValidTradeTargets(
  game: DraftBattleGame,
  slot: BattleSlot,
): TradeTarget[] {
  const currentOption = getCurrentOption(game, slot);
  if (!currentOption) {
    return [];
  }

  return currentOption.tradeTargets ?? [];
}

function removePlayersFromPool(
  game: DraftBattleGame,
  slot: BattleSlot,
  playerIds: string[],
): DraftBattleGame {
  const pool = game.pools[slot];
  const removedIds = new Set(playerIds);
  const nextOptions = pool.options.filter(
    (option) => !removedIds.has(option.player.id),
  );

  return {
    ...game,
    pools: {
      ...game.pools,
      [slot]: {
        ...pool,
        options: nextOptions,
        currentIndex:
          nextOptions.length === 0
            ? 0
            : Math.min(pool.currentIndex, nextOptions.length - 1),
      },
    },
  };
}

function getFirstEmptySlot(lineup: DraftBattleLineup): BattleSlot | null {
  for (const slot of BATTLE_SLOTS) {
    if (!lineup[slot]) {
      return slot;
    }
  }

  return null;
}

function isLineupComplete(lineup: DraftBattleLineup): boolean {
  return BATTLE_SLOTS.every((slot) => lineup[slot] !== null);
}

function scoreLineup(lineup: DraftBattleLineup): number {
  return Number(
    BATTLE_SLOTS.reduce(
      (sum, slot) => sum + (lineup[slot]?.score ?? 0),
      0,
    ).toFixed(1),
  );
}

function createSignedLineupSlot(player: DraftBattlePlayer): SignedLineupSlot {
  return {
    player,
    score: scorePlayer(player),
  };
}

function appendHistory(
  history: HistoryEntry[],
  owner: TurnOwner | "system",
  text: string,
): HistoryEntry[] {
  return [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      owner,
      text,
    },
    ...history,
  ];
}

function finalizeSession(session: DraftBattleSession): DraftBattleSession {
  if (
    !isLineupComplete(session.userLineup) ||
    !isLineupComplete(session.cpuLineup)
  ) {
    return {
      ...session,
      gameOver: false,
      winner: null,
    };
  }

  const userScore = scoreLineup(session.userLineup);
  const cpuScore = scoreLineup(session.cpuLineup);

  let winner: GameWinner = "tie";
  if (userScore > cpuScore) {
    winner = "user";
  } else if (cpuScore > userScore) {
    winner = "cpu";
  }

  return {
    ...session,
    activeTurn: null,
    gameOver: true,
    winner,
    history: appendHistory(
      session.history,
      "system",
      `Final score — You ${userScore.toFixed(1)} • CPU ${cpuScore.toFixed(1)}`,
    ),
  };
}

function getLeftScoreText(session: DraftBattleSession): string {
  return scoreLineup(session.userLineup).toFixed(1);
}

function getRightScoreText(session: DraftBattleSession): string {
  return scoreLineup(session.cpuLineup).toFixed(1);
}

function getRosterStats(
  player: DraftBattlePlayer,
): Array<{ label: string; value: string }> {
  return [
    { label: "PPG", value: player.ppg.toFixed(1) },
    { label: "RPG", value: player.rpg.toFixed(1) },
    { label: "APG", value: player.apg.toFixed(1) },
    { label: "SPG", value: player.spg.toFixed(1) },
    { label: "BPG", value: player.bpg.toFixed(1) },
    { label: "FG%", value: `${(player.fgPct * 100).toFixed(1)}%` },
  ];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max <= min) {
    return 0;
  }

  return clampNumber((value - min) / (max - min), 0, 1);
}

function hashPlayerId(playerId: string): number {
  let hash = 0;

  for (let index = 0; index < playerId.length; index += 1) {
    hash = (hash * 31 + playerId.charCodeAt(index)) % 1000003;
  }

  return hash;
}

function estimatePlayerValue(player: DraftBattlePlayer): number {
  const bpm = normalizeRange(safeNumber(player.bpm, -4), -7, 11);
  const per = normalizeRange(safeNumber(player.per, 10), 7, 28);
  const ws48 = normalizeRange(safeNumber(player.ws48, 0.05), -0.05, 0.25);
  const mpg = normalizeRange(safeNumber(player.minutesPerGame, 18), 10, 35);
  const ppg = normalizeRange(safeNumber(player.ppg, 8), 4, 28);
  const rpg = normalizeRange(safeNumber(player.rpg, 3), 1, 12);
  const apg = normalizeRange(safeNumber(player.apg, 2), 0.5, 9);
  const spg = normalizeRange(safeNumber(player.spg, 0.6), 0.2, 2);
  const bpg = normalizeRange(safeNumber(player.bpg, 0.4), 0, 2.5);
  const fgPct = normalizeRange(safeNumber(player.fgPct, 0.46), 0.4, 0.62);
  const threePct = normalizeRange(
    safeNumber(player.threePct, 0.34),
    0.28,
    0.42,
  );
  const threePa = normalizeRange(safeNumber(player.threePa, 2), 0.5, 8);
  const durability = normalizeRange(
    safeNumber(player.durability, 0.8),
    0.55,
    1,
  );
  const age = safeNumber(player.age, 27);

  const advancedCore =
    (bpm * 0.34 + per * 0.24 + ws48 * 0.24 + mpg * 0.18) * 60;
  const boxCreation =
    (ppg * 0.42 + rpg * 0.18 + apg * 0.22 + spg * 0.1 + bpg * 0.08) * 24;
  const shooting =
    (fgPct * 0.65 + threePct * 0.35 * Math.max(0.4, threePa)) * 10;
  const ageCurve =
    age >= 24 && age <= 30 ? 2.2 : age <= 22 || age >= 34 ? -1.5 : 0;
  const uncertainty = ((hashPlayerId(player.id) % 11) - 5) * 0.55;

  return Number(
    clampNumber(
      advancedCore +
        boxCreation +
        shooting +
        durability * 6 +
        ageCurve +
        uncertainty,
      0,
      100,
    ).toFixed(1),
  );
}

function getOpenSlots(lineup: DraftBattleLineup): BattleSlot[] {
  return BATTLE_SLOTS.filter((slot) => !lineup[slot]);
}

function getProjectedSlotValues(
  game: DraftBattleGame,
  slot: BattleSlot,
  lookahead = CPU_LOOKAHEAD_DEPTH,
): number[] {
  return game.pools[slot].options
    .slice(0, lookahead)
    .map((option) => estimatePlayerValue(option.player));
}

function getTopVisibleThreat(
  game: DraftBattleGame,
  lineup: DraftBattleLineup,
): { slot: BattleSlot; player: DraftBattlePlayer; score: number } | null {
  const threats = getOpenSlots(lineup)
    .map((slot) => {
      const currentOption = getCurrentOption(game, slot);
      if (!currentOption) {
        return null;
      }

      return {
        slot,
        player: currentOption.player,
        score: estimatePlayerValue(currentOption.player),
      };
    })
    .filter(
      (
        threat,
      ): threat is {
        slot: BattleSlot;
        player: DraftBattlePlayer;
        score: number;
      } => threat !== null,
    )
    .sort((a, b) => b.score - a.score);

  return threats[0] ?? null;
}

function getBestVisibleCutOption(
  game: DraftBattleGame,
  preferredSlots: BattleSlot[],
): { slot: BattleSlot; player: DraftBattlePlayer; score: number } | null {
  const preferredSlotSet = new Set(preferredSlots);

  const visibleOptions = BATTLE_SLOTS.map((slot) => {
    const currentOption = getCurrentOption(game, slot);
    if (!currentOption) {
      return null;
    }

    return {
      slot,
      player: currentOption.player,
      score: estimatePlayerValue(currentOption.player),
      isPreferred: preferredSlotSet.has(slot),
    };
  }).filter(
    (
      option,
    ): option is {
      slot: BattleSlot;
      player: DraftBattlePlayer;
      score: number;
      isPreferred: boolean;
    } => option !== null,
  );

  visibleOptions.sort((a, b) => {
    if (a.isPreferred !== b.isPreferred) {
      return Number(b.isPreferred) - Number(a.isPreferred);
    }

    return b.score - a.score;
  });

  return visibleOptions[0] ?? null;
}

function chooseCpuTradeMove(
  game: DraftBattleGame,
  cpuLineup: DraftBattleLineup,
): {
  slot: BattleSlot;
  target: TradeTarget;
  basePlayer: DraftBattlePlayer;
  improvement: number;
  targetScore: number;
  currentScore: number;
} | null {
  const candidates = getOpenSlots(cpuLineup)
    .map((slot) => {
      const currentOption = getCurrentOption(game, slot);
      const tradeTargets = getValidTradeTargets(game, slot);

      if (!currentOption || tradeTargets.length === 0) {
        return null;
      }

      const bestTarget = [...tradeTargets].sort((a, b) => {
        const scoreDelta = estimatePlayerValue(b) - estimatePlayerValue(a);
        if (scoreDelta !== 0) return scoreDelta;
        return Number(Boolean(b.isJackpot)) - Number(Boolean(a.isJackpot));
      })[0];

      if (!bestTarget) {
        return null;
      }

      const currentScore = estimatePlayerValue(currentOption.player);
      const targetScore = estimatePlayerValue(bestTarget);

      return {
        slot,
        target: bestTarget,
        basePlayer: currentOption.player,
        improvement: targetScore - currentScore,
        targetScore,
        currentScore,
        isJackpot: Boolean(bestTarget.isJackpot),
      };
    })
    .filter(
      (
        candidate,
      ): candidate is {
        slot: BattleSlot;
        target: TradeTarget;
        basePlayer: DraftBattlePlayer;
        improvement: number;
        targetScore: number;
        currentScore: number;
        isJackpot: boolean;
      } => candidate !== null,
    )
    .sort((a, b) => {
      if (b.isJackpot !== a.isJackpot) {
        return Number(b.isJackpot) - Number(a.isJackpot);
      }

      if (b.improvement !== a.improvement) {
        return b.improvement - a.improvement;
      }

      return b.targetScore - a.targetScore;
    });

  return candidates[0] ?? null;
}

type CpuDecision =
  | {
      type: "sign";
      slot: BattleSlot;
      player: DraftBattlePlayer;
      reason: string;
    }
  | {
      type: "trade";
      slot: BattleSlot;
      basePlayer: DraftBattlePlayer;
      target: TradeTarget;
      reason: string;
    }
  | {
      type: "cut";
      slot: BattleSlot;
      player: DraftBattlePlayer;
      reason: string;
    }
  | {
      type: "yield";
    };

function chooseCpuDecision(
  game: DraftBattleGame,
  session: DraftBattleSession,
): CpuDecision {
  const openCpuSlots = getOpenSlots(session.cpuLineup);
  const openUserSlots = getOpenSlots(session.userLineup);
  const cpuSlotsLeft = openCpuSlots.length;
  const userSlotsLeft = openUserSlots.length;
  const moveSlack = session.cpuMovesRemaining - cpuSlotsLeft;
  const isBehindOnScore =
    scoreLineup(session.cpuLineup) < scoreLineup(session.userLineup);
  const hasExtraMoveEdge =
    session.cpuMovesRemaining > session.userMovesRemaining;

  if (session.cpuMovesRemaining <= 0) {
    const forcedSlot = openCpuSlots[0] ?? null;
    const forcedOption = forcedSlot ? getCurrentOption(game, forcedSlot) : null;

    if (!forcedSlot || !forcedOption) {
      return { type: "yield" };
    }

    return {
      type: "sign",
      slot: forcedSlot,
      player: forcedOption.player,
      reason: `CPU auto-signed ${forcedOption.player.name} to ${forcedSlot}.`,
    };
  }

  const ownSlotReads = openCpuSlots
    .map((slot) => {
      const currentOption = getCurrentOption(game, slot);
      if (!currentOption) {
        return null;
      }

      const projectedValues = getProjectedSlotValues(game, slot);
      const currentEstimate =
        projectedValues[0] ?? estimatePlayerValue(currentOption.player);
      const bestFutureEstimate = projectedValues
        .slice(1)
        .reduce((best, value) => Math.max(best, value), currentEstimate);

      return {
        slot,
        player: currentOption.player,
        currentEstimate,
        bestFutureEstimate,
        futureImprovement: bestFutureEstimate - currentEstimate,
      };
    })
    .filter(
      (
        read,
      ): read is {
        slot: BattleSlot;
        player: DraftBattlePlayer;
        currentEstimate: number;
        bestFutureEstimate: number;
        futureImprovement: number;
      } => read !== null,
    )
    .sort((a, b) => {
      if (b.currentEstimate !== a.currentEstimate) {
        return b.currentEstimate - a.currentEstimate;
      }

      return a.futureImprovement - b.futureImprovement;
    });

  const bestOwnAvailable = ownSlotReads[0] ?? null;
  const weakestOwnAvailable =
    [...ownSlotReads].sort(
      (a, b) => a.currentEstimate - b.currentEstimate,
    )[0] ?? null;
  const bestTradeMove = chooseCpuTradeMove(game, session.cpuLineup);
  const topUserThreat = getTopVisibleThreat(game, session.userLineup);

  if (cpuSlotsLeft === 0 && session.cpuMovesRemaining > 0) {
    const forcedCutTarget =
      getBestVisibleCutOption(game, openUserSlots) ??
      getBestVisibleCutOption(game, BATTLE_SLOTS);

    if (forcedCutTarget) {
      return {
        type: "cut",
        slot: forcedCutTarget.slot,
        player: forcedCutTarget.player,
        reason:
          forcedCutTarget.slot && openUserSlots.includes(forcedCutTarget.slot)
            ? `CPU cut ${forcedCutTarget.player.name} from ${forcedCutTarget.slot} to keep pressure on your open lane.`
            : `CPU cut ${forcedCutTarget.player.name} from ${forcedCutTarget.slot} because its roster is full and it still has moves to spend.`,
      };
    }
  }

  if (
    bestTradeMove &&
    (bestTradeMove.targetScore >= CPU_TRADE_SCORE_THRESHOLD ||
      bestTradeMove.improvement >= CPU_TRADE_IMPROVEMENT_THRESHOLD ||
      (Boolean(bestTradeMove.target.isJackpot) &&
        bestTradeMove.improvement >= CPU_TRADE_IMPROVEMENT_THRESHOLD - 1))
  ) {
    const shouldTradeBecauseHugeUpgrade =
      bestTradeMove.improvement >= CPU_TRADE_IMPROVEMENT_THRESHOLD;
    const shouldTradeBecauseBadCurrent =
      bestTradeMove.currentScore < CPU_SIGN_SCORE_THRESHOLD - 6 &&
      bestTradeMove.improvement >= CPU_TRADE_IMPROVEMENT_THRESHOLD - 1.5;
    const shouldTradeBecauseJackpot =
      Boolean(bestTradeMove.target.isJackpot) &&
      bestTradeMove.targetScore >= CPU_TRADE_SCORE_THRESHOLD + 2 &&
      bestTradeMove.improvement >= CPU_TRADE_IMPROVEMENT_THRESHOLD - 1;

    if (
      shouldTradeBecauseHugeUpgrade ||
      (shouldTradeBecauseBadCurrent && moveSlack >= 1) ||
      (shouldTradeBecauseJackpot && moveSlack >= 0)
    ) {
      return {
        type: "trade",
        slot: bestTradeMove.slot,
        basePlayer: bestTradeMove.basePlayer,
        target: bestTradeMove.target,
        reason: `CPU traded ${bestTradeMove.slot} into ${bestTradeMove.target.name}.`,
      };
    }
  }

  if (bestOwnAvailable) {
    const shouldForceSign = session.cpuMovesRemaining <= cpuSlotsLeft;
    const shouldTakeGreatPlayer =
      bestOwnAvailable.currentEstimate >= CPU_SIGN_SCORE_THRESHOLD;
    const shouldTakeSolidPlayerSoon =
      moveSlack <= 1 &&
      bestOwnAvailable.currentEstimate >= CPU_SIGN_SCORE_THRESHOLD - 4;
    const laneLooksTappedOut = bestOwnAvailable.futureImprovement < 2.2;

    if (
      shouldForceSign ||
      shouldTakeGreatPlayer ||
      shouldTakeSolidPlayerSoon ||
      laneLooksTappedOut
    ) {
      return {
        type: "sign",
        slot: bestOwnAvailable.slot,
        player: bestOwnAvailable.player,
        reason: `CPU signed ${bestOwnAvailable.player.name} to ${bestOwnAvailable.slot}.`,
      };
    }
  }

  if (weakestOwnAvailable) {
    const shouldFishOwnLane =
      moveSlack > 0 &&
      weakestOwnAvailable.futureImprovement >=
        (isBehindOnScore && hasExtraMoveEdge
          ? CPU_FISH_IMPROVEMENT_THRESHOLD - 1
          : CPU_FISH_IMPROVEMENT_THRESHOLD) &&
      weakestOwnAvailable.currentEstimate < CPU_SIGN_SCORE_THRESHOLD;

    if (shouldFishOwnLane) {
      return {
        type: "cut",
        slot: weakestOwnAvailable.slot,
        player: weakestOwnAvailable.player,
        reason: `CPU cut ${weakestOwnAvailable.player.name} from ${weakestOwnAvailable.slot} looking for a stronger fit.`,
      };
    }
  }

  if (topUserThreat) {
    const ownBoardIsStable = openCpuSlots.length === 0 || moveSlack > 0;
    const denialMargin = bestOwnAvailable
      ? topUserThreat.score - bestOwnAvailable.currentEstimate
      : topUserThreat.score;

    if (
      ownBoardIsStable &&
      topUserThreat.score >= CPU_DEFENSIVE_CUT_THRESHOLD &&
      (denialMargin >= CPU_BIG_THREAT_MARGIN ||
        (!cpuSlotsLeft && userSlotsLeft > 0))
    ) {
      return {
        type: "cut",
        slot: topUserThreat.slot,
        player: topUserThreat.player,
        reason: `CPU cut ${topUserThreat.player.name} from ${topUserThreat.slot} to block your best lane.`,
      };
    }
  }

  if (bestOwnAvailable) {
    return {
      type: "sign",
      slot: bestOwnAvailable.slot,
      player: bestOwnAvailable.player,
      reason: `CPU signed ${bestOwnAvailable.player.name} to ${bestOwnAvailable.slot}.`,
    };
  }

  const forcedFallbackCut =
    getBestVisibleCutOption(game, openUserSlots) ??
    getBestVisibleCutOption(game, openCpuSlots) ??
    getBestVisibleCutOption(game, BATTLE_SLOTS);

  if (forcedFallbackCut && session.cpuMovesRemaining > 0) {
    return {
      type: "cut",
      slot: forcedFallbackCut.slot,
      player: forcedFallbackCut.player,
      reason: openUserSlots.includes(forcedFallbackCut.slot)
        ? `CPU cut ${forcedFallbackCut.player.name} from ${forcedFallbackCut.slot} to keep your board from settling.`
        : `CPU cut ${forcedFallbackCut.player.name} from ${forcedFallbackCut.slot} to spend its remaining move.`,
    };
  }

  return { type: "yield" };
}

function StackCards({
  lane,
  game,
  isTradeLocked,
  isSignDisabled,
  isTradeDisabled,
  isTradeOpen,
  selectedTradeTargetId,
  isCutDisabled,
  onSign,
  onToggleTrade,
  onSelectTradeTarget,
  onExecuteTrade,
  onCut,
}: {
  lane: BattleSlot;
  game: DraftBattleGame;
  isTradeLocked: boolean;
  isSignDisabled: boolean;
  isTradeDisabled: boolean;
  isTradeOpen: boolean;
  selectedTradeTargetId: string | null;
  isCutDisabled: boolean;
  onSign: (slot: BattleSlot) => void;
  onToggleTrade: (slot: BattleSlot) => void;
  onSelectTradeTarget: (slot: BattleSlot, playerId: string) => void;
  onExecuteTrade: (slot: BattleSlot) => void;
  onCut: (slot: BattleSlot) => void;
}) {
  const currentOption = getCurrentOption(game, lane);

  if (!currentOption || !currentOption.player) {
    return (
      <div className="draft-battle__stack-shell">
        <div className="draft-battle__stack-header">
          <div className="draft-battle__stack-title">{getPoolLabel(lane)}</div>
          <div className="draft-battle__stack-meta">0 left</div>
        </div>
        <div className="draft-battle__stack-empty">No assets left</div>
      </div>
    );
  }

  const remainingCount = game.pools[lane].options.length;
  const validTradeTargets = getValidTradeTargets(game, lane);
  const canTrade =
    !isTradeDisabled && !isTradeLocked && validTradeTargets.length > 0;
  const canCut = !isCutDisabled && !isTradeLocked && remainingCount > 0;
  const selectedTradeTarget =
    validTradeTargets.find((target) => target.id === selectedTradeTargetId) ??
    null;

  return (
    <div className="draft-battle__stack-shell">
      <div className="draft-battle__stack-header">
        <div className="draft-battle__stack-title">{getPoolLabel(lane)}</div>
        <div className="draft-battle__stack-meta">{remainingCount} left</div>
      </div>

      {!isTradeOpen ? (
        <div className="draft-battle__lane-grid">
          <div className="draft-battle__lane-cell draft-battle__lane-cell--identity">
            <div className="draft-battle__lane-headshot-wrap">
              {currentOption.player.headshotUrl ? (
                <img
                  src={currentOption.player.headshotUrl}
                  alt={`${currentOption.player.name} headshot`}
                  className="draft-battle__headshot"
                />
              ) : (
                <div className="draft-battle__headshot" aria-hidden="true" />
              )}
            </div>
            <div className="draft-battle__lane-info">
              <div className="draft-battle__lane-name">
                {currentOption.player.name}
              </div>
              <div className="draft-battle__lane-meta">
                {currentOption.player.position} · {currentOption.player.team}
              </div>
            </div>
          </div>

          {(currentOption.stats ?? []).slice(0, 3).map((stat) => (
            <div
              key={`${currentOption.player.id}-${stat.key}`}
              className="draft-battle__lane-cell draft-battle__lane-cell--stat"
            >
              <div className="draft-battle__stat-value">{stat.value}</div>
              <div className="draft-battle__stat-label">{stat.label}</div>
            </div>
          ))}

          <div className="draft-battle__lane-cell draft-battle__lane-cell--actions">
            <button
              type="button"
              className="draft-battle__action-btn draft-battle__action-btn--sign"
              onClick={() => onSign(lane)}
              disabled={isSignDisabled || isTradeLocked}
            >
              Sign
            </button>
            <button
              type="button"
              className="draft-battle__action-btn draft-battle__action-btn--trade"
              onClick={() => onToggleTrade(lane)}
              disabled={!canTrade}
            >
              Trade
            </button>
            <button
              type="button"
              className="draft-battle__action-btn draft-battle__action-btn--cut"
              onClick={() => onCut(lane)}
              disabled={!canCut}
            >
              Cut
            </button>
          </div>
        </div>
      ) : (
        <div className="draft-battle__lane-grid">
          <div className="draft-battle__lane-cell draft-battle__lane-cell--identity">
            <div className="draft-battle__lane-headshot-wrap">
              {currentOption.player.headshotUrl ? (
                <img
                  src={currentOption.player.headshotUrl}
                  alt={`${currentOption.player.name} headshot`}
                  className="draft-battle__headshot"
                />
              ) : (
                <div className="draft-battle__headshot" aria-hidden="true" />
              )}
            </div>
            <div className="draft-battle__lane-info">
              <div className="draft-battle__lane-name">
                {currentOption.player.name}
              </div>
              <div className="draft-battle__lane-meta">
                {currentOption.player.position} · {currentOption.player.team}
              </div>
            </div>
          </div>

          {validTradeTargets.slice(0, 3).map((target) => (
            <button
              key={`${lane}-${target.id}`}
              type="button"
              className={`draft-battle__lane-cell draft-battle__lane-cell--offer${
                selectedTradeTargetId === target.id
                  ? " draft-battle__lane-cell--offer-selected"
                  : ""
              }${
                target.isJackpot
                  ? " draft-battle__lane-cell--offer-jackpot"
                  : ""
              }`}
              onClick={() => onSelectTradeTarget(lane, target.id)}
            >
              <div className="draft-battle__offer-headshot-wrap">
                {target.headshotUrl ? (
                  <img
                    src={target.headshotUrl}
                    alt={`${target.name} headshot`}
                    className="draft-battle__offer-headshot"
                  />
                ) : (
                  <div
                    className="draft-battle__offer-headshot"
                    aria-hidden="true"
                  />
                )}
              </div>
              <div className="draft-battle__offer-name">{target.name}</div>
            </button>
          ))}

          <div className="draft-battle__lane-cell draft-battle__lane-cell--execute">
            <button
              type="button"
              className="draft-battle__action-btn draft-battle__action-btn--execute"
              onClick={() => onExecuteTrade(lane)}
              disabled={!selectedTradeTarget}
            >
              Execute Trade
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RosterColumn({
  title,
  side,
  lineup,
}: {
  title: string;
  side: "user" | "cpu";
  lineup: DraftBattleLineup;
}) {
  return (
    <section className={`draft-battle__roster draft-battle__roster--${side}`}>
      <div className="draft-battle__column-header">
        <div className="draft-battle__column-eyebrow">
          {side === "user" ? "Your Side" : "CPU Side"}
        </div>
        <h2 className="draft-battle__column-title">{title}</h2>
      </div>

      <div className="draft-battle__slots">
        {BATTLE_SLOTS.map((slot) => {
          const signed = lineup[slot];

          return (
            <div
              key={`${side}-${slot}`}
              className={`draft-battle__slot-card${
                signed ? " draft-battle__slot-card--filled" : ""
              }`}
            >
              {!signed ? (
                <div className="draft-battle__slot-badge">{slot}</div>
              ) : null}

              {signed ? (
                <div className="draft-battle__slot-filled draft-battle__slot-filled--detailed">
                  <div className="draft-battle__slot-top">
                    <div className="draft-battle__slot-headshot-shell">
                      {signed.player.headshotUrl ? (
                        <img
                          src={signed.player.headshotUrl}
                          alt={`${signed.player.name} headshot`}
                          className="draft-battle__slot-headshot"
                        />
                      ) : (
                        <div
                          className="draft-battle__slot-headshot"
                          aria-hidden="true"
                        />
                      )}
                    </div>

                    <div className="draft-battle__slot-stat-grid">
                      {getRosterStats(signed.player).map((stat) => (
                        <div
                          key={`${side}-${slot}-${stat.label}`}
                          className="draft-battle__slot-stat"
                        >
                          <div className="draft-battle__slot-stat-value">
                            {stat.value}
                          </div>
                          <div className="draft-battle__slot-stat-label">
                            {stat.label}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="draft-battle__slot-bottom">
                    <div className="draft-battle__slot-bottom-grid">
                      <div className="draft-battle__slot-left">
                        <div className="draft-battle__slot-player">
                          {signed.player.name}
                        </div>
                        <div className="draft-battle__slot-meta">
                          {signed.player.position} · {signed.player.team}
                        </div>
                      </div>

                      <div className="draft-battle__slot-score">
                        Score: {signed.score.toFixed(1)}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="draft-battle__slot-title">Empty slot</div>
                  <div className="draft-battle__slot-copy">
                    Future signed player lands here
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DraftBattlePage({
  activeMode,
  onChangeMode,
}: DraftBattlePageProps) {
  const [game, setGame] = useState<DraftBattleGame>(() => {
    if (typeof window === "undefined") {
      return createDraftBattleGame();
    }

    return loadStoredGame() ?? loadInitialGame() ?? createDraftBattleGame();
  });
  const [session, setSession] = useState<DraftBattleSession>(() => {
    if (typeof window === "undefined") {
      return createInitialSession();
    }

    return loadStoredSession() ?? createInitialSession();
  });
  const [isHowToOpen, setIsHowToOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [tradePickerSlot, setTradePickerSlot] = useState<BattleSlot | null>(
    null,
  );
  const [selectedTradeTargetId, setSelectedTradeTargetId] = useState<
    string | null
  >(null);

  useEffect(() => {
    persistGame(game);

    if (!loadInitialGame()) {
      persistInitialGame(game);
    }
  }, [game]);

  useEffect(() => {
    persistSession(session);
  }, [session]);

  const resetGame = useCallback(() => {
    const initial = loadInitialGame();
    const freshSession = createInitialSession();

    setTradePickerSlot(null);
    setSelectedTradeTargetId(null);

    if (initial) {
      setGame(initial);
      setSession(freshSession);
      persistGame(initial);
      persistSession(freshSession);
      return;
    }

    const freshGame = createDraftBattleGame();
    setGame(freshGame);
    setSession(freshSession);
    persistGame(freshGame);
    persistInitialGame(freshGame);
    persistSession(freshSession);
  }, []);

  const signCurrentCard = useCallback(
    (slot: BattleSlot) => {
      if (
        !session.setupComplete ||
        session.activeTurn !== "user" ||
        session.gameOver
      ) {
        return;
      }

      if (session.userLineup[slot] || tradePickerSlot) {
        return;
      }

      const currentOption = getCurrentOption(game, slot);
      if (!currentOption) {
        return;
      }

      setTradePickerSlot(null);
      setSelectedTradeTargetId(null);
      setGame((currentGame) =>
        removePlayersFromPool(currentGame, slot, [currentOption.player.id]),
      );
      setSession((currentSession) =>
        finalizeSession({
          ...currentSession,
          userLineup: {
            ...currentSession.userLineup,
            [slot]: createSignedLineupSlot(currentOption.player),
          },
          activeTurn: "cpu",
          history: appendHistory(
            currentSession.history,
            "user",
            `Signed ${currentOption.player.name} to ${slot}.`,
          ),
        }),
      );
    },
    [game, session, tradePickerSlot],
  );

  const cutCurrentCard = useCallback(
    (slot: BattleSlot) => {
      if (
        !session.setupComplete ||
        session.activeTurn !== "user" ||
        session.gameOver ||
        tradePickerSlot
      ) {
        return;
      }

      if (session.userMovesRemaining <= 0) {
        return;
      }

      const currentOption = getCurrentOption(game, slot);
      if (!currentOption) {
        return;
      }

      setSelectedTradeTargetId(null);
      setGame((currentGame) =>
        removePlayersFromPool(currentGame, slot, [currentOption.player.id]),
      );
      setSession((currentSession) => ({
        ...currentSession,
        userMovesRemaining: Math.max(0, currentSession.userMovesRemaining - 1),
        activeTurn: "cpu",
        history: appendHistory(
          currentSession.history,
          "user",
          `Cut ${currentOption.player.name} from ${slot}.`,
        ),
      }));
    },
    [game, session, tradePickerSlot],
  );

  const toggleTradePicker = useCallback(
    (slot: BattleSlot) => {
      if (
        !session.setupComplete ||
        session.activeTurn !== "user" ||
        session.gameOver
      ) {
        return;
      }

      if (session.userMovesRemaining <= 0 || session.userLineup[slot]) {
        return;
      }

      const currentOption = getCurrentOption(game, slot);
      if (!currentOption || getValidTradeTargets(game, slot).length === 0) {
        return;
      }

      setTradePickerSlot(slot);
      setSelectedTradeTargetId(null);
    },
    [game, session],
  );

  const selectTradeTarget = useCallback(
    (slot: BattleSlot, playerId: string) => {
      if (tradePickerSlot !== slot) {
        return;
      }

      setSelectedTradeTargetId(playerId);
    },
    [tradePickerSlot],
  );

  const executeTrade = useCallback(
    (slot: BattleSlot) => {
      if (
        !session.setupComplete ||
        session.activeTurn !== "user" ||
        session.gameOver
      ) {
        return;
      }

      if (session.userMovesRemaining <= 0 || session.userLineup[slot]) {
        return;
      }

      const chosenTarget =
        getValidTradeTargets(game, slot).find(
          (target) => target.id === selectedTradeTargetId,
        ) ?? null;
      const currentOption = getCurrentOption(game, slot);

      if (!currentOption || !chosenTarget) {
        return;
      }

      setTradePickerSlot(null);
      setSelectedTradeTargetId(null);
      setGame((currentGame) =>
        removePlayersFromPool(currentGame, slot, [
          currentOption.player.id,
          chosenTarget.id,
        ]),
      );
      setSession((currentSession) =>
        finalizeSession({
          ...currentSession,
          userMovesRemaining: Math.max(
            0,
            currentSession.userMovesRemaining - 1,
          ),
          userLineup: {
            ...currentSession.userLineup,
            [slot]: createSignedLineupSlot(chosenTarget),
          },
          activeTurn: "cpu",
          history: appendHistory(
            currentSession.history,
            "user",
            `Traded ${slot} into ${chosenTarget.name}.`,
          ),
        }),
      );
    },
    [game, session, selectedTradeTargetId],
  );

  useEffect(() => {
    if (
      !session.setupComplete ||
      session.gameOver ||
      session.activeTurn !== "user"
    ) {
      return;
    }

    if (session.userMovesRemaining > 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setTradePickerSlot(null);
      setSelectedTradeTargetId(null);

      const slot = getFirstEmptySlot(session.userLineup);
      if (!slot) {
        setSession((currentSession) => ({
          ...currentSession,
          activeTurn: "cpu",
        }));
        return;
      }

      const currentOption = getCurrentOption(game, slot);
      if (!currentOption) {
        setSession((currentSession) => ({
          ...currentSession,
          activeTurn: "cpu",
        }));
        return;
      }

      setGame((currentGame) =>
        removePlayersFromPool(currentGame, slot, [currentOption.player.id]),
      );
      setSession((currentSession) =>
        finalizeSession({
          ...currentSession,
          userLineup: {
            ...currentSession.userLineup,
            [slot]: createSignedLineupSlot(currentOption.player),
          },
          activeTurn: "cpu",
          history: appendHistory(
            currentSession.history,
            "user",
            `Auto-signed ${currentOption.player.name} to ${slot}.`,
          ),
        }),
      );
    }, AUTO_SIGN_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [game, session]);

  useEffect(() => {
    if (
      !session.setupComplete ||
      session.gameOver ||
      session.activeTurn !== "cpu"
    ) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => {
        setTradePickerSlot(null);
        setSelectedTradeTargetId(null);

        const cpuDecision = chooseCpuDecision(game, session);

        if (cpuDecision.type === "sign") {
          setGame((currentGame) =>
            removePlayersFromPool(currentGame, cpuDecision.slot, [
              cpuDecision.player.id,
            ]),
          );
          setSession((currentSession) =>
            finalizeSession({
              ...currentSession,
              cpuLineup: {
                ...currentSession.cpuLineup,
                [cpuDecision.slot]: createSignedLineupSlot(cpuDecision.player),
              },
              activeTurn: "user",
              history: appendHistory(
                currentSession.history,
                "cpu",
                cpuDecision.reason,
              ),
            }),
          );
          return;
        }

        if (cpuDecision.type === "trade") {
          setGame((currentGame) =>
            removePlayersFromPool(currentGame, cpuDecision.slot, [
              cpuDecision.basePlayer.id,
              cpuDecision.target.id,
            ]),
          );
          setSession((currentSession) =>
            finalizeSession({
              ...currentSession,
              cpuMovesRemaining: Math.max(
                0,
                currentSession.cpuMovesRemaining - 1,
              ),
              cpuLineup: {
                ...currentSession.cpuLineup,
                [cpuDecision.slot]: createSignedLineupSlot(cpuDecision.target),
              },
              activeTurn: "user",
              history: appendHistory(
                currentSession.history,
                "cpu",
                cpuDecision.reason,
              ),
            }),
          );
          return;
        }

        if (cpuDecision.type === "cut") {
          setGame((currentGame) =>
            removePlayersFromPool(currentGame, cpuDecision.slot, [
              cpuDecision.player.id,
            ]),
          );
          setSession((currentSession) => ({
            ...currentSession,
            cpuMovesRemaining: Math.max(
              0,
              currentSession.cpuMovesRemaining - 1,
            ),
            activeTurn: "user",
            history: appendHistory(
              currentSession.history,
              "cpu",
              cpuDecision.reason,
            ),
          }));
          return;
        }

        setSession((currentSession) => ({
          ...currentSession,
          activeTurn: "user",
        }));
      },
      session.cpuMovesRemaining <= 0 ? AUTO_SIGN_DELAY_MS : CPU_TURN_DELAY_MS,
    );

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [game, session]);

  const buildNewGame = useCallback(async () => {
    try {
      setIsLoading(true);
      setTradePickerSlot(null);
      setSelectedTradeTargetId(null);
      await Promise.resolve();
      const freshGame = createDraftBattleGame();
      const freshSession = createInitialSession();
      setGame(freshGame);
      setSession(freshSession);
      persistGame(freshGame);
      persistInitialGame(freshGame);
      persistSession(freshSession);
    } finally {
      window.setTimeout(() => {
        setIsLoading(false);
      }, 150);
    }
  }, []);

  const handleCoinFlipComplete = useCallback((firstTurn: TurnOwner) => {
    setSession((currentSession) => ({
      ...currentSession,
      setupComplete: true,
      initialTurn: firstTurn,
      activeTurn: firstTurn,
      history: appendHistory(
        currentSession.history,
        "system",
        `${firstTurn === "user" ? "You" : "CPU"} will go first.`,
      ),
    }));
  }, []);

  const userScoreCardClass = useMemo(() => {
    if (!session.gameOver) {
      return "draft-battle__footer-card";
    }

    if (session.winner === "user") {
      return "draft-battle__footer-card draft-battle__footer-card--winner";
    }

    if (session.winner === "cpu") {
      return "draft-battle__footer-card draft-battle__footer-card--loser";
    }

    return "draft-battle__footer-card";
  }, [session.gameOver, session.winner]);

  const cpuScoreCardClass = useMemo(() => {
    if (!session.gameOver) {
      return "draft-battle__footer-card";
    }

    if (session.winner === "cpu") {
      return "draft-battle__footer-card draft-battle__footer-card--winner";
    }

    if (session.winner === "user") {
      return "draft-battle__footer-card draft-battle__footer-card--loser";
    }

    return "draft-battle__footer-card";
  }, [session.gameOver, session.winner]);

  const userScoreValueClass = useMemo(() => {
    if (!session.gameOver) {
      return "draft-battle__footer-score";
    }

    if (session.winner === "user") {
      return "draft-battle__footer-score draft-battle__footer-score--winner";
    }

    if (session.winner === "cpu") {
      return "draft-battle__footer-score draft-battle__footer-score--loser";
    }

    return "draft-battle__footer-score";
  }, [session.gameOver, session.winner]);

  const cpuScoreValueClass = useMemo(() => {
    if (!session.gameOver) {
      return "draft-battle__footer-score";
    }

    if (session.winner === "cpu") {
      return "draft-battle__footer-score draft-battle__footer-score--winner";
    }

    if (session.winner === "user") {
      return "draft-battle__footer-score draft-battle__footer-score--loser";
    }

    return "draft-battle__footer-score";
  }, [session.gameOver, session.winner]);

  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <div className="topbar__left">
            <div className="topbar__title-block">
              <div className="eyebrow" style={{ textAlign: "left" }}>
                Draft Battle
              </div>
              <h1 style={{ textAlign: "left" }}>Cut / Trade / Sign</h1>
            </div>
          </div>

          <div className="topbar__center">
            <div className="topbar__control-strip">
              <ModeDropdown
                activeMode={activeMode}
                onChangeMode={onChangeMode}
              />

              <div className="topbar__divider" aria-hidden="true" />

              <div className="topbar__buttons">
                <div className="mode-actions mode-actions--topbar">
                  <button
                    type="button"
                    className="how-to-btn"
                    onClick={() => setIsHowToOpen(true)}
                    disabled={isLoading}
                  >
                    How To Play
                  </button>

                  <button
                    type="button"
                    className="mode-btn"
                    onClick={resetGame}
                    disabled={isLoading}
                  >
                    Reset Game
                  </button>

                  <button
                    type="button"
                    className="mode-btn mode-btn--forever"
                    onClick={() => void buildNewGame()}
                    disabled={isLoading}
                  >
                    Build New Game
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="topbar__right">
            <ShootoutMoveCounter
              userMovesRemaining={session.userMovesRemaining}
              cpuMovesRemaining={session.cpuMovesRemaining}
            />
          </div>
        </header>

        <main className="draft-battle">
          <RosterColumn
            title="Your Lineup"
            side="user"
            lineup={session.userLineup}
          />

          <section className="draft-battle__center">
            <div className="draft-battle__lanes">
              {BATTLE_SLOTS.map((slot) => (
                <StackCards
                  key={slot}
                  lane={slot}
                  game={game}
                  isTradeLocked={
                    tradePickerSlot !== null && tradePickerSlot !== slot
                  }
                  isSignDisabled={
                    !session.setupComplete ||
                    session.activeTurn !== "user" ||
                    session.gameOver ||
                    Boolean(session.userLineup[slot])
                  }
                  isTradeDisabled={
                    !session.setupComplete ||
                    session.activeTurn !== "user" ||
                    session.userMovesRemaining <= 0 ||
                    session.gameOver ||
                    Boolean(session.userLineup[slot])
                  }
                  isTradeOpen={tradePickerSlot === slot}
                  selectedTradeTargetId={
                    tradePickerSlot === slot ? selectedTradeTargetId : null
                  }
                  isCutDisabled={
                    !session.setupComplete ||
                    session.activeTurn !== "user" ||
                    session.userMovesRemaining <= 0 ||
                    session.gameOver
                  }
                  onSign={signCurrentCard}
                  onToggleTrade={toggleTradePicker}
                  onSelectTradeTarget={selectTradeTarget}
                  onExecuteTrade={executeTrade}
                  onCut={cutCurrentCard}
                />
              ))}
            </div>
          </section>

          <RosterColumn
            title="CPU Lineup"
            side="cpu"
            lineup={session.cpuLineup}
          />
        </main>

        <section className="draft-battle__footer draft-battle__footer--history">
          <div className={userScoreCardClass}>
            <div className="draft-battle__footer-label">Your Score</div>
            <div className={userScoreValueClass}>
              {getLeftScoreText(session)}
            </div>
          </div>

          <div className="draft-battle__footer-card draft-battle__footer-card--wide">
            <div className="draft-battle__footer-label">Transaction Log</div>
            <div className="draft-battle__history-list">
              {session.history.length > 0 ? (
                session.history.map((entry) => (
                  <div
                    key={entry.id}
                    className={`draft-battle__history-entry draft-battle__history-entry--${entry.owner}`}
                  >
                    {entry.text}
                  </div>
                ))
              ) : (
                <div className="draft-battle__history-empty">
                  No actions yet
                </div>
              )}
            </div>
          </div>

          <div className={cpuScoreCardClass}>
            <div className="draft-battle__footer-label">CPU Score</div>
            <div className={cpuScoreValueClass}>
              {getRightScoreText(session)}
            </div>
          </div>
        </section>
      </div>

      <HowToPlayModal
        isOpen={isHowToOpen}
        onClose={() => setIsHowToOpen(false)}
      />

      <ShootoutCoinFlipModal
        isOpen={!isLoading && !session.setupComplete}
        onComplete={handleCoinFlipComplete}
        cpuPrefersFirstOnWin
      />

      {isLoading ? (
        <LoadingOverlay
          title="Building Game"
          currentStatus="Generating draft battle pools"
          logs={["Generating draft battle pools"]}
        />
      ) : null}
    </div>
  );
}
