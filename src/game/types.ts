export type Position = "PG" | "SG" | "SF" | "PF" | "C";

export type Player = {
  id: string;
  nbaPlayerId: number;
  name: string;
  team: string;
  position: Position;
  age: number;
  bpm: number;
  salary: number;
  gamesPlayed: number;
  teamGamesPlayed: number;
  isRookie: boolean;
  headshotUrl?: string;
  per: number;
  ws48: number;
  usgPct: number;
  durability?: number;
  minutesPlayed?: number;
  minutesPerGame?: number;
  minuteShareOfTeam?: number;
  activeMinuteShare?: number;

  ppg?: number;
  rpg?: number;
  apg?: number;
  spg?: number;
  bpg?: number;
  fgPct?: number;
  threePct?: number;
  ftPct?: number;
};

export type OptionNode = {
  player: Player;
  trades: [Player, Player, Player] | Player[];
};

export type PositionBucket = {
  options:
    | [OptionNode, OptionNode, OptionNode, OptionNode, OptionNode, OptionNode]
    | OptionNode[];
};

export type DailyGame = {
  date: string;
  salaryCap: number;
  bestScore?: number;
  worstScore?: number;
  solutionSpread?: number;
  terminalCount?: number;
  uniqueStateCount?: number;
  positions: Record<Position, PositionBucket>;
};

export type LockedReason = "sign" | "trade" | "auto" | null;

export type Transaction =
  | {
      type: "cut";
      playerOut: Player;
    }
  | {
      type: "trade";
      playerOut: Player;
      playerIn: Player;
    };

export type RowState = {
  position: Position;
  optionIndex: number;
  currentPlayer: Player;
  locked: boolean;
  lockedReason: LockedReason;
  playerScore: number | null;
  transactionHistory: Transaction[];
};

export type TradeState = {
  activePosition: Position | null;
  selectedTradePlayerId: string | null;
};

export type GameState = {
  rows: Record<Position, RowState>;
  movesRemaining: number;
  tradeState: TradeState;
  finalScore: number | null;
  finalScorePct: number | null;
  gameOver: boolean;
};

export type GameAction =
  | { type: "SIGN_PLAYER"; position: Position }
  | { type: "CUT_PLAYER"; position: Position }
  | { type: "START_TRADE"; position: Position }
  | { type: "SELECT_TRADE_CANDIDATE"; playerId: string }
  | { type: "EXECUTE_TRADE" }
  | { type: "NO_OP" };