import { type RowDataPacket } from "mysql2/promise";

import type { Device, Site, Tank, TankShape } from "../types/monitoring";
import {
  normalizeRegionalLabel,
  normalizeWilayahLabel,
} from "./location-taxonomy";
import { getMysqlPool } from "./mysql-connection";

type SiteRow = RowDataPacket & {
  id: string;
  code: string;
  name: string;
  area_label: string;
  regional_label: string | null;
  wilayah_label: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  is_active: number | boolean;
};

type TankRow = RowDataPacket & {
  id: string;
  site_id: string;
  name: string;
  shape: string;
  capacity_liter: number | string;
  diameter_cm: number | string | null;
  length_cm: number | string | null;
  height_cm: number | string | null;
  width_cm: number | string | null;
  sensor_mount_height_cm: number | string;
  low_level_percent: number | string;
  critical_level_percent: number | string;
  consumption_liter_per_hour: number | string;
  is_active: number | boolean;
};

type DeviceRow = RowDataPacket & {
  id: string;
  site_id: string;
  tank_id: string;
  code: string;
  label: string;
  expected_report_interval_sec: number | string;
  api_key_hash: string | null;
  is_active: number | boolean;
  key_version?: number | null;
  previous_api_key_hash?: string | null;
  previous_key_valid_until?: Date | string | null;
  key_rotated_at?: Date | string | null;
  last_seen_at?: Date | string | null;
};

type ReferenceCountRow = RowDataPacket & {
  site_count: number | string;
  tank_count: number | string;
  device_count: number | string;
};

export type MysqlReferenceCounts = {
  sites: number;
  tanks: number;
  devices: number;
};

export type MysqlMonitoringReferenceData = {
  sites: Site[];
  tanks: Tank[];
  devices: Device[];
};

function toBoolean(value: number | boolean): boolean {
  return value === true || value === 1;
}

function toNumber(value: number | string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOptionalNumber(value: number | string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toTankShape(value: string): TankShape {
  return value === "rectangular" ? "rectangular" : "horizontal-cylinder";
}

export function rowToSite(row: SiteRow): Site {
  const latitude = toOptionalNumber(row.latitude);
  const longitude = toOptionalNumber(row.longitude);
  const regionalLabel =
    normalizeRegionalLabel(row.regional_label) ?? row.regional_label ?? undefined;
  const wilayahLabel =
    normalizeWilayahLabel(row.wilayah_label) ?? row.wilayah_label ?? undefined;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    areaLabel: row.area_label,
    ...(regionalLabel ? { regionalLabel } : {}),
    ...(wilayahLabel ? { wilayahLabel } : {}),
    ...(typeof latitude === "number" ? { latitude } : {}),
    ...(typeof longitude === "number" ? { longitude } : {}),
    isActive: toBoolean(row.is_active),
  };
}

export function rowToTank(row: TankRow): Tank {
  const diameterCm = toOptionalNumber(row.diameter_cm);
  const lengthCm = toOptionalNumber(row.length_cm);
  const heightCm = toOptionalNumber(row.height_cm);
  const widthCm = toOptionalNumber(row.width_cm);

  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    shape: toTankShape(row.shape),
    capacityLiter: toNumber(row.capacity_liter),
    ...(typeof diameterCm === "number" ? { diameterCm } : {}),
    ...(typeof lengthCm === "number" ? { lengthCm } : {}),
    ...(typeof heightCm === "number" ? { heightCm } : {}),
    ...(typeof widthCm === "number" ? { widthCm } : {}),
    sensorMountHeightCm: toNumber(row.sensor_mount_height_cm),
    lowLevelPercent: toNumber(row.low_level_percent),
    criticalLevelPercent: toNumber(row.critical_level_percent),
    consumptionLiterPerHour: toNumber(row.consumption_liter_per_hour),
    isActive: toBoolean(row.is_active),
  };
}

function toIsoStringOrNull(value?: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function rowToDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    siteId: row.site_id,
    tankId: row.tank_id,
    code: row.code,
    label: row.label,
    expectedReportIntervalSec: toNumber(row.expected_report_interval_sec),
    apiKeyHash: row.api_key_hash,
    isActive: toBoolean(row.is_active),
    keyVersion: row.key_version === undefined || row.key_version === null
      ? 1
      : toNumber(row.key_version),
    previousApiKeyHash: row.previous_api_key_hash ?? null,
    previousKeyValidUntil: toIsoStringOrNull(row.previous_key_valid_until),
    keyRotatedAt: toIsoStringOrNull(row.key_rotated_at),
    lastSeenAt: toIsoStringOrNull(row.last_seen_at),
  };
}

export async function checkMonitoringLocationTaxonomySchemaFromMysql(): Promise<void> {
  const pool = getMysqlPool();

  await pool.query(
    `
      SELECT
        sites.regional_label,
        sites.wilayah_label,
        requests.regional_label,
        requests.wilayah_label
      FROM monitoring_sites AS sites
      CROSS JOIN monitoring_device_requests AS requests
      LIMIT 0
    `,
  );
}

export async function listMonitoringSitesFromMysql(): Promise<Site[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<SiteRow[]>(
    `
      SELECT
        id,
        code,
        name,
        area_label,
        regional_label,
        wilayah_label,
        latitude,
        longitude,
        is_active
      FROM monitoring_sites
      WHERE is_active = TRUE
      ORDER BY code ASC
    `,
  );

  return rows.map(rowToSite);
}

export async function listMonitoringTanksFromMysql(): Promise<Tank[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<TankRow[]>(
    `
      SELECT
        id,
        site_id,
        name,
        shape,
        capacity_liter,
        diameter_cm,
        length_cm,
        height_cm,
        width_cm,
        sensor_mount_height_cm,
        low_level_percent,
        critical_level_percent,
        consumption_liter_per_hour,
        is_active
      FROM monitoring_tanks
      WHERE is_active = TRUE
      ORDER BY site_id ASC, id ASC
    `,
  );

  return rows.map(rowToTank);
}

export async function listMonitoringDevicesFromMysql(): Promise<Device[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<DeviceRow[]>(
    `
      SELECT
        id,
        site_id,
        tank_id,
        code,
        label,
        expected_report_interval_sec,
        api_key_hash,
        key_version,
        previous_api_key_hash,
        previous_key_valid_until,
        key_rotated_at,
        last_seen_at,
        is_active
      FROM monitoring_devices
      WHERE is_active = TRUE
      ORDER BY code ASC
    `,
  );

  return rows.map(rowToDevice);
}

export async function listMonitoringReferenceFromMysql(): Promise<MysqlMonitoringReferenceData> {
  const [sites, tanks, devices] = await Promise.all([
    listMonitoringSitesFromMysql(),
    listMonitoringTanksFromMysql(),
    listMonitoringDevicesFromMysql(),
  ]);

  return {
    sites,
    tanks,
    devices,
  };
}

export async function countMonitoringReferenceRowsFromMysql(): Promise<MysqlReferenceCounts> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<ReferenceCountRow[]>(
    `
      SELECT
        (SELECT COUNT(*) FROM monitoring_sites WHERE is_active = TRUE) AS site_count,
        (SELECT COUNT(*) FROM monitoring_tanks WHERE is_active = TRUE) AS tank_count,
        (SELECT COUNT(*) FROM monitoring_devices WHERE is_active = TRUE) AS device_count
    `,
  );
  const row = rows[0];

  return {
    sites: toNumber(row?.site_count ?? 0),
    tanks: toNumber(row?.tank_count ?? 0),
    devices: toNumber(row?.device_count ?? 0),
  };
}
