import { describe, expect, it } from "vitest";
import { mockTanks } from "../data/mock-tanks";
import { normalizeCatPayload } from "../lib/normalize-reading";

describe("normalizeCatPayload", () => {
  it("normalizes CAT-like telemetry payload into a standard reading", () => {
    const tank = mockTanks[0];
    const receivedAt = new Date("2026-06-25T07:43:08.000Z");

    const reading = normalizeCatPayload({
      payload: {
        device: "demo-tph-01",
        ts: 0,
        distance: 35,
        voltage: 3.85,
        raw: {
          H_cm: 115,
          volume: 3900,
          percent: 78,
          wifi_rssi: -61,
        },
      },
      tank,
      receivedAt,
      readingId: "reading-test",
    });

    expect(reading).toMatchObject({
      id: "reading-test",
      deviceId: "demo-tph-01",
      tankId: "tank-tph-main",
      measuredAt: "2026-06-25T07:43:08.000Z",
      receivedAt: "2026-06-25T07:43:08.000Z",
      sensorDistanceCm: 35,
      fuelHeightCm: 115,
      volumeLiter: 3900,
      fillPercent: 78,
      runtimeHour: 156,
      batteryVolt: 3.85,
      rssiDbm: -61,
    });
  });

  it("calculates height, volume, and percent when device does not send them", () => {
    const tank = mockTanks[0];

    const reading = normalizeCatPayload({
      payload: {
        device: "demo-tph-01",
        distance: 75,
      },
      tank,
      receivedAt: new Date("2026-06-25T07:43:08.000Z"),
    });

    expect(reading.fuelHeightCm).toBe(75);
    expect(reading.volumeLiter).toBeGreaterThan(2400);
    expect(reading.volumeLiter).toBeLessThan(2600);
    expect(reading.fillPercent).toBeGreaterThan(48);
    expect(reading.fillPercent).toBeLessThan(52);
  });

  it("uses fallback device id when payload does not contain a device value", () => {
    const tank = mockTanks[0];

    const reading = normalizeCatPayload({
      payload: {
        distance: 75,
      },
      tank,
      fallbackDeviceId: "demo-fallback-01",
      receivedAt: new Date("2026-06-25T07:43:08.000Z"),
    });

    expect(reading.deviceId).toBe("demo-fallback-01");
  });

  it("accepts real device payload with matching rectangular config snapshot", () => {
    const tank = mockTanks.find((item) => item.id === "tank-psn-main");

    if (!tank) {
      throw new Error("Expected PSN tank mock data.");
    }

    const reading = normalizeCatPayload({
      payload: {
        device: "demo-psn-01",
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
        distance: 10.2,
        distance_cm: 10.2,
        dist: 10.2,
        dist_cm: 10.2,
        voltage: 3.7,
        rssi: -54,
        wifi_rssi: -54,
        ip: "192.168.1.173",
        lat: -7.65,
        lng: 112.9,
        tank: {
          shape: "rectangular",
          capacity_liter: 540,
          length_cm: 150,
          width_cm: 60,
          height_cm: 60,
          sensor_mount_height_cm: 60,
        },
        raw: {
          local_H_cm: 49.8,
          local_volume_l: 448.2,
          local_percent: 83,
          wifi_rssi: -54,
          ip: "192.168.1.173",
        },
      },
      tank,
      receivedAt: new Date("2026-06-28T05:18:00.000Z"),
      readingId: "reading-real-device",
    });

    expect(reading).toMatchObject({
      id: "reading-real-device",
      deviceId: "demo-psn-01",
      tankId: "tank-psn-main",
      measuredAt: "2026-06-28T05:17:57.000Z",
      receivedAt: "2026-06-28T05:18:00.000Z",
      sensorDistanceCm: 10.2,
      fuelHeightCm: 49.8,
      volumeLiter: 448.2,
      fillPercent: 83,
      runtimeHour: 17.93,
      batteryVolt: 3.7,
      rssiDbm: -54,
    });
    expect(reading.quality).toMatchObject({
      measuredAtSource: "device",
      fuelHeightSource: "device",
      volumeSource: "device",
      fillPercentSource: "device",
      runtimeSource: "backend",
      configSource: "payload",
      configStatus: "normal",
      needsReview: false,
    });
  });

  it("marks config mismatch when payload tank config conflicts with registry", () => {
    const tank = mockTanks[0];

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
        consumption_liter_per_hour: 25,
        distance_cm: 10.2,
        raw: {
          local_H_cm: 49.8,
          local_volume_l: 448.2,
          local_percent: 83,
        },
      },
      tank,
      receivedAt: new Date("2026-06-28T05:18:00.000Z"),
    });

    expect(reading.fuelHeightCm).toBe(139.8);
    expect(reading.volumeLiter).toBe(4853.59);
    expect(reading.fillPercent).toBe(97.07);
    expect(reading.runtimeHour).toBe(194.14);
    expect(reading.quality).toMatchObject({
      fuelHeightSource: "backend",
      volumeSource: "backend",
      fillPercentSource: "backend",
      configSource: "registry",
      configStatus: "config_mismatch",
      needsReview: true,
    });
    expect(reading.quality?.configMismatchReasons).toEqual(
      expect.arrayContaining([
        "Payload tank shape differs from the official registry.",
        "Tank capacity payload differs by 89.2% from the registry.",
      ]),
    );
    expect(reading.quality?.warnings).toContain(
      "Device height, volume, and percent values are ignored until the payload config is reviewed.",
    );
  });

  it("falls back to server time when device timestamp is too far from received time", () => {
    const tank = mockTanks[0];

    const reading = normalizeCatPayload({
      payload: {
        device: "demo-tph-01",
        measuredAt: "2026-01-01T00:00:00.000Z",
        distance: 75,
      },
      tank,
      receivedAt: new Date("2026-06-28T05:18:00.000Z"),
    });

    expect(reading.measuredAt).toBe("2026-06-28T05:18:00.000Z");
    expect(reading.quality).toMatchObject({
      measuredAtSource: "server",
    });
    expect(reading.quality?.warnings).toContain(
      "Device timestamp differs from server time by more than 24 hours; measuredAt uses server time.",
    );
  });
});
