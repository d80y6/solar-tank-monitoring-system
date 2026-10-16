import { requireApiUser } from "@/features/auth/lib/auth-guards";
import { buildTankReadings } from "@/features/monitoring/lib/tank-detail-view-model";
import { listMonitoringReadingsForTank } from "@/features/monitoring/lib/monitoring-storage";
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
  const url = new URL(request.url);
  const range = url.searchParams.get("range") ?? "24h";
  const now = new Date();
  const [monitoringReadings, referenceData] = await Promise.all([
    listMonitoringReadingsForTank(tankId),
    getMonitoringReferenceData(),
  ]);

  const readings = buildTankReadings(tankId, {
    now,
    sites: referenceData.sites,
    tanks: referenceData.tanks,
    devices: referenceData.devices,
    readings: monitoringReadings,
  });

  if (readings.length === 0) {
    return Response.json(
      {
        ok: false,
        error: "Tank history not found.",
      },
      { status: 404 },
    );
  }

  return Response.json({
    ok: true,
    data: {
      tankId,
      range,
      items: readings,
    },
  });
}
