import type { NextRequest } from "next/server";

import { checkRateLimit } from "@/features/auth/lib/rate-limit";
import { getRequestSessionUser } from "@/features/auth/lib/auth-session";
import { getRequestIpAddress, withApiObservability } from "@/lib/api-observability";
import { createLogger } from "@/lib/logger";
import { metrics } from "@/lib/metrics";
import { reportError } from "@/lib/error-tracker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger({ module: "client-errors" });
const MAX_BODY_BYTES = 8_192;

type ClientErrorPayload = {
  digest?: string | null;
  extra?: Record<string, unknown> | null;
  message?: string;
  name?: string;
  source?: string;
  stack?: string | null;
  url?: string;
  userAgent?: string;
};

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

async function handleClientError(request: NextRequest): Promise<Response> {
  const ip = getRequestIpAddress(request.headers);
  const contact = await getRequestSessionUser(request).catch(() => null);
  const rateLimit = await checkRateLimit({
    key: `client-errors:${contact?.id ?? ip}`,
    limit: 30,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    metrics.incrementCounter({
      help: "Client error reports refused by the limiter.",
      name: "solar_tank_client_error_reports_total",
      labels: { outcome: "rate_limited" },
    });

    return Response.json(
      { error: "Too many error reports; slow down.", ok: false },
      {
        headers: { "retry-after": String(rateLimit.retryAfterSeconds) },
        status: 429,
      },
    );
  }

  const rawBody = await request.text();

  if (rawBody.length > MAX_BODY_BYTES) {
    return Response.json(
      { error: "Error report is too large.", ok: false },
      { status: 413 },
    );
  }

  let payload: ClientErrorPayload;

  try {
    payload = JSON.parse(rawBody) as ClientErrorPayload;
  } catch {
    return Response.json(
      { error: "Error report must be JSON.", ok: false },
      { status: 400 },
    );
  }

  const message = readString(payload.message, 500) ?? "Unknown client error";
  const source = readString(payload.source, 120) ?? "client.unknown";
  const syntheticError = new Error(message);

  syntheticError.name = readString(payload.name, 80) ?? "ClientError";

  const stack = readString(payload.stack, 2_000);

  if (stack) {
    syntheticError.stack = stack;
  }

  metrics.incrementCounter({
    help: "Client error reports accepted by source.",
    name: "solar_tank_client_error_reports_total",
    labels: { outcome: "accepted", source },
  });

  // Client failures flow through the same reporter as server failures, so they
  // share the log shape, the error metric, and the optional external sink.
  reportError({
    error: syntheticError,
    fields: {
      clientDigest: payload.digest ?? undefined,
      clientUrl: readString(payload.url, 300) ?? undefined,
      clientUserAgent: readString(payload.userAgent, 300) ?? undefined,
      actorUserId: contact?.id ?? undefined,
      ip: ip === "unknown" ? undefined : ip,
      ...(payload.extra && typeof payload.extra === "object"
        ? { clientExtra: payload.extra }
        : {}),
    },
    level: "warn",
    scope: `client.${source}`,
  });

  log.warn("client.error", { actorUserId: contact?.id, source });

  return Response.json({ ok: true }, { status: 202 });
}

export const POST = withApiObservability(
  "api/telemetry/client-errors",
  handleClientError,
);
