import type { DailyGame } from "../../game/types";
import { generateForeverGame } from "./buildForeverGame";
import { solveForeverGame } from "./solveForeverGame";

type StatusCallback = (status: string) => void;

export async function createForeverModeGame(
  onStatus?: StatusCallback,
): Promise<DailyGame> {
  onStatus?.("Generating a fresh puzzle from players.json…");
  const generatedGame = await generateForeverGame(onStatus);

  onStatus?.("Running the solver to find best and worst outcomes…");
  const solved = await solveForeverGame(generatedGame, onStatus);

  onStatus?.("Publishing the generated Forever game…");

  return {
    ...generatedGame,
    bestScore: solved.bestScore,
    worstScore: solved.worstScore,
    solutionSpread: solved.spread,
    terminalCount: solved.terminalCount,
    uniqueStateCount: solved.uniqueStateCount,
  };
}