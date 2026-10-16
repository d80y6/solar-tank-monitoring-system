import type { RowDataPacket } from "mysql2/promise";

import { getMemoryRateLimiter } from "@/lib/memory-rate-limit";
import { metricNames, metrics } from "@/lib/metrics";
import { getMysqlPool } from "@/features/monitoring/lib/mysql-connection";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";
import { hmacSha256Hex } from "./auth-crypto";

type RateLimitRow = RowDataPacket & {
  request_count: number;
  window_expires_at: Date;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

function hashBucketKey(key: string): string {
  return `hmac-sha256:${hmacSha256Hex(key)}`;
}

async function checkRateLimitInMysql({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  const pool = getMysqlPool();
  const bucketKey = hashBucketKey(key);
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

  await pool.execute(
    `INSERT INTO auth_rate_limits
      (bucket_key, request_count, window_expires_at)
     VALUES (?, 1, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))
     ON DUPLICATE KEY UPDATE
       request_count = CASE
         WHEN window_expires_at <= UTC_TIMESTAMP(3) THEN 1
         ELSE request_count + 1
       END,
       window_expires_at = CASE
         WHEN window_expires_at <= UTC_TIMESTAMP(3)
           THEN DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND)
         ELSE window_expires_at
       END`,
    [bucketKey, windowSeconds, windowSeconds],
  );

  const [rows] = await pool.execute<RateLimitRow[]>(
    `SELECT request_count, window_expires_at
       FROM auth_rate_limits
      WHERE bucket_key = ?
      LIMIT 1`,
    [bucketKey],
  );
  const bucket = rows[0];

  if (!bucket || bucket.request_count <= limit) {
    return { allowed: true };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((bucket.window_expires_at.getTime() - Date.now()) / 1000),
    ),
  };
}

/**
 * Shared fixed-window rate limiter.
 *
 * Uses the durable MySQL bucket when the operational database is active and
 * falls back to an in-process limiter when it is not (development, preview)
 * or when the database is temporarily unreachable. Rate limiting therefore
 * never silently disappears.
 */
export async function checkRateLimit({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  if (getMonitoringStorageDriver() === "mysql") {
    try {
      const result = await checkRateLimitInMysql({ key, limit, windowMs });

      metrics.incrementCounter({
        name: metricNames.rateLimited,
        help: "Rate-limited requests grouped by limiter backend and outcome.",
        labels: {
          backend: "mysql",
          outcome: result.allowed ? "allowed" : "blocked",
        },
      });

      return result;
    } catch {
      metrics.incrementCounter({
        name: metricNames.rateLimited,
        help: "Rate-limited requests grouped by limiter backend and outcome.",
        labels: { backend: "memory-fallback", outcome: "degraded" },
      });
    }
  }

  const result = getMemoryRateLimiter().check({ key, limit, windowMs });

  metrics.incrementCounter({
    name: metricNames.rateLimited,
    help: "Rate-limited requests grouped by limiter backend and outcome.",
    labels: {
      backend: "memory",
      outcome: result.allowed ? "allowed" : "blocked",
    },
  });

  return result;
}
