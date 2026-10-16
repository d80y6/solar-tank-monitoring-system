import { describe, expect, it } from "vitest";

import { MemoryRateLimiter } from "../memory-rate-limit";

describe("in-memory rate limiter", () => {
  it("allows requests up to the limit inside the window", () => {
    const limiter = new MemoryRateLimiter();

    for (let index = 0; index < 5; index += 1) {
      expect(
        limiter.check({ key: "device-a", limit: 5, windowMs: 60_000 }).allowed,
      ).toBe(true);
    }
  });

  it("blocks and reports retry-after once the window is exhausted", () => {
    const limiter = new MemoryRateLimiter();

    limiter.check({ key: "device-a", limit: 2, windowMs: 30_000 });
    limiter.check({ key: "device-a", limit: 2, windowMs: 30_000 });

    const blocked = limiter.check({
      key: "device-a",
      limit: 2,
      windowMs: 30_000,
    });

    expect(blocked.allowed).toBe(false);

    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(30);
    }
  });

  it("tracks identifiers independently", () => {
    const limiter = new MemoryRateLimiter();

    limiter.check({ key: "device-a", limit: 1, windowMs: 60_000 });
    limiter.check({ key: "device-a", limit: 1, windowMs: 60_000 });

    expect(limiter.check({ key: "device-b", limit: 1, windowMs: 60_000 }).allowed).toBe(
      true,
    );
  });

  it("resets after the window expires", () => {
    const limiter = new MemoryRateLimiter();
    const start = 1_000_000;

    limiter.check({ key: "device-a", limit: 1, windowMs: 1_000, nowMs: start });
    limiter.check({ key: "device-a", limit: 1, windowMs: 1_000, nowMs: start });

    expect(
      limiter.check({
        key: "device-a",
        limit: 1,
        windowMs: 1_000,
        nowMs: start + 1_001,
      }).allowed,
    ).toBe(true);
  });

  it("evicts entries instead of growing without bound", () => {
    const limiter = new MemoryRateLimiter({ maxBuckets: 10 });

    for (let index = 0; index < 50; index += 1) {
      limiter.check({ key: `device-${index}`, limit: 5, windowMs: 60_000 });
    }

    expect(limiter.size()).toBeLessThanOrEqual(10);
  });

  it("ignores limits that are disabled", () => {
    const limiter = new MemoryRateLimiter();

    expect(limiter.check({ key: "any", limit: 0, windowMs: 60_000 }).allowed).toBe(
      true,
    );
  });
});
