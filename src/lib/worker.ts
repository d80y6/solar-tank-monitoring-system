import { createLogger } from "./logger";
import { metricNames, metrics } from "./metrics";

const log = createLogger({ module: "worker" });

export type WorkerTaskResult = {
  task: string;
  ok: boolean;
  detail?: Record<string, unknown>;
  error?: string;
};

/**
 * Runs a named scheduled/background task with metrics, structured logging,
 * and failure isolation: one failing task never prevents the others from
 * running.
 */
export async function runWorkerTask(
  task: string,
  work: () => Promise<Record<string, unknown> | void>,
): Promise<WorkerTaskResult> {
  const startedAt = performance.now();

  try {
    const detail = await work();
    const durationSeconds = (performance.now() - startedAt) / 1_000;
    const labels = { task, outcome: "success" };

    metrics.incrementCounter({
      name: metricNames.jobRuns,
      help: "Background job executions grouped by task and outcome.",
      labels,
    });
    metrics.observeHistogram({
      name: metricNames.jobDuration,
      help: "Background job duration in seconds.",
      labels: { task },
      value: durationSeconds,
    });
    log.info("worker.task.completed", {
      durationMs: Math.round(durationSeconds * 1_000),
      task,
      ...detail,
    });

    return { detail: detail ?? undefined, ok: true, task };
  } catch (error) {
    const durationSeconds = (performance.now() - startedAt) / 1_000;

    metrics.incrementCounter({
      name: metricNames.jobRuns,
      help: "Background job executions grouped by task and outcome.",
      labels: { task, outcome: "failure" },
    });
    metrics.observeHistogram({
      name: metricNames.jobDuration,
      help: "Background job duration in seconds.",
      labels: { task },
      value: durationSeconds,
    });

    const message = error instanceof Error ? error.message : String(error);

    log.error("worker.task.failed", { durationMs: Math.round(durationSeconds * 1_000), task, error });

    return { error: message, ok: false, task };
  }
}
