import { createLogger, describeError, type LogFields } from "./logger";
import { metricNames, metrics } from "./metrics";
import { getRequestContext } from "./request-context";

export type ErrorReportInput = {
  /** Stable, low-cardinality identifier such as `ingest.save-failed`. */
  scope: string;
  error: unknown;
  level?: "warn" | "error";
  fields?: LogFields;
};

const log = createLogger({ module: "error-tracker" });

const FORWARD_TIMEOUT_MS = 3_000;

/**
 * Records an unexpected server-side failure.
 *
 * Every report produces a structured log line and increments an error metric
 * so failures are visible without a third-party dependency. When
 * `ERROR_TRACKING_WEBHOOK_URL` is configured (for example a Sentry, Better
 * Stack, or internal collector endpoint), the report is also forwarded
 * asynchronously and never blocks the request path.
 */
export function reportError({
  scope,
  error,
  level = "error",
  fields,
}: ErrorReportInput): void {
  const context = getRequestContext();
  const payload: LogFields = {
    scope,
    requestId: context?.requestId,
    route: context?.route,
    userId: context?.userId,
    ...fields,
    ...describeError(error),
  };

  if (level === "warn") {
    log.warn(`Handled failure in ${scope}`, payload);
  } else {
    log.error(`Unhandled failure in ${scope}`, payload);
  }

  metrics.incrementCounter({
    name: metricNames.errors,
    help: "Server-side failures recorded by the error tracker.",
    labels: { scope, level },
  });

  void forwardToWebhook({ scope, error, fields: payload });
}

function getWebhookUrl(): string | null {
  const value = process.env.ERROR_TRACKING_WEBHOOK_URL?.trim();

  return value || null;
}

async function forwardToWebhook({
  scope,
  error,
  fields,
}: {
  scope: string;
  error: unknown;
  fields: LogFields;
}): Promise<void> {
  const url = getWebhookUrl();

  if (!url) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.ERROR_TRACKING_WEBHOOK_TOKEN?.trim()
          ? {
              authorization: `Bearer ${process.env.ERROR_TRACKING_WEBHOOK_TOKEN.trim()}`,
            }
          : {}),
      },
      body: JSON.stringify({
        service:
          process.env.NEXT_PUBLIC_APP_NAME?.trim() ||
          "solar-tank-monitoring-system",
        environment:
          process.env.NEXT_PUBLIC_APP_ENV?.trim() ||
          process.env.NODE_ENV ||
          "development",
        scope,
        occurredAt: new Date().toISOString(),
        error: {
          name: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : String(error),
        },
        context: fields,
      }),
      signal: controller.signal,
    });
  } catch {
    // Forwarding is best effort; the structured log above is the source of truth.
  } finally {
    clearTimeout(timeout);
  }
}
