import { describe, expect, it } from "vitest";

import {
  buildMonitoringRollupWindow,
  MONITORING_ROLLUP_INTERVAL_MINUTES,
} from "../lib/reading-rollup";

describe("monitoring reading rollup", () => {
  it("maps a reading to a stable five-minute UTC bucket", () => {
    expect(
      buildMonitoringRollupWindow({
        deviceId: "device-tph-main",
        receivedAt: "2026-07-11T03:12:47.123Z",
      }),
    ).toEqual({
      end: "2026-07-11T03:15:00.000Z",
      id: "rollup-5m-device-tph-main-1783739400000",
      start: "2026-07-11T03:10:00.000Z",
    });
    expect(MONITORING_ROLLUP_INTERVAL_MINUTES).toBe(5);
  });

  it("rejects an invalid received timestamp", () => {
    expect(() =>
      buildMonitoringRollupWindow({
        deviceId: "device-tph-main",
        receivedAt: "invalid",
      }),
    ).toThrow("Reading timestamp is invalid for the aggregation bucket.");
  });
});
