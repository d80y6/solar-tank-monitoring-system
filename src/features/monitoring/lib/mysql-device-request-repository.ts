import { randomBytes } from "node:crypto";

import type { PoolConnection, RowDataPacket } from "mysql2/promise";

import type {
  DeviceRequestDraft,
  DeviceRequestStatus,
  DeviceRequestValidationIssue,
  DeviceSensorType,
  FirmwarePackageStatus,
  HardwareBoardFamily,
  HardwareTankShapeSupport,
  LoadPowerUnit,
  MonitoringDeviceRequest,
  MonitoringFirmwarePackage,
  MonitoringFirmwareTemplate,
  MonitoringHardwareProfile,
  Device,
  Site,
  Tank,
  TankShape,
} from "../types/monitoring";
import { buildPendingDeviceRequest } from "./device-request";
import {
  createDeviceKey,
  hashDeviceKey,
  verifyDeviceKeyHash,
} from "./device-key";
import {
  createDownloadExpiresAt,
  createDownloadToken,
  createFirmwarePackageBundle,
  decryptFirmwarePackage,
  encryptFirmwarePackage,
  getDevicePackageMaxDownloads,
  hashDownloadToken,
} from "./firmware-package";
import {
  DEFAULT_REGIONAL_LABEL,
  DEFAULT_WILAYAH_LABEL,
  normalizeRegionalLabel,
  normalizeWilayahLabel,
} from "./location-taxonomy";
import { getMysqlPool } from "./mysql-connection";

const DEVICE_REQUEST_STATUSES: DeviceRequestStatus[] = [
  "pending_admin_review",
  "rejected",
  "approved_waiting_package",
  "approved_package_ready",
  "waiting_firmware_download",
  "waiting_first_valid_ping",
  "active",
  "expired",
  "revoked",
  "package_generation_failed",
];

const FIRMWARE_PACKAGE_STATUSES: FirmwarePackageStatus[] = [
  "ready",
  "downloaded",
  "expired",
  "revoked",
  "activated",
  "failed",
];

const BLOCKING_DEVICE_REQUEST_STATUSES: DeviceRequestStatus[] = [
  "pending_admin_review",
  "approved_waiting_package",
  "approved_package_ready",
  "waiting_firmware_download",
  "waiting_first_valid_ping",
  "active",
];

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
  report_interval_ms: number | string;
  is_active: number | boolean;
};

type DeviceRequestRow = RowDataPacket & {
  id: string;
  request_code: string;
  requester_user_id: string;
  requester_email: string;
  status: string;
  site_code: string;
  site_name: string;
  area_label: string;
  regional_label: string | null;
  wilayah_label: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  device_code: string;
  device_label: string;
  device_sensor_type: string;
  tank_shape: string;
  capacity_liter: number | string;
  length_cm: number | string | null;
  width_cm: number | string | null;
  height_cm: number | string | null;
  diameter_cm: number | string | null;
  sensor_mount_height_cm: number | string;
  load_value: number | string | null;
  load_unit: string;
  diesel_engine_capacity_kva: number | string | null;
  cos_phi: number | string | null;
  low_level_percent: number | string;
  critical_level_percent: number | string;
  consumption_liter_per_hour: number | string;
  hardware_profile_id: string;
  firmware_template_id: string;
  admin_reviewed_by_user_id: string | null;
  admin_reviewed_at: Date | string | null;
  rejection_reason: string | null;
  validation_warnings_json: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

type FirmwarePackageRow = RowDataPacket & {
  id: string;
  request_id: string;
  device_id: string | null;
  package_status: string;
  device_key_hash: string;
  download_token_hash: string;
  download_expires_at: Date | string;
  download_count: number | string;
  max_download_count: number | string;
  package_filename: string;
  package_size_bytes: number | string;
  package_checksum_sha256: string | null;
  package_ciphertext: Buffer | null;
  package_iv: Buffer | null;
  package_auth_tag: Buffer | null;
  content_type: string;
  firmware_template_id: string;
  hardware_profile_id: string;
  generated_at: Date | string;
  first_downloaded_at: Date | string | null;
  activated_at: Date | string | null;
  revoked_at: Date | string | null;
};

type SiteIdRow = RowDataPacket & {
  id: string;
};

type ExistingDeviceRow = RowDataPacket & {
  id: string;
};

type ExistingDeviceRequestRow = RowDataPacket & {
  id: string;
  request_code: string;
  status: string;
};

type PendingDeviceActivationRow = RowDataPacket & {
  device_id: string;
  device_site_id: string;
  device_tank_id: string;
  device_code: string;
  device_label: string;
  expected_report_interval_sec: number | string;
  device_api_key_hash: string | null;
  device_is_active: number | boolean;
  site_id: string;
  site_code: string;
  site_name: string;
  area_label: string;
  regional_label: string | null;
  wilayah_label: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  site_is_active: number | boolean;
  tank_id: string;
  tank_site_id: string;
  tank_name: string;
  tank_shape: string;
  capacity_liter: number | string;
  diameter_cm: number | string | null;
  length_cm: number | string | null;
  height_cm: number | string | null;
  width_cm: number | string | null;
  sensor_mount_height_cm: number | string;
  low_level_percent: number | string;
  critical_level_percent: number | string;
  consumption_liter_per_hour: number | string;
  tank_is_active: number | boolean;
  package_id: string;
  package_status: string;
  package_device_key_hash: string;
  request_id: string;
  request_status: string;
};

export type CreateDeviceRequestFromMysqlResult =
  | {
      ok: true;
      request: MonitoringDeviceRequest;
      warnings: DeviceRequestValidationIssue[];
    }
  | {
      ok: false;
      issues: DeviceRequestValidationIssue[];
      message: string;
    };

export type ApprovedDeviceRequestPackageResult = {
  downloadExpiresAt: string;
  downloadToken: string;
  package: MonitoringFirmwarePackage;
  request: MonitoringDeviceRequest;
};

export type DownloadDevicePackageResult =
  | {
      ok: true;
      content: Buffer;
      contentType: string;
      filename: string;
    }
  | {
      ok: false;
      status: 400 | 404 | 410 | 429 | 500;
      message: string;
    };

export type DevicePackageAdminMutationResult = {
  downloadExpiresAt: string;
  downloadToken: string;
  package: MonitoringFirmwarePackage;
  request: MonitoringDeviceRequest;
};

export type ActivateApprovedDeviceResult =
  | {
      ok: true;
      device: Device;
      site: Site;
      tank: Tank;
    }
  | {
      ok: false;
      reason: "not-found" | "invalid-key" | "not-ready" | "revoked";
    };

function toBoolean(value: number | boolean): boolean {
  return value === true || value === 1;
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOptionalNumber(
  value: number | string | null | undefined,
): number | undefined {
  if (value === null || typeof value === "undefined") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isDeviceRequestStatus(value: string): value is DeviceRequestStatus {
  return DEVICE_REQUEST_STATUSES.includes(value as DeviceRequestStatus);
}

function isFirmwarePackageStatus(value: string): value is FirmwarePackageStatus {
  return FIRMWARE_PACKAGE_STATUSES.includes(value as FirmwarePackageStatus);
}

function toDeviceRequestStatus(value: string): DeviceRequestStatus {
  return isDeviceRequestStatus(value) ? value : "pending_admin_review";
}

function toTankShape(value: string): TankShape {
  return value === "rectangular" ? "rectangular" : "horizontal-cylinder";
}

function toDeviceSensorType(value: string | undefined): DeviceSensorType {
  return value === "energy" ? "energy" : "fuel";
}

function toLoadPowerUnit(value: string | undefined): LoadPowerUnit {
  return value === "kva" ? "kva" : "kw";
}

function rowToActivationSite(row: PendingDeviceActivationRow): Site {
  const latitude = toOptionalNumber(row.latitude);
  const longitude = toOptionalNumber(row.longitude);
  const regionalLabel =
    normalizeRegionalLabel(row.regional_label) ?? DEFAULT_REGIONAL_LABEL;
  const wilayahLabel =
    normalizeWilayahLabel(row.wilayah_label) ?? DEFAULT_WILAYAH_LABEL;

  return {
    id: row.site_id,
    code: row.site_code,
    name: row.site_name,
    areaLabel: row.area_label,
    regionalLabel,
    wilayahLabel,
    ...(typeof latitude === "number" ? { latitude } : {}),
    ...(typeof longitude === "number" ? { longitude } : {}),
    isActive: true,
  };
}

function rowToActivationTank(row: PendingDeviceActivationRow): Tank {
  const diameterCm = toOptionalNumber(row.diameter_cm);
  const lengthCm = toOptionalNumber(row.length_cm);
  const heightCm = toOptionalNumber(row.height_cm);
  const widthCm = toOptionalNumber(row.width_cm);

  return {
    id: row.tank_id,
    siteId: row.tank_site_id,
    name: row.tank_name,
    shape: toTankShape(row.tank_shape),
    capacityLiter: toNumber(row.capacity_liter),
    ...(typeof diameterCm === "number" ? { diameterCm } : {}),
    ...(typeof lengthCm === "number" ? { lengthCm } : {}),
    ...(typeof heightCm === "number" ? { heightCm } : {}),
    ...(typeof widthCm === "number" ? { widthCm } : {}),
    sensorMountHeightCm: toNumber(row.sensor_mount_height_cm),
    lowLevelPercent: toNumber(row.low_level_percent),
    criticalLevelPercent: toNumber(row.critical_level_percent),
    consumptionLiterPerHour: toNumber(row.consumption_liter_per_hour),
    isActive: true,
  };
}

function rowToActivationDevice(row: PendingDeviceActivationRow): Device {
  return {
    id: row.device_id,
    siteId: row.device_site_id,
    tankId: row.device_tank_id,
    code: row.device_code,
    label: row.device_label,
    expectedReportIntervalSec: toNumber(row.expected_report_interval_sec),
    apiKeyHash: row.device_api_key_hash ?? row.package_device_key_hash,
    isActive: true,
  };
}

function toBoardFamily(value: string): HardwareBoardFamily {
  if (value === "esp8266" || value === "esp32") {
    return value;
  }

  return "unknown";
}

function toTankShapeSupport(value: string): HardwareTankShapeSupport {
  if (
    value === "rectangular" ||
    value === "horizontal-cylinder" ||
    value === "any"
  ) {
    return value;
  }

  return "any";
}

function parseMysqlDateTimeAsUtc(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const cleanValue = value.trim();
  if (!cleanValue) {
    return null;
  }

  const hasExplicitTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(cleanValue);
  const normalizedValue = cleanValue.includes("T")
    ? cleanValue
    : cleanValue.replace(" ", "T");
  const parsedTime = Date.parse(
    hasExplicitTimezone ? normalizedValue : `${normalizedValue}Z`,
  );

  return Number.isFinite(parsedTime) ? new Date(parsedTime).toISOString() : null;
}

function parseRequiredMysqlDateTimeAsUtc(value: Date | string): string {
  const isoValue = parseMysqlDateTimeAsUtc(value);

  if (!isoValue) {
    throw new Error("Device request timestamp from MySQL is invalid.");
  }

  return isoValue;
}

function formatMysqlDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();

  if (!Number.isFinite(time)) {
    throw new Error("Device request timestamp is invalid.");
  }

  return date.toISOString().slice(0, 23).replace("T", " ");
}

function isValidationIssue(value: unknown): value is DeviceRequestValidationIssue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const issue = value as Partial<DeviceRequestValidationIssue>;

  return (
    typeof issue.field === "string" &&
    typeof issue.message === "string" &&
    (issue.severity === "error" || issue.severity === "warning")
  );
}

function parseValidationWarnings(value: unknown): DeviceRequestValidationIssue[] {
  let parsedValue = value;

  if (typeof value === "string" && value.trim()) {
    try {
      parsedValue = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsedValue)) {
    return [];
  }

  return parsedValue.filter(isValidationIssue);
}

function createProvisioningEventId(): string {
  return `provisioning_event_${randomBytes(18).toString("base64url")}`;
}

function normalizeRejectionReason(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function rowToFirmwareTemplate(
  row: FirmwareTemplateRow,
): MonitoringFirmwareTemplate {
  return {
    id: row.id,
    templateKey: row.template_key,
    version: row.version,
    displayName: row.display_name,
    sourcePath: row.source_path,
    checksumSha256: row.checksum_sha256,
    isActive: toBoolean(row.is_active),
  };
}

export function rowToHardwareProfile(
  row: HardwareProfileRow,
): MonitoringHardwareProfile {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    boardFamily: toBoardFamily(row.board_family),
    boardLabel: row.board_label,
    sensorType: row.sensor_type,
    triggerPin: row.trigger_pin,
    echoPin: row.echo_pin,
    supportedTankShape: toTankShapeSupport(row.supported_tank_shape),
    firmwareTemplateId: row.firmware_template_id,
    reportIntervalMs: toNumber(row.report_interval_ms),
    isActive: toBoolean(row.is_active),
  };
}

export function rowToDeviceRequest(row: DeviceRequestRow): MonitoringDeviceRequest {
  const latitude = toOptionalNumber(row.latitude);
  const longitude = toOptionalNumber(row.longitude);
  const lengthCm = toOptionalNumber(row.length_cm);
  const widthCm = toOptionalNumber(row.width_cm);
  const heightCm = toOptionalNumber(row.height_cm);
  const diameterCm = toOptionalNumber(row.diameter_cm);
  const regionalLabel =
    normalizeRegionalLabel(row.regional_label) ?? DEFAULT_REGIONAL_LABEL;
  const wilayahLabel =
    normalizeWilayahLabel(row.wilayah_label) ?? DEFAULT_WILAYAH_LABEL;

  return {
    id: row.id,
    requestCode: row.request_code,
    requesterUserId: row.requester_user_id,
    requesterEmail: row.requester_email,
    status: toDeviceRequestStatus(row.status),
    siteCode: row.site_code,
    siteName: row.site_name,
    areaLabel: row.area_label,
    regionalLabel,
    wilayahLabel,
    ...(typeof latitude === "number" ? { latitude } : {}),
    ...(typeof longitude === "number" ? { longitude } : {}),
    deviceCode: row.device_code,
    deviceLabel: row.device_label,
    deviceSensorType: toDeviceSensorType(row.device_sensor_type),
    tankShape: toTankShape(row.tank_shape),
    capacityLiter: toNumber(row.capacity_liter),
    ...(typeof lengthCm === "number" ? { lengthCm } : {}),
    ...(typeof widthCm === "number" ? { widthCm } : {}),
    ...(typeof heightCm === "number" ? { heightCm } : {}),
    ...(typeof diameterCm === "number" ? { diameterCm } : {}),
    sensorMountHeightCm: toNumber(row.sensor_mount_height_cm),
    loadValue: toNumber(row.load_value),
    loadUnit: toLoadPowerUnit(row.load_unit),
    dieselEngineCapacityKva: toNumber(row.diesel_engine_capacity_kva),
    cosPhi: toNumber(row.cos_phi),
    lowLevelPercent: toNumber(row.low_level_percent),
    criticalLevelPercent: toNumber(row.critical_level_percent),
    consumptionLiterPerHour: toNumber(row.consumption_liter_per_hour),
    hardwareProfileId: row.hardware_profile_id,
    firmwareTemplateId: row.firmware_template_id,
    adminReviewedByUserId: row.admin_reviewed_by_user_id,
    adminReviewedAt: parseMysqlDateTimeAsUtc(row.admin_reviewed_at),
    rejectionReason: row.rejection_reason,
    validationWarnings: parseValidationWarnings(row.validation_warnings_json),
    createdAt: parseRequiredMysqlDateTimeAsUtc(row.created_at),
    updatedAt: parseRequiredMysqlDateTimeAsUtc(row.updated_at),
  };
}

export function rowToFirmwarePackage(
  row: FirmwarePackageRow,
): MonitoringFirmwarePackage {
  return {
    id: row.id,
    requestId: row.request_id,
    deviceId: row.device_id,
    packageStatus: isFirmwarePackageStatus(row.package_status)
      ? row.package_status
      : "failed",
    deviceKeyHash: row.device_key_hash,
    downloadTokenHash: row.download_token_hash,
    downloadExpiresAt: parseRequiredMysqlDateTimeAsUtc(row.download_expires_at),
    downloadCount: toNumber(row.download_count),
    maxDownloadCount: toNumber(row.max_download_count),
    packageFilename: row.package_filename,
    packageSizeBytes: toNumber(row.package_size_bytes),
    packageChecksumSha256: row.package_checksum_sha256,
    firmwareTemplateId: row.firmware_template_id,
    hardwareProfileId: row.hardware_profile_id,
    generatedAt: parseRequiredMysqlDateTimeAsUtc(row.generated_at),
    firstDownloadedAt: parseMysqlDateTimeAsUtc(row.first_downloaded_at),
    activatedAt: parseMysqlDateTimeAsUtc(row.activated_at),
    revokedAt: parseMysqlDateTimeAsUtc(row.revoked_at),
  };
}

function createSafeIdSegment(value: string, fallback: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || fallback
  );
}

function buildRegistryIdsForRequest(request: MonitoringDeviceRequest) {
  const siteSegment = createSafeIdSegment(request.siteCode, "sto");
  const deviceSegment = createSafeIdSegment(request.deviceCode, "device");

  return {
    deviceId: `device-${deviceSegment}`,
    fallbackSiteId: `site-${siteSegment}`,
    tankId: `tank-${deviceSegment}-main`,
  };
}

async function findHardwareProfileById({
  connection,
  hardwareProfileId,
}: {
  connection: PoolConnection;
  hardwareProfileId: string;
}): Promise<MonitoringHardwareProfile> {
  const [rows] = await connection.execute<HardwareProfileRow[]>(
    `
      SELECT
        id,
        code,
        name,
        board_family,
        board_label,
        sensor_type,
        trigger_pin,
        echo_pin,
        supported_tank_shape,
        firmware_template_id,
        report_interval_ms,
        is_active
      FROM monitoring_hardware_profiles
      WHERE id = ?
      LIMIT 1
    `,
    [hardwareProfileId],
  );
  const row = rows[0];

  if (!row) {
    throw new Error("Request hardware profile not found.");
  }

  return rowToHardwareProfile(row);
}

async function findFirmwareTemplateById({
  connection,
  firmwareTemplateId,
}: {
  connection: PoolConnection;
  firmwareTemplateId: string;
}): Promise<MonitoringFirmwareTemplate> {
  const [rows] = await connection.execute<FirmwareTemplateRow[]>(
    `
      SELECT
        id,
        template_key,
        version,
        display_name,
        source_path,
        checksum_sha256,
        is_active
      FROM monitoring_firmware_templates
      WHERE id = ?
      LIMIT 1
    `,
    [firmwareTemplateId],
  );
  const row = rows[0];

  if (!row) {
    throw new Error("Request firmware template not found.");
  }

  return rowToFirmwareTemplate(row);
}

async function findPackageForUpdateByToken({
  connection,
  downloadToken,
}: {
  connection: PoolConnection;
  downloadToken: string;
}): Promise<FirmwarePackageRow | null> {
  const [rows] = await connection.execute<FirmwarePackageRow[]>(
    `
      SELECT *
      FROM monitoring_device_packages
      WHERE download_token_hash = ?
      LIMIT 1
      FOR UPDATE
    `,
    [hashDownloadToken(downloadToken)],
  );

  return rows[0] ?? null;
}

async function findLatestPackageForRequestForUpdate({
  connection,
  requestId,
}: {
  connection: PoolConnection;
  requestId: string;
}): Promise<FirmwarePackageRow | null> {
  const [rows] = await connection.execute<FirmwarePackageRow[]>(
    `
      SELECT *
      FROM monitoring_device_packages
      WHERE request_id = ?
      ORDER BY generated_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
    `,
    [requestId],
  );

  return rows[0] ?? null;
}

async function findPackageById({
  connection,
  packageId,
}: {
  connection: PoolConnection;
  packageId: string;
}): Promise<MonitoringFirmwarePackage> {
  const [rows] = await connection.execute<FirmwarePackageRow[]>(
    `
      SELECT *
      FROM monitoring_device_packages
      WHERE id = ?
      LIMIT 1
    `,
    [packageId],
  );
  const row = rows[0];

  if (!row) {
    throw new Error("Firmware package not found after update.");
  }

  return rowToFirmwarePackage(row);
}

export async function listFirmwareTemplatesFromMysql({
  activeOnly = false,
}: {
  activeOnly?: boolean;
} = {}): Promise<MonitoringFirmwareTemplate[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<FirmwareTemplateRow[]>(
    `
      SELECT
        id,
        template_key,
        version,
        display_name,
        source_path,
        checksum_sha256,
        is_active
      FROM monitoring_firmware_templates
      ${activeOnly ? "WHERE is_active = TRUE" : ""}
      ORDER BY template_key ASC, version DESC
    `,
  );

  return rows.map(rowToFirmwareTemplate);
}

export async function listHardwareProfilesFromMysql({
  activeOnly = false,
}: {
  activeOnly?: boolean;
} = {}): Promise<MonitoringHardwareProfile[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<HardwareProfileRow[]>(
    `
      SELECT
        hp.id,
        hp.code,
        hp.name,
        hp.board_family,
        hp.board_label,
        hp.sensor_type,
        hp.trigger_pin,
        hp.echo_pin,
        hp.supported_tank_shape,
        hp.firmware_template_id,
        hp.report_interval_ms,
        hp.is_active
      FROM monitoring_hardware_profiles hp
      INNER JOIN monitoring_firmware_templates ft
        ON ft.id = hp.firmware_template_id
      ${activeOnly ? "WHERE hp.is_active = TRUE AND ft.is_active = TRUE" : ""}
      ORDER BY hp.name ASC
    `,
  );

  return rows.map(rowToHardwareProfile);
}

export async function listDeviceRequestsForUserFromMysql(
  requesterUserId: string,
): Promise<MonitoringDeviceRequest[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<DeviceRequestRow[]>(
    `
      SELECT *
      FROM monitoring_device_requests
      WHERE requester_user_id = ?
      ORDER BY created_at DESC, request_code DESC
      LIMIT 100
    `,
    [requesterUserId],
  );

  return rows.map(rowToDeviceRequest);
}

export async function listDeviceRequestsForAdminFromMysql(): Promise<
  MonitoringDeviceRequest[]
> {
  const pool = getMysqlPool();
  const [rows] = await pool.query<DeviceRequestRow[]>(
    `
      SELECT *
      FROM monitoring_device_requests
      ORDER BY
        CASE status
          WHEN 'pending_admin_review' THEN 0
          WHEN 'approved_waiting_package' THEN 1
          WHEN 'approved_package_ready' THEN 2
          ELSE 3
        END ASC,
        created_at DESC,
        request_code DESC
      LIMIT 200
    `,
  );

  return rows.map(rowToDeviceRequest);
}

async function assertDeviceCodeIsAvailable({
  connection,
  deviceCode,
}: {
  connection: PoolConnection;
  deviceCode: string;
}) {
  const [deviceRows] = await connection.execute<ExistingDeviceRow[]>(
    `
      SELECT id
      FROM monitoring_devices
      WHERE code = ?
      LIMIT 1
    `,
    [deviceCode],
  );

  if (deviceRows.length > 0) {
    throw new Error(
      "Device code is already used in the active registry. Use a different device code.",
    );
  }

  const blockingStatusPlaceholders = BLOCKING_DEVICE_REQUEST_STATUSES.map(
    () => "?",
  ).join(", ");
  const [requestRows] = await connection.execute<ExistingDeviceRequestRow[]>(
    `
      SELECT id, request_code, status
      FROM monitoring_device_requests
      WHERE device_code = ?
        AND status IN (${blockingStatusPlaceholders})
      LIMIT 1
    `,
    [deviceCode, ...BLOCKING_DEVICE_REQUEST_STATUSES],
  );
  const existingRequest = requestRows[0];

  if (existingRequest) {
    throw new Error(
      `Device code is still in use by request ${existingRequest.request_code}. Complete that request first or use a different code.`,
    );
  }
}

async function insertProvisioningEvent({
  actorUserId,
  connection,
  eventType,
  metadata,
  packageId,
  requestId,
}: {
  actorUserId?: string | null;
  connection: PoolConnection;
  eventType: string;
  metadata?: Record<string, unknown> | null;
  packageId?: string | null;
  requestId?: string | null;
}) {
  await connection.execute(
    `
      INSERT INTO monitoring_device_provisioning_events (
        id,
        request_id,
        package_id,
        actor_user_id,
        event_type,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      createProvisioningEventId(),
      requestId ?? null,
      packageId ?? null,
      actorUserId ?? null,
      eventType,
      stringifyJson(metadata ?? null),
    ],
  );
}

export async function createDeviceRequestInMysql({
  draft,
  requesterEmail,
  requesterUserId,
}: {
  draft: DeviceRequestDraft;
  requesterEmail: string;
  requesterUserId: string;
}): Promise<CreateDeviceRequestFromMysqlResult> {
  const [firmwareTemplates, hardwareProfiles] = await Promise.all([
    listFirmwareTemplatesFromMysql({ activeOnly: true }),
    listHardwareProfilesFromMysql({ activeOnly: true }),
  ]);
  const buildResult = buildPendingDeviceRequest({
    draft,
    firmwareTemplates,
    hardwareProfiles,
    requesterEmail,
    requesterUserId,
  });

  if (!buildResult.ok) {
    return {
      ok: false,
      issues: buildResult.validation.errors,
      message: "Device request data is incomplete or invalid.",
    };
  }

  const { request } = buildResult;
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await assertDeviceCodeIsAvailable({
      connection,
      deviceCode: request.deviceCode,
    });

    await connection.execute(
      `
        INSERT INTO monitoring_device_requests (
          id,
          request_code,
          requester_user_id,
          requester_email,
          status,
          site_code,
          site_name,
          area_label,
          regional_label,
          wilayah_label,
          latitude,
          longitude,
          device_code,
          device_label,
          device_sensor_type,
          tank_shape,
          capacity_liter,
          length_cm,
          width_cm,
          height_cm,
          diameter_cm,
          sensor_mount_height_cm,
          load_value,
          load_unit,
          diesel_engine_capacity_kva,
          cos_phi,
          low_level_percent,
          critical_level_percent,
          consumption_liter_per_hour,
          hardware_profile_id,
          firmware_template_id,
          validation_warnings_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        request.id,
        request.requestCode,
        request.requesterUserId,
        request.requesterEmail,
        request.status,
        request.siteCode,
        request.siteName,
        request.areaLabel,
        request.regionalLabel,
        request.wilayahLabel,
        request.latitude ?? null,
        request.longitude ?? null,
        request.deviceCode,
        request.deviceLabel,
        request.deviceSensorType,
        request.tankShape,
        request.capacityLiter,
        request.lengthCm ?? null,
        request.widthCm ?? null,
        request.heightCm ?? null,
        request.diameterCm ?? null,
        request.sensorMountHeightCm,
        request.loadValue,
        request.loadUnit,
        request.dieselEngineCapacityKva,
        request.cosPhi,
        request.lowLevelPercent,
        request.criticalLevelPercent,
        request.consumptionLiterPerHour,
        request.hardwareProfileId,
        request.firmwareTemplateId,
        stringifyJson(request.validationWarnings),
        formatMysqlDateTime(request.createdAt),
        formatMysqlDateTime(request.updatedAt),
      ],
    );

    await insertProvisioningEvent({
      actorUserId: request.requesterUserId,
      connection,
      eventType: "device_request_created",
      metadata: {
        deviceCode: request.deviceCode,
        deviceSensorType: request.deviceSensorType,
        dieselEngineCapacityKva: request.dieselEngineCapacityKva,
        loadUnit: request.loadUnit,
        loadValue: request.loadValue,
        regionalLabel: request.regionalLabel,
        requestCode: request.requestCode,
        siteCode: request.siteCode,
        wilayahLabel: request.wilayahLabel,
      },
      requestId: request.id,
    });

    await connection.commit();

    return {
      ok: true,
      request,
      warnings: buildResult.validation.warnings,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function findDeviceRequestForUpdate({
  connection,
  requestId,
}: {
  connection: PoolConnection;
  requestId: string;
}): Promise<MonitoringDeviceRequest> {
  const [rows] = await connection.execute<DeviceRequestRow[]>(
    `
      SELECT *
      FROM monitoring_device_requests
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [requestId],
  );
  const row = rows[0];

  if (!row) {
    throw new Error("Device request not found.");
  }

  return rowToDeviceRequest(row);
}

async function findDeviceRequestById({
  connection,
  requestId,
}: {
  connection: PoolConnection;
  requestId: string;
}): Promise<MonitoringDeviceRequest> {
  const [rows] = await connection.execute<DeviceRequestRow[]>(
    `
      SELECT *
      FROM monitoring_device_requests
      WHERE id = ?
      LIMIT 1
    `,
    [requestId],
  );
  const row = rows[0];

  if (!row) {
    throw new Error("Device request not found after update.");
  }

  return rowToDeviceRequest(row);
}

async function resolveOrCreateInactiveSite({
  connection,
  request,
}: {
  connection: PoolConnection;
  request: MonitoringDeviceRequest;
}): Promise<string> {
  const { fallbackSiteId } = buildRegistryIdsForRequest(request);
  const [siteRows] = await connection.execute<SiteIdRow[]>(
    `
      SELECT id
      FROM monitoring_sites
      WHERE code = ?
      LIMIT 1
      FOR UPDATE
    `,
    [request.siteCode],
  );
  const existingSite = siteRows[0];

  if (existingSite) {
    await connection.execute(
      `
        UPDATE monitoring_sites
        SET
          name = ?,
          area_label = ?,
          regional_label = ?,
          wilayah_label = ?,
          latitude = ?,
          longitude = ?
        WHERE id = ?
      `,
      [
        request.siteName,
        request.areaLabel,
        request.regionalLabel,
        request.wilayahLabel,
        request.latitude ?? null,
        request.longitude ?? null,
        existingSite.id,
      ],
    );

    return existingSite.id;
  }

  await connection.execute(
    `
      INSERT INTO monitoring_sites (
        id,
        code,
        name,
        area_label,
        regional_label,
        wilayah_label,
        latitude,
        longitude,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE)
    `,
    [
      fallbackSiteId,
      request.siteCode,
      request.siteName,
      request.areaLabel,
      request.regionalLabel,
      request.wilayahLabel,
      request.latitude ?? null,
      request.longitude ?? null,
    ],
  );

  return fallbackSiteId;
}

async function createInactiveRegistryForApprovedRequest({
  connection,
  deviceKeyHash,
  expectedReportIntervalSec,
  request,
}: {
  connection: PoolConnection;
  deviceKeyHash: string;
  expectedReportIntervalSec: number;
  request: MonitoringDeviceRequest;
}): Promise<string> {
  const siteId = await resolveOrCreateInactiveSite({ connection, request });
  const { deviceId, tankId } = buildRegistryIdsForRequest(request);

  await connection.execute(
    `
      INSERT INTO monitoring_tanks (
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
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)
      ON DUPLICATE KEY UPDATE
        site_id = VALUES(site_id),
        name = VALUES(name),
        shape = VALUES(shape),
        capacity_liter = VALUES(capacity_liter),
        diameter_cm = VALUES(diameter_cm),
        length_cm = VALUES(length_cm),
        height_cm = VALUES(height_cm),
        width_cm = VALUES(width_cm),
        sensor_mount_height_cm = VALUES(sensor_mount_height_cm),
        low_level_percent = VALUES(low_level_percent),
        critical_level_percent = VALUES(critical_level_percent),
        consumption_liter_per_hour = VALUES(consumption_liter_per_hour),
        is_active = FALSE
    `,
    [
      tankId,
      siteId,
      "Main tank",
      request.tankShape,
      request.capacityLiter,
      request.diameterCm ?? null,
      request.lengthCm ?? null,
      request.heightCm ?? null,
      request.widthCm ?? null,
      request.sensorMountHeightCm,
      request.lowLevelPercent,
      request.criticalLevelPercent,
      request.consumptionLiterPerHour,
    ],
  );

  await connection.execute(
    `
      INSERT INTO monitoring_devices (
        id,
        site_id,
        tank_id,
        code,
        label,
        expected_report_interval_sec,
        api_key_hash,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)
      ON DUPLICATE KEY UPDATE
        site_id = VALUES(site_id),
        tank_id = VALUES(tank_id),
        label = VALUES(label),
        expected_report_interval_sec = VALUES(expected_report_interval_sec),
        api_key_hash = VALUES(api_key_hash),
        is_active = FALSE
    `,
    [
      deviceId,
      siteId,
      tankId,
      request.deviceCode,
      request.deviceLabel,
      expectedReportIntervalSec,
      deviceKeyHash,
    ],
  );

  return deviceId;
}

async function insertFirmwarePackage({
  connection,
  deviceId,
  deviceKeyHash,
  downloadExpiresAt,
  downloadToken,
  encryptedPackage,
  firmwareTemplateId,
  generatedAt,
  hardwareProfileId,
  packageChecksumSha256,
  packageFilename,
  packageSizeBytes,
  requestId,
}: {
  connection: PoolConnection;
  deviceId: string;
  deviceKeyHash: string;
  downloadExpiresAt: Date;
  downloadToken: string;
  encryptedPackage: {
    authTag: Buffer;
    ciphertext: Buffer;
    iv: Buffer;
  };
  firmwareTemplateId: string;
  generatedAt: Date;
  hardwareProfileId: string;
  packageChecksumSha256: string;
  packageFilename: string;
  packageSizeBytes: number;
  requestId: string;
}): Promise<MonitoringFirmwarePackage> {
  const packageId = `device_package_${randomBytes(18).toString("base64url")}`;
  const maxDownloadCount = getDevicePackageMaxDownloads();

  await connection.execute(
    `
      INSERT INTO monitoring_device_packages (
        id,
        request_id,
        device_id,
        package_status,
        device_key_hash,
        download_token_hash,
        download_expires_at,
        download_count,
        max_download_count,
        package_filename,
        package_size_bytes,
        package_checksum_sha256,
        package_ciphertext,
        package_iv,
        package_auth_tag,
        content_type,
        firmware_template_id,
        hardware_profile_id,
        generated_at
      )
      VALUES (?, ?, ?, 'ready', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'application/zip', ?, ?, ?)
    `,
    [
      packageId,
      requestId,
      deviceId,
      deviceKeyHash,
      hashDownloadToken(downloadToken),
      formatMysqlDateTime(downloadExpiresAt),
      maxDownloadCount,
      packageFilename,
      packageSizeBytes,
      packageChecksumSha256,
      encryptedPackage.ciphertext,
      encryptedPackage.iv,
      encryptedPackage.authTag,
      firmwareTemplateId,
      hardwareProfileId,
      formatMysqlDateTime(generatedAt),
    ],
  );

  const [rows] = await connection.execute<FirmwarePackageRow[]>(
    `
      SELECT *
      FROM monitoring_device_packages
      WHERE id = ?
      LIMIT 1
    `,
    [packageId],
  );
  const row = rows[0];

  if (!row) {
    throw new Error("Firmware package could not be read after creation.");
  }

  return rowToFirmwarePackage(row);
}

async function createPackageForRequest({
  appBaseUrl,
  connection,
  request,
}: {
  appBaseUrl: string;
  connection: PoolConnection;
  request: MonitoringDeviceRequest;
}): Promise<DevicePackageAdminMutationResult> {
  const hardwareProfile = await findHardwareProfileById({
    connection,
    hardwareProfileId: request.hardwareProfileId,
  });
  const firmwareTemplate = await findFirmwareTemplateById({
    connection,
    firmwareTemplateId: request.firmwareTemplateId,
  });

  if (!hardwareProfile.isActive || !firmwareTemplate.isActive) {
    throw new Error(
      "Hardware profile or firmware template is not active. Activate it after confirmation first.",
    );
  }

  const deviceKey = createDeviceKey();
  const deviceKeyHash = hashDeviceKey(deviceKey);
  const firmwarePackage = await createFirmwarePackageBundle({
    appBaseUrl,
    deviceKey,
    firmwareTemplate,
    hardwareProfile,
    request,
  });
  const encryptedPackage = encryptFirmwarePackage(firmwarePackage.zipBuffer);
  const downloadToken = createDownloadToken();
  const downloadExpiresAt = createDownloadExpiresAt(firmwarePackage.generatedAt);
  const deviceId = await createInactiveRegistryForApprovedRequest({
    connection,
    deviceKeyHash,
    expectedReportIntervalSec: Math.max(
      Math.round(hardwareProfile.reportIntervalMs / 1000),
      5,
    ),
    request,
  });
  const devicePackage = await insertFirmwarePackage({
    connection,
    deviceId,
    deviceKeyHash,
    downloadExpiresAt,
    downloadToken,
    encryptedPackage,
    firmwareTemplateId: request.firmwareTemplateId,
    generatedAt: firmwarePackage.generatedAt,
    hardwareProfileId: request.hardwareProfileId,
    packageChecksumSha256: firmwarePackage.checksumSha256,
    packageFilename: firmwarePackage.filename,
    packageSizeBytes: firmwarePackage.zipBuffer.length,
    requestId: request.id,
  });

  return {
    downloadExpiresAt: downloadExpiresAt.toISOString(),
    downloadToken,
    package: devicePackage,
    request,
  };
}

export async function approveDeviceRequestInMysql({
  adminUserId,
  appBaseUrl,
  requestId,
}: {
  adminUserId: string;
  appBaseUrl: string;
  requestId: string;
}): Promise<ApprovedDeviceRequestPackageResult> {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();
  const reviewedAt = new Date();

  try {
    await connection.beginTransaction();
    const request = await findDeviceRequestForUpdate({ connection, requestId });

    if (request.status !== "pending_admin_review") {
      throw new Error("This device request has already been processed.");
    }

    const packageResult = await createPackageForRequest({
      appBaseUrl,
      connection,
      request,
    });

    await connection.execute(
      `
        UPDATE monitoring_device_requests
        SET
          status = 'approved_package_ready',
          admin_reviewed_by_user_id = ?,
          admin_reviewed_at = ?,
          rejection_reason = NULL
        WHERE id = ?
      `,
      [adminUserId, formatMysqlDateTime(reviewedAt), requestId],
    );

    await insertProvisioningEvent({
      actorUserId: adminUserId,
      connection,
      eventType: "firmware_package_created",
      metadata: {
        deviceCode: request.deviceCode,
        packageChecksumSha256: packageResult.package.packageChecksumSha256,
        packageFilename: packageResult.package.packageFilename,
        requestCode: request.requestCode,
      },
      packageId: packageResult.package.id,
      requestId,
    });

    const updatedRequest = await findDeviceRequestById({ connection, requestId });
    await connection.commit();

    return {
      downloadExpiresAt: packageResult.downloadExpiresAt,
      downloadToken: packageResult.downloadToken,
      package: packageResult.package,
      request: updatedRequest,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function recordFirmwarePackageEmailDeliveryInMysql({
  adminUserId,
  delivered,
  delivery,
  errorReason,
  packageId,
  requestId,
}: {
  adminUserId: string;
  delivered: boolean;
  delivery: string;
  errorReason?: string;
  packageId: string;
  requestId: string;
}): Promise<void> {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (delivered) {
      await connection.execute(
        `
          UPDATE monitoring_device_requests
          SET status = 'waiting_firmware_download'
          WHERE id = ?
            AND status = 'approved_package_ready'
        `,
        [requestId],
      );
    }

    await insertProvisioningEvent({
      actorUserId: adminUserId,
      connection,
      eventType: delivered
        ? "firmware_package_email_delivered"
        : "firmware_package_email_failed",
      metadata: {
        delivery,
        ...(errorReason ? { errorReason } : {}),
      },
      packageId,
      requestId,
    });

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function refreshDevicePackageDownloadTokenInMysql({
  adminUserId,
  requestId,
}: {
  adminUserId: string;
  requestId: string;
}): Promise<DevicePackageAdminMutationResult> {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const request = await findDeviceRequestForUpdate({ connection, requestId });

    if (
      request.status !== "approved_package_ready" &&
      request.status !== "waiting_firmware_download" &&
      request.status !== "waiting_first_valid_ping"
    ) {
      throw new Error(
        "Firmware link can only be resent for devices whose package has been created and is not yet active.",
      );
    }

    const packageRow = await findLatestPackageForRequestForUpdate({
      connection,
      requestId,
    });

    if (!packageRow) {
      throw new Error("Firmware package is not available for this request yet.");
    }

    const devicePackage = rowToFirmwarePackage(packageRow);

    if (
      devicePackage.packageStatus === "revoked" ||
      devicePackage.packageStatus === "expired" ||
      devicePackage.packageStatus === "failed" ||
      devicePackage.packageStatus === "activated"
    ) {
      throw new Error(
        "This firmware package cannot be resent. Recreate the package if it is still needed.",
      );
    }

    const downloadToken = createDownloadToken();
    const downloadExpiresAt = createDownloadExpiresAt(new Date());

    await connection.execute(
      `
        UPDATE monitoring_device_packages
        SET
          download_token_hash = ?,
          download_expires_at = ?,
          download_count = 0,
          max_download_count = ?,
          package_status = CASE
            WHEN package_status = 'downloaded' THEN 'downloaded'
            ELSE 'ready'
          END
        WHERE id = ?
      `,
      [
        hashDownloadToken(downloadToken),
        formatMysqlDateTime(downloadExpiresAt),
        getDevicePackageMaxDownloads(),
        devicePackage.id,
      ],
    );

    if (request.status === "approved_package_ready") {
      await connection.execute(
        `
          UPDATE monitoring_device_requests
          SET status = 'waiting_firmware_download'
          WHERE id = ?
        `,
        [requestId],
      );
    }

    await insertProvisioningEvent({
      actorUserId: adminUserId,
      connection,
      eventType: "firmware_package_download_link_refreshed",
      metadata: {
        deviceCode: request.deviceCode,
        requestCode: request.requestCode,
      },
      packageId: devicePackage.id,
      requestId,
    });

    const updatedPackage = await findPackageById({
      connection,
      packageId: devicePackage.id,
    });
    const updatedRequest = await findDeviceRequestById({
      connection,
      requestId,
    });
    await connection.commit();

    return {
      downloadExpiresAt: downloadExpiresAt.toISOString(),
      downloadToken,
      package: updatedPackage,
      request: updatedRequest,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function reissueDevicePackageInMysql({
  adminUserId,
  appBaseUrl,
  requestId,
}: {
  adminUserId: string;
  appBaseUrl: string;
  requestId: string;
}): Promise<DevicePackageAdminMutationResult> {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const request = await findDeviceRequestForUpdate({ connection, requestId });

    if (
      request.status === "pending_admin_review" ||
      request.status === "rejected" ||
      request.status === "revoked"
    ) {
      throw new Error(
        "Firmware package can only be regenerated after the request is approved.",
      );
    }

    if (request.status === "active") {
      throw new Error(
        "Active devices are not automatically regenerated from here. Revoke access first if the key needs to be replaced.",
      );
    }

    await connection.execute(
      `
        UPDATE monitoring_device_packages
        SET
          package_status = 'revoked',
          revoked_at = COALESCE(revoked_at, ?)
        WHERE request_id = ?
          AND package_status IN ('ready', 'downloaded', 'expired', 'failed')
      `,
      [formatMysqlDateTime(new Date()), requestId],
    );

    const packageResult = await createPackageForRequest({
      appBaseUrl,
      connection,
      request,
    });

    await connection.execute(
      `
        UPDATE monitoring_device_requests
        SET
          status = 'approved_package_ready',
          admin_reviewed_by_user_id = ?,
          admin_reviewed_at = COALESCE(admin_reviewed_at, ?)
        WHERE id = ?
      `,
      [adminUserId, formatMysqlDateTime(new Date()), requestId],
    );

    await insertProvisioningEvent({
      actorUserId: adminUserId,
      connection,
      eventType: "firmware_package_reissued",
      metadata: {
        deviceCode: request.deviceCode,
        packageChecksumSha256: packageResult.package.packageChecksumSha256,
        packageFilename: packageResult.package.packageFilename,
        requestCode: request.requestCode,
      },
      packageId: packageResult.package.id,
      requestId,
    });

    const updatedRequest = await findDeviceRequestById({ connection, requestId });
    await connection.commit();

    return {
      ...packageResult,
      request: updatedRequest,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function revokeDeviceProvisioningInMysql({
  adminUserId,
  requestId,
}: {
  adminUserId: string;
  requestId: string;
}): Promise<MonitoringDeviceRequest> {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const request = await findDeviceRequestForUpdate({ connection, requestId });

    if (
      request.status === "pending_admin_review" ||
      request.status === "rejected" ||
      request.status === "revoked"
    ) {
      throw new Error(
        "This request does not have an active device access that can be revoked.",
      );
    }

    await connection.execute(
      `
        UPDATE monitoring_devices d
        INNER JOIN monitoring_device_packages p
          ON p.device_id = d.id
        SET d.is_active = FALSE
        WHERE p.request_id = ?
      `,
      [requestId],
    );
    await connection.execute(
      `
        UPDATE monitoring_device_packages
        SET
          package_status = 'revoked',
          revoked_at = COALESCE(revoked_at, ?)
        WHERE request_id = ?
          AND package_status <> 'revoked'
      `,
      [formatMysqlDateTime(new Date()), requestId],
    );
    await connection.execute(
      `
        UPDATE monitoring_device_requests
        SET status = 'revoked'
        WHERE id = ?
      `,
      [requestId],
    );

    await insertProvisioningEvent({
      actorUserId: adminUserId,
      connection,
      eventType: "device_provisioning_revoked",
      metadata: {
        deviceCode: request.deviceCode,
        requestCode: request.requestCode,
      },
      requestId,
    });

    const updatedRequest = await findDeviceRequestById({ connection, requestId });
    await connection.commit();

    return updatedRequest;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function findPendingDeviceActivationForUpdate({
  connection,
  deviceIdentifier,
}: {
  connection: PoolConnection;
  deviceIdentifier: string;
}): Promise<PendingDeviceActivationRow | null> {
  const [rows] = await connection.execute<PendingDeviceActivationRow[]>(
    `
      SELECT
        d.id AS device_id,
        d.site_id AS device_site_id,
        d.tank_id AS device_tank_id,
        d.code AS device_code,
        d.label AS device_label,
        d.expected_report_interval_sec,
        d.api_key_hash AS device_api_key_hash,
        d.is_active AS device_is_active,
        s.id AS site_id,
        s.code AS site_code,
        s.name AS site_name,
        s.area_label,
        s.regional_label,
        s.wilayah_label,
        s.latitude,
        s.longitude,
        s.is_active AS site_is_active,
        t.id AS tank_id,
        t.site_id AS tank_site_id,
        t.name AS tank_name,
        t.shape AS tank_shape,
        t.capacity_liter,
        t.diameter_cm,
        t.length_cm,
        t.height_cm,
        t.width_cm,
        t.sensor_mount_height_cm,
        t.low_level_percent,
        t.critical_level_percent,
        t.consumption_liter_per_hour,
        t.is_active AS tank_is_active,
        p.id AS package_id,
        p.package_status,
        p.device_key_hash AS package_device_key_hash,
        r.id AS request_id,
        r.status AS request_status
      FROM monitoring_devices d
      JOIN monitoring_sites s
        ON s.id = d.site_id
      JOIN monitoring_tanks t
        ON t.id = d.tank_id
      JOIN monitoring_device_packages p
        ON p.device_id = d.id
      JOIN monitoring_device_requests r
        ON r.id = p.request_id
      WHERE d.id = ? OR d.code = ?
      ORDER BY p.generated_at DESC, p.id DESC
      LIMIT 1
      FOR UPDATE
    `,
    [deviceIdentifier, deviceIdentifier],
  );

  return rows[0] ?? null;
}

export async function activateApprovedDeviceOnFirstPingFromMysql({
  deviceIdentifier,
  deviceKey,
  receivedAt = new Date(),
}: {
  deviceIdentifier: string;
  deviceKey: string;
  receivedAt?: Date;
}): Promise<ActivateApprovedDeviceResult> {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const row = await findPendingDeviceActivationForUpdate({
      connection,
      deviceIdentifier,
    });

    if (!row) {
      await connection.rollback();
      return {
        ok: false,
        reason: "not-found",
      };
    }

    if (
      row.request_status === "revoked" ||
      row.package_status === "revoked" ||
      row.package_status === "expired" ||
      row.package_status === "failed"
    ) {
      await connection.rollback();
      return {
        ok: false,
        reason: "revoked",
      };
    }

    const readyForFirstPing =
      row.request_status === "waiting_first_valid_ping" &&
      row.package_status === "downloaded";
    const alreadyActive =
      row.request_status === "active" &&
      row.package_status === "activated" &&
      toBoolean(row.device_is_active);

    if (!readyForFirstPing && !alreadyActive) {
      await connection.rollback();
      return {
        ok: false,
        reason: "not-ready",
      };
    }

    if (!verifyDeviceKeyHash(deviceKey, row.package_device_key_hash)) {
      await insertProvisioningEvent({
        connection,
        eventType: "device_first_valid_ping_invalid_key",
        metadata: {
          deviceCode: row.device_code,
        },
        packageId: row.package_id,
        requestId: row.request_id,
      });
      await connection.commit();

      return {
        ok: false,
        reason: "invalid-key",
      };
    }

    const activatedAt = formatMysqlDateTime(receivedAt);

    await connection.execute(
      `
        UPDATE monitoring_sites
        SET is_active = TRUE
        WHERE id = ?
      `,
      [row.site_id],
    );
    await connection.execute(
      `
        UPDATE monitoring_tanks
        SET is_active = TRUE
        WHERE id = ?
      `,
      [row.tank_id],
    );
    await connection.execute(
      `
        UPDATE monitoring_devices
        SET is_active = TRUE
        WHERE id = ?
      `,
      [row.device_id],
    );
    await connection.execute(
      `
        UPDATE monitoring_device_packages
        SET
          package_status = 'activated',
          activated_at = COALESCE(activated_at, ?)
        WHERE id = ?
      `,
      [activatedAt, row.package_id],
    );
    await connection.execute(
      `
        UPDATE monitoring_device_requests
        SET status = 'active'
        WHERE id = ?
          AND status IN ('waiting_first_valid_ping', 'active')
      `,
      [row.request_id],
    );
    await insertProvisioningEvent({
      connection,
      eventType: alreadyActive
        ? "device_first_valid_ping_already_active"
        : "device_first_valid_ping_activated",
      metadata: {
        deviceCode: row.device_code,
      },
      packageId: row.package_id,
      requestId: row.request_id,
    });

    await connection.commit();

    return {
      ok: true,
      device: rowToActivationDevice(row),
      site: rowToActivationSite(row),
      tank: rowToActivationTank(row),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function downloadDevicePackageByTokenFromMysql(
  downloadToken: string,
): Promise<DownloadDevicePackageResult> {
  const cleanToken = downloadToken.trim();

  if (!cleanToken.startsWith("dpt_")) {
    return {
      ok: false,
      status: 400,
      message: "Download token is invalid.",
    };
  }

  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const packageRow = await findPackageForUpdateByToken({
      connection,
      downloadToken: cleanToken,
    });

    if (!packageRow) {
      await connection.rollback();
      return {
        ok: false,
        status: 404,
        message: "Firmware package not found.",
      };
    }

    const devicePackage = rowToFirmwarePackage(packageRow);
    const now = Date.now();
    const expiresAt = new Date(devicePackage.downloadExpiresAt).getTime();

    if (
      devicePackage.packageStatus === "revoked" ||
      devicePackage.packageStatus === "expired"
    ) {
      await connection.rollback();
      return {
        ok: false,
        status: 410,
        message: "Firmware download link is no longer valid.",
      };
    }

    if (!Number.isFinite(expiresAt) || expiresAt < now) {
      await connection.execute(
        `
          UPDATE monitoring_device_packages
          SET package_status = 'expired'
          WHERE id = ?
        `,
        [devicePackage.id],
      );
      await insertProvisioningEvent({
        connection,
        eventType: "firmware_package_download_expired",
        packageId: devicePackage.id,
        requestId: devicePackage.requestId,
      });
      await connection.commit();

      return {
        ok: false,
        status: 410,
        message: "Firmware download link has expired.",
      };
    }

    if (devicePackage.downloadCount >= devicePackage.maxDownloadCount) {
      await connection.rollback();
      return {
        ok: false,
        status: 429,
        message: "Firmware package download limit reached.",
      };
    }

    if (
      !Buffer.isBuffer(packageRow.package_ciphertext) ||
      !Buffer.isBuffer(packageRow.package_iv) ||
      !Buffer.isBuffer(packageRow.package_auth_tag) ||
      packageRow.package_ciphertext.length === 0 ||
      packageRow.package_iv.length === 0 ||
      packageRow.package_auth_tag.length === 0
    ) {
      await connection.execute(
        `
          UPDATE monitoring_device_packages
          SET package_status = 'failed'
          WHERE id = ?
        `,
        [devicePackage.id],
      );
      await insertProvisioningEvent({
        connection,
        eventType: "firmware_package_missing_content",
        packageId: devicePackage.id,
        requestId: devicePackage.requestId,
      });
      await connection.commit();

      return {
        ok: false,
        status: 410,
        message:
          "Legacy firmware package has no ZIP file. Admin needs to create a new request so the firmware package can be downloaded.",
      };
    }

    let zipBuffer: Buffer;

    try {
      zipBuffer = decryptFirmwarePackage({
        authTag: packageRow.package_auth_tag,
        ciphertext: packageRow.package_ciphertext,
        iv: packageRow.package_iv,
      });
    } catch {
      await insertProvisioningEvent({
        connection,
        eventType: "firmware_package_decrypt_failed",
        packageId: devicePackage.id,
        requestId: devicePackage.requestId,
      });
      await connection.commit();

      return {
        ok: false,
        status: 500,
        message: "Firmware package could not be opened.",
      };
    }

    await connection.execute(
      `
        UPDATE monitoring_device_packages
        SET
          package_status = 'downloaded',
          download_count = download_count + 1,
          first_downloaded_at = COALESCE(first_downloaded_at, ?)
        WHERE id = ?
      `,
      [formatMysqlDateTime(new Date()), devicePackage.id],
    );
    await connection.execute(
      `
        UPDATE monitoring_device_requests
        SET status = 'waiting_first_valid_ping'
        WHERE id = ?
          AND status IN ('approved_package_ready', 'waiting_firmware_download')
      `,
      [devicePackage.requestId],
    );
    await insertProvisioningEvent({
      connection,
      eventType: "firmware_package_downloaded",
      metadata: {
        downloadCount: devicePackage.downloadCount + 1,
        maxDownloadCount: devicePackage.maxDownloadCount,
      },
      packageId: devicePackage.id,
      requestId: devicePackage.requestId,
    });

    await connection.commit();

    return {
      ok: true,
      content: zipBuffer,
      contentType: packageRow.content_type || "application/zip",
      filename: devicePackage.packageFilename,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function rejectDeviceRequestInMysql({
  adminUserId,
  rejectionReason,
  requestId,
}: {
  adminUserId: string;
  rejectionReason: string;
  requestId: string;
}): Promise<MonitoringDeviceRequest> {
  const cleanReason = normalizeRejectionReason(rejectionReason);

  if (cleanReason.length < 8) {
    throw new Error("Rejection reason must be clear, at least 8 characters.");
  }

  if (cleanReason.length > 1000) {
    throw new Error("Rejection reason is limited to 1000 characters.");
  }

  const pool = getMysqlPool();
  const connection = await pool.getConnection();
  const reviewedAt = new Date();

  try {
    await connection.beginTransaction();
    const request = await findDeviceRequestForUpdate({ connection, requestId });

    if (request.status !== "pending_admin_review") {
      throw new Error("This device request has already been processed.");
    }

    await connection.execute(
      `
        UPDATE monitoring_device_requests
        SET
          status = 'rejected',
          admin_reviewed_by_user_id = ?,
          admin_reviewed_at = ?,
          rejection_reason = ?
        WHERE id = ?
      `,
      [adminUserId, formatMysqlDateTime(reviewedAt), cleanReason, requestId],
    );

    await insertProvisioningEvent({
      actorUserId: adminUserId,
      connection,
      eventType: "device_request_rejected",
      metadata: {
        deviceCode: request.deviceCode,
        requestCode: request.requestCode,
        reasonLength: cleanReason.length,
      },
      requestId,
    });

    const updatedRequest = await findDeviceRequestById({ connection, requestId });
    await connection.commit();

    return updatedRequest;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function isPackageStatus(value: string): value is FirmwarePackageStatus {
  return isFirmwarePackageStatus(value);
}
