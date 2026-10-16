import { describe, expect, it } from "vitest";

import {
  DEFAULT_MONITORING_REFRESH_INTERVAL_MS,
  MIN_MONITORING_REFRESH_INTERVAL_MS,
  formatMonitoringRefreshInterval,
  getMonitoringRefreshIntervalMs,
  normalizeMonitoringRefreshInterval,
} from "../lib/refresh-interval";

describe("monitoring refresh interval", () => {
  it("keeps the default interval when env is empty", () => {
    expect(getMonitoringRefreshIntervalMs("")).toBe(
      DEFAULT_MONITORING_REFRESH_INTERVAL_MS,
    );
  });

  it("clamps refresh interval to the minimum allowed value", () => {
    expect(normalizeMonitoringRefreshInterval(1000)).toBe(
      MIN_MONITORING_REFRESH_INTERVAL_MS,
    );
  });

  it("formats seconds and mixed minute intervals for the UI", () => {
    expect(formatMonitoringRefreshInterval(20_000)).toBe("20 sec");
    expect(formatMonitoringRefreshInterval(90_000)).toBe("1 min 30 sec");
  });
});
