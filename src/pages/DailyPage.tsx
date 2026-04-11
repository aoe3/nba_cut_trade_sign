import { useCallback, useEffect, useMemo, useState } from "react";
import { GameBoard } from "../components/GameBoard";
import { DateNavigator } from "../components/DateNavigator";
import { HowToPlayModal } from "../components/HowToPlayModal";
import { ModeDropdown } from "../components/ModeDropdown";
import { MoveCounter } from "../components/MoveCounter";
import { ScoreBar } from "../components/Score";
import { buildInitialGameState, gameReducer } from "../game/gameReducer";
import type { DailyGame, GameAction, GameState, Position } from "../game/types";
import type { AppMode } from "../App";
import {
  getAvailableDailyDates,
  getDailyGameByDate,
  getInitialDailyDate,
  isAvailableDailyDate,
} from "../utils/dailyGames";

type DailyPageProps = {
  activeMode: AppMode;
  onChangeMode: (mode: AppMode) => void;
  onCreateNewForeverGame: () => void;
};

const DAILY_SELECTED_DATE_STORAGE_KEY = "cut-trade-sign:daily-selected-date";
const DAILY_STATE_STORAGE_KEY_PREFIX = "cut-trade-sign:daily-state:";
const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];
const AVAILABLE_DAILY_DATES = getAvailableDailyDates();
const FALLBACK_DAILY_DATE = getInitialDailyDate();
function requireDailyGame(date: string): DailyGame {
  const game = getDailyGameByDate(date);

  if (!game) {
    throw new Error(`Missing daily game for ${date}.`);
  }

  return game;
}

const FALLBACK_DAILY_GAME = requireDailyGame(FALLBACK_DAILY_DATE);

/**
 * Resolves a dated puzzle import and fails loudly if the published date is missing.
 */
function getRatingLabel(finalScorePct: number | null): string {
  if (finalScorePct === null) return "--";
  if (finalScorePct < 15) return "G-League";
  if (finalScorePct < 35) return "Bench";
  if (finalScorePct < 60) return "Starter";
  if (finalScorePct < 85) return "Superstar";
  return "Legend";
}

/**
 * Returns the CSS modifier class for a rating tier.
 */
function getRatingClass(rating: string): string {
  switch (rating) {
    case "G-League":
      return "rating--gleague";
    case "Bench":
      return "rating--bench";
    case "Starter":
      return "rating--starter";
    case "Superstar":
      return "rating--superstar";
    case "Legend":
      return "rating--legend";
    default:
      return "";
  }
}

/**
 * Namespaces Daily saves per date so archived puzzles persist independently.
 */
function getDailyStateStorageKey(date: string): string {
  return `${DAILY_STATE_STORAGE_KEY_PREFIX}${date}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Guards against stale or malformed localStorage data after puzzle files change.
 */
function isCompatibleStoredState(
  value: unknown,
  game: DailyGame,
): value is GameState {
  if (!isRecord(value)) {
    return false;
  }

  if (!isRecord(value.rows) || !isRecord(value.tradeState)) {
    return false;
  }

  if (
    typeof value.movesRemaining !== "number" ||
    !Number.isFinite(value.movesRemaining)
  ) {
    return false;
  }

  if (typeof value.gameOver !== "boolean") {
    return false;
  }

  if (!(value.finalScore === null || typeof value.finalScore === "number")) {
    return false;
  }

  if (
    !(value.finalScorePct === null || typeof value.finalScorePct === "number")
  ) {
    return false;
  }

  const activePosition = value.tradeState.activePosition;
  if (
    !(activePosition === null || POSITIONS.includes(activePosition as Position))
  ) {
    return false;
  }

  const rawSelectedTradePlayerId = value.tradeState.selectedTradePlayerId;
  if (
    !(
      rawSelectedTradePlayerId === null ||
      typeof rawSelectedTradePlayerId === "string"
    )
  ) {
    return false;
  }

  const selectedTradePlayerId = rawSelectedTradePlayerId as string | null;

  for (const position of POSITIONS) {
    const row = value.rows[position];

    if (!isRecord(row)) {
      return false;
    }

    if (row.position !== position) {
      return false;
    }

    if (
      typeof row.optionIndex !== "number" ||
      !Number.isInteger(row.optionIndex)
    ) {
      return false;
    }

    const optionNode = game.positions[position]?.options?.[row.optionIndex];
    if (!optionNode?.player) {
      return false;
    }

    if (
      !isRecord(row.currentPlayer) ||
      typeof row.currentPlayer.id !== "string"
    ) {
      return false;
    }

    const validPlayerIds = new Set([
      optionNode.player.id,
      ...optionNode.trades.map((player) => player.id),
    ]);

    if (!validPlayerIds.has(row.currentPlayer.id)) {
      return false;
    }

    if (typeof row.locked !== "boolean") {
      return false;
    }

    if (
      !(
        row.lockedReason === null ||
        row.lockedReason === "sign" ||
        row.lockedReason === "trade" ||
        row.lockedReason === "auto"
      )
    ) {
      return false;
    }

    if (!(row.playerScore === null || typeof row.playerScore === "number")) {
      return false;
    }

    if (!Array.isArray(row.transactionHistory)) {
      return false;
    }
  }

  if (activePosition !== null) {
    const resolvedActivePosition = activePosition as Position;
    const activeRow = value.rows[resolvedActivePosition];

    if (!isRecord(activeRow) || activeRow.locked === true) {
      return false;
    }

    if (
      selectedTradePlayerId !== null &&
      typeof activeRow.optionIndex === "number" &&
      Number.isInteger(activeRow.optionIndex)
    ) {
      const activeOption =
        game.positions[resolvedActivePosition]?.options?.[
          activeRow.optionIndex
        ];
      const validTradeIds = new Set<string>(
        activeOption?.trades?.map((player: { id: string }) => player.id) ?? [],
      );

      if (!validTradeIds.has(selectedTradePlayerId)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Restores the last viewed Daily date, falling back to the published date when needed.
 */
function loadStoredSelectedDate(): string {
  try {
    const storedDate = window.localStorage.getItem(
      DAILY_SELECTED_DATE_STORAGE_KEY,
    );

    if (storedDate && isAvailableDailyDate(storedDate)) {
      return storedDate;
    }
  } catch {}

  return FALLBACK_DAILY_DATE;
}

/**
 * Persists the selected Daily date for quick return visits.
 */
function persistSelectedDate(date: string) {
  window.localStorage.setItem(DAILY_SELECTED_DATE_STORAGE_KEY, date);
}

/**
 * Loads a saved Daily state for a specific date after validating it against the puzzle file.
 */
function loadStoredState(date: string, game: DailyGame): GameState | null {
  try {
    const raw = window.localStorage.getItem(getDailyStateStorageKey(date));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (isCompatibleStoredState(parsed, game)) {
      return parsed;
    }

    window.localStorage.removeItem(getDailyStateStorageKey(date));
    return null;
  } catch {
    return null;
  }
}

/**
 * Persists Daily progress per date. This keeps archived puzzles independent from one another.
 */
function persistState(date: string, state: GameState) {
  window.localStorage.setItem(
    getDailyStateStorageKey(date),
    JSON.stringify(state),
  );
}

/**
 * Renders the default Daily mode, including date navigation and per-date save state.
 */
export function DailyPage({ activeMode, onChangeMode }: DailyPageProps) {
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    loadStoredSelectedDate(),
  );
  const activeGame = getDailyGameByDate(selectedDate) ?? FALLBACK_DAILY_GAME;
  const [state, setState] = useState<GameState>(() => {
    return (
      loadStoredState(selectedDate, activeGame) ??
      buildInitialGameState(activeGame)
    );
  });
  const [isHowToOpen, setIsHowToOpen] = useState(false);

  useEffect(() => {
    persistSelectedDate(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    persistState(selectedDate, state);
  }, [selectedDate, state]);

  const dispatch = useCallback(
    (action: GameAction) => {
      setState((previousState) =>
        gameReducer(previousState, action, activeGame),
      );
    },
    [activeGame],
  );

  const handleSelectDate = useCallback(
    (nextDate: string) => {
      if (nextDate === selectedDate) {
        return;
      }

      const nextGame = getDailyGameByDate(nextDate);
      if (!nextGame) {
        return;
      }

      setSelectedDate(nextDate);
      setState(
        loadStoredState(nextDate, nextGame) ?? buildInitialGameState(nextGame),
      );
    },
    [selectedDate],
  );

  const puzzleRating = useMemo(
    () => getRatingLabel(state.finalScorePct),
    [state.finalScorePct],
  );
  const ratingClass = useMemo(
    () => getRatingClass(puzzleRating),
    [puzzleRating],
  );

  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <div className="topbar__left">
            <div className="topbar__title-block">
              <div className="eyebrow" style={{ textAlign: "left" }}>
                Daily Puzzle
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
                  >
                    How To Play
                  </button>

                  <DateNavigator
                    availableDates={AVAILABLE_DAILY_DATES}
                    selectedDate={selectedDate}
                    onSelectDate={handleSelectDate}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="topbar__right">
            <MoveCounter movesRemaining={state.movesRemaining} />
          </div>
        </header>

        <GameBoard game={activeGame} state={state} dispatch={dispatch} />

        <ScoreBar
          finalScore={state.finalScore}
          finalScorePct={state.finalScorePct}
          puzzleRating={puzzleRating}
          ratingClass={ratingClass}
          bestScore={activeGame.bestScore}
          worstScore={activeGame.worstScore}
        />
      </div>

      <HowToPlayModal
        isOpen={isHowToOpen}
        onClose={() => setIsHowToOpen(false)}
      />
    </div>
  );
}
