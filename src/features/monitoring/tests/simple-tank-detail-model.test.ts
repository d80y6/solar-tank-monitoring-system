import { describe, expect, it } from "vitest";
import {
  buildSimpleTankTrend,
  buildSimpleTankDetail,
  sampleSimpleTankDetailChartPoints,
  type SimpleTankDetailChartPoint,
} from "../lib/simple-tank-detail-model";
import { buildTankDetail } from "../lib/tank-detail-view-model";
import type { TankReadingPoint } from "../lib/tank-detail-view-model";
import type { Reading } from "../types/monitoring";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function createReadingPoint(minute: number, volumeLiter: number): TankReadingPoint {
  const receivedAt = new Date(
    Date.UTC(2026, 6, 2, 8, minute, 0),
  ).toISOString();

  return {
    measuredAt: receivedAt,
    receivedAt,
    timeLabel: `${String(8).padStart(2, "0")}.${String(minute).padStart(
      2,
      "0",
    )}`,
    sensorDistanceCm: 10,
    fuelHeightCm: 40,
    volumeLiter,
    fillPercent: 50,
    runtimeHour: 10,
    status: "received",
  };
}

function createChartPoint({
  day,
  hour,
  minute,
  volumeLiter,
}: {
  day: number;
  hour: number;
  minute: number;
  volumeLiter: number;
}): SimpleTankDetailChartPoint {
  const receivedAt = new Date(
    Date.UTC(2026, 6, day, hour, minute, 0) - WIB_OFFSET_MS,
  ).toISOString();

  return {
    fullTimeLabel: "",
    receivedAt,
    timeLabel: "",
    volumeLiter,
  };
}

function createRawReading(index: number, volumeLiter: number): Reading {
  const receivedAt = new Date(
    Date.UTC(2026, 6, 2, 3, 15, index * 15),
  ).toISOString();

  return {
    id: `history-${index}`,
    deviceId: "device-tph-main",
    tankId: "tank-tph-main",
    measuredAt: receivedAt,
    receivedAt,
    sensorDistanceCm: 24.2,
    fuelHeightCm: 35.77,
    volumeLiter,
    fillPercent: 59,
    runtimeHour: 12.69,
  };
}

describe("simple tank detail model", () => {
  it("builds compact detail from tank detail without payload technical fields", () => {
    const detail = buildTankDetail("tank-tph-main", {
      now: new Date("2026-06-25T07:45:00.000Z"),
    });

    if (!detail) {
      throw new Error("Expected TPH tank detail.");
    }

    expect(buildSimpleTankDetail(detail)).toMatchObject({
      siteCode: "TPH",
      deviceCode: "demo-tph-01",
      deviceStatusLabel: "Online",
      volumeLiter: 3900,
      capacityLiter: 5000,
      chartPoints: expect.arrayContaining([
        expect.objectContaining({
          volumeLiter: 3900,
        }),
      ]),
    });
  });

  it("uses raw tank history for the chart, not the trimmed detail series", () => {
    const detail = buildTankDetail("tank-tph-main", {
      now: new Date("2026-06-25T07:45:00.000Z"),
    });

    if (!detail) {
      throw new Error("Expected TPH tank detail.");
    }

    const history = Array.from({ length: 36 }, (_, index) =>
      createRawReading(index, 300 + index),
    );
    const simpleDetail = buildSimpleTankDetail(detail, history);

    expect(simpleDetail.chartPoints).toHaveLength(36);
    expect(simpleDetail.chartPoints[0].volumeLiter).toBe(300);
    expect(simpleDetail.chartPoints.at(-1)?.volumeLiter).toBe(335);
  });

  it("samples chart points at least five minutes apart and keeps the latest point", () => {
    const points = sampleSimpleTankDetailChartPoints(
      [
        createReadingPoint(0, 100),
        createReadingPoint(1, 110),
        createReadingPoint(4, 120),
        createReadingPoint(5, 130),
        createReadingPoint(6, 140),
      ],
      {
        minIntervalMinutes: 5,
      },
    );

    expect(points.map((point) => point.volumeLiter)).toEqual([100, 140]);
  });

  it("limits chart point count from the newest data side", () => {
    const points = sampleSimpleTankDetailChartPoints(
      [
        createReadingPoint(0, 100),
        createReadingPoint(5, 150),
        createReadingPoint(10, 200),
      ],
      {
        maxPoints: 2,
        minIntervalMinutes: 5,
      },
    );

    expect(points.map((point) => point.volumeLiter)).toEqual([150, 200]);
  });

  it("builds daily trend from 00:00 to 23:59 with five-minute buckets", () => {
    const trend = buildSimpleTankTrend(
      [
        createChartPoint({
          day: 2,
          hour: 10,
          minute: 22,
          volumeLiter: 322,
        }),
      ],
      "day",
    );

    expect(trend.totalSlots).toBe(288);
    expect(trend.domainStart).toBe("2026-07-01T17:00:00.000Z");
    expect(trend.domainEnd).toBe("2026-07-02T17:00:00.000Z");
    expect(trend.range.bucketLabel).toBe("5-minute buckets");
    expect(trend.xTicks.map((tick) => tick.label)).toEqual([
      "00:00",
      "06:00",
      "12:00",
      "18:00",
      "23:59",
    ]);
    expect(trend.points[0]).toMatchObject({
      sampleCount: 1,
      timeLabel: "10:20",
      volumeLiter: 322,
    });
    expect(trend.points[0].xRatio).toBeGreaterThan(0.42);
    expect(trend.points[0].xRatio).toBeLessThan(0.44);
  });

  it("computes advanced trend using rollup sample count weights", () => {
    const trend = buildSimpleTankTrend(
      [
        {
          ...createChartPoint({
            day: 2,
            hour: 10,
            minute: 21,
            volumeLiter: 100,
          }),
          sampleCount: 15,
        },
        {
          ...createChartPoint({
            day: 2,
            hour: 10,
            minute: 24,
            volumeLiter: 200,
          }),
          sampleCount: 5,
        },
      ],
      "day",
    );

    expect(trend.points[0]).toMatchObject({
      sampleCount: 20,
      volumeLiter: 125,
    });
  });

  it("breaks trend segments when a data gap exceeds the offline threshold", () => {
    const trend = buildSimpleTankTrend(
      [
        createChartPoint({
          day: 2,
          hour: 10,
          minute: 0,
          volumeLiter: 320,
        }),
        createChartPoint({
          day: 2,
          hour: 10,
          minute: 5,
          volumeLiter: 321,
        }),
        createChartPoint({
          day: 2,
          hour: 10,
          minute: 30,
          volumeLiter: 322,
        }),
      ],
      "day",
    );

    expect(trend.gapThresholdMinutes).toBe(15);
    expect(trend.segments).toHaveLength(2);
    expect(trend.segments.map((segment) => segment.points.length)).toEqual([
      2,
      1,
    ]);
    expect(trend.gaps).toHaveLength(1);
    expect(trend.gaps[0]).toMatchObject({
      durationLabel: "25m",
      thresholdMinutes: 15,
    });
  });

  it("builds monthly trend as a per-date average", () => {
    const trend = buildSimpleTankTrend(
      [
        createChartPoint({
          day: 2,
          hour: 8,
          minute: 0,
          volumeLiter: 300,
        }),
        createChartPoint({
          day: 2,
          hour: 20,
          minute: 0,
          volumeLiter: 500,
        }),
      ],
      "month",
    );

    expect(trend.totalSlots).toBe(30);
    expect(trend.range.bucketLabel).toBe("Daily averages");
    expect(trend.points).toHaveLength(1);
    expect(trend.points[0]).toMatchObject({
      sampleCount: 2,
      volumeLiter: 400,
    });
  });
});
