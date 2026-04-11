import { useCallback, useEffect, useMemo, useState } from "react";
import publishedGameData from "../data/games/game_2026-04-10.json";
import { ActionButtons } from "../components/ActionButtons";
import { HowToPlayModal } from "../components/HowToPlayModal";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { ModeDropdown } from "../components/ModeDropdown";
import { MoveCounter } from "../components/MoveCounter";
import { buildInitialGameState, gameReducer } from "../game/gameReducer";
import { scorePlayer } from "../game/scorePlayer";
import type {
  DailyGame,
  GameAction,
  GameState,
  Position,
  RowState,
} from "../game/types";
import type { AppMode } from "../App";
import type { BeatTheScoreSolution } from "./beatTheScore/solveBeatTheScore";
import {
  buildForeverGameInWorker,
  solveBeatTheScoreInWorker,
} from "../workers/gameBuildClient";

type BeatTheScorePageProps = {
  activeMode: AppMode;
  onChangeMode: (mode: AppMode) => void;
};

type PathChip = {
  position: Position;
  text: string;
};

const publishedGame = publishedGameData as DailyGame;
const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];
const SILHOUETTE_URL = `${import.meta.env.BASE_URL}cpu-silhouette.svg`;
const JACKPOT_SCORE_MULTIPLIER = 1.1;
const BEAT_GAME_STORAGE_KEY = "cut-trade-sign:beat-game";
const BEAT_STATE_STORAGE_KEY = "cut-trade-sign:beat-state";
const BEAT_SOLUTION_STORAGE_KEY = "cut-trade-sign:beat-solution";

/**
 * Restores the active Beat The Score puzzle from local storage.
 */
function loadStoredGame(): DailyGame | null {
  try {
    const raw = window.localStorage.getItem(BEAT_GAME_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DailyGame;
  } catch {
    return null;
  }
}

/**
 * Restores the user board for Beat The Score.
 */
function loadStoredState(): GameState | null {
  try {
    const raw = window.localStorage.getItem(BEAT_STATE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

/**
 * Restores the cached CPU solution so users can reset without re-solving the same puzzle.
 */
function loadStoredSolution(): BeatTheScoreSolution | null {
  try {
    const raw = window.localStorage.getItem(BEAT_SOLUTION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BeatTheScoreSolution;
  } catch {
    return null;
  }
}

function persistGame(game: DailyGame) {
  window.localStorage.setItem(BEAT_GAME_STORAGE_KEY, JSON.stringify(game));
}

function persistState(state: GameState) {
  window.localStorage.setItem(BEAT_STATE_STORAGE_KEY, JSON.stringify(state));
}

function persistSolution(solution: BeatTheScoreSolution | null) {
  if (!solution) {
    window.localStorage.removeItem(BEAT_SOLUTION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    BEAT_SOLUTION_STORAGE_KEY,
    JSON.stringify(solution),
  );
}

function formatStat(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "—";
  }

  return value.toFixed(1);
}

function summarizeUserRow(row: RowState): string {
  const trades = row.transactionHistory.filter(
    (transaction) => transaction.type === "trade",
  ).length;
  const cuts = row.transactionHistory.filter(
    (transaction) => transaction.type === "cut",
  ).length;

  if (trades > 0) {
    return `${row.position}: Trade → ${row.currentPlayer.name}`;
  }

  if (cuts > 0) {
    return `${row.position}: ${cuts} Cut${cuts > 1 ? "s" : ""} → ${row.currentPlayer.name}`;
  }

  return `${row.position}: Sign ${row.currentPlayer.name}`;
}

function summarizeCpuPath(solution: BeatTheScoreSolution): PathChip[] {
  return POSITIONS.map((position) => {
    const positionSteps = solution.path.filter(
      (step) => step.position === position,
    );
    const finalRow = solution.finalState.rows[position];

    const tradeCount = positionSteps.filter(
      (step) => step.kind === "trade",
    ).length;
    const cutCount = positionSteps.filter((step) => step.kind === "cut").length;

    if (tradeCount > 0) {
      return {
        position,
        text: `${position}: Trade → ${finalRow.currentPlayer.name}`,
      };
    }

    if (cutCount > 0) {
      return {
        position,
        text: `${position}: ${cutCount} Cut${cutCount > 1 ? "s" : ""} → ${finalRow.currentPlayer.name}`,
      };
    }

    return {
      position,
      text: `${position}: Sign ${finalRow.currentPlayer.name}`,
    };
  });
}

/**
 * Renders the score-chasing mode where the player competes against a precomputed CPU path.
 */
export function BeatTheScorePage({
  activeMode,
  onChangeMode,
}: BeatTheScorePageProps) {
  const initialGame = loadStoredGame() ?? publishedGame;
  const initialState = loadStoredState() ?? buildInitialGameState(initialGame);
  const initialSolution = loadStoredSolution();

  const [game, setGame] = useState<DailyGame>(initialGame);
  const [state, setState] = useState<GameState>(initialState);
  const [solution, setSolution] = useState<BeatTheScoreSolution | null>(
    initialSolution,
  );
  const [isHowToOpen, setIsHowToOpen] = useState(false);
  const [isLoadingSolution, setIsLoadingSolution] = useState(!initialSolution);
  const [loadingTitle, setLoadingTitle] = useState("Building CPU Opponent");
  const [statusLogs, setStatusLogs] = useState<string[]>([]);

  useEffect(() => {
    persistGame(game);
  }, [game]);

  useEffect(() => {
    persistState(state);
  }, [state]);

  useEffect(() => {
    persistSolution(solution);
  }, [solution]);

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

  useEffect(() => {
    if (solution) {
      return;
    }

    let isCancelled = false;

    async function buildInitialSolution() {
      setStatusLogs(["Starting background solve worker…"]);
      setLoadingTitle("Building CPU Opponent");
      setIsLoadingSolution(true);

      try {
        const nextSolution = await solveBeatTheScoreInWorker(
          game,
          handleStatus,
        );
        if (!isCancelled) {
          setSolution(nextSolution);
        }
      } finally {
        if (!isCancelled) {
          window.setTimeout(() => {
            setIsLoadingSolution(false);
          }, 250);
        }
      }
    }

    void buildInitialSolution();

    return () => {
      isCancelled = true;
    };
  }, [game, solution]);

  const resetGame = useCallback(() => {
    const freshState = buildInitialGameState(game);
    setState(freshState);
    persistState(freshState);
  }, [game]);

  const startNewBeatTheScoreGame = useCallback(async () => {
    try {
      setIsLoadingSolution(true);
      setLoadingTitle("Building Game");
      setStatusLogs(["Starting background build worker…"]);

      const newGame = await buildForeverGameInWorker(handleStatus);
      handleStatus("Building CPU opponent from the new puzzle…");
      const newSolution = await solveBeatTheScoreInWorker(
        newGame,
        handleStatus,
      );
      const freshState = buildInitialGameState(newGame);

      setGame(newGame);
      setSolution(newSolution);
      setState(freshState);
      persistGame(newGame);
      persistSolution(newSolution);
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
      window.alert(`Could not generate a new Beat The Score game. ${message}`);
    } finally {
      window.setTimeout(() => {
        setIsLoadingSolution(false);
      }, 250);
    }
  }, [handleStatus]);

  const revealedPositions = useMemo(() => {
    return new Set(POSITIONS.filter((position) => state.rows[position].locked));
  }, [state.rows]);

  const userRunningScore = useMemo(() => {
    return state.finalScore?.toFixed(1) ?? "--";
  }, [state.finalScore]);

  const cpuPath = useMemo(() => {
    return solution ? summarizeCpuPath(solution) : [];
  }, [solution]);

  const userPath = useMemo(() => {
    return POSITIONS.filter((position) => state.rows[position].locked).map(
      (position) => ({
        position,
        text: summarizeUserRow(state.rows[position]),
      }),
    );
  }, [state.rows]);

  const isFinalized =
    state.gameOver && solution !== null && state.finalScore !== null;
  const userWon = isFinalized && (state.finalScore ?? 0) > solution.finalScore;
  const cpuWon = isFinalized && (state.finalScore ?? 0) < solution.finalScore;
  const isTie = isFinalized && (state.finalScore ?? 0) === solution.finalScore;

  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <div className="topbar__left">
            <div className="topbar__title-block">
              <div className="eyebrow" style={{ textAlign: "left" }}>
                Beat The Score
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
                    disabled={isLoadingSolution}
                  >
                    How To Play
                  </button>

                  <button
                    type="button"
                    className="mode-btn"
                    onClick={resetGame}
                    disabled={isLoadingSolution}
                  >
                    Reset Game
                  </button>

                  <button
                    type="button"
                    className="mode-btn mode-btn--forever"
                    onClick={() => void startNewBeatTheScoreGame()}
                    disabled={isLoadingSolution}
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

        <main className="beat-board">
          {POSITIONS.map((position) => {
            const row = state.rows[position];
            const cpuRow = solution?.finalState.rows[position] ?? null;
            const isCpuRevealed =
              revealedPositions.has(position) && cpuRow !== null;
            const currentOptionNode =
              game.positions[position]?.options?.[row.optionIndex];
            const nextOptionExists = Boolean(
              game.positions[position]?.options?.[row.optionIndex + 1]?.player,
            );
            const isTradeActive = state.tradeState.activePosition !== null;
            const isActiveTradeRow =
              state.tradeState.activePosition === position;
            const basePlayerScore = scorePlayer(row.currentPlayer);

            return (
              <div
                key={position}
                className={`beat-row ${isActiveTradeRow ? "beat-row--focus" : ""}`}
              >
                <div className="beat-row__user">
                  <div className="row-cell row-cell--headshot beat-row__cell">
                    {row.currentPlayer.headshotUrl ? (
                      <img
                        src={row.currentPlayer.headshotUrl}
                        alt={`${row.currentPlayer.name} headshot`}
                        className="row-cell__headshot-image"
                      />
                    ) : (
                      <div className="row-cell__headshot-fallback" />
                    )}
                  </div>

                  <div className="row-cell row-cell--identity beat-row__cell">
                    <div className="row-cell__name">
                      {row.currentPlayer.name}
                    </div>
                    <div className="row-cell__position">{row.position}</div>
                    <div className="row-cell__team">
                      {row.currentPlayer.team}
                    </div>
                  </div>

                  <div className="row-cell row-cell--buttons beat-row__cell">
                    <ActionButtons
                      disabled={
                        row.locked ||
                        isActiveTradeRow ||
                        (isTradeActive && !isActiveTradeRow)
                      }
                      onSign={() => dispatch({ type: "SIGN_PLAYER", position })}
                      onCut={() => dispatch({ type: "CUT_PLAYER", position })}
                      onTrade={() =>
                        dispatch({ type: "START_TRADE", position })
                      }
                      canCut={!isTradeActive && nextOptionExists}
                    />
                  </div>

                  <div className="row-cell beat-row__cell beat-info-panel">
                    {row.locked && row.playerScore !== null ? (
                      <>
                        <div className="locked-badge">LOCKED IN</div>
                        <div className="locked-score">
                          Player Score: {row.playerScore.toFixed(1)}
                        </div>

                        <div className="beat-stats-grid">
                          <div className="locked-stat">
                            <span className="locked-stat__value">
                              {formatStat(row.currentPlayer.ppg)}
                            </span>
                            <span className="locked-stat__label">PPG</span>
                          </div>
                          <div className="locked-stat">
                            <span className="locked-stat__value">
                              {formatStat(row.currentPlayer.rpg)}
                            </span>
                            <span className="locked-stat__label">RPG</span>
                          </div>
                          <div className="locked-stat">
                            <span className="locked-stat__value">
                              {formatStat(row.currentPlayer.apg)}
                            </span>
                            <span className="locked-stat__label">APG</span>
                          </div>
                        </div>
                      </>
                    ) : isActiveTradeRow ? (
                      <div className="trade-candidates beat-trade-candidates">
                        {currentOptionNode?.trades?.map((candidate) => (
                          <button
                            key={candidate.id}
                            className={`trade-candidate-card trade-candidate-card--row ${
                              state.tradeState.selectedTradePlayerId ===
                              candidate.id
                                ? "trade-candidate-card--selected"
                                : ""
                            } ${
                              scorePlayer(candidate) >=
                              basePlayerScore * JACKPOT_SCORE_MULTIPLIER
                                ? "trade-candidate-card--jackpot"
                                : ""
                            }`}
                            onClick={() =>
                              dispatch({
                                type: "SELECT_TRADE_CANDIDATE",
                                playerId: candidate.id,
                              })
                            }
                          >
                            <div className="trade-candidate-card__portrait trade-candidate-card__portrait--row">
                              {candidate.headshotUrl ? (
                                <img
                                  src={candidate.headshotUrl}
                                  alt={`${candidate.name} headshot`}
                                  className="trade-candidate-card__image"
                                />
                              ) : null}
                            </div>
                            <div className="trade-candidate-card__name trade-candidate-card__name--row">
                              {candidate.name}
                            </div>
                          </button>
                        ))}

                        <button
                          className="execute-trade-btn execute-trade-btn--row"
                          onClick={() => dispatch({ type: "EXECUTE_TRADE" })}
                          disabled={!state.tradeState.selectedTradePlayerId}
                        >
                          <span>Execute</span>
                          <span>Trade</span>
                        </button>
                      </div>
                    ) : (
                      <div className="info-panel__placeholder">
                        Lock a player to reveal the CPU matchup.
                      </div>
                    )}
                  </div>
                </div>

                <div className="beat-row__cpu">
                  <div className="row-cell row-cell--headshot beat-row__cell">
                    <img
                      src={
                        isCpuRevealed
                          ? cpuRow.currentPlayer.headshotUrl
                          : SILHOUETTE_URL
                      }
                      alt={
                        isCpuRevealed && cpuRow
                          ? `${cpuRow.currentPlayer.name} headshot`
                          : "Hidden CPU player silhouette"
                      }
                      className="row-cell__headshot-image"
                    />
                  </div>

                  <div className="row-cell row-cell--identity beat-row__cell beat-row__cell--cpu-identity">
                    <div className="row-cell__name">
                      {isCpuRevealed && cpuRow
                        ? cpuRow.currentPlayer.name
                        : "Hidden Opponent"}
                    </div>
                    <div className="row-cell__position">{position}</div>
                    <div className="row-cell__team">
                      {isCpuRevealed && cpuRow
                        ? cpuRow.currentPlayer.team
                        : "CPU"}
                    </div>
                  </div>

                  <div className="row-cell beat-row__cell beat-cpu-score">
                    <div className="beat-cpu-score__label">
                      {isCpuRevealed ? "Revealed Score" : "Hidden Score"}
                    </div>
                    <div className="beat-cpu-score__value">
                      {cpuRow?.playerScore?.toFixed(1) ?? "--"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </main>

        <footer className="beat-scorebar">
          <div className="beat-scorebar__score beat-scorebar__score--user">
            <div className="beat-scorebar__label">Your Score</div>
            <div
              className={`beat-scorebar__value ${userWon ? "beat-scorebar__value--winner" : ""} ${cpuWon ? "beat-scorebar__value--loser" : ""}`.trim()}
            >
              {userRunningScore}
            </div>
          </div>

          <div className="beat-scorebar__paths">
            <div
              className={`beat-paths__column beat-paths__column--user ${userWon ? "beat-paths__column--winner" : ""} ${cpuWon ? "beat-paths__column--loser" : ""} ${isTie ? "beat-paths__column--tie" : ""}`.trim()}
            >
              <div className="beat-paths__label">Your Path</div>
              <div className="beat-paths__chips">
                {userPath.length > 0 ? (
                  userPath.map((chip) => (
                    <div
                      key={chip.position}
                      className="beat-path-chip beat-path-chip--user"
                    >
                      {chip.text}
                    </div>
                  ))
                ) : (
                  <div className="beat-paths__empty">
                    No locked positions yet.
                  </div>
                )}
              </div>
            </div>

            <div
              className={`beat-paths__column beat-paths__column--cpu ${cpuWon ? "beat-paths__column--winner" : ""} ${userWon ? "beat-paths__column--loser" : ""} ${isTie ? "beat-paths__column--tie" : ""}`.trim()}
            >
              <div className="beat-paths__label">CPU Path</div>
              <div className="beat-paths__chips beat-paths__chips--cpu">
                {cpuPath.length > 0 ? (
                  cpuPath.map((chip) => (
                    <div
                      key={chip.position}
                      className={`beat-path-chip beat-path-chip--cpu ${
                        revealedPositions.has(chip.position)
                          ? "beat-path-chip--revealed"
                          : "beat-path-chip--hidden"
                      }`}
                    >
                      {revealedPositions.has(chip.position)
                        ? chip.text
                        : `${chip.position}: Hidden`}
                    </div>
                  ))
                ) : (
                  <div className="beat-paths__empty">Building CPU lineup…</div>
                )}
              </div>
            </div>
          </div>

          <div className="beat-scorebar__score beat-scorebar__score--cpu">
            <div className="beat-scorebar__label">CPU Score</div>
            <div
              className={`beat-scorebar__value ${cpuWon ? "beat-scorebar__value--winner" : ""} ${userWon ? "beat-scorebar__value--loser" : ""}`.trim()}
            >
              {solution ? solution.finalScore.toFixed(1) : "--"}
            </div>
          </div>
        </footer>
      </div>

      <HowToPlayModal
        isOpen={isHowToOpen}
        onClose={() => setIsHowToOpen(false)}
      />

      {isLoadingSolution ? (
        <LoadingOverlay
          title={loadingTitle}
          currentStatus={statusLogs[statusLogs.length - 1] ?? ""}
          logs={statusLogs}
        />
      ) : null}
    </div>
  );
}
