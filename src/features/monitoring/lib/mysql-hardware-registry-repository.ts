import { randomBytes } from "node:crypto";

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { getMysqlPool } from "@/features/monitoring/lib/mysql-connection";
import {
  rowToFirmwareTemplate,
  rowToHardwareProfile,
} from "@/features/monitoring/lib/mysql-device-request-repository";
import type {
  HardwareBoardFamily,
  HardwareTankShapeSupport,
  MonitoringFirmwareTemplate,
  MonitoringHardwareProfile,
  TankShape,
} from "@/features/monitoring/types/monitoring";

type FirmwareTemplateRow = RowDataPacket & {
  id: string;
  template_key: string;
  version: string;
  display_name: string;
  source_path: string;
  checksum_sha256: string | null;
  is_active: number | boolean;
};

type HardwareProfileRow = RowDataPacket & {
  id: string;
  code: string;
  name: string;
  board_family: string;
  board_label: string;
  sensor_type: string;
  trigger_pin: string;
  echo_pin: string;
  supported_tank_shape: string;
  firmware_template_id: string;
  report_interval_ms: number;
  is_active: number | boolean;
};

export type HardwareProfileUsage = {
  deviceRequestCount: number;
  hardwareProfileId: string;
};

export type FirmwareTemplateUsage = {
  firmwareTemplateId: string;
  hardwareProfileCount: number;
};

function createId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

export async function listAllFirmwareTemplatesFromMysql(): Promise<
  MonitoringFirmwareTemplate[]
> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<FirmwareTemplateRow[]>(
    `SELECT id, template_key, version, display_name, source_path,
            checksum_sha256, is_active
       FROM monitoring_firmware_templates
      ORDER BY template_key ASC, version DESC`,
  );

  return rows.map(rowToFirmwareTemplate);
}

export async function listAllHardwareProfilesFromMysql(): Promise<
  MonitoringHardwareProfile[]
> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<HardwareProfileRow[]>(
    `SELECT id, code, name, board_family, board_label, sensor_type,
            trigger_pin, echo_pin, supported_tank_shape, firmware_template_id,
            report_interval_ms, is_active
       FROM monitoring_hardware_profiles
      ORDER BY name ASC`,
  );

  return rows.map(rowToHardwareProfile);
}

export async function listHardwareProfileUsageFromMysql(): Promise<
  HardwareProfileUsage[]
> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<
    Array<RowDataPacket & { hardware_profile_id: string; request_count: number }>
  >(
    `SELECT hardware_profile_id, COUNT(*) AS request_count
       FROM monitoring_device_requests
      GROUP BY hardware_profile_id`,
  );

  return rows.map((row) => ({
    deviceRequestCount: Number(row.request_count ?? 0),
    hardwareProfileId: row.hardware_profile_id,
  }));
}

export async function listFirmwareTemplateUsageFromMysql(): Promise<
  FirmwareTemplateUsage[]
> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<
    Array<
      RowDataPacket & { firmware_template_id: string; profile_count: number }
    >
  >(
    `SELECT firmware_template_id, COUNT(*) AS profile_count
       FROM monitoring_hardware_profiles
      GROUP BY firmware_template_id`,
  );

  return rows.map((row) => ({
    firmwareTemplateId: row.firmware_template_id,
    hardwareProfileCount: Number(row.profile_count ?? 0),
  }));
}

export async function findFirmwareTemplateFromMysql(
  id: string,
): Promise<MonitoringFirmwareTemplate | null> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<FirmwareTemplateRow[]>(
    `SELECT id, template_key, version, display_name, source_path,
            checksum_sha256, is_active
       FROM monitoring_firmware_templates
      WHERE id = ?
      LIMIT 1`,
    [id],
  );

  return rows[0] ? rowToFirmwareTemplate(rows[0]) : null;
}

export async function createFirmwareTemplateInMysql({
  templateKey,
  version,
  displayName,
  sourcePath,
  checksumSha256,
  isActive,
}: {
  templateKey: string;
  version: string;
  displayName: string;
  sourcePath: string;
  checksumSha256?: string | null;
  isActive: boolean;
}): Promise<MonitoringFirmwareTemplate> {
  const pool = getMysqlPool();
  const id = createId("firmware_template");

  await pool.execute<ResultSetHeader>(
    `INSERT INTO monitoring_firmware_templates
       (id, template_key, version, display_name, source_path, checksum_sha256, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, templateKey, version, displayName, sourcePath, checksumSha256 ?? null, isActive],
  );

  const created = await findFirmwareTemplateFromMysql(id);

  if (!created) {
    throw new Error("The firmware template could not be read back after insert.");
  }

  return created;
}

export async function updateFirmwareTemplateInMysql({
  id,
  displayName,
  sourcePath,
  checksumSha256,
  isActive,
}: {
  id: string;
  displayName: string;
  sourcePath: string;
  checksumSha256?: string | null;
  isActive: boolean;
}): Promise<MonitoringFirmwareTemplate | null> {
  const pool = getMysqlPool();
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE monitoring_firmware_templates
        SET display_name = ?, source_path = ?, checksum_sha256 = ?, is_active = ?
      WHERE id = ?`,
    [displayName, sourcePath, checksumSha256 ?? null, isActive, id],
  );

  if (result.affectedRows === 0) {
    return null;
  }

  return findFirmwareTemplateFromMysql(id);
}

export async function findHardwareProfileFromMysql(
  id: string,
): Promise<MonitoringHardwareProfile | null> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<HardwareProfileRow[]>(
    `SELECT id, code, name, board_family, board_label, sensor_type,
            trigger_pin, echo_pin, supported_tank_shape, firmware_template_id,
            report_interval_ms, is_active
       FROM monitoring_hardware_profiles
      WHERE id = ?
      LIMIT 1`,
    [id],
  );

  return rows[0] ? rowToHardwareProfile(rows[0]) : null;
}

export async function createHardwareProfileInMysql({
  code,
  name,
  boardFamily,
  boardLabel,
  sensorType,
  triggerPin,
  echoPin,
  supportedTankShape,
  firmwareTemplateId,
  reportIntervalMs,
  isActive,
}: {
  code: string;
  name: string;
  boardFamily: HardwareBoardFamily;
  boardLabel: string;
  sensorType: string;
  triggerPin: string;
  echoPin: string;
  supportedTankShape: HardwareTankShapeSupport;
  firmwareTemplateId: string;
  reportIntervalMs: number;
  isActive: boolean;
}): Promise<MonitoringHardwareProfile> {
  const pool = getMysqlPool();
  const id = createId("hardware_profile");

  await pool.execute<ResultSetHeader>(
    `INSERT INTO monitoring_hardware_profiles
       (id, code, name, board_family, board_label, sensor_type, trigger_pin,
        echo_pin, supported_tank_shape, firmware_template_id, report_interval_ms, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      code,
      name,
      boardFamily,
      boardLabel,
      sensorType,
      triggerPin,
      echoPin,
      supportedTankShape,
      firmwareTemplateId,
      reportIntervalMs,
      isActive,
    ],
  );

  const created = await findHardwareProfileFromMysql(id);

  if (!created) {
    throw new Error("The hardware profile could not be read back after insert.");
  }

  return created;
}

export async function updateHardwareProfileInMysql({
  id,
  name,
  boardFamily,
  boardLabel,
  sensorType,
  triggerPin,
  echoPin,
  supportedTankShape,
  firmwareTemplateId,
  reportIntervalMs,
  isActive,
}: {
  id: string;
  name: string;
  boardFamily: HardwareBoardFamily;
  boardLabel: string;
  sensorType: string;
  triggerPin: string;
  echoPin: string;
  supportedTankShape: HardwareTankShapeSupport;
  firmwareTemplateId: string;
  reportIntervalMs: number;
  isActive: boolean;
}): Promise<MonitoringHardwareProfile | null> {
  const pool = getMysqlPool();
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE monitoring_hardware_profiles
        SET name = ?, board_family = ?, board_label = ?, sensor_type = ?,
            trigger_pin = ?, echo_pin = ?, supported_tank_shape = ?,
            firmware_template_id = ?, report_interval_ms = ?, is_active = ?
      WHERE id = ?`,
    [
      name,
      boardFamily,
      boardLabel,
      sensorType,
      triggerPin,
      echoPin,
      supportedTankShape,
      firmwareTemplateId,
      reportIntervalMs,
      isActive,
      id,
    ],
  );

  if (result.affectedRows === 0) {
    return null;
  }

  return findHardwareProfileFromMysql(id);
}

/**
 * Deletion is only offered when nothing references the row: a hardware profile
 * used by an approved device request must stay for audit, and a firmware
 * template used by a profile must stay for package regeneration. Operators get
 * a clear message instead of a foreign-key error.
 */
export async function deleteHardwareProfileFromMysql(
  id: string,
): Promise<{ deleted: boolean; reason?: "not-found" | "in-use"; usageCount?: number }> {
  const pool = getMysqlPool();
  const [usageRows] = await pool.execute<
    Array<RowDataPacket & { request_count: number }>
  >(
    `SELECT COUNT(*) AS request_count
       FROM monitoring_device_requests
      WHERE hardware_profile_id = ?`,
    [id],
  );
  const usageCount = Number(usageRows[0]?.request_count ?? 0);

  if (usageCount > 0) {
    return { deleted: false, reason: "in-use", usageCount };
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `DELETE FROM monitoring_hardware_profiles WHERE id = ?`,
    [id],
  );

  return { deleted: result.affectedRows > 0, reason: result.affectedRows > 0 ? undefined : "not-found" };
}

export async function deleteFirmwareTemplateFromMysql(
  id: string,
): Promise<{ deleted: boolean; reason?: "not-found" | "in-use"; usageCount?: number }> {
  const pool = getMysqlPool();
  const [usageRows] = await pool.execute<
    Array<RowDataPacket & { profile_count: number }>
  >(
    `SELECT COUNT(*) AS profile_count
       FROM monitoring_hardware_profiles
      WHERE firmware_template_id = ?`,
    [id],
  );
  const usageCount = Number(usageRows[0]?.profile_count ?? 0);

  if (usageCount > 0) {
    return { deleted: false, reason: "in-use", usageCount };
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `DELETE FROM monitoring_firmware_templates WHERE id = ?`,
    [id],
  );

  return {
    deleted: result.affectedRows > 0,
    reason: result.affectedRows > 0 ? undefined : "not-found",
  };
}

export const HARDWARE_BOARD_FAMILIES: HardwareBoardFamily[] = [
  "esp8266",
  "esp32",
  "unknown",
];

export const HARDWARE_TANK_SHAPES: HardwareTankShapeSupport[] = [
  "rectangular",
  "horizontal-cylinder",
  "any",
];

export function isHardwareBoardFamily(value: string): value is HardwareBoardFamily {
  return HARDWARE_BOARD_FAMILIES.includes(value as HardwareBoardFamily);
}

export function isHardwareTankShape(value: string): value is HardwareTankShapeSupport {
  return HARDWARE_TANK_SHAPES.includes(value as HardwareTankShapeSupport);
}

export function isTankShape(value: string): value is TankShape {
  return value === "rectangular" || value === "horizontal-cylinder";
}
