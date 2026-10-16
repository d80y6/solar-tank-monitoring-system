import type { NextRequest } from "next/server";

import { reportError } from "./error-tracker";
import { createLogger } from "./logger";
import { metricNames, metrics } from "./metrics";
import {
  getRequestIdFromHeaders,
  runWithRequestContext,
} from "./request-context";

type RouteHandler<Context> = (
  request: NextRequest,
  context: Context,
) => Promise<Response> | Response;

const log = createLogger({ module: "api" });

function normalizeRouteLabel(route: string): string {
  return route.replace(/^\/+/, "").replaceAll("/", ".") || "root";
}

/**
 * Wraps a Route Handler with correlation IDs, structured request logging,
 * latency metrics, and a safe failure response.
 *
 * Handlers keep their normal Next.js signature, so adoption is per-route and
 * incremental.
 */
export function withApiObservability<Context = unknown>(
  route: string,
  handler: RouteHandler<Context>,
): RouteHandler<Context> {
  const routeLabel = normalizeRouteLabel(route);

  return async (request: NextRequest, context: Context) => {
    const requestId = getRequestIdFromHeaders(request.headers);
    const startedAt = performance.now();
    const method = request.method;

    return runWithRequestContext(
      {
        requestId,
        method,
        route: routeLabel,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
      async () => {
        let status = 500;

        try {
          const response = await handler(request, context);
          status = response.status;
          response.headers.set("x-request-id", requestId);

          return response;
        } catch (error) {
          reportError({
            scope: `api.${routeLabel}`,
            error,
            fields: { method },
          });

          return Response.json(
            {
              ok: false,
              error: "The server could not complete the request.",
              requestId,
            },
            {
              headers: { "x-request-id": requestId },
              status: 500,
            },
          );
        } finally {
          const durationSeconds = (performance.now() - startedAt) / 1_000;
          const labels = { method, route: routeLabel, status: String(status) };

          metrics.incrementCounter({
            name: metricNames.httpRequests,
            help: "Total HTTP requests handled by the application.",
            labels,
          });
          metrics.observeHistogram({
            name: metricNames.httpRequestDuration,
            help: "HTTP request latency in seconds.",
            labels: { method, route: routeLabel },
            value: durationSeconds,
          });

          const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";

          log[level]("api.request", {
            durationMs: Math.round(durationSeconds * 1_000),
            status,
          });
        }
      },
    );
  };
}

export function getRequestIpAddress(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}
