import { NextResponse } from "next/server";

import { downloadDevicePackageByTokenFromMysql } from "@/features/monitoring/lib/mysql-device-request-repository";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";

export const runtime = "nodejs";

function sanitizeAttachmentFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 180) || "solartank-device-firmware.zip"
  );
}

function createErrorResponse(message: string, status: number) {
  return NextResponse.json(
    {
      error: message,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
      status,
    },
  );
}

export async function GET(request: Request) {
  if (getMonitoringStorageDriver() !== "mysql") {
    return createErrorResponse(
      "Firmware download requires MySQL storage.",
      503,
    );
  }

  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = await downloadDevicePackageByTokenFromMysql(token);

  if (!result.ok) {
    return createErrorResponse(result.message, result.status);
  }

  const filename = sanitizeAttachmentFilename(result.filename);

  return new NextResponse(new Blob([new Uint8Array(result.content)]), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": result.contentType,
      "X-Content-Type-Options": "nosniff",
    },
    status: 200,
  });
}
