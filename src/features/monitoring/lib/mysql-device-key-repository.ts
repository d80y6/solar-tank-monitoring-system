import { randomUUID } from "node:crypto";

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { getMysqlPool } from "./mysql-connection";
import { createDeviceKey, hashDeviceKey } from "./device-key";
import { rowToDevice } from "./mysql-reference-repository";
import type { Device } from "../types/monitoring";

const DEFAULT_GRACE_HOURS = 72;
const MAX_GRACE_HOURS = 24 * 14;

export type DeviceKeyRotationResult =
  | {
      ok: true;
      device: Device;
      deviceKey: string;
      keyVersion: number;
      previousKeyValidUntil: string;
    }
  | { ok: false; reason: "not-found" | "inactive" };

export type MonitoringDeviceAdminRow = {
  device: Device;
  tankLabel: string | null;
  siteCode: string | null;
  siteName: string | null;
  lastReadingAt: string | null;
  fillPercent: number | null;
  previousKeyValidUntil: string | null;
  keyRotatedAt: string | null;
};

type DeviceAdminRow = RowDataPacket & {
  api_key_hash: string | null;
  area_label: string | null;
  code: string;
  expected_report_interval_sec: number | string;
  fill_percent: number | string | null;
  id: string;
  is_active: number | boolean;
  key_rotated_at: Date | null;
  key_version: number | null;
  label: string;
  last_received_at: Date | null;
  last_seen_at: Date | null;
  previous_api_key_hash: string | null;
  previous_key_valid_until: Date | null;
  site_code: string | null;
  site_id: string;
  site_name: string | null;
  tank_id: string;
  tank_name: string | null;
};

function toNumber(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function getDeviceKeyGraceHours(
  envValue = process.env.DEVICE_KEY_ROTATION_GRACE_HOURS,
): number {
  const parsed = Number(envValue);

  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_GRACE_HOURS) {
    return parsed;
  }

  return DEFAULT_GRACE_HOURS;
}

export async function listMonitoringDevicesForAdminFromMysql(): Promise<
  MonitoringDeviceAdminRow[]
> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<DeviceAdminRow[]>(
    `SELECT
        devices.id,
        devices.site_id,
        devices.tank_id,
        devices.code,
        devices.label,
        devices.expected_report_interval_sec,
        devices.api_key_hash,
        devices.key_version,
        devices.previous_api_key_hash,
        devices.previous_key_valid_until,
        devices.key_rotated_at,
        devices.last_seen_at,
        devices.is_active,
        tanks.name AS tank_name,
        sites.code AS site_code,
        sites.name AS site_name,
        sites.area_label,
        latest.fill_percent,
        latest.received_at AS last_received_at
      FROM monitoring_devices AS devices
      LEFT JOIN monitoring_tanks AS tanks ON tanks.id = devices.tank_id
      LEFT JOIN monitoring_sites AS sites ON sites.id = devices.site_id
      LEFT JOIN monitoring_latest_readings AS latest
        ON latest.device_id = devices.id
      ORDER BY devices.code ASC
      LIMIT 500`,
  );

  return rows.map((row) => ({
    device: rowToDevice(row),
    fillPercent:
      row.fill_percent === null ? null : toNumber(row.fill_percent),
    keyRotatedAt: toIso(row.key_rotated_at),
    lastReadingAt: toIso(row.last_received_at),
    previousKeyValidUntil: toIso(row.previous_key_valid_until),
    siteCode: row.site_code,
    siteName: row.site_name,
    tankLabel: row.tank_name,
  }));
}

export async function setMonitoringDeviceActiveStateInMysql({
  actorLabel,
  actorUserId,
  deviceId,
  isActive,
}: {
  actorLabel?: string | null;
  actorUserId: string;
  deviceId: string;
  isActive: boolean;
}): Promise<Device | null> {
  const pool = getMysqlPool();
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE monitoring_devices
        SET is_active = ?
      WHERE id = ?`,
    [isActive ? 1 : 0, deviceId],
  );

  if (result.affectedRows === 0) {
    return null;
  }

  await recordDeviceKeyEvent({
    actorLabel: actorLabel ?? null,
    actorUserId,
    deviceId,
    eventType: isActive ? "grace_extended" : "revoked",
    keyVersion: await getDeviceKeyVersion(deviceId),
    note: isActive
      ? "Device re-enabled by an administrator."
      : "Device disabled by an administrator.",
  });

  return getMonitoringDeviceByIdFromMysql(deviceId);
}

export async function getMonitoringDeviceByIdFromMysql(
  deviceId: string,
): Promise<Device | null> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<DeviceAdminRow[]>(
    `SELECT
        devices.id,
        devices.site_id,
        devices.tank_id,
        devices.code,
        devices.label,
        devices.expected_report_interval_sec,
        devices.api_key_hash,
        devices.key_version,
        devices.previous_api_key_hash,
        devices.previous_key_valid_until,
        devices.key_rotated_at,
        devices.last_seen_at,
        devices.is_active,
        NULL AS tank_name,
        NULL AS site_code,
        NULL AS site_name,
        NULL AS area_label,
        NULL AS fill_percent,
        NULL AS last_received_at
      FROM monitoring_devices AS devices
      WHERE devices.id = ?
      LIMIT 1`,
    [deviceId],
  );

  return rows[0] ? rowToDevice(rows[0]) : null;
}

async function getDeviceKeyVersion(deviceId: string): Promise<number> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<
    Array<RowDataPacket & { key_version: number | null }>
  >(
    `SELECT key_version FROM monitoring_devices WHERE id = ? LIMIT 1`,
    [deviceId],
  );

  return Number(rows[0]?.key_version ?? 1);
}

export async function recordDeviceKeyEvent({
  actorLabel,
  actorUserId,
  deviceId,
  eventType,
  keyVersion,
  note,
}: {
  actorLabel?: string | null;
  actorUserId?: string | null;
  deviceId: string;
  eventType: "rotated" | "grace_extended" | "grace_expired" | "revoked";
  keyVersion: number;
  note?: string | null;
}): Promise<void> {
  const pool = getMysqlPool();

  await pool.execute(
    `INSERT INTO monitoring_device_key_events (
       id,
       device_id,
       event_type,
       key_version,
       actor_user_id,
       actor_label,
       note
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      `device_key_evt_${randomUUID()}`,
      deviceId,
      eventType,
      keyVersion,
      actorUserId ?? null,
      actorLabel ?? null,
      note ?? null,
    ],
  );
}

/**
 * Rotates a device key.
 *
 * The previous hash stays valid for a grace window so the device in the field
 * keeps reporting until it is re-flashed. The new key is returned exactly once
 * and is never stored in plaintext.
 */
export async function rotateMonitoringDeviceKeyInMysql({
  actorLabel,
  actorUserId,
  deviceId,
  graceHours = getDeviceKeyGraceHours(),
  now = new Date(),
}: {
  actorLabel?: string | null;
  actorUserId: string;
  deviceId: string;
  graceHours?: number;
  now?: Date;
}): Promise<DeviceKeyRotationResult> {
  const pool = getMysqlPool();
  const existing = await getMonitoringDeviceByIdFromMysql(deviceId);

  if (!existing) {
    return { ok: false, reason: "not-found" };
  }

  if (!existing.isActive) {
    return { ok: false, reason: "inactive" };
  }

  const deviceKey = createDeviceKey();
  const nextVersion = (existing.keyVersion ?? 1) + 1;
  const graceValidUntil = new Date(now.getTime() + graceHours * 60 * 60 * 1_000);

  await pool.execute(
    `UPDATE monitoring_devices
        SET api_key_hash = ?,
            key_version = ?,
            previous_api_key_hash = api_key_hash,
            previous_key_valid_until = ?,
            key_rotated_at = ?,
            key_rotated_by_user_id = ?
      WHERE id = ?`,
    [
      hashDeviceKey(deviceKey),
      nextVersion,
      graceValidUntil,
      now,
      actorUserId,
      deviceId,
    ],
  );

  await recordDeviceKeyEvent({
    actorLabel: actorLabel ?? null,
    actorUserId,
    deviceId,
    eventType: "rotated",
    keyVersion: nextVersion,
    note: `Previous key accepted until ${graceValidUntil.toISOString()}.`,
  });

  const updated = await getMonitoringDeviceByIdFromMysql(deviceId);

  if (!updated) {
    return { ok: false, reason: "not-found" };
  }

  return {
    device: updated,
    deviceKey,
    keyVersion: nextVersion,
    ok: true,
    previousKeyValidUntil: graceValidUntil.toISOString(),
  };
}

/**
 * Records last-seen information and marks devices whose telemetry arrived,
 * which the alert rules use as the authoritative freshness signal.
 */
export async function touchMonitoringDeviceLastSeenInMysql({
  deviceId,
  seenAt,
}: {
  deviceId: string;
  seenAt: Date;
}): Promise<void> {
  const pool = getMysqlPool();

  await pool.execute(
    `UPDATE monitoring_devices
        SET last_seen_at = GREATEST(COALESCE(last_seen_at, ?), ?)
      WHERE id = ?`,
    [seenAt, seenAt, deviceId],
  );
}
