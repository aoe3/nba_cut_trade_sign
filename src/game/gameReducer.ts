import { scorePlayer } from "./scorePlayer";
import { scoreRoster } from "./scoreRoster";

import type {
  DailyGame,
  GameAction,
  GameState,
  Position,
  RowState,
} from "./types";

const POSITIONS: Position[] = ["PG", "SG", "SF", "PF", "C"];

/**
 * Restricts a numeric value to a bounded range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Checks whether the current board has been fully resolved.
 */
function areAllRowsLocked(rows: Record<Position, RowState>): boolean {
  return POSITIONS.every((position) => rows[position].locked);
}

/**
 * Auto-locks unresolved rows when the move budget reaches zero.
 */
function autoLockRemainingRows(rows: Record<Position, RowState>): Record<Position, RowState> {
  const nextRows = { ...rows };

  for (const position of POSITIONS) {
    const row = nextRows[position];
    if (!row.locked) {
      nextRows[position] = {
        ...row,
        locked: true,
        lockedReason: "auto",
        playerScore: scorePlayer(row.currentPlayer),
      };
    }
  }

  return nextRows;
}

/**
 * Converts a raw score into a puzzle-relative percentage using the published best and worst paths.
 */
function getNormalizedScorePercent(
  game: DailyGame | undefined,
  rawScore: number | null,
): number | null {
  if (!game || rawScore === null) {
    return null;
  }

  const best = game.bestScore;
  const worst = game.worstScore;

  if (
    typeof best !== "number" ||
    typeof worst !== "number" ||
    !Number.isFinite(best) ||
    !Number.isFinite(worst)
  ) {
    return null;
  }

  if (best <= worst) {
    return rawScore >= best ? 100 : 0;
  }

  const ratio = (rawScore - worst) / (best - worst);
  return Number((clamp(ratio, 0, 1) * 100).toFixed(1));
}

/**
 * Recomputes board-level score fields after any state transition.
 */
function finalizeState(
  nextState: GameState,
  currentGame: DailyGame | undefined,
): GameState {
  const finalScore = scoreRoster(nextState);

  return {
    ...nextState,
    finalScore,
    finalScorePct: getNormalizedScorePercent(currentGame, finalScore),
  };
}

/**
 * Creates the starting board state from the first option at each position.
 */
export function buildInitialGameState(game: DailyGame): GameState {
  const rows = POSITIONS.reduce<Record<Position, RowState>>((acc, position) => {
    const firstOption = game.positions[position]?.options?.[0];

    if (!firstOption?.player) {
      throw new Error(`Missing initial player for ${position}`);
    }

    acc[position] = {
      position,
      optionIndex: 0,
      currentPlayer: firstOption.player,
      locked: false,
      lockedReason: null,
      playerScore: null,
      transactionHistory: [],
    };

    return acc;
  }, {} as Record<Position, RowState>);

  return {
    rows,
    movesRemaining: 5,
    tradeState: {
      activePosition: null,
      selectedTradePlayerId: null,
    },
    finalScore: null,
    finalScorePct: null,
    gameOver: false,
  };
}

/**
 * Applies a single player action to the current board using the active puzzle data.
 */
export function gameReducer(
  state: GameState,
  action: GameAction,
  currentGame: DailyGame,
): GameState {

  switch (action.type) {
    case "SIGN_PLAYER": {
      const row = state.rows[action.position];

      if (!row || row.locked || state.gameOver) {
        return state;
      }

      const updatedRows = {
        ...state.rows,
        [action.position]: {
          ...row,
          locked: true,
          lockedReason: "sign",
          playerScore: scorePlayer(row.currentPlayer),
        },
      };

      const nextState = {
        ...state,
        rows: updatedRows,
        gameOver: areAllRowsLocked(updatedRows),
      };

      return finalizeState(nextState, currentGame);
    }

    case "CUT_PLAYER": {
      const row = state.rows[action.position];

      if (!row || row.locked || state.gameOver || state.movesRemaining <= 0) {
        return state;
      }

      if (!currentGame) {
        return state;
      }

      const nextOptionIndex = row.optionIndex + 1;
      const nextOptionNode =
        currentGame.positions[action.position]?.options?.[nextOptionIndex];

      if (!nextOptionNode?.player) {
        return state;
      }

      const updatedRow: RowState = {
        ...row,
        optionIndex: nextOptionIndex,
        currentPlayer: nextOptionNode.player,
        playerScore: null,
        transactionHistory: [
          ...row.transactionHistory,
          {
            type: "cut",
            playerOut: row.currentPlayer,
          },
        ],
      };

      let updatedRows = {
        ...state.rows,
        [action.position]: updatedRow,
      };

      const nextMovesRemaining = state.movesRemaining - 1;

      if (nextMovesRemaining === 0) {
        updatedRows = autoLockRemainingRows(updatedRows);
      }

      const nextState = {
        ...state,
        rows: updatedRows,
        movesRemaining: nextMovesRemaining,
        gameOver: nextMovesRemaining === 0 || areAllRowsLocked(updatedRows),
      };

      return finalizeState(nextState, currentGame);
    }

    case "START_TRADE": {
      const row = state.rows[action.position];

      if (
        !row ||
        row.locked ||
        state.gameOver ||
        state.movesRemaining <= 0 ||
        state.tradeState.activePosition !== null
      ) {
        return state;
      }

      return {
        ...state,
        tradeState: {
          activePosition: action.position,
          selectedTradePlayerId: null,
        },
      };
    }

    case "SELECT_TRADE_CANDIDATE": {
      if (state.tradeState.activePosition === null || state.gameOver) {
        return state;
      }

      const alreadySelected =
        state.tradeState.selectedTradePlayerId === action.playerId;

      return {
        ...state,
        tradeState: {
          ...state.tradeState,
          selectedTradePlayerId: alreadySelected ? null : action.playerId,
        },
      };
    }

    case "EXECUTE_TRADE": {
      const activePosition = state.tradeState.activePosition;
      const selectedTradePlayerId = state.tradeState.selectedTradePlayerId;

      if (
        activePosition === null ||
        selectedTradePlayerId === null ||
        state.gameOver ||
        state.movesRemaining <= 0
      ) {
        return state;
      }

      if (!currentGame) {
        return state;
      }

      const row = state.rows[activePosition];
      if (!row || row.locked) {
        return state;
      }

      const optionNode =
        currentGame.positions[activePosition]?.options?.[row.optionIndex];

      const selectedTradePlayer = optionNode?.trades?.find(
        (player) => player.id === selectedTradePlayerId,
      );

      if (!selectedTradePlayer) {
        return state;
      }

      let updatedRows = {
        ...state.rows,
        [activePosition]: {
          ...row,
          currentPlayer: selectedTradePlayer,
          locked: true,
          lockedReason: "trade",
          playerScore: scorePlayer(selectedTradePlayer),
          transactionHistory: [
            ...row.transactionHistory,
            {
              type: "trade",
              playerOut: row.currentPlayer,
              playerIn: selectedTradePlayer,
            },
          ],
        },
      };

      const nextMovesRemaining = state.movesRemaining - 1;

      if (nextMovesRemaining === 0) {
        updatedRows = autoLockRemainingRows(updatedRows);
      }

      const nextState = {
        ...state,
        rows: updatedRows,
        movesRemaining: nextMovesRemaining,
        tradeState: {
          activePosition: null,
          selectedTradePlayerId: null,
        },
        gameOver: nextMovesRemaining === 0 || areAllRowsLocked(updatedRows),
      };

      return finalizeState(nextState, currentGame);
    }

    case "NO_OP":
      return state;

    default:
      return state;
  }
}