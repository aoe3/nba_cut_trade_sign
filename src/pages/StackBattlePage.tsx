import { useMemo, useState } from "react";

import type { AppMode } from "../App";
import { HowToPlayModal } from "../components/HowToPlayModal";
import { ModeDropdown } from "../components/ModeDropdown";
import { ShootoutMoveCounter } from "../components/ShootoutMoveCounter";

type StackBattlePageProps = {
  activeMode: AppMode;
  onChangeMode: (mode: AppMode) => void;
};

type BattleSlot = "G" | "F" | "C";

const BATTLE_SLOTS: BattleSlot[] = ["G", "F", "C"];

function StackCards({ lane }: { lane: BattleSlot }) {
  const placeholders = useMemo(
    () => Array.from({ length: 12 }, (_, index) => index + 1),
    [],
  );

  return (
    <div className="stack-battle__stack-shell">
      <div className="stack-battle__stack-header">
        <div>
          <div className="stack-battle__stack-title">
            {lane === "G" ? "Guard" : lane === "F" ? "Forward" : "Center"} Pool
          </div>
        </div>

        <div className="stack-battle__stack-meta">12 deep</div>
      </div>

      <div
        className="stack-battle__stack-hand"
        aria-label={`${lane} stack placeholder`}
      >
        {placeholders.map((value) => (
          <div key={`${lane}-${value}`} className="stack-battle__stack-card">
            <div className="stack-battle__stack-card-rank">
              {String(value).padStart(2, "0")}
            </div>
            <div
              className="stack-battle__stack-card-headshot"
              aria-hidden="true"
            />
            <div className="stack-battle__stack-card-name">Player {value}</div>
            <div className="stack-battle__stack-card-meta">{lane} · TEAM</div>
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
  const [isHowToOpen, setIsHowToOpen] = useState(false);

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
                  >
                    How To Play
                  </button>

                  <button type="button" className="mode-btn">
                    Reset Game
                  </button>

                  <button type="button" className="mode-btn mode-btn--forever">
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
            <div className="stack-battle__column-header stack-battle__column-header--center">
              <h2 className="stack-battle__column-title"></h2>
            </div>

            <div className="stack-battle__lanes">
              {BATTLE_SLOTS.map((slot) => (
                <StackCards key={slot} lane={slot} />
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
              Layout only for inspection
            </div>
          </div>
        </section>
      </div>

      <HowToPlayModal
        isOpen={isHowToOpen}
        onClose={() => setIsHowToOpen(false)}
      />
    </div>
  );
}
