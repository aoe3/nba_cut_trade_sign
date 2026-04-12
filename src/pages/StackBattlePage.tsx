import { useCallback, useEffect, useState } from "react";

import type { AppMode } from "../App";
import { HowToPlayModal } from "../components/HowToPlayModal";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { ModeDropdown } from "../components/ModeDropdown";
import { ShootoutMoveCounter } from "../components/ShootoutMoveCounter";
import {
  createStackBattleGame,
  type BattleSlot,
  type StackBattleGame,
} from "./stackBattle/createStackBattleGame";

type StackBattlePageProps = {
  activeMode: AppMode;
  onChangeMode: (mode: AppMode) => void;
};

const BATTLE_SLOTS: BattleSlot[] = ["G", "F", "C"];
const STACK_BATTLE_GAME_STORAGE_KEY = "cut-trade-sign:stack-battle-game";

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

function loadStoredGame(): StackBattleGame | null {
  try {
    const raw = window.localStorage.getItem(STACK_BATTLE_GAME_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StackBattleGame;
  } catch {
    return null;
  }
}

function persistGame(game: StackBattleGame) {
  window.localStorage.setItem(STACK_BATTLE_GAME_STORAGE_KEY, JSON.stringify(game));
}

function StackCards({
  lane,
  game,
}: {
  lane: BattleSlot;
  game: StackBattleGame;
}) {
  const options = game.pools[lane].options;

  return (
    <div className="stack-battle__stack-shell">
      <div className="stack-battle__stack-header">
        <div className="stack-battle__stack-title">{getPoolLabel(lane)}</div>
        <div className="stack-battle__stack-meta">{options.length} deep</div>
      </div>

      <div className="stack-battle__stack-hand" aria-label={`${lane} player stack`}>
        {options.map((option, index) => (
          <div
            key={`${lane}-${option.player.id}`}
            className={`stack-battle__stack-card${index === 0 ? " stack-battle__stack-card--current" : ""}`}
            style={{
              left: `${index * 22}px`,
              zIndex: options.length - index,
            }}
            aria-hidden={index !== 0}
          >
            <div className="stack-battle__stack-card-rank">
              {String(index + 1).padStart(2, "0")}
            </div>

            {option.player.headshotUrl ? (
              <img
                src={option.player.headshotUrl}
                alt={index === 0 ? `${option.player.name} headshot` : ""}
                className="stack-battle__stack-card-image"
              />
            ) : (
              <div className="stack-battle__stack-card-headshot" aria-hidden="true" />
            )}

            <div className="stack-battle__stack-card-name">{option.player.name}</div>
            <div className="stack-battle__stack-card-meta">
              {option.player.position} · {option.player.team}
            </div>
          </div>
        ))}
      </div>

      <div className="stack-battle__stack-actions" aria-hidden="true">
        <button type="button" className="stack-battle__action-btn" disabled>
          Sign
        </button>
        <button type="button" className="stack-battle__action-btn" disabled>
          Trade
        </button>
        <button type="button" className="stack-battle__action-btn" disabled>
          Cut
        </button>
      </div>
    </div>
  );
}

function EmptyRosterColumn({
  title,
  side,
}: {
  title: string;
  side: "user" | "cpu";
}) {
  return (
    <section className={`stack-battle__roster stack-battle__roster--${side}`}>
      <div className="stack-battle__column-header">
        <div className="stack-battle__column-eyebrow">
          {side === "user" ? "Your Side" : "CPU Side"}
        </div>
        <h2 className="stack-battle__column-title">{title}</h2>
      </div>

      <div className="stack-battle__slots">
        {BATTLE_SLOTS.map((slot) => (
          <div key={`${side}-${slot}`} className="stack-battle__slot-card">
            <div className="stack-battle__slot-badge">{slot}</div>
            <div className="stack-battle__slot-title">Empty slot</div>
            <div className="stack-battle__slot-copy">
              Future signed player lands here
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function StackBattlePage({
  activeMode,
  onChangeMode,
}: StackBattlePageProps) {
  const [game, setGame] = useState<StackBattleGame>(() => {
    if (typeof window === "undefined") {
      return createStackBattleGame();
    }

    return loadStoredGame() ?? createStackBattleGame();
  });
  const [isHowToOpen, setIsHowToOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    persistGame(game);
  }, [game]);

  const resetGame = useCallback(() => {
    const stored = loadStoredGame();
    if (stored) {
      setGame(stored);
      return;
    }

    const freshGame = createStackBattleGame();
    setGame(freshGame);
    persistGame(freshGame);
  }, []);

  const buildNewGame = useCallback(async () => {
    try {
      setIsLoading(true);
      await Promise.resolve();
      const freshGame = createStackBattleGame();
      setGame(freshGame);
      persistGame(freshGame);
    } finally {
      window.setTimeout(() => {
        setIsLoading(false);
      }, 150);
    }
  }, []);

  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <div className="topbar__left">
            <div className="topbar__title-block">
              <div className="eyebrow" style={{ textAlign: "left" }}>
                Stack Battle
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
            <ShootoutMoveCounter userMovesRemaining={5} cpuMovesRemaining={5} />
          </div>
        </header>

        <main className="stack-battle">
          <EmptyRosterColumn title="Your Lineup" side="user" />

          <section className="stack-battle__center">
            <div className="stack-battle__lanes">
              {BATTLE_SLOTS.map((slot) => (
                <StackCards key={slot} lane={slot} game={game} />
              ))}
            </div>
          </section>

          <EmptyRosterColumn title="CPU Lineup" side="cpu" />
        </main>

        <section className="stack-battle__footer">
          <div className="stack-battle__footer-card">
            <div className="stack-battle__footer-label">Turn Order</div>
            <div className="stack-battle__footer-value">
              Coin flip decides opening control
            </div>
          </div>

          <div className="stack-battle__footer-card stack-battle__footer-card--wide">
            <div className="stack-battle__footer-label">Mode Shape</div>
            <div className="stack-battle__footer-value">
              Three contested pools: G, F, C. Each stack is twelve deep. Both
              sides spend five moves on cuts and trades, then close empty slots
              with free signs.
            </div>
          </div>

          <div className="stack-battle__footer-card">
            <div className="stack-battle__footer-label">Current Goal</div>
            <div className="stack-battle__footer-value">
              Initial stack generation only
            </div>
          </div>
        </section>
      </div>

      <HowToPlayModal
        isOpen={isHowToOpen}
        onClose={() => setIsHowToOpen(false)}
      />

      {isLoading ? (
        <LoadingOverlay
          title="Building Game"
          currentStatus="Generating stack battle pools"
          logs={["Generating stack battle pools"]}
        />
      ) : null}
    </div>
  );
}
