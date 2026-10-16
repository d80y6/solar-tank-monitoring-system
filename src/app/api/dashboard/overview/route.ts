import { requireApiUser } from "@/features/auth/lib/auth-guards";
import { buildDashboardOverview } from "@/features/monitoring/lib/dashboard-view-model";
import {
  getScopedLatestReadings,
  getScopedMonitoringReference,
} from "@/features/monitoring/lib/scoped-monitoring-data";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireApiUser(request);

  if (!auth.ok) {
    return auth.response;
  }

  const [monitoringReadingsResult, monitoringReferenceResult] =
    await Promise.all([
      getScopedLatestReadings(auth.user),
      getScopedMonitoringReference(auth.user),
    ]);
  const overview = buildDashboardOverview({
    now: new Date(),
    sites: monitoringReferenceResult.reference.sites,
    tanks: monitoringReferenceResult.reference.tanks,
    devices: monitoringReferenceResult.reference.devices,
    readings: monitoringReadingsResult.readings,
  });

  return Response.json({
    ok: true,
    data: overview,
    meta: {
      access: {
        enforced: monitoringReferenceResult.access.enforced,
        scope: monitoringReferenceResult.access.reason,
        siteCount: monitoringReferenceResult.access.allowedSiteIds?.length ?? null,
      },
      registry: monitoringReferenceResult.source,
      storage: monitoringReadingsResult.source,
    },
  });
}
