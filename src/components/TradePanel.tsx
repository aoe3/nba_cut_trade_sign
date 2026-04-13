import type { Player } from "../game/types";

type TradeCandidateView = {
  id: string;
  name: string;
  headshotUrl?: string;
  isJackpot?: boolean;
};

type LockedPanelProps = {
  score: number;
  player: Player;
};

type TradingPanelProps = {
  candidates?: TradeCandidateView[];
  selectedTradePlayerId?: string | null;
  onSelectTradeCandidate: (playerId: string) => void;
  onExecuteTrade: () => void;
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

export function LockedPanel({ score, player }: LockedPanelProps) {
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

export function TradingPanel({
  candidates = [],
  selectedTradePlayerId,
  onSelectTradeCandidate,
  onExecuteTrade,
}: TradingPanelProps) {
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
            } ${candidate.isJackpot ? "trade-candidate-card--jackpot" : ""}`}
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

export function EmptyPanel() {
  return (
    <div className="row-cell row-cell--trade-area info-panel info-panel--empty">
      <div className="info-panel__placeholder">
        Locked stats or trade offers appear here
      </div>
    </div>
  );
}
