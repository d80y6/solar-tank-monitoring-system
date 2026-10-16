import { describe, expect, it } from "vitest";
import { mockSites } from "../data/mock-sites";
import { mockTanks } from "../data/mock-tanks";
import {
  buildTankDetail,
  buildTankReadings,
} from "../lib/tank-detail-view-model";
import { normalizeCatPayload } from "../lib/normalize-reading";

describe("tank detail view model", () => {
  const now = new Date("2026-06-25T07:45:00.000Z");

  it("builds tank detail from monitoring mock data", () => {
    const detail = buildTankDetail("tank-tph-main", { now });

    expect(detail?.siteCode).toBe("TPH");
    expect(detail?.deviceCode).toBe("demo-tph-01");
    expect(detail?.volumeLiter).toBe(3900);
    expect(detail?.fillPercent).toBe(78);
    expect(detail?.status).toBe("online");
  });

  it("returns null when tank id is unknown", () => {
    const detail = buildTankDetail("tank-not-found", { now });

    expect(detail).toBeNull();
  });

  it("builds reading series from real stored readings only", () => {
    const readings = buildTankReadings("tank-tph-main", { now });
    const latest = readings.at(-1);

    expect(readings).toHaveLength(1);
    expect(latest?.volumeLiter).toBe(3900);
    expect(latest?.fillPercent).toBe(78);
  });

  it("uses device freshness to mark offline tanks", () => {
    const detail = buildTankDetail("tank-skp-main", { now });

    expect(detail?.status).toBe("offline");
    expect(detail?.statuses.deviceStatus).toBe("offline");
  });

  it("keeps registered tank detail reachable before the first reading arrives", () => {
    const detail = buildTankDetail("tank-nja-main", {
      now,
      readings: [],
    });

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      siteCode: "NJA",
      status: "offline",
      fillPercent: 0,
      volumeLiter: 0,
      lastUpdateLabel: "No data yet",
      receivedAtLabel: "No data yet",
      readings: [],
    });
  });

  it("keeps precise manual coordinates in detail labels", () => {
    const sites = mockSites.map((site) =>
      site.id === "site-tph"
        ? {
            ...site,
            latitude: -7.7201234,
            longitude: 112.8809876,
          }
        : site,
    );
    const detail = buildTankDetail("tank-tph-main", { now, sites });

    expect(detail?.coordinate.label).toBe(
      "-7.7201234, 112.8809876 (manual coordinates)",
    );
  });

  it("surfaces config mismatch review when latest payload conflicts with registry", () => {
    const tank = mockTanks.find((item) => item.id === "tank-tph-main");

    if (!tank) {
      throw new Error("Expected TPH tank mock data.");
    }

    const reading = normalizeCatPayload({
      payload: {
        device: "demo-tph-01",
        measuredAt: "2026-06-28T05:17:57.000Z",
        tank_shape: "rectangular",
        capacity_liter: 540,
        length_cm: 150,
        width_cm: 60,
        height_cm: 60,
        sensor_mount_height_cm: 60,
        low_level_percent: 30,
        critical_level_percent: 15,
        consumption_liter_per_hour: 25,
        distance_cm: 10.2,
        voltage: 3.7,
        rssi: -54,
        raw: {
          local_H_cm: 49.8,
          local_volume_l: 448.2,
          local_percent: 83,
        },
      },
      tank,
      receivedAt: new Date("2026-06-28T05:18:00.000Z"),
      readingId: "reading-real-device",
    });

    const detail = buildTankDetail("tank-tph-main", {
      now: new Date("2026-06-28T05:18:12.000Z"),
      readings: [reading],
    });

    expect(detail).toMatchObject({
      capacityLiter: 5000,
      shape: "horizontal-cylinder",
      shapeLabel: "Horizontal cylinder tank",
      lengthCm: 283,
      widthCm: null,
      heightCm: null,
      sensorMountHeightCm: 150,
      consumptionLiterPerHour: 25,
      volumeLiter: 4853.59,
      fillPercent: 97.07,
      runtimeHour: 194.14,
      status: "warning",
      configReview: {
        status: "config_mismatch",
        needsReview: true,
        configSource: "registry",
        appliedTankConfig: {
          shape: "horizontal-cylinder",
          capacityLiter: 5000,
        },
      },
      dataSources: {
        configSource: "registry",
        volumeSource: "backend",
        fillPercentSource: "backend",
      },
    });
    expect(detail?.configReview.reasons).toEqual(
      expect.arrayContaining([
        "Payload tank shape differs from the official registry.",
        "Tank capacity payload differs by 89.2% from the registry.",
      ]),
    );
  });
});
