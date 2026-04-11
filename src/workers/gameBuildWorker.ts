import type { DailyGame } from "../game/types";
import { createForeverModeGame } from "../pages/forever/createForeverModeGame";
import { solveBeatTheScore, type BeatTheScoreSolution } from "../pages/beatTheScore/solveBeatTheScore";

type BuildForeverGameRequest = {
  taskId: string;
  type: "build-forever-game";
};

type SolveBeatTheScoreRequest = {
  taskId: string;
  type: "solve-beat-the-score";
  game: DailyGame;
};

type WorkerRequest = BuildForeverGameRequest | SolveBeatTheScoreRequest;

type StatusResponse = {
  taskId: string;
  type: "status";
  status: string;
};

type BuildForeverGameSuccessResponse = {
  taskId: string;
  type: "success";
  resultType: "build-forever-game";
  game: DailyGame;
};

type SolveBeatTheScoreSuccessResponse = {
  taskId: string;
  type: "success";
  resultType: "solve-beat-the-score";
  solution: BeatTheScoreSolution;
};

type ErrorResponse = {
  taskId: string;
  type: "error";
  message: string;
};

type WorkerResponse =
  | StatusResponse
  | BuildForeverGameSuccessResponse
  | SolveBeatTheScoreSuccessResponse
  | ErrorResponse;

const workerScope = self as typeof globalThis & {
  postMessage: (message: WorkerResponse) => void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

/**
 * Sends a typed response back to the main thread.
 */
function postResponse(message: WorkerResponse) {
  workerScope.postMessage(message);
}

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    if (request.type === "build-forever-game") {
      const game = await createForeverModeGame((status) => {
        postResponse({
          taskId: request.taskId,
          type: "status",
          status,
        });
      });

      postResponse({
        taskId: request.taskId,
        type: "success",
        resultType: "build-forever-game",
        game,
      });
      return;
    }

    postResponse({
      taskId: request.taskId,
      type: "status",
      status: "Solving CPU opponent from the current puzzle…",
    });

    const solution = await solveBeatTheScore(request.game);
    postResponse({
      taskId: request.taskId,
      type: "success",
      resultType: "solve-beat-the-score",
      solution,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error.";
    postResponse({
      taskId: request.taskId,
      type: "error",
      message,
    });
  }
};

export {};
