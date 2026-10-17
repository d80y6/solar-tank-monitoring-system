import type { NextRequest } from "next/server";

export const DEFAULT_JSON_BODY_LIMIT_BYTES = 8 * 1024;
/** Bodies larger than this are never parsed, whatever the environment says. */
export const MAX_JSON_BODY_LIMIT_BYTES = 1024 * 1024;

export type LimitedBodyResult =
  | { ok: true; body: unknown; bytes: number }
  | { ok: false; reason: "too-large" | "invalid-json"; bytes: number };

export function parseBodyLimit(
  envValue: string | undefined,
  fallback = DEFAULT_JSON_BODY_LIMIT_BYTES,
): number {
  const parsed = Number(envValue);

  if (
    Number.isInteger(parsed) &&
    parsed >= 1_024 &&
    parsed <= MAX_JSON_BODY_LIMIT_BYTES
  ) {
    return parsed;
  }

  return fallback;
}

/**
 * Reads a JSON body with a hard size ceiling.
 *
 * `request.json()` parses whatever arrives into memory, so a large or deeply
 * nested body is an easy way to exhaust a serverless instance. This helper
 * reads the text first, rejects an oversized body before parsing, and reports
 * the byte count so a route can return 413 with a useful message.
 */
export async function readLimitedJsonBody(
  request: NextRequest,
  { maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES }: { maxBytes?: number } = {},
): Promise<LimitedBodyResult> {
  const declaredLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { bytes: declaredLength, ok: false, reason: "too-large" };
  }

  const rawBody = await request.text();
  const bytes = new TextEncoder().encode(rawBody).length;

  if (bytes > maxBytes) {
    return { bytes, ok: false, reason: "too-large" };
  }

  if (rawBody.trim().length === 0) {
    return { body: {}, bytes, ok: true };
  }

  try {
    return { body: JSON.parse(rawBody) as unknown, bytes, ok: true };
  } catch {
    return { bytes, ok: false, reason: "invalid-json" };
  }
}

export type JsonBodyOrReject = {
  body: unknown;
  response: Response | null;
};

/**
 * Convenience wrapper for route handlers: either the parsed body, or a ready
 * 400/413 response the handler can return directly.
 */
export async function readJsonBodyOrReject(
  request: NextRequest,
  { maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES }: { maxBytes?: number } = {},
): Promise<JsonBodyOrReject> {
  const result = await readLimitedJsonBody(request, { maxBytes });

  if (result.ok) {
    return { body: result.body, response: null };
  }

  if (result.reason === "too-large") {
    return {
      body: null,
      response: Response.json(
        {
          error: `Request body is too large. The limit is ${maxBytes} bytes.`,
          ok: false,
        },
        { status: 413 },
      ),
    };
  }

  return {
    body: null,
    response: Response.json(
      { error: "Request body must be valid JSON.", ok: false },
      { status: 400 },
    ),
  };
}
