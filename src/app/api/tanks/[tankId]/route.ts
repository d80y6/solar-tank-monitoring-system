import { requireApiUser } from "@/features/auth/lib/auth-guards";
import { mergeMonitoringReadingsById } from "@/features/monitoring/lib/latest-reading";
import { buildTankDetail } from "@/features/monitoring/lib/tank-detail-view-model";
import {
  listLatestMonitoringReadingsByTankWithSource,
  listMonitoringReadingsForTank,
} from "@/features/monitoring/lib/monitoring-storage";
import { getMonitoringReferenceData } from "@/features/monitoring/lib/monitoring-registry";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tankId: string }> },
) {
  const auth = await requireApiUser(request);

  if (!auth.ok) {
    return auth.response;
  }

  const { tankId } = await params;
  const now = new Date();
  const [latestReadingsResult, readings, referenceData] = await Promise.all([
    listLatestMonitoringReadingsByTankWithSource(),
    listMonitoringReadingsForTank(tankId),
    getMonitoringReferenceData(),
  ]);
  const detail = buildTankDetail(tankId, {
    now,
    sites: referenceData.sites,
    tanks: referenceData.tanks,
    devices: referenceData.devices,
    readings: mergeMonitoringReadingsById(
      latestReadingsResult.readings,
      readings,
    ),
  });

  if (!detail) {
    return Response.json(
      {
        ok: false,
        error: "Tank not found.",
      },
      { status: 404 },
    );
  }

  return Response.json({
    ok: true,
    data: detail,
  });
}
