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
const STACK_BATTLE_GAME_STORAGE_KEY = "cut-trade-sign:draft-battle-game";
const STACK_BATTLE_INITIAL_GAME_STORAGE_KEY =
  "cut-trade-sign:draft-battle-initial-game";
const STACK_BATTLE_SESSION_STORAGE_KEY = "cut-trade-sign:draft-battle-session";
const CPU_TURN_DELAY_MS = 850;
const AUTO_SIGN_DELAY_MS = 600;

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
  return loadGameFromStorage(STACK_BATTLE_GAME_STORAGE_KEY);
}

function loadInitialGame(): DraftBattleGame | null {
  return loadGameFromStorage(STACK_BATTLE_INITIAL_GAME_STORAGE_KEY);
}

function loadStoredSession(): DraftBattleSession | null {
  try {
    const raw = window.localStorage.getItem(STACK_BATTLE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    return normalizeStoredSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

function persistGame(game: DraftBattleGame) {
  window.localStorage.setItem(
    STACK_BATTLE_GAME_STORAGE_KEY,
    JSON.stringify(game),
  );
}

function persistInitialGame(game: DraftBattleGame) {
  window.localStorage.setItem(
    STACK_BATTLE_INITIAL_GAME_STORAGE_KEY,
    JSON.stringify(game),
  );
}

function persistSession(session: DraftBattleSession) {
  window.localStorage.setItem(
    STACK_BATTLE_SESSION_STORAGE_KEY,
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

function getValidTradeTargets(game: DraftBattleGame, slot: BattleSlot) {
  const currentOption = getCurrentOption(game, slot);
  if (!currentOption) {
    return [];
  }

  return currentOption.tradeTargets ?? [];
}

function getAvailableCutSlots(game: DraftBattleGame): BattleSlot[] {
  return BATTLE_SLOTS.filter((slot) => getCurrentOption(game, slot) !== null);
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
              }${target.isJackpot ? " draft-battle__lane-cell--offer-jackpot" : ""}`}
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

        if (session.cpuMovesRemaining <= 0) {
          const slot = getFirstEmptySlot(session.cpuLineup);
          if (!slot) {
            setSession((currentSession) => ({
              ...currentSession,
              activeTurn: "user",
            }));
            return;
          }

          const currentOption = getCurrentOption(game, slot);
          if (!currentOption) {
            setSession((currentSession) => ({
              ...currentSession,
              activeTurn: "user",
            }));
            return;
          }

          setGame((currentGame) =>
            removePlayersFromPool(currentGame, slot, [currentOption.player.id]),
          );
          setSession((currentSession) =>
            finalizeSession({
              ...currentSession,
              cpuLineup: {
                ...currentSession.cpuLineup,
                [slot]: createSignedLineupSlot(currentOption.player),
              },
              activeTurn: "user",
              history: appendHistory(
                currentSession.history,
                "cpu",
                `CPU auto-signed ${currentOption.player.name} to ${slot}.`,
              ),
            }),
          );
          return;
        }

        const emptyCpuSlot = getFirstEmptySlot(session.cpuLineup);
        const signShouldHappen =
          emptyCpuSlot !== null &&
          (() => {
            const currentOption = getCurrentOption(game, emptyCpuSlot);
            if (!currentOption) return false;
            const currentScore = scorePlayer(currentOption.player);
            return currentScore >= 55 || Math.random() < 0.45;
          })();

        if (signShouldHappen && emptyCpuSlot) {
          const currentOption = getCurrentOption(game, emptyCpuSlot);
          if (currentOption) {
            setGame((currentGame) =>
              removePlayersFromPool(currentGame, emptyCpuSlot, [
                currentOption.player.id,
              ]),
            );
            setSession((currentSession) =>
              finalizeSession({
                ...currentSession,
                cpuLineup: {
                  ...currentSession.cpuLineup,
                  [emptyCpuSlot]: createSignedLineupSlot(currentOption.player),
                },
                activeTurn: "user",
                history: appendHistory(
                  currentSession.history,
                  "cpu",
                  `CPU signed ${currentOption.player.name} to ${emptyCpuSlot}.`,
                ),
              }),
            );
            return;
          }
        }

        const availableTradeSlots = BATTLE_SLOTS.filter((slot) => {
          if (session.cpuLineup[slot]) return false;
          return getValidTradeTargets(game, slot).length > 0;
        });
        const availableCutSlots = getAvailableCutSlots(game);

        if (
          availableTradeSlots.length > 0 &&
          (availableCutSlots.length === 0 || Math.random() < 0.45)
        ) {
          const chosenSlot =
            availableTradeSlots[
              Math.floor(Math.random() * availableTradeSlots.length)
            ];
          const validTargets = getValidTradeTargets(game, chosenSlot);
          const chosenTarget =
            validTargets[Math.floor(Math.random() * validTargets.length)];
          const currentOption = getCurrentOption(game, chosenSlot);

          if (currentOption && chosenTarget) {
            setGame((currentGame) =>
              removePlayersFromPool(currentGame, chosenSlot, [
                currentOption.player.id,
                chosenTarget.id,
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
                  [chosenSlot]: createSignedLineupSlot(chosenTarget),
                },
                activeTurn: "user",
                history: appendHistory(
                  currentSession.history,
                  "cpu",
                  `CPU traded ${chosenSlot} into ${chosenTarget.name}.`,
                ),
              }),
            );
            return;
          }
        }

        if (availableCutSlots.length > 0) {
          const randomSlot =
            availableCutSlots[
              Math.floor(Math.random() * availableCutSlots.length)
            ];
          const currentOption = getCurrentOption(game, randomSlot);

          if (currentOption) {
            setGame((currentGame) =>
              removePlayersFromPool(currentGame, randomSlot, [
                currentOption.player.id,
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
                `CPU cut ${currentOption.player.name} from ${randomSlot}.`,
              ),
            }));
            return;
          }
        }

        if (emptyCpuSlot) {
          const currentOption = getCurrentOption(game, emptyCpuSlot);
          if (currentOption) {
            setGame((currentGame) =>
              removePlayersFromPool(currentGame, emptyCpuSlot, [
                currentOption.player.id,
              ]),
            );
            setSession((currentSession) =>
              finalizeSession({
                ...currentSession,
                cpuLineup: {
                  ...currentSession.cpuLineup,
                  [emptyCpuSlot]: createSignedLineupSlot(currentOption.player),
                },
                activeTurn: "user",
                history: appendHistory(
                  currentSession.history,
                  "cpu",
                  `CPU signed ${currentOption.player.name} to ${emptyCpuSlot}.`,
                ),
              }),
            );
            return;
          }
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

  const isTradeLocked = tradePickerSlot !== null;
  const isSignDisabled = useMemo(() => {
    return (
      !session.setupComplete ||
      session.activeTurn !== "user" ||
      session.gameOver
    );
  }, [session]);

  const isTradeDisabled = useMemo(() => {
    return (
      !session.setupComplete ||
      session.activeTurn !== "user" ||
      session.userMovesRemaining <= 0 ||
      session.gameOver
    );
  }, [session]);

  const isCutDisabled = useMemo(() => {
    return (
      !session.setupComplete ||
      session.activeTurn !== "user" ||
      session.userMovesRemaining <= 0 ||
      session.gameOver
    );
  }, [session]);

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
                  isTradeLocked={isTradeLocked && tradePickerSlot !== slot}
                  isSignDisabled={
                    isSignDisabled || Boolean(session.userLineup[slot])
                  }
                  isTradeDisabled={
                    isTradeDisabled || Boolean(session.userLineup[slot])
                  }
                  isTradeOpen={tradePickerSlot === slot}
                  selectedTradeTargetId={
                    tradePickerSlot === slot ? selectedTradeTargetId : null
                  }
                  isCutDisabled={isCutDisabled}
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
