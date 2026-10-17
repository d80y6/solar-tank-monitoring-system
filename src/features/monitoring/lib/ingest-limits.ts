/**
 * Ingest endpoint limits.
 *
 * These live here, and not in the route module, because Next.js validates the
 * exports of a route file: anything other than the HTTP method handlers and the
 * recognised route options is a build error ("is not a valid Route export
 * field"). Keeping the helpers in a feature module also makes them unit
 * testable without importing the route.
 */

export const DEFAULT_MAX_INGEST_BODY_BYTES = 16 * 1024;
export const MIN_MAX_INGEST_BODY_BYTES = 1_024;
export const MAX_MAX_INGEST_BODY_BYTES = 1_024 * 1_024;

export const DEFAULT_INGEST_RATE_LIMIT_PER_MINUTE = 120;

export function getMaxIngestBodyBytes(
  envValue = process.env.INGEST_MAX_BODY_BYTES,
): number {
  const parsed = Number(envValue);

  if (
    Number.isInteger(parsed) &&
    parsed >= MIN_MAX_INGEST_BODY_BYTES &&
    parsed <= MAX_MAX_INGEST_BODY_BYTES
  ) {
    return parsed;
  }

  return DEFAULT_MAX_INGEST_BODY_BYTES;
}

export function getIngestRateLimitPerMinute(
  envValue = process.env.INGEST_RATE_LIMIT_PER_MINUTE,
): number {
  const parsed = Number(envValue);

  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 10_000) {
    return parsed;
  }

  return DEFAULT_INGEST_RATE_LIMIT_PER_MINUTE;
}
