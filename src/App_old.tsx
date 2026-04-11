import { useEffect, useReducer, useState } from "react";
import "./App.css";
import gameData from "./data/games/game_2026-04-10.json";
import type { DailyGame, Player } from "./game/types";
import { buildInitialGameState, gameReducer } from "./game/gameReducer";
import { getOrderedRows } from "./game/selectors";

const game = gameData as DailyGame;

type Position = "PG" | "SG" | "SF" | "PF" | "C";

type TradeCandidateView = {
  id: string;
  name: string;
  headshotUrl?: string;
};

type TransactionView =
  | { type: "cut"; text: string }
  | { type: "trade"; text: string };

type MockRowView = {
  position: Position;
  name: string;
  team: string;
  headshotUrl?: string;
  score: number | null;
  player: Player;
  status?: "default" | "locked" | "trading";
  tradeCandidates?: TradeCandidateView[];
  selectedTradePlayerId?: string | null;
  transactionHistory?: TransactionView[];
  onSign: () => void;
  onCut: () => void;
  onTrade: () => void;
  onSelectTradeCandidate: (playerId: string) => void;
  onExecuteTrade: () => void;
  canCut: boolean;
  boardLockedByTrade: boolean;
};

function formatStat(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "—";
  }

  return value.toFixed(1);
}

function formatPct(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "—";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function MoveCounter({ movesRemaining }: { movesRemaining: number }) {
  const total = 5;
  const used = total - movesRemaining;

  return (
    <div className="move-counter">
      <div className="move-counter__label">Trades/Cuts Remaining</div>
      <div className="move-counter__dots">
        {Array.from({ length: total }).map((_, index) => {
          const isUsed = index < used;
          return (
            <span
              key={index}
              className={`move-dot ${isUsed ? "move-dot--used" : ""}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function HowToPlayModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-to-play-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close-btn"
          type="button"
          onClick={onClose}
          aria-label="Close how to play"
        >
          ×
        </button>

        <div className="modal-content">
          <div className="modal-eyebrow">How To Play</div>
          <h2 id="how-to-play-title" className="modal-title">
            Build the best five-man roster you can
          </h2>

          <ul className="how-to-list">
            <li>
              You have one player at each position: PG, SG, SF, PF, and C.
            </li>
            <li>
              For each row, you can choose to Sign the current player, Cut to
              move to the next option in that position’s chain, or Trade for one
              of three comparable players.
            </li>
            <li>
              You only get 5 total Trades/Cuts for the entire board. Signing a
              player does not use one of those moves.
            </li>
            <li>
              Cutting advances that position to its next available option. You
              cannot go backward once you cut.
            </li>
            <li>
              Trading immediately locks that row with the selected trade target.
            </li>
            <li>
              Signing also locks that row with the player currently shown.
            </li>
            <li>
              When your 5 Trades/Cuts are gone, every remaining unlocked row is
              automatically locked as-is.
            </li>
            <li>
              Every locked player gets a Player Score based on overall value,
              impact, role, durability, age, and contract.
            </li>
            <li>
              Your Final Score is the sum of the five locked player scores.
            </li>
            <li>
              Your Puzzle % measures how close your roster was to the best
              possible score for that day’s puzzle, based on the full solvable
              range.
            </li>
            <li>
              Use the transaction history on the right to keep track of how you
              got to each roster spot.
            </li>
            <li>
              The goal is simple: squeeze the strongest possible final lineup
              out of limited moves.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function HeadshotCell({
  name,
  headshotUrl,
}: {
  name: string;
  headshotUrl?: string;
}) {
  return (
    <div className="row-cell row-cell--headshot">
      {headshotUrl ? (
        <img
          src={headshotUrl}
          alt={`${name} headshot`}
          className="row-cell__headshot-image"
        />
      ) : (
        <div className="row-cell__headshot-fallback" />
      )}
    </div>
  );
}

function IdentityCell({
  name,
  position,
  team,
}: {
  name: string;
  position: Position;
  team: string;
}) {
  return (
    <div className="row-cell row-cell--identity">
      <div className="row-cell__name">{name}</div>
      <div className="row-cell__position">{position}</div>
      <div className="row-cell__team">{team}</div>
    </div>
  );
}

function ActionButtons({
  disabled = false,
  onSign,
  onCut,
  onTrade,
  canCut,
}: {
  disabled?: boolean;
  onSign: () => void;
  onCut: () => void;
  onTrade: () => void;
  canCut: boolean;
}) {
  return (
    <div className="row-cell row-cell--buttons action-buttons">
      <button
        className="action-btn action-btn--sign"
        disabled={disabled}
        onClick={onSign}
      >
        Sign
      </button>

      <button
        className="action-btn action-btn--trade"
        disabled={disabled}
        onClick={onTrade}
      >
        Trade
      </button>

      <button
        className="action-btn action-btn--cut"
        disabled={disabled || !canCut}
        onClick={onCut}
      >
        Cut
      </button>
    </div>
  );
}

function LockedPanel({ score, player }: { score: number; player: Player }) {
  return (
    <div className="row-cell row-cell--trade-area info-panel info-panel--locked">
      <div className="locked-badge">LOCKED IN</div>
      <div className="locked-score">Player Score: {score.toFixed(1)}</div>

      <div className="locked-stats-grid">
        <div className="locked-stat">
          <span className="locked-stat__value">{formatStat(player.ppg)}</span>
          <span className="locked-stat__label">PPG</span>
        </div>
        <div className="locked-stat">
          <span className="locked-stat__value">{formatStat(player.rpg)}</span>
          <span className="locked-stat__label">RPG</span>
        </div>
        <div className="locked-stat">
          <span className="locked-stat__value">{formatStat(player.apg)}</span>
          <span className="locked-stat__label">APG</span>
        </div>
        <div className="locked-stat">
          <span className="locked-stat__value">{formatStat(player.spg)}</span>
          <span className="locked-stat__label">SPG</span>
        </div>
        <div className="locked-stat">
          <span className="locked-stat__value">{formatStat(player.bpg)}</span>
          <span className="locked-stat__label">BPG</span>
        </div>
        <div className="locked-stat">
          <span className="locked-stat__value">{formatPct(player.fgPct)}</span>
          <span className="locked-stat__label">FG%</span>
        </div>
        <div className="locked-stat">
          <span className="locked-stat__value">
            {formatPct(player.threePct)}
          </span>
          <span className="locked-stat__label">3P%</span>
        </div>
        <div className="locked-stat">
          <span className="locked-stat__value">{formatPct(player.ftPct)}</span>
          <span className="locked-stat__label">FT%</span>
        </div>
      </div>
    </div>
  );
}

function TradingPanel({
  candidates = [],
  selectedTradePlayerId,
  onSelectTradeCandidate,
  onExecuteTrade,
}: {
  candidates?: TradeCandidateView[];
  selectedTradePlayerId?: string | null;
  onSelectTradeCandidate: (playerId: string) => void;
  onExecuteTrade: () => void;
}) {
  return (
    <div className="row-cell row-cell--trade-area info-panel info-panel--trade">
      <div className="trade-candidates trade-candidates--single-row">
        {candidates.map((candidate) => (
          <button
            key={candidate.id}
            className={`trade-candidate-card trade-candidate-card--row ${
              selectedTradePlayerId === candidate.id
                ? "trade-candidate-card--selected"
                : ""
            }`}
            onClick={() => onSelectTradeCandidate(candidate.id)}
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
          onClick={onExecuteTrade}
          disabled={!selectedTradePlayerId}
        >
          <span>Execute</span>
          <span>Trade</span>
        </button>
      </div>
    </div>
  );
}

function EmptyPanel() {
  return (
    <div className="row-cell row-cell--trade-area info-panel info-panel--empty">
      <div className="info-panel__placeholder">
        Trade candidates / score area
      </div>
    </div>
  );
}

function TransactionHistoryPanel({
  items = [],
}: {
  items?: TransactionView[];
}) {
  return (
    <div className="row-cell row-cell--history cut-history">
      <div className="cut-history__title">Transactions</div>
      <div className="cut-history__list">
        {items.length === 0 ? (
          <div className="cut-history__empty">None yet</div>
        ) : (
          items.map((item, index) => (
            <div
              key={index}
              className={`cut-card ${
                item.type === "trade" ? "cut-card--trade" : ""
              }`}
            >
              <div className="cut-card__name">{item.text}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RosterRow({ row }: { row: MockRowView }) {
  const tradeMode = row.status === "trading";

  return (
    <div className={`roster-row ${tradeMode ? "roster-row--focus" : ""}`}>
      <HeadshotCell name={row.name} headshotUrl={row.headshotUrl} />

      <IdentityCell name={row.name} position={row.position} team={row.team} />

      <ActionButtons
        disabled={
          row.status === "locked" ||
          row.status === "trading" ||
          row.boardLockedByTrade
        }
        onSign={row.onSign}
        onCut={row.onCut}
        onTrade={row.onTrade}
        canCut={row.canCut}
      />

      {row.status === "locked" && row.score !== null ? (
        <LockedPanel score={row.score} player={row.player} />
      ) : row.status === "trading" ? (
        <TradingPanel
          candidates={row.tradeCandidates}
          selectedTradePlayerId={row.selectedTradePlayerId}
          onSelectTradeCandidate={row.onSelectTradeCandidate}
          onExecuteTrade={row.onExecuteTrade}
        />
      ) : (
        <EmptyPanel />
      )}

      <TransactionHistoryPanel items={row.transactionHistory} />
    </div>
  );
}

function getPuzzleRating(finalScorePct: number | null): string {
  if (finalScorePct === null) return "--";

  if (finalScorePct < 15) return "G-League";
  if (finalScorePct < 35) return "Bench";
  if (finalScorePct < 60) return "Starter";
  if (finalScorePct < 85) return "Superstar";
  return "Legend";
}

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

export default function App() {
  const [state, dispatch] = useReducer(
    (state: ReturnType<typeof buildInitialGameState>, action: Parameters<typeof gameReducer>[1]) =>
      gameReducer(state, action, game),
    game,
    buildInitialGameState,
  );
  const [isHowToOpen, setIsHowToOpen] = useState(false);

  const orderedRows = getOrderedRows(state);
  const puzzleRating = getPuzzleRating(state.finalScorePct);
  const ratingClass = getRatingClass(puzzleRating);

  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <div className="topbar__left">
            <button
              type="button"
              className="how-to-btn"
              onClick={() => setIsHowToOpen(true)}
            >
              How To Play
            </button>
          </div>

          <div className="topbar__center">
            <div className="eyebrow">Like FMK, but Basketball!</div>
            <h1>Cut / Trade / Sign</h1>
          </div>

          <div className="topbar__right">
            <MoveCounter movesRemaining={state.movesRemaining} />
          </div>
        </header>

        <main className="roster-grid">
          {orderedRows.map((row) => {
            const nextOptionExists = Boolean(
              game.positions[row.position]?.options?.[row.optionIndex + 1]
                ?.player,
            );

            const isTradeActive = state.tradeState.activePosition !== null;
            const isActiveTradeRow =
              state.tradeState.activePosition === row.position;

            const currentOptionNode =
              game.positions[row.position]?.options?.[row.optionIndex];

            const tradeCandidates =
              isActiveTradeRow && currentOptionNode?.trades
                ? currentOptionNode.trades.map((player) => ({
                    id: player.id,
                    name: player.name,
                    headshotUrl: player.headshotUrl,
                  }))
                : [];

            const transactionHistory = row.transactionHistory.map(
              (transaction) => {
                if (transaction.type === "cut") {
                  return {
                    type: "cut" as const,
                    text: `Cut ${transaction.playerOut.name}`,
                  };
                }

                return {
                  type: "trade" as const,
                  text: `Traded ${transaction.playerOut.name} for ${transaction.playerIn.name}`,
                };
              },
            );

            const status = row.locked
              ? "locked"
              : isActiveTradeRow
                ? "trading"
                : "default";

            return (
              <RosterRow
                key={row.position}
                row={{
                  position: row.position,
                  name: row.currentPlayer.name,
                  team: row.currentPlayer.team,
                  headshotUrl: row.currentPlayer.headshotUrl,
                  score: row.playerScore,
                  player: row.currentPlayer,
                  status,
                  transactionHistory,
                  onSign: () =>
                    dispatch({ type: "SIGN_PLAYER", position: row.position }),
                  onCut: () =>
                    dispatch({ type: "CUT_PLAYER", position: row.position }),
                  onTrade: () =>
                    dispatch({ type: "START_TRADE", position: row.position }),
                  onSelectTradeCandidate: (playerId: string) =>
                    dispatch({ type: "SELECT_TRADE_CANDIDATE", playerId }),
                  onExecuteTrade: () => dispatch({ type: "EXECUTE_TRADE" }),
                  canCut: !isTradeActive && nextOptionExists,
                  boardLockedByTrade: isTradeActive,
                  tradeCandidates,
                  selectedTradePlayerId: isActiveTradeRow
                    ? state.tradeState.selectedTradePlayerId
                    : null,
                }}
              />
            );
          })}
        </main>

        <footer className="scorebar">
          <div className="scorebar__group">
            <div className="scorebar__label">Final Score</div>
            <div className="scorebar__value">
              {state.finalScore?.toFixed(1) ?? "--"}
            </div>
          </div>

          <div className="scorebar__group">
            <div className="scorebar__label">Puzzle %</div>
            <div className="scorebar__value">
              {state.finalScorePct !== null
                ? `${state.finalScorePct.toFixed(1)}%`
                : "--"}
            </div>
          </div>

          <div className="scorebar__group">
            <div className="scorebar__label">Rating</div>
            <div className={`scorebar__value ${ratingClass}`}>
              {puzzleRating}
            </div>
          </div>

          <div className="scorebar__group">
            <div className="scorebar__label">Range</div>
            <div className="scorebar__value scorebar__value--small">
              {typeof game.worstScore === "number" &&
              typeof game.bestScore === "number"
                ? `${game.worstScore.toFixed(1)} – ${game.bestScore.toFixed(1)}`
                : "--"}
            </div>
          </div>
        </footer>
      </div>

      <HowToPlayModal
        isOpen={isHowToOpen}
        onClose={() => setIsHowToOpen(false)}
      />
    </div>
  );
}
