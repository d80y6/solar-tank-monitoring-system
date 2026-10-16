import {
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";
import { getMysqlPool } from "./mysql-connection";
import type {
  Reading,
  ReadingQuality,
  ReadingResolution,
} from "../types/monitoring";
import { buildMonitoringRollupWindow } from "./reading-rollup";
import { selectLatestReadingPerTank } from "./latest-reading";

const DEFAULT_MYSQL_READINGS_LIMIT = 1000;
const DEFAULT_MYSQL_TANK_HISTORY_LIMIT = 10_000;

const HISTORY_READING_COLUMN_NAMES = [
  "id",
  "device_id",
  "tank_id",
  "measured_at",
  "received_at",
  "sensor_distance_cm",
  "fuel_height_cm",
  "volume_liter",
  "fill_percent",
  "runtime_hour",
  "battery_volt",
  "rssi_dbm",
  "raw_payload",
  "quality_payload",
  "reading_resolution",
  "bucket_start",
  "bucket_end",
  "sample_count",
  "volume_liter_min",
  "volume_liter_max",
  "fill_percent_min",
  "fill_percent_max",
] as const;

function getHistoryReadingColumns(tableAlias?: string): string {
  return HISTORY_READING_COLUMN_NAMES.map((column) =>
    tableAlias ? `${tableAlias}.${column}` : column,
  ).join(",\n        ");
}

function normalizeLimit(limit: number) {
  return Math.min(Math.max(Math.round(limit), 1), 50_000);
}

type ReadingRow = RowDataPacket & {
  id: string;
  device_id: string;
  tank_id: string;
  measured_at: Date | string;
  received_at: Date | string;
  sensor_distance_cm: number | string;
  fuel_height_cm: number | string;
  volume_liter: number | string;
  fill_percent: number | string;
  runtime_hour: number | string;
  battery_volt: number | string | null;
  rssi_dbm: number | string | null;
  raw_payload: unknown;
  quality_payload: unknown;
  reading_resolution: string;
  bucket_start: Date | string | null;
  bucket_end: Date | string | null;
  sample_count: number | string;
  volume_liter_min: number | string | null;
  volume_liter_max: number | string | null;
  fill_percent_min: number | string | null;
  fill_percent_max: number | string | null;
};

export function formatMysqlUtcDateTime(value: string): string {
  const date = new Date(value);
  const time = date.getTime();

  if (!Number.isFinite(time)) {
    throw new Error("Reading timestamp is invalid.");
  }

  return date.toISOString().slice(0, 23).replace("T", " ");
}

export function parseMysqlDateTimeAsUtc(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const cleanValue = value.trim();
  const hasExplicitTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(cleanValue);
  const normalizedValue = cleanValue.includes("T")
    ? cleanValue
    : cleanValue.replace(" ", "T");
  const isoCandidate = hasExplicitTimezone
    ? normalizedValue
    : `${normalizedValue}Z`;
  const parsedTime = new Date(isoCandidate).getTime();

  if (!Number.isFinite(parsedTime)) {
    throw new Error("Reading timestamp from MySQL is invalid.");
  }

  return new Date(parsedTime).toISOString();
}

function toNumber(value: number | string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOptionalNumber(
  value: number | string | null,
): number | undefined {
  return value === null ? undefined : toNumber(value);
}

function parseJson(value: unknown): unknown {
  if (value === null || typeof value === "undefined") {
    return undefined;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function parseReadingQuality(value: unknown): ReadingQuality | undefined {
  const parsed = parseJson(value);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  return parsed as ReadingQuality;
}

function normalizeReadingResolution(value: string): ReadingResolution {
  return value === "5m" || value === "latest" ? value : "raw";
}

function rowToReading(row: ReadingRow): Reading {
  const batteryVolt = toOptionalNumber(row.battery_volt);
  const rssiDbm = toOptionalNumber(row.rssi_dbm);
  const bucketStart = row.bucket_start
    ? parseMysqlDateTimeAsUtc(row.bucket_start)
    : undefined;
  const bucketEnd = row.bucket_end
    ? parseMysqlDateTimeAsUtc(row.bucket_end)
    : undefined;
  const volumeLiterMin = toOptionalNumber(row.volume_liter_min);
  const volumeLiterMax = toOptionalNumber(row.volume_liter_max);
  const fillPercentMin = toOptionalNumber(row.fill_percent_min);
  const fillPercentMax = toOptionalNumber(row.fill_percent_max);
  const rawPayload = parseJson(row.raw_payload);
  const quality = parseReadingQuality(row.quality_payload);

  return {
    id: row.id,
    deviceId: row.device_id,
    tankId: row.tank_id,
    measuredAt: parseMysqlDateTimeAsUtc(row.measured_at),
    receivedAt: parseMysqlDateTimeAsUtc(row.received_at),
    sensorDistanceCm: toNumber(row.sensor_distance_cm),
    fuelHeightCm: toNumber(row.fuel_height_cm),
    volumeLiter: toNumber(row.volume_liter),
    fillPercent: toNumber(row.fill_percent),
    runtimeHour: toNumber(row.runtime_hour),
    resolution: normalizeReadingResolution(row.reading_resolution),
    sampleCount: Math.max(1, Math.round(toNumber(row.sample_count))),
    ...(typeof batteryVolt === "number" ? { batteryVolt } : {}),
    ...(typeof rssiDbm === "number" ? { rssiDbm } : {}),
    ...(bucketStart ? { bucketStart } : {}),
    ...(bucketEnd ? { bucketEnd } : {}),
    ...(typeof volumeLiterMin === "number" ? { volumeLiterMin } : {}),
    ...(typeof volumeLiterMax === "number" ? { volumeLiterMax } : {}),
    ...(typeof fillPercentMin === "number" ? { fillPercentMin } : {}),
    ...(typeof fillPercentMax === "number" ? { fillPercentMax } : {}),
    ...(typeof rawPayload !== "undefined" ? { rawPayload } : {}),
    ...(quality ? { quality } : {}),
  };
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

async function upsertLatestMonitoringReading(
  connection: PoolConnection,
  reading: Reading,
) {
  await connection.execute(
    `
      INSERT INTO monitoring_latest_readings (
        device_id,
        id,
        tank_id,
        measured_at,
        received_at,
        sensor_distance_cm,
        fuel_height_cm,
        volume_liter,
        fill_percent,
        runtime_hour,
        battery_volt,
        rssi_dbm,
        raw_payload,
        quality_payload
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS incoming
      ON DUPLICATE KEY UPDATE
        id = IF(incoming.received_at >= monitoring_latest_readings.received_at, incoming.id, monitoring_latest_readings.id),
        tank_id = IF(incoming.received_at >= monitoring_latest_readings.received_at, incoming.tank_id, monitoring_latest_readings.tank_id),
        measured_at = IF(incoming.received_at >= monitoring_latest_readings.received_at, incoming.measured_at, monitoring_latest_readings.measured_at),
        sensor_distance_cm = IF(incoming.received_at >= monitoring_latest_readings.received_at, incoming.sensor_distance_cm, monitoring_latest_readings.sensor_distance_cm),
        fuel_height_cm = IF(incoming.received_at >= monitoring_latest_readings.received_at, incoming.fuel_height_cm, monitoring_latest_readings.fuel_height_cm),
        volume_liter = IF(incoming.received_at >= monitoring_latest_readings.received_at, incoming.volume_liter, monitoring_latest_readings.volume_liter),
        fill_percent = IF(incoming.received_at >= monitoring_latest_readings.received_at, incoming.fill_percent, monitoring_latest_readings.fill_percent),
        runtime_hour = IF(incoming.received_at >= monitoring_latest_readings.received_at, incoming.runtime_hour, monitoring_latest_readings.runtime_hour),
        battery_volt = IF(incoming.received_at >= monitoring_latest_readings.received_at, incoming.battery_volt, monitoring_latest_readings.battery_volt),
        rssi_dbm = IF(incoming.received_at >= monitoring_latest_readings.received_at, incoming.rssi_dbm, monitoring_latest_readings.rssi_dbm),
        raw_payload = IF(incoming.received_at >= monitoring_latest_readings.received_at, incoming.raw_payload, monitoring_latest_readings.raw_payload),
        quality_payload = IF(incoming.received_at >= monitoring_latest_readings.received_at, incoming.quality_payload, monitoring_latest_readings.quality_payload),
        received_at = GREATEST(monitoring_latest_readings.received_at, incoming.received_at)
    `,
    [
      reading.deviceId,
      reading.id,
      reading.tankId,
      formatMysqlUtcDateTime(reading.measuredAt),
      formatMysqlUtcDateTime(reading.receivedAt),
      reading.sensorDistanceCm,
      reading.fuelHeightCm,
      reading.volumeLiter,
      reading.fillPercent,
      reading.runtimeHour,
      reading.batteryVolt ?? null,
      reading.rssiDbm ?? null,
      serializeJson(reading.rawPayload),
      serializeJson(reading.quality),
    ],
  );
}

async function upsertFiveMinuteMonitoringRollup(
  connection: PoolConnection,
  reading: Reading,
) {
  const window = buildMonitoringRollupWindow({
    deviceId: reading.deviceId,
    receivedAt: reading.receivedAt,
  });

  await connection.execute(
    `
      INSERT INTO monitoring_readings (
        id,
        device_id,
        tank_id,
        measured_at,
        received_at,
        sensor_distance_cm,
        fuel_height_cm,
        volume_liter,
        fill_percent,
        runtime_hour,
        battery_volt,
        rssi_dbm,
        raw_payload,
        reading_resolution,
        bucket_start,
        bucket_end,
        sample_count,
        volume_liter_min,
        volume_liter_max,
        fill_percent_min,
        fill_percent_max,
        quality_payload
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '5m', ?, ?, 1, ?, ?, ?, ?, ?) AS incoming
      ON DUPLICATE KEY UPDATE
        tank_id = IF(incoming.received_at >= monitoring_readings.received_at, incoming.tank_id, monitoring_readings.tank_id),
        sensor_distance_cm = IF(
          incoming.measured_at = monitoring_readings.measured_at,
          monitoring_readings.sensor_distance_cm,
          (monitoring_readings.sensor_distance_cm * monitoring_readings.sample_count + incoming.sensor_distance_cm) / (monitoring_readings.sample_count + 1)
        ),
        fuel_height_cm = IF(
          incoming.measured_at = monitoring_readings.measured_at,
          monitoring_readings.fuel_height_cm,
          (monitoring_readings.fuel_height_cm * monitoring_readings.sample_count + incoming.fuel_height_cm) / (monitoring_readings.sample_count + 1)
        ),
        volume_liter = IF(
          incoming.measured_at = monitoring_readings.measured_at,
          monitoring_readings.volume_liter,
          (monitoring_readings.volume_liter * monitoring_readings.sample_count + incoming.volume_liter) / (monitoring_readings.sample_count + 1)
        ),
        fill_percent = IF(
          incoming.measured_at = monitoring_readings.measured_at,
          monitoring_readings.fill_percent,
          (monitoring_readings.fill_percent * monitoring_readings.sample_count + incoming.fill_percent) / (monitoring_readings.sample_count + 1)
        ),
        runtime_hour = IF(
          incoming.measured_at = monitoring_readings.measured_at,
          monitoring_readings.runtime_hour,
          (monitoring_readings.runtime_hour * monitoring_readings.sample_count + incoming.runtime_hour) / (monitoring_readings.sample_count + 1)
        ),
        volume_liter_min = IF(incoming.measured_at = monitoring_readings.measured_at, monitoring_readings.volume_liter_min, LEAST(COALESCE(monitoring_readings.volume_liter_min, monitoring_readings.volume_liter), incoming.volume_liter)),
        volume_liter_max = IF(incoming.measured_at = monitoring_readings.measured_at, monitoring_readings.volume_liter_max, GREATEST(COALESCE(monitoring_readings.volume_liter_max, monitoring_readings.volume_liter), incoming.volume_liter)),
        fill_percent_min = IF(incoming.measured_at = monitoring_readings.measured_at, monitoring_readings.fill_percent_min, LEAST(COALESCE(monitoring_readings.fill_percent_min, monitoring_readings.fill_percent), incoming.fill_percent)),
        fill_percent_max = IF(incoming.measured_at = monitoring_readings.measured_at, monitoring_readings.fill_percent_max, GREATEST(COALESCE(monitoring_readings.fill_percent_max, monitoring_readings.fill_percent), incoming.fill_percent)),
        battery_volt = IF(incoming.received_at >= monitoring_readings.received_at, incoming.battery_volt, monitoring_readings.battery_volt),
        rssi_dbm = IF(incoming.received_at >= monitoring_readings.received_at, incoming.rssi_dbm, monitoring_readings.rssi_dbm),
        quality_payload = IF(incoming.received_at >= monitoring_readings.received_at, incoming.quality_payload, monitoring_readings.quality_payload),
        sample_count = monitoring_readings.sample_count + IF(incoming.measured_at = monitoring_readings.measured_at, 0, 1),
        measured_at = IF(incoming.received_at >= monitoring_readings.received_at, incoming.measured_at, monitoring_readings.measured_at),
        received_at = GREATEST(monitoring_readings.received_at, incoming.received_at)
    `,
    [
      window.id,
      reading.deviceId,
      reading.tankId,
      formatMysqlUtcDateTime(reading.measuredAt),
      formatMysqlUtcDateTime(reading.receivedAt),
      reading.sensorDistanceCm,
      reading.fuelHeightCm,
      reading.volumeLiter,
      reading.fillPercent,
      reading.runtimeHour,
      reading.batteryVolt ?? null,
      reading.rssiDbm ?? null,
      formatMysqlUtcDateTime(window.start),
      formatMysqlUtcDateTime(window.end),
      reading.volumeLiter,
      reading.volumeLiter,
      reading.fillPercent,
      reading.fillPercent,
      serializeJson(reading.quality),
    ],
  );
}

export async function saveMonitoringReadingToMysql(
  reading: Reading,
): Promise<Reading> {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await upsertLatestMonitoringReading(connection, reading);
    await upsertFiveMinuteMonitoringRollup(connection, reading);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return reading;
}

export async function checkMonitoringReadingStorageSchemaFromMysql(): Promise<void> {
  const pool = getMysqlPool();

  await pool.query(
    `
      SELECT reading_resolution, bucket_start, bucket_end, sample_count, quality_payload
      FROM monitoring_readings
      LIMIT 0
    `,
  );
  await pool.query(
    `
      SELECT device_id, received_at, quality_payload
      FROM monitoring_latest_readings
      LIMIT 0
    `,
  );
}

export async function listMonitoringReadingsFromMysql(
  limit = DEFAULT_MYSQL_READINGS_LIMIT,
): Promise<Reading[]> {
  const pool = getMysqlPool();
  const safeLimit = normalizeLimit(limit);
  const [rows] = await pool.query<ReadingRow[]>(
    `
      SELECT ${getHistoryReadingColumns()}
      FROM monitoring_readings
      ORDER BY received_at DESC, id DESC
      LIMIT ?
    `,
    [safeLimit],
  );

  return rows.map(rowToReading).reverse();
}

export async function listLatestMonitoringReadingsByTankFromMysql(): Promise<
  Reading[]
> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<ReadingRow[]>(
    `
      SELECT
        latest.id,
        latest.device_id,
        latest.tank_id,
        latest.measured_at,
        latest.received_at,
        latest.sensor_distance_cm,
        latest.fuel_height_cm,
        latest.volume_liter,
        latest.fill_percent,
        latest.runtime_hour,
        latest.battery_volt,
        latest.rssi_dbm,
        latest.raw_payload,
        latest.quality_payload,
        'latest' AS reading_resolution,
        NULL AS bucket_start,
        NULL AS bucket_end,
        1 AS sample_count,
        NULL AS volume_liter_min,
        NULL AS volume_liter_max,
        NULL AS fill_percent_min,
        NULL AS fill_percent_max
      FROM monitoring_latest_readings latest
      JOIN monitoring_tanks tank
        ON tank.id = latest.tank_id
       AND tank.is_active = TRUE

      UNION ALL

      SELECT ${getHistoryReadingColumns("history")}
      FROM monitoring_readings history
      JOIN monitoring_tanks tank
        ON tank.id = history.tank_id
       AND tank.is_active = TRUE
       AND history.id = (
         SELECT newest_history.id
         FROM monitoring_readings newest_history
         WHERE newest_history.tank_id = tank.id
         ORDER BY newest_history.received_at DESC, newest_history.id DESC
         LIMIT 1
       )
    `,
  );

  return selectLatestReadingPerTank(rows.map(rowToReading));
}

export async function listMonitoringReadingsForTankFromMysql(
  tankId: string,
  limit = DEFAULT_MYSQL_TANK_HISTORY_LIMIT,
): Promise<Reading[]> {
  const pool = getMysqlPool();
  const safeLimit = normalizeLimit(limit);
  const [rows] = await pool.query<ReadingRow[]>(
    `
      SELECT ${getHistoryReadingColumns()}
      FROM monitoring_readings
      WHERE tank_id = ?
      ORDER BY received_at DESC, id DESC
      LIMIT ?
    `,
    [tankId, safeLimit],
  );

  return rows.map(rowToReading).reverse();
}

export async function listMonitoringReadingsForTankInRangeFromMysql({
  end,
  start,
  tankId,
}: {
  end: string;
  start: string;
  tankId: string;
}): Promise<Reading[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<ReadingRow[]>(
    `
      SELECT ${getHistoryReadingColumns()}
      FROM monitoring_readings
      WHERE tank_id = ?
        AND received_at >= ?
        AND received_at < ?
      ORDER BY received_at ASC, id ASC
    `,
    [tankId, formatMysqlUtcDateTime(start), formatMysqlUtcDateTime(end)],
  );

  return rows.map(rowToReading);
}
