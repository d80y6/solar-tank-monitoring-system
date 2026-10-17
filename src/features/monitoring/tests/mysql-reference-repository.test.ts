import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../lib/mysql-connection", () => ({
  getMysqlPool: () => ({ query: mocks.query }),
}));

import {
  checkMonitoringLocationTaxonomySchemaFromMysql,
  rowToDevice,
  rowToSite,
  rowToTank,
} from "../lib/mysql-reference-repository";

describe("mysql reference repository mappers", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValue([[], []]);
  });

  it("maps mysql site rows into Site objects", () => {
    const site = rowToSite({
      id: "site-demo-01",
      code: "DMO",
      name: "STO Demo",
      regional_label: "TREG 5",
      wilayah_label: "TIF 3",
      area_label: "Area demo",
      latitude: "-7.6500000",
      longitude: "112.9000000",
      is_active: 1,
    } as Parameters<typeof rowToSite>[0]);

    expect(site).toEqual({
      id: "site-demo-01",
      code: "DMO",
      name: "STO Demo",
      regionalLabel: "TREG 5",
      wilayahLabel: "TIF 3",
      areaLabel: "Area demo",
      latitude: -7.65,
      longitude: 112.9,
      isActive: true,
    });
  });

  it("checks both location tables in one lightweight database request", async () => {
    await checkMonitoringLocationTaxonomySchemaFromMysql();

    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0]?.[0]).toContain("monitoring_sites");
    expect(mocks.query.mock.calls[0]?.[0]).toContain(
      "monitoring_device_requests",
    );
    expect(mocks.query.mock.calls[0]?.[0]).toContain("regional_label");
    expect(mocks.query.mock.calls[0]?.[0]).toContain("wilayah_label");
  });

  it("maps mysql tank rows into Tank objects", () => {
    const tank = rowToTank({
      id: "tank-demo-main",
      site_id: "site-demo-01",
      name: "Main tank",
      shape: "horizontal-cylinder",
      capacity_liter: "5000.00",
      diameter_cm: "150.00",
      length_cm: "283.00",
      height_cm: null,
      width_cm: null,
      sensor_mount_height_cm: "150.00",
      low_level_percent: "30.00",
      critical_level_percent: "15.00",
      consumption_liter_per_hour: "25.00",
      is_active: 1,
    } as Parameters<typeof rowToTank>[0]);

    expect(tank).toMatchObject({
      id: "tank-demo-main",
      siteId: "site-demo-01",
      shape: "horizontal-cylinder",
      capacityLiter: 5000,
      diameterCm: 150,
      lengthCm: 283,
      sensorMountHeightCm: 150,
      lowLevelPercent: 30,
      criticalLevelPercent: 15,
      consumptionLiterPerHour: 25,
      isActive: true,
    });
    expect(tank.heightCm).toBeUndefined();
    expect(tank.widthCm).toBeUndefined();
  });

  it("maps mysql device rows into Device objects", () => {
    const device = rowToDevice({
      id: "device-demo-main",
      site_id: "site-demo-01",
      tank_id: "tank-demo-main",
      code: "demo-device-01",
      label: "NodeMCU Ultrasonic Demo",
      expected_report_interval_sec: "300",
      api_key_hash: "sha256:abc",
      is_active: 1,
    } as Parameters<typeof rowToDevice>[0]);

    expect(device).toEqual({
      keyRotatedAt: null,
      keyVersion: 1,
      lastSeenAt: null,
      previousApiKeyHash: null,
      previousKeyValidUntil: null,
      id: "device-demo-main",
      siteId: "site-demo-01",
      tankId: "tank-demo-main",
      code: "demo-device-01",
      label: "NodeMCU Ultrasonic Demo",
      expectedReportIntervalSec: 300,
      apiKeyHash: "sha256:abc",
      isActive: true,
    });
  });
});
