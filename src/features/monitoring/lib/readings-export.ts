import type { Reading } from "../types/monitoring";
import {
  SIMPLE_TANK_CHART_RANGES,
  type SimpleTankChartRange,
  type SimpleTankChartRangeKey,
} from "./simple-tank-detail-model";

const TANK_READING_CSV_HEADERS = [
  "reading_id",
  "tank_id",
  "device_id",
  "measured_at_utc",
  "measured_at_wib",
  "received_at_utc",
  "received_at_wib",
  "sensor_distance_cm",
  "fuel_height_cm",
  "volume_liter",
  "fill_percent",
  "remaining_runtime_hour",
  "battery_volt",
  "rssi_dbm",
  "config_status",
  "needs_review",
  "warnings",
  "resolution",
  "bucket_start_utc",
  "bucket_start_wib",
  "bucket_end_utc",
  "bucket_end_wib",
  "sample_count",
  "volume_min_liter",
  "volume_max_liter",
  "percent_min",
  "percent_max",
  "download_period",
] as const;

const DISPLAY_TIME_ZONE = "Asia/Jakarta";
const DISPLAY_TIME_ZONE_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReadingExportRangeKey = SimpleTankChartRangeKey;

export type ReadingExportPeriod = {
  range: SimpleTankChartRange;
  start: Date;
  end: Date;
  label: string;
  filenameSegment: string;
};

export type ReadingExportOptions = {
  period?: ReadingExportPeriod;
  rangeKey?: ReadingExportRangeKey;
};

export type TankReadingsCsvFilenameOptions = {
  siteCode?: string | null;
  tankId: string;
  tankName: string;
  period: ReadingExportPeriod;
};

const READING_EXPORT_RANGE_ALIASES: Record<string, ReadingExportRangeKey> = {
  "1d": "day",
  "24h": "day",
  day: "day",
  harian: "day",
  daily: "day",
  "7d": "week",
  week: "week",
  mingguan: "week",
  weekly: "week",
  "30d": "month",
  month: "month",
  bulanan: "month",
  monthly: "month",
};

function escapeCsvValue(value: string | number | boolean | null | undefined) {
  if (typeof value === "undefined" || value === null) {
    return "";
  }

  const text = String(value);

  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}

function sortReadingsByReceivedAt(readings: Reading[]): Reading[] {
  return [...readings].sort(
    (first, second) =>
      new Date(first.receivedAt).getTime() -
      new Date(second.receivedAt).getTime(),
  );
}

function parseTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function startOfDisplayDay(time: number) {
  const date = new Date(time + DISPLAY_TIME_ZONE_OFFSET_MS);
  date.setUTCHours(0, 0, 0, 0);

  return new Date(date.getTime() - DISPLAY_TIME_ZONE_OFFSET_MS);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function getChartRange(rangeKey: ReadingExportRangeKey) {
  return (
    SIMPLE_TANK_CHART_RANGES.find((range) => range.key === rangeKey) ??
    SIMPLE_TANK_CHART_RANGES[0]
  );
}

function formatCsvDateTime(value: string) {
  const time = parseTime(value);

  if (time === null) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    second: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
  })
    .format(new Date(time))
    .replaceAll(".", ":");
}

function formatPeriodDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
  }).format(date);
}

function formatFilenameDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((dateParts, part) => {
      if (part.type !== "literal") {
        dateParts[part.type] = part.value;
      }

      return dateParts;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function sanitizeFilenameSegment(value: string): string {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return clean || "data";
}

export function parseReadingExportRange(
  value: string | null | undefined,
): ReadingExportRangeKey | null {
  if (!value) {
    return "day";
  }

  return READING_EXPORT_RANGE_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function getReadingExportRangeLabel(rangeKey: ReadingExportRangeKey) {
  return getChartRange(rangeKey).label;
}

export function buildReadingExportPeriod(
  readings: Reading[],
  rangeKey: ReadingExportRangeKey = "day",
): ReadingExportPeriod {
  const range = getChartRange(rangeKey);
  const sortedReadings = sortReadingsByReceivedAt(readings);
  const latestTime =
    sortedReadings
      .map((reading) => parseTime(reading.receivedAt))
      .filter((time): time is number => time !== null)
      .at(-1) ?? Date.now();
  const latestDayStart = startOfDisplayDay(latestTime);
  const start = addDays(latestDayStart, -(range.days - 1));
  const end = addDays(latestDayStart, 1);
  const lastDisplayDate = new Date(end.getTime() - 1);
  const startDateLabel = formatPeriodDate(start);
  const endDateLabel = formatPeriodDate(lastDisplayDate);
  const startFilenameDate = formatFilenameDate(start);
  const endFilenameDate = formatFilenameDate(lastDisplayDate);
  const dateRangeLabel =
    startDateLabel === endDateLabel
      ? startDateLabel
      : `${startDateLabel} to ${endDateLabel}`;
  const filenameDateRange =
    startFilenameDate === endFilenameDate
      ? startFilenameDate
      : `${startFilenameDate}_to_${endFilenameDate}`;

  return {
    end,
    filenameSegment: `${sanitizeFilenameSegment(range.label)}_${filenameDateRange}`,
    label: `${range.label} (${dateRangeLabel})`,
    range,
    start,
  };
}

export function filterReadingsForExportPeriod(
  readings: Reading[],
  period: ReadingExportPeriod,
): Reading[] {
  const startTime = period.start.getTime();
  const endTime = period.end.getTime();

  return sortReadingsByReceivedAt(readings).filter((reading) => {
    const receivedTime = parseTime(reading.receivedAt);

    return (
      receivedTime !== null &&
      receivedTime >= startTime &&
      receivedTime < endTime
    );
  });
}

export function createTankReadingsCsv(
  readings: Reading[],
  options: ReadingExportOptions = {},
): string {
  const period =
    options.period ?? buildReadingExportPeriod(readings, options.rangeKey);
  const rows = filterReadingsForExportPeriod(readings, period).map((reading) => [
    reading.id,
    reading.tankId,
    reading.deviceId,
    reading.measuredAt,
    formatCsvDateTime(reading.measuredAt),
    reading.receivedAt,
    formatCsvDateTime(reading.receivedAt),
    reading.sensorDistanceCm,
    reading.fuelHeightCm,
    reading.volumeLiter,
    reading.fillPercent,
    reading.runtimeHour,
    reading.batteryVolt,
    reading.rssiDbm,
    reading.quality?.configStatus,
    reading.quality?.needsReview,
    reading.quality?.warnings.join(" | "),
    reading.resolution ?? "raw",
    reading.bucketStart,
    reading.bucketStart ? formatCsvDateTime(reading.bucketStart) : undefined,
    reading.bucketEnd,
    reading.bucketEnd ? formatCsvDateTime(reading.bucketEnd) : undefined,
    reading.sampleCount ?? 1,
    reading.volumeLiterMin ?? reading.volumeLiter,
    reading.volumeLiterMax ?? reading.volumeLiter,
    reading.fillPercentMin ?? reading.fillPercent,
    reading.fillPercentMax ?? reading.fillPercent,
    period.label,
  ]);

  return [
    TANK_READING_CSV_HEADERS.join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ].join("\r\n").concat("\r\n");
}

export function createTankReadingsCsvFilename({
  period,
  siteCode,
  tankId,
  tankName,
}: TankReadingsCsvFilenameOptions): string {
  return [
    "solartank",
    sanitizeFilenameSegment(siteCode ?? tankId),
    sanitizeFilenameSegment(tankName),
    "reading",
    period.filenameSegment,
  ].join("_").concat(".csv");
}
