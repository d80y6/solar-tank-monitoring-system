import { describe, expect, it } from "vitest";

import { redactForLogging } from "../redaction";

describe("log redaction", () => {
  it("redacts sensitive keys regardless of nesting depth", () => {
    const result = redactForLogging({
      deviceKey: "stk_abcdefghijklmnopqrstuvwxyz0123456789",
      nested: {
        authorization: "Bearer abc",
        password: "hunter2",
        sessionToken: "token-value",
      },
      safe: "visible",
    }) as Record<string, unknown>;

    expect(result.deviceKey).toBe("[redacted]");
    expect(result.safe).toBe("visible");
    expect(result.nested).toEqual({
      authorization: "[redacted]",
      password: "[redacted]",
      sessionToken: "[redacted]",
    });
  });

  it("redacts credential-shaped values even when the key looks safe", () => {
    const result = redactForLogging({
      connection: "mysql://user:pass@host:3306/db",
      header: "Bearer 1234567890",
      note: "stk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    }) as Record<string, string>;

    expect(result.connection).toBe("[redacted]");
    expect(result.header).toBe("[redacted]");
    expect(result.note).toBe("[redacted]");
  });

  it("serializes errors without leaking their cause object", () => {
    const error = new Error("boom") as Error & { code?: string };
    error.code = "ER_ACCESS_DENIED";

    const result = redactForLogging(error) as Record<string, unknown>;

    expect(result.message).toBe("boom");
    expect(result.name).toBe("Error");
    expect(result.code).toBe("ER_ACCESS_DENIED");
  });

  it("bounds long strings, long arrays, and deep structures", () => {
    const shallow = redactForLogging({
      long: "x".repeat(5_000),
      list: Array.from({ length: 80 }, (_, index) => index),
    }) as { list: unknown[]; long: string };

    expect(shallow.long).toContain("[truncated");
    expect(shallow.list).toHaveLength(51);
    expect(shallow.list.at(-1)).toContain("more items");

    let deep: unknown = "leaf";

    for (let index = 0; index < 10; index += 1) {
      deep = { nested: deep };
    }

    expect(JSON.stringify(redactForLogging(deep))).toContain("depth-limit");
  });

  it("keeps primitive values and converts dates to ISO strings", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    const result = redactForLogging({
      active: true,
      at: date,
      count: 3,
      empty: null,
    }) as Record<string, unknown>;

    expect(result).toEqual({
      active: true,
      at: "2026-01-02T03:04:05.000Z",
      count: 3,
      empty: null,
    });
  });
});
