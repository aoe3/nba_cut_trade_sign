import type { Player } from "../game/types";
import { ActionButtons } from "./ActionButtons";
import { CutHistory } from "./CutHistory";
import { HeadshotCell, IdentityCell } from "./PlayerCard";
import { EmptyPanel, LockedPanel, TradingPanel } from "./TradePanel";

type Position = "PG" | "SG" | "SF" | "PF" | "C";

type TradeCandidateView = {
  id: string;
  name: string;
  headshotUrl?: string;
  isJackpot?: boolean;
};

type TransactionView =
  | { type: "cut"; text: string }
  | { type: "trade"; text: string };

type PositionRowView = {
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

type PositionRowProps = {
  row: PositionRowView;
};

export function PositionRow({ row }: PositionRowProps) {
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

      <CutHistory items={row.transactionHistory} />
    </div>
  );
}
