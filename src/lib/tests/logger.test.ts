import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger, getLogLevel, shouldUseJsonLogs } from "../logger";
import { runWithRequestContext } from "../request-context";

const ORIGINAL_ENV = { ...process.env };

function captureConsole() {
  const lines: { level: "error" | "log" | "warn"; value: string }[] = [];

  vi.spyOn(globalThis.console, "log").mockImplementation((value?: unknown) => {
    lines.push({ level: "log", value: String(value) });
  });
  vi.spyOn(globalThis.console, "warn").mockImplementation((value?: unknown) => {
    lines.push({ level: "warn", value: String(value) });
  });
  vi.spyOn(globalThis.console, "error").mockImplementation((value?: unknown) => {
    lines.push({ level: "error", value: String(value) });
  });

  return lines;
}

describe("structured logger", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, LOG_FORMAT: "json", LOG_LEVEL: "debug" };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("writes JSON entries with service, level, and message", () => {
    const lines = captureConsole();
    const log = createLogger({ module: "test" });

    log.info("hello", { count: 2 });

    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0].value);

    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("hello");
    expect(entry.module).toBe("test");
    expect(entry.count).toBe(2);
    expect(typeof entry.time).toBe("string");
    expect(typeof entry.service).toBe("string");
  });

  it("attaches the active request correlation id", () => {
    const lines = captureConsole();

    runWithRequestContext(
      { requestId: "req-1234567890", method: "POST", route: "api.ingest" },
      () => {
        createLogger().info("inside request");
      },
    );

    const entry = JSON.parse(lines[0].value);

    expect(entry.requestId).toBe("req-1234567890");
    expect(entry.route).toBe("api.ingest");
    expect(entry.method).toBe("POST");
  });

  it("redacts secrets before writing", () => {
    const lines = captureConsole();

    createLogger().error("failed", {
      deviceKey: "stk_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    const entry = JSON.parse(lines[0].value);

    expect(entry.deviceKey).toBe("[redacted]");
    expect(lines[0].level).toBe("error");
  });

  it("honours the configured level threshold", () => {
    process.env.LOG_LEVEL = "warn";
    const lines = captureConsole();
    const log = createLogger();

    log.debug("ignored");
    log.info("ignored");
    log.warn("kept");
    log.error("kept");

    expect(lines.map((line) => line.level)).toEqual(["warn", "error"]);
  });

  it("merges child fields with parent fields", () => {
    const lines = captureConsole();

    createLogger({ module: "api" }).child({ route: "tanks" }).info("ok");

    const entry = JSON.parse(lines[0].value);

    expect(entry.module).toBe("api");
    expect(entry.route).toBe("tanks");
  });

  it("resolves format and level defaults", () => {
    process.env.LOG_FORMAT = "pretty";
    expect(shouldUseJsonLogs()).toBe(false);

    process.env.LOG_FORMAT = "json";
    expect(shouldUseJsonLogs()).toBe(true);

    process.env.LOG_LEVEL = "verbose";
    expect(getLogLevel()).toBe("debug");
  });

  it("never throws when console writes fail", () => {
    vi.spyOn(globalThis.console, "log").mockImplementation(() => {
      throw new Error("EPIPE");
    });

    expect(() => createLogger().info("still safe")).not.toThrow();
  });
});
