import { describe, expect, it } from "vitest";

import { mockDevices } from "../data/mock-devices";
import { buildDashboardOverview } from "../lib/dashboard-view-model";
import {
  mergeMonitoringReadingsById,
  selectLatestReadingPerTank,
} from "../lib/latest-reading";
import type { Reading } from "../types/monitoring";

function createReading({
  id,
  receivedAt,
  resolution,
  tankId = "tank-1",
}: {
  id: string;
  receivedAt: string;
  resolution: Reading["resolution"];
  tankId?: string;
}): Reading {
  return {
    id,
    deviceId: `device-${tankId}`,
    tankId,
    measuredAt: receivedAt,
    receivedAt,
    sensorDistanceCm: 10,
    fuelHeightCm: 20,
    volumeLiter: 100,
    fillPercent: 50,
    runtimeHour: 10,
    resolution,
  };
}

describe("latest reading selection", () => {
  it("uses newer history when the snapshot table is stale", () => {
    const staleSnapshot = createReading({
      id: "snapshot-stale",
      receivedAt: "2026-07-10T10:39:48.000Z",
      resolution: "latest",
    });
    const freshRaw = createReading({
      id: "raw-fresh",
      receivedAt: "2026-07-11T01:46:54.000Z",
      resolution: "raw",
    });

    expect(selectLatestReadingPerTank([staleSnapshot, freshRaw])).toEqual([
      freshRaw,
    ]);
  });

  it("keeps the overview online when history is fresher than a stale snapshot", () => {
    const staleSnapshot = createReading({
      id: "snapshot-stale",
      receivedAt: "2026-07-10T10:39:48.000Z",
      resolution: "latest",
      tankId: "tank-tph-main",
    });
    const freshRaw = createReading({
      id: "raw-fresh",
      receivedAt: "2026-07-11T01:46:54.000Z",
      resolution: "raw",
      tankId: "tank-tph-main",
    });
    const devices = mockDevices.map((device) =>
      device.tankId === "tank-tph-main"
        ? { ...device, expectedReportIntervalSec: 20 }
        : device,
    );
    const overview = buildDashboardOverview({
      now: new Date("2026-07-11T01:47:14.000Z"),
      devices,
      readings: selectLatestReadingPerTank([staleSnapshot, freshRaw]),
    });
    const tph = overview.rows.find((row) => row.code === "TPH");

    expect(tph).toMatchObject({
      deviceStatus: "online",
      updateLabel: "20 sec ago",
    });
    expect(overview.summary.onlineDevices).toBe(1);
  });

  it("prefers the exact latest snapshot when timestamps are equal", () => {
    const receivedAt = "2026-07-11T01:46:54.000Z";
    const rollup = createReading({
      id: "rollup-5m",
      receivedAt,
      resolution: "5m",
    });
    const snapshot = createReading({
      id: "snapshot-exact",
      receivedAt,
      resolution: "latest",
    });

    expect(selectLatestReadingPerTank([rollup, snapshot])).toEqual([snapshot]);
  });

  it("returns one freshest reading for every tank", () => {
    const tankOne = createReading({
      id: "tank-1-latest",
      receivedAt: "2026-07-11T01:46:54.000Z",
      resolution: "latest",
      tankId: "tank-1",
    });
    const tankTwo = createReading({
      id: "tank-2-latest",
      receivedAt: "2026-07-11T01:46:55.000Z",
      resolution: "raw",
      tankId: "tank-2",
    });

    expect(selectLatestReadingPerTank([tankTwo, tankOne])).toEqual([
      tankOne,
      tankTwo,
    ]);
  });

  it("deduplicates detail history without replacing an exact snapshot", () => {
    const receivedAt = "2026-07-11T01:46:54.000Z";
    const raw = createReading({
      id: "same-reading",
      receivedAt,
      resolution: "raw",
    });
    const snapshot = createReading({
      id: "same-reading",
      receivedAt,
      resolution: "latest",
    });

    expect(mergeMonitoringReadingsById([snapshot], [raw])).toEqual([snapshot]);
  });
});
