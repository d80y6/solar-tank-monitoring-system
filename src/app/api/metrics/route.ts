import type { NextRequest } from "next/server";

import {
  getReadinessCheckToken,
  isProductionLikeEnvironment,
} from "@/features/auth/lib/auth-config";
import { requireApiUser } from "@/features/auth/lib/auth-guards";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";
import { getBuildInfo } from "@/lib/build-info";
import { withApiObservability } from "@/lib/api-observability";
import {
  metrics,
  toPrometheusText,
  type MetricFamilySnapshot,
} from "@/lib/metrics";
import { hasValidOpsToken } from "@/lib/ops-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function buildRuntimeFamilies(): MetricFamilySnapshot[] {
  const memory = process.memoryUsage();

  return [
    {
      name: "solar_tank_process_uptime_seconds",
      help: "Process uptime in seconds.",
      type: "gauge",
      samples: [
        {
          name: "solar_tank_process_uptime_seconds",
          labels: {},
          value: Math.round(process.uptime()),
        },
      ],
    },
    {
      name: "solar_tank_process_resident_memory_bytes",
      help: "Resident memory size in bytes.",
      type: "gauge",
      samples: [
        {
          name: "solar_tank_process_resident_memory_bytes",
          labels: {},
          value: memory.rss,
        },
      ],
    },
    {
      name: "solar_tank_process_heap_used_bytes",
      help: "V8 heap used in bytes.",
      type: "gauge",
      samples: [
        {
          name: "solar_tank_process_heap_used_bytes",
          labels: {},
          value: memory.heapUsed,
        },
      ],
    },
    {
      name: "solar_tank_build_info",
      help: "Application build identity.",
      type: "gauge",
      samples: [
        {
          name: "solar_tank_build_info",
          labels: {
            version: getBuildInfo().version,
            commit: getBuildInfo().commitSha?.slice(0, 12) ?? "unknown",
            environment: getBuildInfo().environment,
          },
          value: 1,
        },
      ],
    },
    {
      name: "solar_tank_storage_driver_info",
      help: "Active monitoring storage driver.",
      type: "gauge",
      samples: [
        {
          name: "solar_tank_storage_driver_info",
          labels: { driver: getMonitoringStorageDriver() },
          value: 1,
        },
      ],
    },
  ];
}

async function authorizeMetrics(request: NextRequest): Promise<Response | null> {
  if (
    hasValidOpsToken({
      expectedToken: process.env.OPS_METRICS_TOKEN,
      fallbackToken: getReadinessCheckToken(),
      headers: request.headers,
    })
  ) {
    return null;
  }

  if (
    !isProductionLikeEnvironment() &&
    !process.env.OPS_METRICS_TOKEN?.trim()
  ) {
    return null;
  }

  const auth = await requireApiUser(request, ["admin"]);

  if (auth.ok) {
    return null;
  }

  return Response.json(
    { ok: false, error: "Metrics are only available to operators." },
    { status: 401 },
  );
}

export const GET = withApiObservability(
  "/api/metrics",
  async (request: NextRequest) => {
    const unauthorized = await authorizeMetrics(request);

    if (unauthorized) {
      return unauthorized;
    }

    const body = toPrometheusText([
      ...metrics.snapshot(),
      ...buildRuntimeFamilies(),
    ]);

    return new Response(body, {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
      },
      status: 200,
    });
  },
);
