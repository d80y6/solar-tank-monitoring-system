import { describe, expect, it } from "vitest";
import { buildDashboardOverview } from "../lib/dashboard-view-model";

describe("dashboard overview view model", () => {
  it("builds dashboard rows from monitoring mock data", () => {
    const overview = buildDashboardOverview({
      now: new Date("2026-06-25T07:45:00.000Z"),
    });
    const tph = overview.rows.find((row) => row.code === "TPH");

    expect(overview.summary.totalSites).toBe(5);
    expect(overview.summary.totalTanks).toBe(5);
    expect(overview.rows).toHaveLength(5);
    expect(overview.rows.some((row) => row.code === "PSN")).toBe(true);
    expect(tph).toMatchObject({
      latitude: -7.65,
      longitude: 112.9,
    });
  });

  it("calculates status from runtime, level, and device freshness", () => {
    const overview = buildDashboardOverview({
      now: new Date("2026-06-25T07:45:00.000Z"),
    });

    const tph = overview.rows.find((row) => row.code === "TPH");
    const jto = overview.rows.find((row) => row.code === "JTO");
    const skp = overview.rows.find((row) => row.code === "SKP");

    expect(tph?.status).toBe("online");
    expect(jto?.status).toBe("critical");
    expect(skp?.status).toBe("offline");
  });

  it("builds priority rows without hardcoding site order in the page", () => {
    const overview = buildDashboardOverview({
      now: new Date("2026-06-25T07:45:00.000Z"),
    });

    expect(overview.priorityRows.length).toBeGreaterThan(0);
    expect(overview.priorityRows.every((row) => row.status !== "online")).toBe(
      true,
    );
  });

  it("builds health cards and trend bars for dashboard display", () => {
    const overview = buildDashboardOverview({
      now: new Date("2026-06-25T07:45:00.000Z"),
    });

    expect(overview.healthCards).toHaveLength(4);
    expect(overview.healthSegments).toHaveLength(4);
    expect(overview.trendBars).toHaveLength(9);
  });

  it("uses the newest received reading for the detail overview card", () => {
    const overview = buildDashboardOverview({
      now: new Date("2026-06-25T08:10:00.000Z"),
      readings: [
        {
          id: "reading-old-tph",
          deviceId: "device-tph-main",
          tankId: "tank-tph-main",
          measuredAt: "2026-06-25T07:30:00.000Z",
          receivedAt: "2026-06-25T07:30:03.000Z",
          sensorDistanceCm: 40,
          fuelHeightCm: 110,
          volumeLiter: 3600,
          fillPercent: 72,
          runtimeHour: 144,
        },
        {
          id: "reading-new-jto",
          deviceId: "device-jto-main",
          tankId: "tank-jto-main",
          measuredAt: "2026-06-25T08:00:00.000Z",
          receivedAt: "2026-06-25T08:00:05.000Z",
          sensorDistanceCm: 130,
          fuelHeightCm: 20,
          volumeLiter: 700,
          fillPercent: 14,
          runtimeHour: 28,
        },
      ],
    });

    expect(overview.latestRow.code).toBe("JTO");
  });

  it("keeps registered tanks visible even before their first reading arrives", () => {
    const overview = buildDashboardOverview({
      now: new Date("2026-06-25T08:10:00.000Z"),
      readings: [
        {
          id: "reading-new-tph",
          deviceId: "device-tph-main",
          tankId: "tank-tph-main",
          measuredAt: "2026-06-25T08:00:00.000Z",
          receivedAt: "2026-06-25T08:00:05.000Z",
          sensorDistanceCm: 40,
          fuelHeightCm: 110,
          volumeLiter: 3600,
          fillPercent: 72,
          runtimeHour: 144,
        },
      ],
    });

    const noDataSite = overview.rows.find((row) => row.code === "NJA");

    expect(overview.rows).toHaveLength(5);
    expect(noDataSite).toMatchObject({
      status: "offline",
      fillPercent: 0,
      volumeLiter: 0,
      updateLabel: "No data yet",
    });
  });

  it("marks dashboard row as warning when payload config needs review", () => {
    const overview = buildDashboardOverview({
      now: new Date("2026-06-28T05:18:12.000Z"),
      readings: [
        {
          id: "reading-config-mismatch",
          deviceId: "device-tph-main",
          tankId: "tank-tph-main",
          measuredAt: "2026-06-28T05:17:57.000Z",
          receivedAt: "2026-06-28T05:18:00.000Z",
          sensorDistanceCm: 10.2,
          fuelHeightCm: 49.8,
          volumeLiter: 448.2,
          fillPercent: 83,
          runtimeHour: 17.93,
          rawPayload: {
            tank_shape: "rectangular",
            capacity_liter: 540,
            length_cm: 150,
            width_cm: 60,
            height_cm: 60,
            sensor_mount_height_cm: 60,
            consumption_liter_per_hour: 25,
          },
        },
      ],
    });

    const tph = overview.rows.find((row) => row.code === "TPH");

    expect(tph).toMatchObject({
      status: "warning",
      configStatus: "config_mismatch",
      configNeedsReview: true,
      configSummary: "Config mismatch needs review",
      consumptionLiterPerHour: 25,
    });
    expect(tph?.note).toContain("Config mismatch needs review");
  });
});
