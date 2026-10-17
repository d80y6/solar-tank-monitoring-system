import { Buffer } from "node:buffer";

import type { NextRequest } from "next/server";

import { buildAuditCsv } from "@/features/auth/lib/audit-query";
import { requireApiUser } from "@/features/auth/lib/auth-guards";
import { listAuthAuditEventsForExport } from "@/features/auth/lib/mysql-auth-repository";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";
import { withApiObservability } from "@/lib/api-observability";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger({ module: "audit-export" });
const MAX_EXPORT_ROWS = 20_000;
const DEFAULT_EXPORT_ROWS = 5_000;

function formatMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "";
  }

  return JSON.stringify(metadata);
}

function parseRowLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_EXPORT_ROWS;
  }

  return Math.min(parsed, MAX_EXPORT_ROWS);
}

async function handleExport(request: NextRequest): Promise<Response> {
  const auth = await requireApiUser(request, ["admin"]);

  if (!auth.ok) {
    return auth.response;
  }

  if (getMonitoringStorageDriver() !== "mysql") {
    return Response.json(
      {
        error:
          "The audit log is stored in MySQL, which is not the active storage driver in this environment.",
        ok: false,
      },
      { status: 409 },
    );
  }

  const params = request.nextUrl.searchParams;
  const limit = parseRowLimit(params.get("limit"));
  const rows = await listAuthAuditEventsForExport({
    eventType: params.get("eventType"),
    from: params.get("from"),
    limit,
    maxRows: limit,
    offset: 0,
    search: params.get("q"),
    to: params.get("to"),
  });
  const csv = buildAuditCsv(
    rows.map((row) => ({
      actorUserId: row.actorUserId,
      createdAt: row.createdAt,
      eventType: row.eventType,
      metadata: formatMetadata(row.metadata),
      targetUserId: row.targetUserId,
    })),
  );
  const filename = `ftm-audit-${new Date().toISOString().slice(0, 10)}.csv`;

  log.info("audit.export", {
    actorUserId: auth.user.id,
    rowCount: rows.length,
    truncated: rows.length >= limit,
  });

  return new Response(Buffer.from(csv, "utf8"), {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-type": "text/csv; charset=utf-8",
      "x-export-row-count": String(rows.length),
    },
    status: 200,
  });
}

export const GET = withApiObservability("api/admin/audit/export", handleExport);
