import type { Player } from "./types";

type PlayerWithExtras = Player & {
  minutesPerGame?: number;
  minutesPlayed?: number;
  gamesPlayed?: number;
  teamGamesPlayed?: number;
  ppg?: number;
  rpg?: number;
  apg?: number;
  spg?: number;
  bpg?: number;
  fgm?: number;
  fga?: number;
  threePm?: number;
  threePa?: number;
  fgPct?: number;
  threePct?: number;
};

/**
 * Restricts a numeric value to a bounded range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Maps a value into the 0..1 range using fixed anchors.
 */
function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (max === min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

/**
 * Coerces uncertain stat fields to a safe finite number.
 */
function safe(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Backbone anchors define the broad talent band for the player pool.
 * They are intentionally wide so a few outliers do not swing the scale each season.
 */
const BPM_MIN = -8.5;
const BPM_MAX = 14.1;
const PER_MIN = 5.0;
const PER_MAX = 32.7;
const WS48_MIN = -0.10;
const WS48_MAX = 0.329;
const USG_MIN = 10.0;
const USG_MAX = 38.0;
const MPG_MIN = 8.0;
const MPG_MAX = 36.0;

/**
 * Practical population anchors keep the temper system centered on a normal NBA contributor.
 */
const AVG_COUNTING_SUM = 22.0;
const AVG_FG_PCT = 0.467;
const AVG_3P_PCT = 0.324;
const COUNTING_SUM_MIN = 6.0;
const COUNTING_SUM_MAX = 42.0;
const FG_PCT_MIN = 0.380;
const FG_PCT_MAX = 0.650;
const THREE_PCT_MIN = 0.280;
const THREE_PCT_MAX = 0.430;

/**
 * Temper only nudges the backbone score. This keeps box-score style from overpowering the
 * advanced-metric foundation while still rewarding productive players.
 */
const TEMPER_CAP = 0.10;

/**
 * Three-point confidence needs both per-game intent and season-long sample.
 * This avoids overrating players who shot well on very few attempts.
 */
const THREE_PA_GAME_START = 1.0;
const THREE_PA_GAME_FULL = 6.0;
const THREE_TOTAL_ATTEMPTS_START = 25;
const THREE_TOTAL_ATTEMPTS_FULL = 250;

/**
 * Field-goal confidence starts trusting efficiency once a player has a meaningful attempt base.
 */
const FG_TOTAL_ATTEMPTS_START = 25;
const FG_TOTAL_ATTEMPTS_FULL = 500;

/**
 * Total minutes are the final anti-small-sample gate.
 * Players below the floor can still score well, but their output is intentionally discounted.
 */
const MINUTES_FLOOR = 500;
const MINUTES_SAFE = 1200;

const BACKBONE_SCORE_MAX = 100;

function getMinutesPerGame(player: PlayerWithExtras): number {
  return safe(player.minutesPerGame, 0);
}

function getMinutesPlayed(player: PlayerWithExtras): number {
  return safe(player.minutesPlayed, 0);
}

function getGamesPlayed(player: PlayerWithExtras): number {
  return safe(player.gamesPlayed, 0);
}

/**
 * Uses traditional production as a mild stylistic adjustment on top of the backbone score.
 */
function getCountingSum(player: PlayerWithExtras): number {
  return (
    safe(player.ppg, 0) +
    safe(player.rpg, 0) +
    safe(player.apg, 0) +
    safe(player.spg, 0) +
    safe(player.bpg, 0)
  );
}

function getTotalFga(player: PlayerWithExtras): number {
  const total = safe(player.fga, 0) * getGamesPlayed(player);
  if (total > 0) return total;

  return safe(player.fgm, 0) > 0 && safe(player.fgPct, 0) > 0
    ? (safe(player.fgm, 0) * getGamesPlayed(player)) / safe(player.fgPct, 1)
    : 0;
}

function getTotalThreePa(player: PlayerWithExtras): number {
  const total = safe(player.threePa, 0) * getGamesPlayed(player);
  if (total > 0) return total;

  return safe(player.threePm, 0) > 0 && safe(player.threePct, 0) > 0
    ? (safe(player.threePm, 0) * getGamesPlayed(player)) / safe(player.threePct, 1)
    : 0;
}

/**
 * Converts a stat into a bounded multiplier around league-average expectations.
 */
function boundedTemperFromAverage(
  value: number,
  average: number,
  minBound: number,
  maxBound: number,
): number {
  if (!Number.isFinite(value) || !Number.isFinite(average) || average <= 0) {
    return 1;
  }

  if (value >= average) {
    const above = normalize(value, average, maxBound);
    return 1 + above * TEMPER_CAP;
  }

  const below = normalize(value, minBound, average);
  return 1 - (1 - below) * TEMPER_CAP;
}

/**
 * Pulls noisy percentages back toward league average when confidence is low.
 */
function shrinkTowardAverage(
  observedPct: number,
  averagePct: number,
  confidence: number,
): number {
  return averagePct * (1 - confidence) + observedPct * confidence;
}

function totalMinutesConfidence(player: PlayerWithExtras): number {
  const minutes = getMinutesPlayed(player);

  if (minutes < MINUTES_FLOOR) {
    return 0.70;
  }

  if (minutes < MINUTES_SAFE) {
    return 0.70 + normalize(minutes, MINUTES_FLOOR, MINUTES_SAFE) * 0.30;
  }

  return 1.0;
}

function fgAttemptConfidence(player: PlayerWithExtras): number {
  const totalFga = getTotalFga(player);
  return normalize(totalFga, FG_TOTAL_ATTEMPTS_START, FG_TOTAL_ATTEMPTS_FULL);
}

function threePointConfidence(player: PlayerWithExtras): number {
  const threePaPerGame = safe(player.threePa, 0);
  const totalThreePa = getTotalThreePa(player);

  const gameVolume = normalize(threePaPerGame, THREE_PA_GAME_START, THREE_PA_GAME_FULL);
  const totalVolume = normalize(totalThreePa, THREE_TOTAL_ATTEMPTS_START, THREE_TOTAL_ATTEMPTS_FULL);

  return clamp(gameVolume * 0.6 + totalVolume * 0.4, 0, 1);
}

/**
 * Backbone score is the stable, season-level estimate of player quality.
 */
function backboneScore(player: PlayerWithExtras): number {
  const bpm = normalize(safe(player.bpm, BPM_MIN), BPM_MIN, BPM_MAX);
  const per = normalize(safe(player.per, PER_MIN), PER_MIN, PER_MAX);
  const ws48 = normalize(safe(player.ws48, WS48_MIN), WS48_MIN, WS48_MAX);
  const usg = normalize(safe(player.usgPct, USG_MIN), USG_MIN, USG_MAX);
  const mpg = normalize(getMinutesPerGame(player), MPG_MIN, MPG_MAX);

  const average = (bpm + per + ws48 + usg + mpg) / 5;

  return average * BACKBONE_SCORE_MAX;
}

function countingStatsTemper(player: PlayerWithExtras): number {
  const countingSum = getCountingSum(player);

  return boundedTemperFromAverage(
    countingSum,
    AVG_COUNTING_SUM,
    COUNTING_SUM_MIN,
    COUNTING_SUM_MAX,
  );
}

/**
 * Shooting temper always considers field-goal efficiency and only trusts three-point
 * accuracy once both usage and total attempts are high enough.
 */
function shootingTemper(player: PlayerWithExtras): number {
  const fgPct = safe(player.fgPct, AVG_FG_PCT);
  const threePct = safe(player.threePct, AVG_3P_PCT);

  const fgConf = fgAttemptConfidence(player);
  const threeConf = threePointConfidence(player);

  const adjustedFgPct = shrinkTowardAverage(fgPct, AVG_FG_PCT, fgConf);
  const adjustedThreePct = shrinkTowardAverage(threePct, AVG_3P_PCT, threeConf);

  const fgSignal =
    adjustedFgPct >= AVG_FG_PCT
      ? normalize(adjustedFgPct, AVG_FG_PCT, FG_PCT_MAX)
      : -normalize(adjustedFgPct, FG_PCT_MIN, AVG_FG_PCT);

  const threeSignal =
    adjustedThreePct >= AVG_3P_PCT
      ? normalize(adjustedThreePct, AVG_3P_PCT, THREE_PCT_MAX)
      : -normalize(adjustedThreePct, THREE_PCT_MIN, AVG_3P_PCT);

  const combinedSignal = fgSignal * 0.75 + threeSignal * 0.25 * threeConf;

  return clamp(1 + combinedSignal * TEMPER_CAP, 1 - TEMPER_CAP, 1 + TEMPER_CAP);
}

/**
 * Produces a mode-agnostic player score used everywhere in the game.
 */
export function scorePlayer(rawPlayer: Player): number {
  const player = rawPlayer as PlayerWithExtras;

  const base = backboneScore(player);
  const countingAdj = countingStatsTemper(player);
  const shootingAdj = shootingTemper(player);
  const minutesConf = totalMinutesConfidence(player);

  const finalScore = base * countingAdj * shootingAdj * minutesConf;

  return Number(clamp(finalScore, 0, 130).toFixed(1));
}
