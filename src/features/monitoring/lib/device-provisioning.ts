import type {
  CatTelemetryPayload,
  Device,
  Site,
  Tank,
  TankShape,
} from "../types/monitoring";
import { hashDeviceKey } from "./device-key";
import {
  DEFAULT_REGIONAL_LABEL,
  DEFAULT_WILAYAH_LABEL,
  normalizeRegionalLabel,
  normalizeWilayahLabel,
} from "./location-taxonomy";
import { getMonitoringStorageDriver } from "./monitoring-storage";
import { getMysqlPool } from "./mysql-connection";
import { toFiniteNumber } from "./number";
import { extractPayloadTankConfig } from "./reading-tank-config";

const DEFAULT_EXPECTED_REPORT_INTERVAL_SEC = 300;
const DEFAULT_LOW_LEVEL_PERCENT = 30;
const DEFAULT_CRITICAL_LEVEL_PERCENT = 15;
const DEFAULT_CONSUMPTION_LITER_PER_HOUR = 25;

type ProvisioningFailure = {
  ok: false;
  status: 400 | 401 | 403 | 500;
  error: string;
};

type ProvisioningSuccess = {
  ok: true;
  site: Site;
  tank: Tank;
  device: Device;
};

export type DeviceProvisioningResult =
  | ProvisioningSuccess
  | ProvisioningFailure;

export type ProvisionMonitoringDeviceInput = {
  deviceIdentifier: string;
  deviceKey: string;
  expectedDeviceKey?: string;
  allowGlobalDeviceKeyFallback?: boolean;
  allowDeviceAutoProvisioning?: boolean;
  provisioningKey?: string | null;
  expectedProvisioningKey?: string | null;
  payload: CatTelemetryPayload;
};

function parseBooleanEnv(value?: string): boolean {
  const cleanValue = value?.trim().toLowerCase();
  return (
    cleanValue === "1" ||
    cleanValue === "true" ||
    cleanValue === "yes" ||
    cleanValue === "on"
  );
}

export function isDeviceAutoProvisioningEnabled(
  envValue = process.env.SOLAR_TANK_AUTO_PROVISION_DEVICES,
): boolean {
  return parseBooleanEnv(envValue);
}

export function getExpectedProvisioningKey(
  envValue = process.env.SOLAR_TANK_DEVICE_PROVISIONING_KEY,
): string | null {
  const cleanValue = envValue?.trim();
  return cleanValue ? cleanValue : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProvisioningFailure(
  value: Tank | ProvisioningFailure,
): value is ProvisioningFailure {
  return "ok" in value && value.ok === false;
}

function readPath(payload: CatTelemetryPayload, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!isRecord(current)) {
      return undefined;
    }

    return current[segment];
  }, payload);
}

function pickString(
  payload: CatTelemetryPayload,
  paths: string[],
): string | null {
  for (const path of paths) {
    const value = readPath(payload, path);

    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return null;
}

function pickNumber(
  payload: CatTelemetryPayload,
  paths: string[],
): number | null {
  for (const path of paths) {
    const value = toFiniteNumber(readPath(payload, path));

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function sanitizeSlug(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function createSiteCode(payload: CatTelemetryPayload, slug: string): string {
  const payloadCode = pickString(payload, [
    "site_code",
    "site.code",
    "raw.site_code",
  ]);
  const baseCode = payloadCode ?? slug;

  return truncate(
    baseCode
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),
    32,
  );
}

function assertValidCoordinate({
  value,
  min,
  max,
  label,
}: {
  value: number | null;
  min: number;
  max: number;
  label: string;
}): number | ProvisioningFailure {
  if (value === null || value < min || value > max) {
    return {
      ok: false,
      status: 400,
      error: `${label} is required and must be between ${min} and ${max}.`,
    };
  }

  return value;
}

function resolveTankShape(shape: unknown): TankShape | null {
  if (shape === "rectangular") {
    return "rectangular";
  }

  if (
    shape === "horizontal-cylinder" ||
    shape === "cylinder" ||
    shape === "silinder"
  ) {
    return "horizontal-cylinder";
  }

  return null;
}

function calculateCapacityLiter({
  shape,
  lengthCm,
  widthCm,
  heightCm,
  diameterCm,
}: {
  shape: TankShape;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  diameterCm?: number;
}): number | null {
  if (shape === "rectangular" && lengthCm && widthCm && heightCm) {
    return (lengthCm * widthCm * heightCm) / 1000;
  }

  if (shape === "horizontal-cylinder" && lengthCm && diameterCm) {
    const radiusCm = diameterCm / 2;
    return (Math.PI * radiusCm * radiusCm * lengthCm) / 1000;
  }

  return null;
}

function buildProvisionedTank({
  payload,
  siteId,
  tankId,
}: {
  payload: CatTelemetryPayload;
  siteId: string;
  tankId: string;
}): Tank | ProvisioningFailure {
  const payloadConfig = extractPayloadTankConfig(payload);
  const shape = resolveTankShape(payloadConfig?.shape);
  const radiusCm = pickNumber(payload, [
    "radius_cm",
    "radiusCm",
    "tank.radius_cm",
    "tank.radiusCm",
  ]);
  const diameterCm = payloadConfig?.diameterCm ?? (radiusCm ? radiusCm * 2 : undefined);
  const lengthCm = payloadConfig?.lengthCm;
  const widthCm = payloadConfig?.widthCm;
  const heightCm = payloadConfig?.heightCm;
  const sensorMountHeightCm = payloadConfig?.sensorMountHeightCm;
  const calculatedCapacityLiter =
    shape === null
      ? null
      : calculateCapacityLiter({
          shape,
          lengthCm,
          widthCm,
          heightCm,
          diameterCm,
        });
  const capacityLiter = payloadConfig?.capacityLiter ?? calculatedCapacityLiter;

  if (!shape) {
    return {
      ok: false,
      status: 400,
      error:
        "New device provisioning requires tank_shape rectangular or horizontal-cylinder.",
    };
  }

  if (!capacityLiter || capacityLiter <= 0 || !sensorMountHeightCm) {
    return {
      ok: false,
      status: 400,
      error:
        "New device provisioning requires a valid capacity_liter and sensor_mount_height_cm.",
    };
  }

  if (shape === "rectangular" && (!lengthCm || !widthCm || !heightCm)) {
    return {
      ok: false,
      status: 400,
      error:
        "Rectangular tanks require length_cm, width_cm, and height_cm.",
    };
  }

  if (shape === "horizontal-cylinder" && (!lengthCm || !diameterCm)) {
    return {
      ok: false,
      status: 400,
      error:
        "Cylinder tanks require length_cm and diameter_cm or radius_cm.",
    };
  }

  return {
    id: tankId,
    siteId,
    name:
      pickString(payload, ["tank_name", "tank.name", "raw.tank_name"]) ??
      "Main tank",
    shape,
    capacityLiter: Math.round(capacityLiter * 100) / 100,
    ...(shape === "horizontal-cylinder" ? { diameterCm } : {}),
    ...(lengthCm ? { lengthCm } : {}),
    ...(shape === "rectangular" ? { widthCm, heightCm } : {}),
    sensorMountHeightCm,
    lowLevelPercent:
      payloadConfig?.lowLevelPercent ?? DEFAULT_LOW_LEVEL_PERCENT,
    criticalLevelPercent:
      payloadConfig?.criticalLevelPercent ?? DEFAULT_CRITICAL_LEVEL_PERCENT,
    consumptionLiterPerHour:
      payloadConfig?.consumptionLiterPerHour ??
      DEFAULT_CONSUMPTION_LITER_PER_HOUR,
    isActive: true,
  };
}

function buildProvisionedBundle({
  deviceIdentifier,
  deviceKey,
  payload,
}: {
  deviceIdentifier: string;
  deviceKey: string;
  payload: CatTelemetryPayload;
}): ProvisioningSuccess | ProvisioningFailure {
  const slug = sanitizeSlug(deviceIdentifier, "device");
  const siteId = truncate(`site-${slug}`, 64);
  const tankId = truncate(`tank-${slug}-main`, 64);
  const deviceId = truncate(`device-${slug}-main`, 64);
  const siteCode = createSiteCode(payload, slug);
  const latitude = assertValidCoordinate({
    value: pickNumber(payload, ["lat", "latitude", "site.lat", "site.latitude"]),
    min: -90,
    max: 90,
    label: "Latitude",
  });

  if (typeof latitude !== "number") {
    return latitude;
  }

  const longitude = assertValidCoordinate({
    value: pickNumber(payload, [
      "lng",
      "longitude",
      "lon",
      "site.lng",
      "site.longitude",
      "site.lon",
    ]),
    min: -180,
    max: 180,
    label: "Longitude",
  });

  if (typeof longitude !== "number") {
    return longitude;
  }

  const tank = buildProvisionedTank({
    payload,
    siteId,
    tankId,
  });

  if (isProvisioningFailure(tank)) {
    return tank;
  }

  const site: Site = {
    id: siteId,
    code: siteCode,
    name:
      pickString(payload, ["site_name", "site.name", "raw.site_name"]) ??
      `Site ${siteCode}`,
    areaLabel:
      pickString(payload, [
        "area_label",
        "areaLabel",
        "site.area_label",
        "site.areaLabel",
      ]) ?? "Auto provisioned",
    regionalLabel:
      normalizeRegionalLabel(
        pickString(payload, [
          "regional_label",
          "regionalLabel",
          "site.regional_label",
          "site.regionalLabel",
        ]),
      ) ?? DEFAULT_REGIONAL_LABEL,
    wilayahLabel:
      normalizeWilayahLabel(
        pickString(payload, [
          "wilayah_label",
          "wilayahLabel",
          "site.wilayah_label",
          "site.wilayahLabel",
        ]),
      ) ?? DEFAULT_WILAYAH_LABEL,
    latitude,
    longitude,
    isActive: true,
  };
  const expectedReportIntervalSec =
    pickNumber(payload, [
      "expected_report_interval_sec",
      "expectedReportIntervalSec",
      "device.expected_report_interval_sec",
      "device.expectedReportIntervalSec",
    ]) ?? DEFAULT_EXPECTED_REPORT_INTERVAL_SEC;
  const device: Device = {
    id: deviceId,
    siteId,
    tankId,
    code: deviceIdentifier,
    label:
      pickString(payload, [
        "device_label",
        "deviceLabel",
        "device.label",
        "raw.device_label",
      ]) ?? `Device ${deviceIdentifier}`,
    expectedReportIntervalSec,
    apiKeyHash: hashDeviceKey(deviceKey),
    isActive: true,
  };

  return {
    ok: true,
    site,
    tank,
    device,
  };
}

function isAuthorizedForProvisioning({
  provisioningKey,
  expectedProvisioningKey,
}: Pick<
  ProvisionMonitoringDeviceInput,
  "provisioningKey" | "expectedProvisioningKey"
>): boolean {
  const cleanExpectedProvisioningKey = expectedProvisioningKey?.trim();
  return Boolean(
    cleanExpectedProvisioningKey &&
      provisioningKey?.trim() === cleanExpectedProvisioningKey,
  );
}

async function saveProvisionedBundleToMysql({
  site,
  tank,
  device,
}: ProvisioningSuccess): Promise<void> {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query(
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          area_label = VALUES(area_label),
          regional_label = VALUES(regional_label),
          wilayah_label = VALUES(wilayah_label),
          latitude = VALUES(latitude),
          longitude = VALUES(longitude),
          is_active = TRUE
      `,
      [
        site.id,
        site.code,
        site.name,
        site.areaLabel,
        site.regionalLabel ?? DEFAULT_REGIONAL_LABEL,
        site.wilayahLabel ?? DEFAULT_WILAYAH_LABEL,
        site.latitude,
        site.longitude,
      ],
    );

    await connection.query(
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
        ON DUPLICATE KEY UPDATE
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
          is_active = TRUE
      `,
      [
        tank.id,
        tank.siteId,
        tank.name,
        tank.shape,
        tank.capacityLiter,
        tank.diameterCm ?? null,
        tank.lengthCm ?? null,
        tank.heightCm ?? null,
        tank.widthCm ?? null,
        tank.sensorMountHeightCm,
        tank.lowLevelPercent,
        tank.criticalLevelPercent,
        tank.consumptionLiterPerHour,
      ],
    );

    await connection.query(
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
        VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
        ON DUPLICATE KEY UPDATE
          site_id = VALUES(site_id),
          tank_id = VALUES(tank_id),
          label = VALUES(label),
          expected_report_interval_sec = VALUES(expected_report_interval_sec),
          api_key_hash = VALUES(api_key_hash),
          is_active = TRUE
      `,
      [
        device.id,
        device.siteId,
        device.tankId,
        device.code,
        device.label,
        device.expectedReportIntervalSec,
        device.apiKeyHash ?? null,
      ],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function provisionMonitoringDevice({
  deviceIdentifier,
  deviceKey,
  allowDeviceAutoProvisioning,
  provisioningKey,
  expectedProvisioningKey,
  payload,
}: ProvisionMonitoringDeviceInput): Promise<DeviceProvisioningResult> {
  if (!allowDeviceAutoProvisioning) {
    return {
      ok: false,
      status: 403,
      error:
        "Device is not registered. Enable auto provisioning before accepting new devices.",
    };
  }

  if (
    !isAuthorizedForProvisioning({
      provisioningKey,
      expectedProvisioningKey,
    })
  ) {
    return {
      ok: false,
      status: 401,
      error: "Provisioning key is invalid for registering a new device.",
    };
  }

  const bundle = buildProvisionedBundle({
    deviceIdentifier,
    deviceKey,
    payload,
  });

  if (!bundle.ok) {
    return bundle;
  }

  if (getMonitoringStorageDriver() === "mysql") {
    try {
      await saveProvisionedBundleToMysql(bundle);
    } catch {
      return {
        ok: false,
        status: 500,
        error: "Failed to create site/tank/device registry from payload.",
      };
    }
  }

  return bundle;
}
