import { describe, expect, it } from "vitest";

import {
  buildReadingExportPeriod,
  createTankReadingsCsv,
  createTankReadingsCsvFilename,
  filterReadingsForExportPeriod,
  parseReadingExportRange,
} from "../lib/readings-export";
import type { Reading } from "../types/monitoring";

const baseReading: Reading = {
  deviceId: "device-1",
  fillPercent: 50,
  fuelHeightCm: 30,
  id: "reading-1",
  measuredAt: "2026-07-07T01:00:00.000Z",
  receivedAt: "2026-07-07T01:00:01.000Z",
  runtimeHour: 20,
  sensorDistanceCm: 30,
  tankId: "tank-1",
  volumeLiter: 500,
};

describe("readings export", () => {
  it("creates stable csv output sorted by received time", () => {
    const csv = createTankReadingsCsv([
      {
        ...baseReading,
        id: "reading-2",
        receivedAt: "2026-07-07T02:00:01.000Z",
      },
      {
        ...baseReading,
        id: "reading-1",
        bucketEnd: "2026-07-07T01:05:00.000Z",
        bucketStart: "2026-07-07T01:00:00.000Z",
        fillPercentMax: 52,
        fillPercentMin: 48,
        resolution: "5m",
        sampleCount: 15,
        volumeLiterMax: 520,
        volumeLiterMin: 480,
        quality: {
          configMismatchReasons: [],
          configSource: "registry",
          configStatus: "normal",
          fillPercentSource: "backend",
          fuelHeightSource: "backend",
          measuredAtSource: "device",
          needsReview: false,
          runtimeSource: "backend",
          volumeSource: "backend",
          warnings: ['value "test", safe'],
        },
        receivedAt: "2026-07-07T01:00:01.000Z",
      },
    ]);
    const lines = csv.trimEnd().split("\r\n");

    expect(lines[0]).toBe(
      "reading_id,tank_id,device_id,measured_at_utc,measured_at_wib,received_at_utc,received_at_wib,sensor_distance_cm,fuel_height_cm,volume_liter,fill_percent,remaining_runtime_hour,battery_volt,rssi_dbm,config_status,needs_review,warnings,resolution,bucket_start_utc,bucket_start_wib,bucket_end_utc,bucket_end_wib,sample_count,volume_min_liter,volume_max_liter,percent_min,percent_max,download_period",
    );
    expect(lines[1]).toContain("reading-1");
    expect(lines[2]).toContain("reading-2");
    expect(lines[1]).toContain('"value ""test"", safe"');
    expect(lines[1]).toContain(",5m,");
    expect(lines[1]).toContain(",15,480,520,48,52,");
    expect(lines[1]).toContain("1 day (July 7, 2026)");
  });

  it("filters export data by the selected calendar range in WIB", () => {
    const readings: Reading[] = [
      {
        ...baseReading,
        id: "before-period",
        receivedAt: "2026-07-06T16:59:59.000Z",
      },
      {
        ...baseReading,
        id: "first-period-reading",
        receivedAt: "2026-07-06T17:00:00.000Z",
      },
      {
        ...baseReading,
        id: "latest-period-reading",
        receivedAt: "2026-07-07T03:00:00.000Z",
      },
    ];
    const period = buildReadingExportPeriod(readings, "day");
    const filteredReadings = filterReadingsForExportPeriod(readings, period);
    const csv = createTankReadingsCsv(readings, { rangeKey: "day" });

    expect(period.label).toBe("1 day (July 7, 2026)");
    expect(filteredReadings.map((reading) => reading.id)).toEqual([
      "first-period-reading",
      "latest-period-reading",
    ]);
    expect(csv).toContain("first-period-reading");
    expect(csv).not.toContain("before-period");
  });

  it("normalizes export ranges and creates predictable filenames", () => {
    const period = buildReadingExportPeriod([baseReading], "week");
    const filename = createTankReadingsCsvFilename({
      period,
      siteCode: "STO Psr-01",
      tankId: "tank-1",
      tankName: "Main Tank",
    });

    expect(parseReadingExportRange(null)).toBe("day");
    expect(parseReadingExportRange("7d")).toBe("week");
    expect(parseReadingExportRange("unknown")).toBeNull();
    expect(period.label).toBe("7 days (July 1, 2026 to July 7, 2026)");
    expect(filename).toBe(
      "solartank_sto-psr-01_main-tank_reading_7-days_2026-07-01_to_2026-07-07.csv",
    );
  });
});
