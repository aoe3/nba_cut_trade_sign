import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import publishedGameData from "../data/games/game_2026-04-10.json";
import { ActionButtons } from "../components/ActionButtons";
import { HowToPlayModal } from "../components/HowToPlayModal";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { ModeDropdown } from "../components/ModeDropdown";
import { ShootoutMoveCounter } from "../components/ShootoutMoveCounter";
import { ShootoutCoinFlipModal } from "../components/ShootoutCoinFlipModal";
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

type ShootoutPageProps = {
  activeMode: AppMode;
  onChangeMode: (mode: AppMode) => void;
};

type TurnOwner = "user" | "cpu";
type TurnBadge = "Your Turn" | "CPU Turn" | "Auto-Skip";
type CpuActionKind = "sign" | "trade" | "cut";

type ShootoutSession = {
  activeTurn: TurnOwner | null;
  initialTurn: TurnOwner | null;
  cpuStepIndex: number;
  setupComplete: boolean;
  turnBadge: TurnBadge;
};

type PathChip = {
  position: Position;
  text: string;
};

const publishedGame = publishedGameData as DailyGame;
const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];
const JACKPOT_SCORE_MULTIPLIER = 1.1;
const SHOOTOUT_GAME_STORAGE_KEY = "cut-trade-sign:shootout-game";
const SHOOTOUT_USER_STATE_STORAGE_KEY = "cut-trade-sign:shootout-user-state";
const SHOOTOUT_CPU_STATE_STORAGE_KEY = "cut-trade-sign:shootout-cpu-state";
const SHOOTOUT_SOLUTION_STORAGE_KEY = "cut-trade-sign:shootout-solution";
const SHOOTOUT_SESSION_STORAGE_KEY = "cut-trade-sign:shootout-session";
const CPU_TURN_DELAY_MS = 1000;
const AUTO_SKIP_DELAY_MS = 650;

function loadStoredGame(): DailyGame | null {
  try {
    const raw = window.localStorage.getItem(SHOOTOUT_GAME_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DailyGame;
  } catch {
    return null;
  }
}

function loadStoredState(key: string): GameState | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

function loadStoredSolution(): BeatTheScoreSolution | null {
  try {
    const raw = window.localStorage.getItem(SHOOTOUT_SOLUTION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BeatTheScoreSolution;
  } catch {
    return null;
  }
}

function loadStoredSession(): ShootoutSession | null {
  try {
    const raw = window.localStorage.getItem(SHOOTOUT_SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ShootoutSession;
  } catch {
    return null;
  }
}

function persistGame(game: DailyGame) {
  window.localStorage.setItem(SHOOTOUT_GAME_STORAGE_KEY, JSON.stringify(game));
}

function persistState(key: string, state: GameState) {
  window.localStorage.setItem(key, JSON.stringify(state));
}

function persistSolution(solution: BeatTheScoreSolution | null) {
  if (!solution) {
    window.localStorage.removeItem(SHOOTOUT_SOLUTION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    SHOOTOUT_SOLUTION_STORAGE_KEY,
    JSON.stringify(solution),
  );
}

function persistSession(session: ShootoutSession) {
  window.localStorage.setItem(
    SHOOTOUT_SESSION_STORAGE_KEY,
    JSON.stringify(session),
  );
}

function formatStat(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "—";
  }

  return value.toFixed(1);
}

function summarizeRow(row: RowState): string {
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

  if (row.locked) {
    return `${row.position}: Sign ${row.currentPlayer.name}`;
  }

  return `${row.position}: ${row.currentPlayer.name}`;
}

function summarizeStatePath(state: GameState): PathChip[] {
  return POSITIONS.map((position) => ({
    position,
    text: summarizeRow(state.rows[position]),
  }));
}

function createInitialSession(): ShootoutSession {
  return {
    activeTurn: null,
    initialTurn: null,
    cpuStepIndex: 0,
    setupComplete: false,
    turnBadge: "Your Turn",
  };
}

function applySolverStep(
  game: DailyGame,
  state: GameState,
  step: BeatTheScoreSolution["path"][number],
): GameState {
  if (step.kind === "trade") {
    let next = gameReducer(
      state,
      {
        type: "START_TRADE",
        position: step.position,
      },
      game,
    );
    next = gameReducer(
      next,
      {
        type: "SELECT_TRADE_CANDIDATE",
        playerId: step.player.id,
      },
      game,
    );
    return gameReducer(next, { type: "EXECUTE_TRADE" }, game);
  }

  if (step.kind === "cut") {
    return gameReducer(
      state,
      { type: "CUT_PLAYER", position: step.position },
      game,
    );
  }

  return gameReducer(
    state,
    { type: "SIGN_PLAYER", position: step.position },
    game,
  );
}

function getTurnLabel(turn: TurnOwner): TurnBadge {
  return turn === "user" ? "Your Turn" : "CPU Turn";
}

function getBadgeOwner(
  activeTurn: TurnOwner | null,
  turnBadge: TurnBadge,
): TurnOwner | null {
  if (turnBadge === "Auto-Skip") {
    return null;
  }

  return activeTurn;
}

function getLatestCpuAction(
  solution: BeatTheScoreSolution | null,
  cpuStepIndex: number,
): { position: Position; action: CpuActionKind } | null {
  if (!solution || cpuStepIndex <= 0) {
    return null;
  }

  const latestStep = solution.path[cpuStepIndex - 1];
  if (!latestStep) {
    return null;
  }

  return {
    position: latestStep.position,
    action: latestStep.kind,
  };
}

function CpuActionButtons({ activeAction }: { activeAction?: CpuActionKind }) {
  return (
    <div className="row-cell row-cell--buttons action-buttons shootout-cpu-actions">
      <button
        type="button"
        className={`action-btn action-btn--sign ${activeAction === "sign" ? "shootout-cpu-action-btn--active" : ""}`.trim()}
        disabled
      >
        Sign
      </button>

      <button
        type="button"
        className={`action-btn action-btn--trade ${activeAction === "trade" ? "shootout-cpu-action-btn--active" : ""}`.trim()}
        disabled
      >
        Trade
      </button>

      <button
        type="button"
        className={`action-btn action-btn--cut ${activeAction === "cut" ? "shootout-cpu-action-btn--active" : ""}`.trim()}
        disabled
      >
        Cut
      </button>
    </div>
  );
}

/**
 * Renders the alternating-turn duel mode, including toss flow and CPU action playback.
 */
export function ShootoutPage({ activeMode, onChangeMode }: ShootoutPageProps) {
  const initialGame = loadStoredGame() ?? publishedGame;
  const storedUserState = loadStoredState(SHOOTOUT_USER_STATE_STORAGE_KEY);
  const storedCpuState = loadStoredState(SHOOTOUT_CPU_STATE_STORAGE_KEY);
  const storedSolution = loadStoredSolution();
  const storedSession = loadStoredSession() ?? createInitialSession();

  const [game, setGame] = useState<DailyGame>(initialGame);
  const [userState, setUserState] = useState<GameState>(
    storedUserState ?? buildInitialGameState(initialGame),
  );
  const [cpuState, setCpuState] = useState<GameState>(
    storedCpuState ?? buildInitialGameState(initialGame),
  );
  const [solution, setSolution] = useState<BeatTheScoreSolution | null>(
    storedSolution,
  );
  const [session, setSession] = useState<ShootoutSession>(storedSession);
  const [isHowToOpen, setIsHowToOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(!storedSolution);
  const [loadingTitle, setLoadingTitle] = useState("Building Shootout");
  const [statusLogs, setStatusLogs] = useState<string[]>([]);
  const [showCoinFlip, setShowCoinFlip] = useState(
    !storedSession.setupComplete,
  );
  const cpuTimeoutRef = useRef<number | null>(null);
  const skipTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    persistGame(game);
  }, [game]);

  useEffect(() => {
    persistState(SHOOTOUT_USER_STATE_STORAGE_KEY, userState);
  }, [userState]);

  useEffect(() => {
    persistState(SHOOTOUT_CPU_STATE_STORAGE_KEY, cpuState);
  }, [cpuState]);

  useEffect(() => {
    persistSolution(solution);
  }, [solution]);

  useEffect(() => {
    persistSession(session);
  }, [session]);

  useEffect(() => {
    return () => {
      if (cpuTimeoutRef.current !== null) {
        window.clearTimeout(cpuTimeoutRef.current);
      }
      if (skipTimeoutRef.current !== null) {
        window.clearTimeout(skipTimeoutRef.current);
      }
    };
  }, [game]);

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
      setLoadingTitle("Building Shootout");
      setIsLoading(true);

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
            setIsLoading(false);
            setShowCoinFlip(true);
          }, 250);
        }
      }
    }

    void buildInitialSolution();

    return () => {
      isCancelled = true;
    };
  }, [game, solution]);

  const isFinalized = userState.gameOver && cpuState.gameOver;
  const userWon =
    isFinalized && (userState.finalScore ?? 0) > (cpuState.finalScore ?? 0);
  const cpuWon =
    isFinalized && (cpuState.finalScore ?? 0) > (userState.finalScore ?? 0);

  useEffect(() => {
    if (!session.setupComplete || showCoinFlip || isLoading || isFinalized) {
      return;
    }

    if (session.activeTurn === "user") {
      if (userState.gameOver && !cpuState.gameOver) {
        if (skipTimeoutRef.current !== null) {
          return;
        }

        setSession((previous) => ({
          ...previous,
          turnBadge: "Auto-Skip",
        }));

        skipTimeoutRef.current = window.setTimeout(() => {
          skipTimeoutRef.current = null;
          setSession((previous) => ({
            ...previous,
            activeTurn: "cpu",
            turnBadge: "CPU Turn",
          }));
        }, AUTO_SKIP_DELAY_MS);
      }
      return;
    }

    if (session.activeTurn === "cpu") {
      if (cpuState.gameOver && !userState.gameOver) {
        if (skipTimeoutRef.current !== null) {
          return;
        }

        setSession((previous) => ({
          ...previous,
          turnBadge: "Auto-Skip",
        }));

        skipTimeoutRef.current = window.setTimeout(() => {
          skipTimeoutRef.current = null;
          setSession((previous) => ({
            ...previous,
            activeTurn: "user",
            turnBadge: "Your Turn",
          }));
        }, AUTO_SKIP_DELAY_MS);
        return;
      }

      if (cpuTimeoutRef.current !== null || !solution) {
        return;
      }

      cpuTimeoutRef.current = window.setTimeout(() => {
        cpuTimeoutRef.current = null;
        const step = solution.path[session.cpuStepIndex];

        if (!step) {
          setSession((previous) => ({
            ...previous,
            activeTurn: userState.gameOver ? null : "user",
            turnBadge: userState.gameOver ? "CPU Turn" : "Your Turn",
          }));
          return;
        }

        setCpuState((previousState) =>
          applySolverStep(game, previousState, step),
        );
        setSession((previous) => ({
          ...previous,
          cpuStepIndex: previous.cpuStepIndex + 1,
          activeTurn: userState.gameOver ? "cpu" : "user",
          turnBadge: userState.gameOver ? "Auto-Skip" : "Your Turn",
        }));
      }, CPU_TURN_DELAY_MS);
    }
  }, [
    cpuState.gameOver,
    isFinalized,
    isLoading,
    session,
    showCoinFlip,
    solution,
    userState.gameOver,
  ]);

  useEffect(() => {
    if (!isFinalized) {
      return;
    }

    if (cpuTimeoutRef.current !== null) {
      window.clearTimeout(cpuTimeoutRef.current);
      cpuTimeoutRef.current = null;
    }

    if (skipTimeoutRef.current !== null) {
      window.clearTimeout(skipTimeoutRef.current);
      skipTimeoutRef.current = null;
    }

    setSession((previous) => ({
      ...previous,
      activeTurn: null,
      turnBadge: userWon ? "Your Turn" : "CPU Turn",
    }));
  }, [isFinalized, userWon]);

  const applyUserAction = useCallback(
    (action: GameAction, endsTurn: boolean) => {
      setUserState((previousState) => {
        const nextState = gameReducer(previousState, action, game);

        if (endsTurn && nextState !== previousState) {
          setSession((previous) => ({
            ...previous,
            activeTurn: "cpu",
            turnBadge: "CPU Turn",
          }));
        }

        return nextState;
      });
    },
    [game],
  );

  const resetGame = useCallback(() => {
    const freshUserState = buildInitialGameState(game);
    const freshCpuState = buildInitialGameState(game);
    const nextInitialTurn = session.initialTurn ?? "user";
    const nextSession: ShootoutSession = {
      activeTurn: nextInitialTurn,
      initialTurn: nextInitialTurn,
      cpuStepIndex: 0,
      setupComplete: true,
      turnBadge: getTurnLabel(nextInitialTurn),
    };

    setUserState(freshUserState);
    setCpuState(freshCpuState);
    setSession(nextSession);
    persistState(SHOOTOUT_USER_STATE_STORAGE_KEY, freshUserState);
    persistState(SHOOTOUT_CPU_STATE_STORAGE_KEY, freshCpuState);
    persistSession(nextSession);
  }, [game, session.initialTurn]);

  const startNewShootoutGame = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadingTitle("Building Game");
      setStatusLogs(["Starting background build worker…"]);

      const newGame = await buildForeverGameInWorker(handleStatus);
      handleStatus("Building CPU opponent from the new puzzle…");
      const newSolution = await solveBeatTheScoreInWorker(
        newGame,
        handleStatus,
      );
      const freshUserState = buildInitialGameState(newGame);
      const freshCpuState = buildInitialGameState(newGame);
      const freshSession = createInitialSession();

      setGame(newGame);
      setSolution(newSolution);
      setUserState(freshUserState);
      setCpuState(freshCpuState);
      setSession(freshSession);
      setShowCoinFlip(true);
      persistGame(newGame);
      persistSolution(newSolution);
      persistState(SHOOTOUT_USER_STATE_STORAGE_KEY, freshUserState);
      persistState(SHOOTOUT_CPU_STATE_STORAGE_KEY, freshCpuState);
      persistSession(freshSession);
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
      window.alert(`Could not generate a new Shootout game. ${message}`);
    } finally {
      window.setTimeout(() => {
        setIsLoading(false);
      }, 250);
    }
  }, [handleStatus]);

  const currentTurnOwner = getBadgeOwner(session.activeTurn, session.turnBadge);

  const userPath = useMemo(() => summarizeStatePath(userState), [userState]);
  const cpuPath = useMemo(() => summarizeStatePath(cpuState), [cpuState]);
  const latestCpuAction = useMemo(
    () => getLatestCpuAction(solution, session.cpuStepIndex),
    [session.cpuStepIndex, solution],
  );

  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <div className="topbar__left">
            <div className="topbar__title-block">
              <div className="eyebrow" style={{ textAlign: "left" }}>
                Shootout
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
                    disabled={isLoading || !session.setupComplete}
                  >
                    Reset Game
                  </button>

                  <button
                    type="button"
                    className="mode-btn mode-btn--forever"
                    onClick={() => void startNewShootoutGame()}
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
              userMovesRemaining={userState.movesRemaining}
              cpuMovesRemaining={cpuState.movesRemaining}
            />
          </div>
        </header>

        <main className="beat-board shootout-board">
          {POSITIONS.map((position) => {
            const row = userState.rows[position];
            const cpuRow = cpuState.rows[position];
            const currentOptionNode =
              game.positions[position]?.options?.[row.optionIndex];
            const nextOptionExists = Boolean(
              game.positions[position]?.options?.[row.optionIndex + 1]?.player,
            );
            const isTradeActive = userState.tradeState.activePosition !== null;
            const isActiveTradeRow =
              userState.tradeState.activePosition === position;
            const basePlayerScore = scorePlayer(row.currentPlayer);
            const cpuActiveAction =
              latestCpuAction?.position === position
                ? latestCpuAction.action
                : undefined;

            return (
              <div
                key={position}
                className={`beat-row ${isActiveTradeRow ? "beat-row--focus" : ""}`}
              >
                <div
                  className={`beat-row__user shootout-side ${currentTurnOwner === "cpu" ? "shootout-side--inactive" : ""}`.trim()}
                >
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
                        currentTurnOwner !== "user" ||
                        row.locked ||
                        isActiveTradeRow ||
                        (isTradeActive && !isActiveTradeRow)
                      }
                      onSign={() =>
                        applyUserAction({ type: "SIGN_PLAYER", position }, true)
                      }
                      onCut={() =>
                        applyUserAction({ type: "CUT_PLAYER", position }, true)
                      }
                      onTrade={() =>
                        applyUserAction(
                          { type: "START_TRADE", position },
                          false,
                        )
                      }
                      canCut={
                        currentTurnOwner === "user" &&
                        !isTradeActive &&
                        nextOptionExists
                      }
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
                              userState.tradeState.selectedTradePlayerId ===
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
                              applyUserAction(
                                {
                                  type: "SELECT_TRADE_CANDIDATE",
                                  playerId: candidate.id,
                                },
                                false,
                              )
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
                          onClick={() =>
                            applyUserAction({ type: "EXECUTE_TRADE" }, true)
                          }
                          disabled={
                            currentTurnOwner !== "user" ||
                            !userState.tradeState.selectedTradePlayerId
                          }
                        >
                          <span>Execute</span>
                          <span>Trade</span>
                        </button>
                      </div>
                    ) : (
                      <div className="info-panel__placeholder">
                        {currentTurnOwner === "user"
                          ? "Your move."
                          : "Waiting for your turn."}
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className={`beat-row__cpu shootout-row__cpu shootout-side ${currentTurnOwner === "user" ? "shootout-side--inactive" : ""}`.trim()}
                >
                  <div className="row-cell beat-row__cell beat-info-panel shootout-cpu-panel">
                    {cpuRow.locked && cpuRow.playerScore !== null ? (
                      <>
                        <div className="locked-badge">LOCKED IN</div>
                        <div className="locked-score">
                          Player Score: {cpuRow.playerScore.toFixed(1)}
                        </div>
                        <div className="beat-stats-grid">
                          <div className="locked-stat">
                            <span className="locked-stat__value">
                              {formatStat(cpuRow.currentPlayer.ppg)}
                            </span>
                            <span className="locked-stat__label">PPG</span>
                          </div>
                          <div className="locked-stat">
                            <span className="locked-stat__value">
                              {formatStat(cpuRow.currentPlayer.rpg)}
                            </span>
                            <span className="locked-stat__label">RPG</span>
                          </div>
                          <div className="locked-stat">
                            <span className="locked-stat__value">
                              {formatStat(cpuRow.currentPlayer.apg)}
                            </span>
                            <span className="locked-stat__label">APG</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="info-panel__placeholder">
                        {currentTurnOwner === "cpu"
                          ? "CPU is thinking…"
                          : "Waiting for CPU turn."}
                      </div>
                    )}
                  </div>

                  <div className="row-cell row-cell--buttons beat-row__cell shootout-cpu-buttons-cell">
                    <CpuActionButtons activeAction={cpuActiveAction} />
                  </div>

                  <div className="row-cell row-cell--identity beat-row__cell beat-row__cell--cpu-identity shootout-row__cell--cpu-identity">
                    <div className="row-cell__name">
                      {cpuRow.currentPlayer.name}
                    </div>
                    <div className="row-cell__position">{position}</div>
                    <div className="row-cell__team">
                      {cpuRow.currentPlayer.team}
                    </div>
                  </div>

                  <div className="row-cell row-cell--headshot beat-row__cell shootout-row__cell--cpu-headshot">
                    {cpuRow.currentPlayer.headshotUrl ? (
                      <img
                        src={cpuRow.currentPlayer.headshotUrl}
                        alt={`${cpuRow.currentPlayer.name} headshot`}
                        className="row-cell__headshot-image"
                      />
                    ) : (
                      <div className="row-cell__headshot-fallback" />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </main>

        <footer className="beat-scorebar shootout-scorebar">
          <div
            className={`beat-scorebar__score beat-scorebar__score--user ${currentTurnOwner === "cpu" ? "shootout-side--inactive" : ""}`.trim()}
          >
            <div className="beat-scorebar__label">Your Score</div>
            <div
              className={`beat-scorebar__value ${userWon ? "beat-scorebar__value--winner" : ""} ${cpuWon ? "beat-scorebar__value--loser" : ""}`.trim()}
            >
              {userState.finalScore?.toFixed(1) ?? "--"}
            </div>
          </div>

          <div
            className={`beat-paths__column beat-paths__column--user ${userWon ? "beat-paths__column--winner" : ""} ${cpuWon ? "beat-paths__column--loser" : ""} ${currentTurnOwner === "cpu" ? "shootout-side--inactive" : ""}`.trim()}
          >
            <div className="beat-paths__label">Your Path</div>
            <div className="beat-paths__chips">
              {userPath.map((chip) => (
                <div
                  key={chip.position}
                  className="beat-path-chip beat-path-chip--user"
                >
                  {chip.text}
                </div>
              ))}
            </div>
          </div>

          <div
            className={`shootout-turn-badge ${session.turnBadge === "Auto-Skip" ? "shootout-turn-badge--skip" : ""} ${session.turnBadge === "Your Turn" ? "shootout-turn-badge--pulse" : ""}`.trim()}
          >
            <span className="shootout-turn-badge__ball" aria-hidden="true" />
            <span>{session.turnBadge}</span>
          </div>

          <div
            className={`beat-paths__column beat-paths__column--cpu ${cpuWon ? "beat-paths__column--winner" : ""} ${userWon ? "beat-paths__column--loser" : ""} ${currentTurnOwner === "user" ? "shootout-side--inactive" : ""}`.trim()}
          >
            <div className="beat-paths__label">CPU Path</div>
            <div className="beat-paths__chips beat-paths__chips--cpu">
              {cpuPath.map((chip) => (
                <div
                  key={chip.position}
                  className="beat-path-chip beat-path-chip--cpu"
                >
                  {chip.text}
                </div>
              ))}
            </div>
          </div>

          <div
            className={`beat-scorebar__score beat-scorebar__score--cpu ${currentTurnOwner === "user" ? "shootout-side--inactive" : ""}`.trim()}
          >
            <div className="beat-scorebar__label">CPU Score</div>
            <div
              className={`beat-scorebar__value ${cpuWon ? "beat-scorebar__value--winner" : ""} ${userWon ? "beat-scorebar__value--loser" : ""}`.trim()}
            >
              {cpuState.finalScore?.toFixed(1) ?? "--"}
            </div>
          </div>
        </footer>
      </div>

      <HowToPlayModal
        isOpen={isHowToOpen}
        onClose={() => setIsHowToOpen(false)}
      />

      <ShootoutCoinFlipModal
        isOpen={showCoinFlip && !isLoading}
        onComplete={(firstTurn) => {
          const nextSession: ShootoutSession = {
            activeTurn: firstTurn,
            initialTurn: firstTurn,
            cpuStepIndex: 0,
            setupComplete: true,
            turnBadge: getTurnLabel(firstTurn),
          };

          setSession(nextSession);
          persistSession(nextSession);
          setShowCoinFlip(false);
        }}
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
