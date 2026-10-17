import type { NextRequest } from "next/server";

import {
  getReadinessCheckToken,
  isProductionLikeEnvironment,
} from "@/features/auth/lib/auth-config";
import { requireApiUser } from "@/features/auth/lib/auth-guards";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";
import { withApiObservability } from "@/lib/api-observability";
import { metrics, toPrometheusText, type MetricFamilySnapshot } from "@/lib/metrics";
import {
  buildProcessMetricFamilies,
  startEventLoopLagMonitor,
} from "@/lib/process-metrics";
import { hasValidOpsToken } from "@/lib/ops-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function buildRuntimeFamilies(): MetricFamilySnapshot[] {
  startEventLoopLagMonitor();

  return [
    ...buildProcessMetricFamilies(),
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
