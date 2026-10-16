import { describe, expect, it } from "vitest";

import {
  DEFAULT_INGEST_RATE_LIMIT_PER_MINUTE,
  DEFAULT_MAX_INGEST_BODY_BYTES,
  getIngestRateLimitPerMinute,
  getMaxIngestBodyBytes,
} from "@/features/monitoring/lib/ingest-limits";

describe("getMaxIngestBodyBytes", () => {
  it("defaults to 16 KB", () => {
    expect(getMaxIngestBodyBytes(undefined)).toBe(DEFAULT_MAX_INGEST_BODY_BYTES);
    expect(getMaxIngestBodyBytes("")).toBe(DEFAULT_MAX_INGEST_BODY_BYTES);
    expect(getMaxIngestBodyBytes("not-a-number")).toBe(DEFAULT_MAX_INGEST_BODY_BYTES);
  });

  it("accepts a configured value inside the allowed range", () => {
    expect(getMaxIngestBodyBytes("4096")).toBe(4096);
    expect(getMaxIngestBodyBytes(String(1024 * 1024))).toBe(1024 * 1024);
  });

  it("ignores values that would weaken or disable the limit", () => {
    expect(getMaxIngestBodyBytes("10")).toBe(DEFAULT_MAX_INGEST_BODY_BYTES);
    expect(getMaxIngestBodyBytes("0")).toBe(DEFAULT_MAX_INGEST_BODY_BYTES);
    expect(getMaxIngestBodyBytes("-1")).toBe(DEFAULT_MAX_INGEST_BODY_BYTES);
    expect(getMaxIngestBodyBytes(String(2 * 1024 * 1024))).toBe(
      DEFAULT_MAX_INGEST_BODY_BYTES,
    );
    expect(getMaxIngestBodyBytes("1024.5")).toBe(DEFAULT_MAX_INGEST_BODY_BYTES);
  });
});

describe("getIngestRateLimitPerMinute", () => {
  it("defaults to 120 requests per minute", () => {
    expect(getIngestRateLimitPerMinute(undefined)).toBe(
      DEFAULT_INGEST_RATE_LIMIT_PER_MINUTE,
    );
    expect(DEFAULT_INGEST_RATE_LIMIT_PER_MINUTE).toBe(120);
  });

  it("accepts a configured value and rejects nonsense", () => {
    expect(getIngestRateLimitPerMinute("30")).toBe(30);
    expect(getIngestRateLimitPerMinute("10000")).toBe(10_000);
    expect(getIngestRateLimitPerMinute("0")).toBe(DEFAULT_INGEST_RATE_LIMIT_PER_MINUTE);
    expect(getIngestRateLimitPerMinute("10001")).toBe(
      DEFAULT_INGEST_RATE_LIMIT_PER_MINUTE,
    );
  });
});
