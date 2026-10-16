import {
  getLocalDeviceKey,
  ingestTelemetry,
} from "@/features/monitoring/lib/ingest-telemetry";
import { checkRateLimit } from "@/features/auth/lib/rate-limit";
import {
  getExpectedProvisioningKey,
  isDeviceAutoProvisioningEnabled,
} from "@/features/monitoring/lib/device-provisioning";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getClientAddress(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwardedFor ||
    headers.get("x-real-ip")?.trim() ||
    headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

async function checkIngestRateLimit(request: Request): Promise<Response | null> {
  if (getMonitoringStorageDriver() !== "mysql") {
    return null;
  }

  const deviceIdentifier =
    request.headers.get("x-device-id")?.trim() || "unknown-device";
  const clientAddress = getClientAddress(request.headers);
  const rateLimit = await checkRateLimit({
    key: `ingest:${deviceIdentifier}:${clientAddress}`,
    limit: 120,
    windowMs: 60_000,
  });

  if (rateLimit.allowed) {
    return null;
  }

  return Response.json(
    {
      ok: false,
      error: "Too many device requests. Try again shortly.",
    },
    {
      headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      status: 429,
    },
  );
}

export async function POST(request: Request) {
  const rateLimitResponse = await checkIngestRateLimit(request);

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Request body must be valid JSON.",
      },
      { status: 400 },
    );
  }

  const result = await ingestTelemetry({
    deviceIdentifier: request.headers.get("x-device-id"),
    deviceKey:
      request.headers.get("x-api-key") ?? request.headers.get("x-device-key"),
    provisioningKey: request.headers.get("x-provisioning-key"),
    expectedDeviceKey: getLocalDeviceKey(),
    expectedProvisioningKey: getExpectedProvisioningKey(),
    allowDeviceAutoProvisioning: isDeviceAutoProvisioningEnabled(),
    payload,
  });

  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        error: result.error,
      },
      { status: result.status },
    );
  }

  return Response.json(
    {
      ok: true,
      data: result.data,
    },
    { status: result.status },
  );
}
