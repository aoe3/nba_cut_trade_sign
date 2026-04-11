import type { DailyGame } from "../game/types";
import type { BeatTheScoreSolution } from "../pages/beatTheScore/solveBeatTheScore";

type StatusCallback = (status: string) => void;

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

/**
 * Generates a task identifier so responses can be matched to the originating request.
 */
function createTaskId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Creates a fresh worker instance for a single long-running build or solve task.
 */
function createWorker(): Worker {
  return new Worker(new URL("./gameBuildWorker.ts", import.meta.url), {
    type: "module",
  });
}

/**
 * Runs a worker task and forwards status updates to the loading overlay.
 */
function runWorkerTask<TResult>(
  request: WorkerRequest,
  onStatus?: StatusCallback,
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;

      if (response.taskId !== request.taskId) {
        return;
      }

      if (response.type === "status") {
        onStatus?.(response.status);
        return;
      }

      if (response.type === "error") {
        worker.terminate();
        reject(new Error(response.message));
        return;
      }

      worker.terminate();

      if (response.resultType === "build-forever-game") {
        resolve(response.game as TResult);
        return;
      }

      resolve(response.solution as TResult);
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Worker execution failed."));
    };

    worker.postMessage(request);
  });
}

/**
 * Builds a new Forever puzzle without blocking the UI thread.
 */
export function buildForeverGameInWorker(
  onStatus?: StatusCallback,
): Promise<DailyGame> {
  return runWorkerTask<DailyGame>(
    {
      taskId: createTaskId(),
      type: "build-forever-game",
    },
    onStatus,
  );
}

/**
 * Solves a puzzle for CPU-driven modes without blocking the UI thread.
 */
export function solveBeatTheScoreInWorker(
  game: DailyGame,
  onStatus?: StatusCallback,
): Promise<BeatTheScoreSolution> {
  return runWorkerTask<BeatTheScoreSolution>(
    {
      taskId: createTaskId(),
      type: "solve-beat-the-score",
      game,
    },
    onStatus,
  );
}
