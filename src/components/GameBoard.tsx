import type { Dispatch } from "react";

import { scorePlayer } from "../game/scorePlayer";
import { getOrderedRows } from "../game/selectors";
import type {
  DailyGame,
  GameAction,
  GameState,
  Player,
  RowState,
} from "../game/types";
import { PositionRow } from "./PositionRow";

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

type GameBoardProps = {
  game: DailyGame;
  state: GameState;
  dispatch: Dispatch<GameAction>;
};

const JACKPOT_SCORE_MULTIPLIER = 1.1;

function buildRowViewModel(
  game: DailyGame,
  state: GameState,
  row: RowState,
  dispatch: Dispatch<GameAction>,
): PositionRowView {
  const nextOptionExists = Boolean(
    game.positions[row.position]?.options?.[row.optionIndex + 1]?.player,
  );

  const isTradeActive = state.tradeState.activePosition !== null;
  const isActiveTradeRow = state.tradeState.activePosition === row.position;

  const currentOptionNode =
    game.positions[row.position]?.options?.[row.optionIndex];

  const basePlayerScore = scorePlayer(row.currentPlayer);

  const tradeCandidates =
    isActiveTradeRow && currentOptionNode?.trades
      ? currentOptionNode.trades.map((player) => {
          const candidateScore = scorePlayer(player);
          return {
            id: player.id,
            name: player.name,
            headshotUrl: player.headshotUrl,
            isJackpot:
              candidateScore >= basePlayerScore * JACKPOT_SCORE_MULTIPLIER,
          };
        })
      : [];

  const transactionHistory: TransactionView[] = row.transactionHistory.map(
    (transaction) => {
      if (transaction.type === "cut") {
        return {
          type: "cut",
          text: `Cut ${transaction.playerOut.name}`,
        };
      }

      return {
        type: "trade",
        text: `Traded ${transaction.playerOut.name} for ${transaction.playerIn.name}`,
      };
    },
  );

  const status = row.locked
    ? "locked"
    : isActiveTradeRow
      ? "trading"
      : "default";

  return {
    position: row.position,
    name: row.currentPlayer.name,
    team: row.currentPlayer.team,
    headshotUrl: row.currentPlayer.headshotUrl,
    score: row.playerScore,
    player: row.currentPlayer,
    status,
    transactionHistory,
    onSign: () => dispatch({ type: "SIGN_PLAYER", position: row.position }),
    onCut: () => dispatch({ type: "CUT_PLAYER", position: row.position }),
    onTrade: () => dispatch({ type: "START_TRADE", position: row.position }),
    onSelectTradeCandidate: (playerId: string) =>
      dispatch({ type: "SELECT_TRADE_CANDIDATE", playerId }),
    onExecuteTrade: () => dispatch({ type: "EXECUTE_TRADE" }),
    canCut: !isTradeActive && nextOptionExists,
    boardLockedByTrade: isTradeActive,
    tradeCandidates,
    selectedTradePlayerId: isActiveTradeRow
      ? state.tradeState.selectedTradePlayerId
      : null,
  };
}

export function GameBoard({ game, state, dispatch }: GameBoardProps) {
  const orderedRows = getOrderedRows(state);

  return (
    <main className="roster-grid">
      {orderedRows.map((row) => (
        <PositionRow
          key={row.position}
          row={buildRowViewModel(game, state, row, dispatch)}
        />
      ))}
    </main>
  );
}
