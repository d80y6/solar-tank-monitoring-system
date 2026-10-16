export type WindowRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type Bucket = {
  count: number;
  expiresAtMs: number;
};

const DEFAULT_MAX_BUCKETS = 5_000;

/**
 * Fixed-window rate limiter held in process memory.
 *
 * It exists so that rate limiting keeps working when MySQL is not the active
 * storage driver (local development, preview deployments) and, more
 * importantly, so a database outage degrades rate limiting instead of
 * removing it. It is intentionally single-process: the durable, shared
 * limiter is the MySQL-backed one.
 */
export class MemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  private readonly maxBuckets: number;

  constructor({ maxBuckets = DEFAULT_MAX_BUCKETS }: { maxBuckets?: number } = {}) {
    this.maxBuckets = Math.max(1, maxBuckets);
  }

  check({
    key,
    limit,
    windowMs,
    nowMs = Date.now(),
  }: {
    key: string;
    limit: number;
    windowMs: number;
    nowMs?: number;
  }): WindowRateLimitResult {
    if (limit <= 0 || windowMs <= 0) {
      return { allowed: true };
    }

    const existing = this.buckets.get(key);

    if (!existing || existing.expiresAtMs <= nowMs) {
      this.evictIfNeeded(nowMs);
      this.buckets.set(key, {
        count: 1,
        expiresAtMs: nowMs + windowMs,
      });

      return { allowed: true };
    }

    existing.count += 1;

    if (existing.count <= limit) {
      return { allowed: true };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.expiresAtMs - nowMs) / 1_000),
      ),
    };
  }

  size(): number {
    return this.buckets.size;
  }

  clear(): void {
    this.buckets.clear();
  }

  private evictIfNeeded(nowMs: number): void {
    if (this.buckets.size < this.maxBuckets) {
      return;
    }

    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAtMs <= nowMs) {
        this.buckets.delete(key);
      }
    }

    if (this.buckets.size < this.maxBuckets) {
      return;
    }

    // Still full after dropping expired buckets: remove the oldest entries so
    // an attacker cannot exhaust memory by cycling identifiers.
    const overflow = this.buckets.size - this.maxBuckets + 1;
    let removed = 0;

    for (const key of this.buckets.keys()) {
      this.buckets.delete(key);
      removed += 1;

      if (removed >= overflow) {
        break;
      }
    }
  }
}

declare global {
  var __solarTankMemoryRateLimiter: MemoryRateLimiter | undefined;
}

export function getMemoryRateLimiter(): MemoryRateLimiter {
  globalThis.__solarTankMemoryRateLimiter ??= new MemoryRateLimiter();

  return globalThis.__solarTankMemoryRateLimiter;
}
