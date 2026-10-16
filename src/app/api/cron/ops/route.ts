import type { NextRequest } from "next/server";

import { getReadinessCheckToken } from "@/features/auth/lib/auth-config";
import { evaluateOperationalAlerts } from "@/features/ops/lib/alert-service";
import { runOperationalHousekeeping } from "@/features/ops/lib/housekeeping";
import { recordOpsJobRunInMysql } from "@/features/ops/lib/mysql-alert-repository";
import { getOpsConfig } from "@/features/ops/lib/ops-config";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";
import { withApiObservability } from "@/lib/api-observability";
import { createLogger } from "@/lib/logger";
import { hasValidOpsToken } from "@/lib/ops-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const log = createLogger({ module: "ops-cron" });

const SUPPORTED_TASKS = ["alerts", "housekeeping"] as const;

type SupportedTask = (typeof SUPPORTED_TASKS)[number];

function getCronSecrets(): string[] {
  return [
    process.env.OPS_CRON_SECRET?.trim() ?? "",
    process.env.CRON_SECRET?.trim() ?? "",
    getReadinessCheckToken() ?? "",
  ].filter(Boolean);
}

function isAuthorized(request: NextRequest): boolean {
  const secrets = getCronSecrets();

  if (secrets.length === 0) {
    // No secret configured: allow only outside production so a local operator
    // can trigger a manual run, and refuse in production-like environments.
    return (
      process.env.NODE_ENV !== "production" &&
      process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase() !== "production"
    );
  }

  return secrets.some((secret) =>
    hasValidOpsToken({ expectedToken: secret, headers: request.headers }),
  );
}

function parseTasks(request: NextRequest): SupportedTask[] | null {
  const raw = request.nextUrl.searchParams.get("tasks");

  if (!raw) {
    return [...SUPPORTED_TASKS];
  }

  const requested = raw
    .split(",")
    .map((task) => task.trim().toLowerCase())
    .filter(Boolean);
  const tasks = requested.filter((task): task is SupportedTask =>
    (SUPPORTED_TASKS as readonly string[]).includes(task),
  );

  return tasks.length > 0 ? tasks : null;
}

async function runTask<T>({
  jobKey,
  task,
}: {
  jobKey: string;
  task: () => Promise<T>;
}): Promise<T> {
  const startedAt = new Date();
  const startedAtMs = performance.now();

  try {
    const result = await task();
    const durationMs = performance.now() - startedAtMs;

    if (getMonitoringStorageDriver() === "mysql") {
      await recordOpsJobRunInMysql({
        detail: result as Record<string, unknown>,
        durationMs,
        jobKey,
        startedAt,
        status: "succeeded",
      }).catch(() => undefined);
    }

    return result;
  } catch (error) {
    const durationMs = performance.now() - startedAtMs;

    if (getMonitoringStorageDriver() === "mysql") {
      await recordOpsJobRunInMysql({
        durationMs,
        errorMessage: error instanceof Error ? error.message : String(error),
        jobKey,
        startedAt,
        status: "failed",
      }).catch(() => undefined);
    }

    throw error;
  }
}

export const GET = withApiObservability(
  "/api/cron/ops",
  async (request: NextRequest) => {
    if (!isAuthorized(request)) {
      return Response.json(
        { ok: false, error: "Operational scheduler access is required." },
        { status: 401 },
      );
    }

    const tasks = parseTasks(request);

    if (!tasks) {
      return Response.json(
        {
          ok: false,
          error: `Unknown task requested. Supported tasks: ${SUPPORTED_TASKS.join(", ")}.`,
        },
        { status: 400 },
      );
    }

    const config = getOpsConfig();
    const results: Record<string, unknown> = {};

    for (const task of tasks) {
      if (task === "alerts") {
        results.alerts = await runTask({
          jobKey: "ops.alerts",
          task: () => evaluateOperationalAlerts({ config }),
        });
        continue;
      }

      results.housekeeping = await runTask({
        jobKey: "ops.housekeeping",
        task: () => runOperationalHousekeeping({ config }),
      });
    }

    const failures = Object.values(results).filter(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        "skipped" in value &&
        (value as { skipped?: string }).skipped !== "memory-storage",
    );

    log.info("ops.cron.completed", {
      storage: getMonitoringStorageDriver(),
      tasks,
    });

    return Response.json({
      ok: true,
      data: {
        evaluatedTasks: tasks,
        results,
        storage: getMonitoringStorageDriver(),
      },
      failures: failures.length,
    });
  },
);

export const POST = GET;
