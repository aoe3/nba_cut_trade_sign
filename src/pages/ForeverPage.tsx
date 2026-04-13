import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import publishedGameData from "../data/games/game_2026-04-10.json";
import { GameBoard } from "../components/GameBoard";
import { HowToPlayModal } from "../components/HowToPlayModal";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { ModeDropdown } from "../components/ModeDropdown";
import { MoveCounter } from "../components/MoveCounter";
import { ScoreBar } from "../components/Score";
import { buildInitialGameState, gameReducer } from "../game/gameReducer";
import type { DailyGame, GameAction, GameState } from "../game/types";
import type { AppMode } from "../App";
import { buildForeverGameInWorker } from "../workers/gameBuildClient";

type ForeverPageProps = {
  activeMode: AppMode;
  autoGenerateToken: number;
  onChangeMode: (mode: AppMode) => void;
};

const publishedGame = publishedGameData as DailyGame;
const FOREVER_GAME_STORAGE_KEY = "cut-trade-sign:forever-game";
const FOREVER_STATE_STORAGE_KEY = "cut-trade-sign:forever-state";

/**
 * Maps normalized score percentage to the public-facing rating tier.
 */
function getPuzzleRating(finalScorePct: number | null): string {
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
 * Restores the current Forever puzzle from local storage.
 */
function loadStoredGame(): DailyGame | null {
  try {
    const raw = window.localStorage.getItem(FOREVER_GAME_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DailyGame;
  } catch {
    return null;
  }
}

/**
 * Restores the current Forever board state from local storage.
 */
function loadStoredState(): GameState | null {
  try {
    const raw = window.localStorage.getItem(FOREVER_STATE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

function persistGame(game: DailyGame) {
  window.localStorage.setItem(FOREVER_GAME_STORAGE_KEY, JSON.stringify(game));
}

function persistState(state: GameState) {
  window.localStorage.setItem(FOREVER_STATE_STORAGE_KEY, JSON.stringify(state));
}

/**
 * Renders the endless sandbox mode and keeps its puzzle and state persistent between visits.
 */
export function ForeverPage({
  activeMode,
  autoGenerateToken,
  onChangeMode,
}: ForeverPageProps) {
  const storedGame = loadStoredGame();
  const initialGame = storedGame ?? publishedGame;
  const initialState = loadStoredState() ?? buildInitialGameState(initialGame);

  const [game, setGame] = useState<DailyGame>(initialGame);
  const [state, setState] = useState<GameState>(initialState);
  const [isHowToOpen, setIsHowToOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(!storedGame);
  const [loadingTitle, setLoadingTitle] = useState("Preparing Forever Mode");
  const [statusLogs, setStatusLogs] = useState<string[]>([]);
  const handledAutoGenerateToken = useRef(0);

  useEffect(() => {
    persistGame(game);
  }, [game]);

  useEffect(() => {
    persistState(state);
  }, [state]);

  const dispatch = useCallback(
    (action: GameAction) => {
      setState((previousState) => gameReducer(previousState, action, game));
    },
    [game],
  );

  const handleStatus = useCallback((status: string) => {
    setStatusLogs((previous) => {
      if (previous[previous.length - 1] === status) {
        return previous;
      }
      return [...previous, status];
    });
  }, []);

  const resetGame = useCallback(() => {
    const freshState = buildInitialGameState(game);
    setState(freshState);
    persistState(freshState);
  }, [game]);

  const startNewForeverGame = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadingTitle("Building Game");
      setStatusLogs(["Starting background build worker…"]);

      const newGame = await buildForeverGameInWorker(handleStatus);
      const freshState = buildInitialGameState(newGame);

      setGame(newGame);
      setState(freshState);
      persistGame(newGame);
      persistState(freshState);
      setStatusLogs((previous) => [...previous, "New game ready."]);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error while generating a new game.";

      setStatusLogs((previous) => [
        ...previous,
        `Generation failed: ${message}`,
      ]);
      window.alert(`Could not generate a new Forever game. ${message}`);
    } finally {
      window.setTimeout(() => {
        setIsLoading(false);
      }, 250);
    }
  }, [handleStatus]);

  useEffect(() => {
    if (autoGenerateToken <= 0) return;
    if (handledAutoGenerateToken.current === autoGenerateToken) return;

    handledAutoGenerateToken.current = autoGenerateToken;
    void startNewForeverGame();
  }, [autoGenerateToken, startNewForeverGame]);

  useEffect(() => {
    if (storedGame || autoGenerateToken > 0) {
      return;
    }

    void startNewForeverGame();
  }, [autoGenerateToken, startNewForeverGame, storedGame]);

  const puzzleRating = useMemo(
    () => getPuzzleRating(state.finalScorePct),
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
                Forever Mode
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
                    onClick={() => void startNewForeverGame()}
                    disabled={isLoading}
                  >
                    Build New Game
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="topbar__right">
            <MoveCounter movesRemaining={state.movesRemaining} />
          </div>
        </header>

        <GameBoard game={game} state={state} dispatch={dispatch} />

        <ScoreBar
          finalScore={state.finalScore}
          finalScorePct={state.finalScorePct}
          puzzleRating={puzzleRating}
          ratingClass={ratingClass}
          bestScore={game.bestScore}
          worstScore={game.worstScore}
        />
      </div>

      <HowToPlayModal
        isOpen={isHowToOpen}
        onClose={() => setIsHowToOpen(false)}
      />

      {isLoading ? (
        <LoadingOverlay
          title={loadingTitle}
          currentStatus={statusLogs[statusLogs.length - 1] ?? ""}
          logs={statusLogs}
        />
      ) : null}
    </div>
  );
}
