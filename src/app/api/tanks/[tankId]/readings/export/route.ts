import { requireApiUser } from "@/features/auth/lib/auth-guards";
import { getMonitoringReferenceData } from "@/features/monitoring/lib/monitoring-registry";
import {
  listMonitoringReadingsForTank,
  listMonitoringReadingsForTankInRange,
} from "@/features/monitoring/lib/monitoring-storage";
import {
  buildReadingExportPeriod,
  createTankReadingsCsv,
  createTankReadingsCsvFilename,
  parseReadingExportRange,
} from "@/features/monitoring/lib/readings-export";
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
  const rangeKey = parseReadingExportRange(
    request.nextUrl.searchParams.get("range"),
  );

  if (rangeKey === null) {
    return Response.json(
      {
        ok: false,
        error: "Unknown export range. Use day, week, or month.",
      },
      { status: 400 },
    );
  }

  const [readings, referenceData] = await Promise.all([
    listMonitoringReadingsForTank(tankId, 1),
    getMonitoringReferenceData(),
  ]);
  const tank = referenceData.tanks.find((item) => item.id === tankId);

  if (!tank) {
    return Response.json(
      {
        ok: false,
        error: "Tank not found.",
      },
      { status: 404 },
    );
  }

  const site = referenceData.sites.find((item) => item.id === tank.siteId);
  const period = buildReadingExportPeriod(readings, rangeKey);
  const periodReadings = await listMonitoringReadingsForTankInRange({
    end: period.end.toISOString(),
    start: period.start.toISOString(),
    tankId,
  });
  const filename = createTankReadingsCsvFilename({
    period,
    siteCode: site?.code,
    tankId: tank.id,
    tankName: tank.name,
  });

  return new Response(
    createTankReadingsCsv(periodReadings, { period, rangeKey }),
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
