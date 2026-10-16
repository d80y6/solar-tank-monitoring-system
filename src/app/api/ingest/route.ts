import { checkRateLimit } from "@/features/auth/lib/rate-limit";
import {
  getExpectedProvisioningKey,
  isDeviceAutoProvisioningEnabled,
} from "@/features/monitoring/lib/device-provisioning";
import {
  getLocalDeviceKey,
  ingestTelemetry,
} from "@/features/monitoring/lib/ingest-telemetry";
import {
  recordMonitoringIngestEvent,
} from "@/features/monitoring/lib/mysql-ingest-event-repository";
import { touchMonitoringDeviceLastSeenInMysql } from "@/features/monitoring/lib/mysql-device-key-repository";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";
import { getRequestIpAddress, withApiObservability } from "@/lib/api-observability";
import { reportError } from "@/lib/error-tracker";
import {
  getActiveRequestId,
  getRequestContext,
} from "@/lib/request-context";
import { metricNames, metrics } from "@/lib/metrics";
import {
  getIngestRateLimitPerMinute,
  getMaxIngestBodyBytes,
} from "@/features/monitoring/lib/ingest-limits";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getDeviceIdentifier(request: NextRequest): string {
  return request.headers.get("x-device-id")?.trim() || "unknown-device";
}

function jsonError({
  error,
  requestId,
  status,
  retryAfterSeconds,
}: {
  error: string;
  requestId?: string;
  status: number;
  retryAfterSeconds?: number;
}) {
  return Response.json(
    {
      ok: false,
      error,
      ...(requestId ? { requestId } : {}),
    },
    {
      headers: {
        ...(requestId ? { "x-request-id": requestId } : {}),
        ...(retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : {}),
      },
      status,
    },
  );
}

async function checkIngestRateLimit(
  request: NextRequest,
): Promise<Response | null> {
  const deviceIdentifier = getDeviceIdentifier(request);
  const clientAddress = getRequestIpAddress(request.headers);
  const rateLimit = await checkRateLimit({
    key: `ingest:${deviceIdentifier}:${clientAddress}`,
    limit: getIngestRateLimitPerMinute(),
    windowMs: 60_000,
  });

  if (rateLimit.allowed) {
    return null;
  }

  metrics.incrementCounter({
    name: metricNames.ingestRejections,
    help: "Rejected telemetry requests grouped by reason.",
    labels: { reason: "rate_limited" },
  });

  void recordMonitoringIngestEvent({
    deviceIdentifier,
    eventType: "ingest_rate_limited",
    ipAddress: clientAddress,
    requestId: getActiveRequestId(),
    responseStatus: 429,
  });

  return jsonError({
    error: "Too many device requests. Try again shortly.",
    requestId: getActiveRequestId(),
    retryAfterSeconds: rateLimit.retryAfterSeconds,
    status: 429,
  });
}

async function readJsonBody(
  request: NextRequest,
): Promise<
  | { ok: true; payload: unknown; rawBody: string }
  | { ok: false; response: Response }
> {
  const maxBytes = getMaxIngestBodyBytes();
  const declaredLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return {
      ok: false,
      response: jsonError({
        error: `Request body must not exceed ${maxBytes} bytes.`,
        requestId: getActiveRequestId(),
        status: 413,
      }),
    };
  }

  let rawBody: string;

  try {
    rawBody = await request.text();
  } catch {
    return {
      ok: false,
      response: jsonError({
        error: "Request body could not be read.",
        requestId: getActiveRequestId(),
        status: 400,
      }),
    };
  }

  if (new TextEncoder().encode(rawBody).byteLength > maxBytes) {
    return {
      ok: false,
      response: jsonError({
        error: `Request body must not exceed ${maxBytes} bytes.`,
        requestId: getActiveRequestId(),
        status: 413,
      }),
    };
  }

  try {
    return { ok: true, payload: JSON.parse(rawBody), rawBody };
  } catch {
    return {
      ok: false,
      response: jsonError({
        error: "Request body must be valid JSON.",
        requestId: getActiveRequestId(),
        status: 400,
      }),
    };
  }
}

export const POST = withApiObservability(
  "/api/ingest",
  async (request: NextRequest) => {
    const rateLimitResponse = await checkIngestRateLimit(request);

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const bodyResult = await readJsonBody(request);

    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const deviceIdentifier = getDeviceIdentifier(request);
    const requestId = getActiveRequestId();
    const storage = getMonitoringStorageDriver();

    let result: Awaited<ReturnType<typeof ingestTelemetry>>;

    try {
      result = await ingestTelemetry({
        headers: request.headers,
        rawBody: bodyResult.rawBody,
        deviceIdentifier: request.headers.get("x-device-id"),
        deviceKey:
          request.headers.get("x-api-key") ?? request.headers.get("x-device-key"),
        provisioningKey: request.headers.get("x-provisioning-key"),
        expectedDeviceKey: getLocalDeviceKey(),
        expectedProvisioningKey: getExpectedProvisioningKey(),
        allowDeviceAutoProvisioning: isDeviceAutoProvisioningEnabled(),
        payload: bodyResult.payload,
      });
    } catch (error) {
      reportError({
        scope: "ingest.unhandled",
        error,
        fields: { deviceIdentifier },
      });

      metrics.incrementCounter({
        name: metricNames.ingestOutcome,
        help: "Telemetry ingest outcomes grouped by result and storage driver.",
        labels: { outcome: "error", storage },
      });

      void recordMonitoringIngestEvent({
        deviceIdentifier,
        eventType: "ingest_rejected",
        ipAddress: getRequestIpAddress(request.headers),
        metadata: { reason: "unhandled_exception" },
        requestId,
        responseStatus: 500,
        userAgent: request.headers.get("user-agent"),
      });

      throw error;
    }

    if (!result.ok) {
      metrics.incrementCounter({
        name: metricNames.ingestOutcome,
        help: "Telemetry ingest outcomes grouped by result and storage driver.",
        labels: { outcome: "rejected", storage },
      });
      metrics.incrementCounter({
        name: metricNames.ingestRejections,
        help: "Rejected telemetry requests grouped by reason.",
        labels: { reason: `status_${result.status}` },
      });

      void recordMonitoringIngestEvent({
        deviceIdentifier,
        eventType: "ingest_rejected",
        ipAddress: getRequestIpAddress(request.headers),
        metadata: { message: result.error },
        requestId,
        responseStatus: result.status,
        userAgent: request.headers.get("user-agent"),
      });

      return jsonError({
        error: result.error,
        requestId,
        status: result.status,
      });
    }

    metrics.incrementCounter({
      name: metricNames.ingestOutcome,
      help: "Telemetry ingest outcomes grouped by result and storage driver.",
      labels: { outcome: "accepted", storage: result.data.storage },
    });

    if (result.data.activated) {
      metrics.incrementCounter({
        name: metricNames.ingestOutcome,
        help: "Telemetry ingest outcomes grouped by result and storage driver.",
        labels: { outcome: "activated", storage: result.data.storage },
      });
    }

    void touchMonitoringDeviceLastSeenInMysql({
      deviceId: result.data.deviceInternalId,
      seenAt: new Date(result.data.receivedAt),
    }).catch((error) => {
      reportError({
        scope: "ingest.last-seen-write-failed",
        error,
        level: "warn",
      });
    });

    void recordMonitoringIngestEvent({
      deviceId: result.data.deviceInternalId,
      deviceIdentifier,
      eventType: result.data.activated
        ? "ingest_activated_device"
        : result.data.provisioned
          ? "ingest_provisioned_device"
          : "ingest_accepted",
      ipAddress: getRequestIpAddress(request.headers),
      metadata: {
        configStatus: result.data.configStatus,
        fillPercent: result.data.fillPercent,
        needsReview: result.data.needsReview,
        route: getRequestContext()?.route,
        volumeLiter: result.data.volumeLiter,
      },
      requestId,
      responseStatus: result.status,
      userAgent: request.headers.get("user-agent"),
    });

    return Response.json(
      {
        ok: true,
        data: result.data,
        requestId,
      },
      { headers: { "x-request-id": requestId ?? "" }, status: result.status },
    );
  },
);
