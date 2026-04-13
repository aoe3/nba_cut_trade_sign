import { useEffect, useMemo, useState } from "react";

import type { GameState, Player, Position, RowState } from "../game/types";

type DailyShareModalProps = {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  state: GameState;
  rating: string;
  ratingClass: string;
};

type BestPlayerResult = {
  player: Player;
  score: number;
};

const POSITION_ORDER: Position[] = ["PG", "SG", "SF", "PF", "C"];

const RATING_EMOJI_MAP: Record<string, string> = {
  "G-League": "🟤",
  Bench: "⚪",
  Starter: "🟡",
  Superstar: "🟣",
  "Hall of Fame": "🔴",
};

function getOrderedRows(state: GameState): RowState[] {
  return POSITION_ORDER.map((position) => state.rows[position]);
}

function getBestPlayer(state: GameState): BestPlayerResult | null {
  const orderedRows = getOrderedRows(state);

  let best: BestPlayerResult | null = null;

  for (const row of orderedRows) {
    const score = row.playerScore;
    if (score === null) {
      continue;
    }

    if (!best || score > best.score) {
      best = {
        player: row.currentPlayer,
        score,
      };
    }
  }

  return best;
}

function getMoveCounts(state: GameState): { cuts: number; trades: number } {
  let cuts = 0;
  let trades = 0;

  for (const row of Object.values(state.rows)) {
    for (const transaction of row.transactionHistory) {
      if (transaction.type === "cut") {
        cuts += 1;
      } else if (transaction.type === "trade") {
        trades += 1;
      }
    }
  }

  return { cuts, trades };
}

function buildShareText(
  date: string,
  rating: string,
  finalScorePct: number | null,
  cuts: number,
  trades: number,
  bestPlayer: BestPlayerResult | null,
): string {
  const ratingEmoji = RATING_EMOJI_MAP[rating] ?? "🏀";
  const pctText =
    finalScorePct !== null ? `${finalScorePct.toFixed(1)}%` : "--";

  const lines = [
    `✂️🤝🖊️ C.T.S. ${date}`,
    `${ratingEmoji} ${rating}: ${pctText} ${ratingEmoji}`,
    `Cuts: ${cuts} | Trades: ${trades}`,
    "",
  ];

  if (bestPlayer) {
    lines.push("Best Player:");
    lines.push(bestPlayer.player.name);
    lines.push(`${bestPlayer.player.position} | ${bestPlayer.player.team}`);
    lines.push(bestPlayer.score.toFixed(1));
    lines.push("");
  }

  lines.push("cuttradesign.com");

  return lines.join("\n");
}

export function DailyShareModal({
  isOpen,
  onClose,
  date,
  state,
  rating,
  ratingClass,
}: DailyShareModalProps) {
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "error">(
    "idle",
  );

  const bestPlayer = useMemo(() => getBestPlayer(state), [state]);
  const { cuts, trades } = useMemo(() => getMoveCounts(state), [state]);

  const shareText = useMemo(
    () =>
      buildShareText(
        date,
        rating,
        state.finalScorePct,
        cuts,
        trades,
        bestPlayer,
      ),
    [bestPlayer, cuts, date, rating, state.finalScorePct, trades],
  );

  useEffect(() => {
    if (!isOpen) {
      setCopyFeedback("idle");
      return;
    }

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

  async function handleShare() {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("error");
    }
  }

  function handleTweet() {
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
    window.open(tweetUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-card modal-card--share"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-share-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close-btn"
          type="button"
          onClick={onClose}
          aria-label="Close share results"
        >
          ×
        </button>

        <div className="modal-content">
          <div className="modal-eyebrow">Daily Complete</div>
          <h2 id="daily-share-title" className="modal-title">
            Share Your Result
          </h2>

          <div className="daily-share-card">
            <div className="daily-share-card__title">C.T.S. {date}</div>
            <div className="daily-share-card__rating-row">
              <span className={`daily-share-card__rating ${ratingClass}`}>
                {rating}
              </span>
              <span className="daily-share-card__rating-separator">:</span>
              <span className="daily-share-card__percent">
                {state.finalScorePct !== null
                  ? `${state.finalScorePct.toFixed(1)}%`
                  : "--"}
              </span>
            </div>

            <div className="daily-share-card__meta">
              Cuts: {cuts} <span aria-hidden="true">|</span> Trades: {trades}
            </div>

            <div className="daily-share-card__best-player-label">
              Best Player
            </div>

            {bestPlayer ? (
              <div className="daily-share-card__best-player">
                <div className="daily-share-card__headshot-wrap">
                  {bestPlayer.player.headshotUrl ? (
                    <img
                      src={bestPlayer.player.headshotUrl}
                      alt={`${bestPlayer.player.name} headshot`}
                      className="daily-share-card__headshot"
                    />
                  ) : (
                    <div className="daily-share-card__headshot-fallback" />
                  )}
                </div>

                <div className="daily-share-card__player-name">
                  {bestPlayer.player.name}
                </div>
                <div className="daily-share-card__player-meta">
                  {bestPlayer.player.position} | {bestPlayer.player.team}
                </div>
                <div className="daily-share-card__player-score">
                  {bestPlayer.score.toFixed(1)}
                </div>
              </div>
            ) : (
              <div className="daily-share-card__empty">
                No locked players yet.
              </div>
            )}
          </div>

          <div className="daily-share-actions">
            <button type="button" className="mode-btn" onClick={handleTweet}>
              Tweet
            </button>

            <button
              type="button"
              className="mode-btn mode-btn--primary"
              onClick={handleShare}
            >
              {copyFeedback === "copied"
                ? "Copied"
                : copyFeedback === "error"
                  ? "Copy Failed"
                  : "Share"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
