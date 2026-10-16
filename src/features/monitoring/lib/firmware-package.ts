import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  MonitoringDeviceRequest,
  MonitoringFirmwareTemplate,
  MonitoringHardwareProfile,
} from "../types/monitoring";

const DEFAULT_PACKAGE_PREFIX = "solartank";
const DEFAULT_DEVICE_SEGMENT = "device";
const DEFAULT_DOWNLOAD_TTL_DAYS = 7;
const DEFAULT_MAX_DOWNLOADS = 3;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION_NEEDED = 20;
const ZIP_UTF8_FLAG = 0x0800;
const AES_GCM_IV_BYTES = 12;
const AES_256_KEY_BYTES = 32;

export type FirmwarePackageFile = {
  path: string;
  content: Buffer;
};

export type FirmwarePackageBundle = {
  checksumSha256: string;
  files: FirmwarePackageFile[];
  filename: string;
  generatedAt: Date;
  zipBuffer: Buffer;
};

export type EncryptedFirmwarePackage = {
  authTag: Buffer;
  ciphertext: Buffer;
  iv: Buffer;
};

type FirmwarePackageContext = {
  appBaseUrl: string;
  deviceKey: string;
  firmwareTemplate: MonitoringFirmwareTemplate;
  hardwareProfile: MonitoringHardwareProfile;
  request: MonitoringDeviceRequest;
};

function toDateStamp(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}

function escapeCppString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
}

function toCppString(value: string): string {
  return `"${escapeCppString(value)}"`;
}

function toCppNumber(value: number | undefined, fallback = 0): string {
  const safeValue = typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;

  return Number.isInteger(safeValue) ? String(safeValue) : safeValue.toFixed(2);
}

function toCppCoordinate(value: number | undefined, fallback = 0): string {
  const safeValue = typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;

  return safeValue.toFixed(7);
}

function getProductionLikeEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase() === "production"
  );
}

function parsePositiveIntegerEnv({
  envValue,
  fallback,
  max,
  min,
}: {
  envValue?: string;
  fallback: number;
  max: number;
  min: number;
}): number {
  const parsed = Number(envValue);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function parseEncryptionKeyFromEnv(value: string): Buffer | null {
  const cleanValue = value.trim();

  if (!cleanValue) {
    return null;
  }

  const candidates = [
    Buffer.from(cleanValue, "base64url"),
    Buffer.from(cleanValue, "base64"),
  ];

  if (/^[a-f0-9]{64}$/i.test(cleanValue)) {
    candidates.push(Buffer.from(cleanValue, "hex"));
  }

  for (const candidate of candidates) {
    if (candidate.length === AES_256_KEY_BYTES) {
      return candidate;
    }
  }

  return null;
}

export function getDevicePackageEncryptionKey(): Buffer {
  const configuredKey = process.env.DEVICE_PACKAGE_ENCRYPTION_KEY;

  if (configuredKey) {
    const parsedKey = parseEncryptionKeyFromEnv(configuredKey);

    if (parsedKey) {
      return parsedKey;
    }

    throw new Error(
      "DEVICE_PACKAGE_ENCRYPTION_KEY must be a 32-byte base64/base64url/hex key.",
    );
  }

  if (getProductionLikeEnvironment()) {
    throw new Error(
      "DEVICE_PACKAGE_ENCRYPTION_KEY is required for production.",
    );
  }

  return createHash("sha256")
    .update(
      process.env.AUTH_SECRET ??
        "development-device-package-encryption-key-change-before-production",
      "utf8",
    )
    .digest();
}

function toDosDateTime(value: Date): { dosDate: number; dosTime: number } {
  const year = Math.max(value.getUTCFullYear(), 1980);
  const month = value.getUTCMonth() + 1;
  const day = value.getUTCDate();
  const hour = value.getUTCHours();
  const minute = value.getUTCMinutes();
  const second = Math.floor(value.getUTCSeconds() / 2);

  return {
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
    dosTime: (hour << 11) | (minute << 5) | second,
  };
}

let crc32Table: number[] | null = null;

function getCrc32Table(): number[] {
  if (crc32Table) {
    return crc32Table;
  }

  crc32Table = Array.from({ length: 256 }, (_, index) => {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    return value >>> 0;
  });

  return crc32Table;
}

function crc32(buffer: Buffer): number {
  const table = getCrc32Table();
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function normalizeZipPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

function assertNoUnresolvedPlaceholders(files: FirmwarePackageFile[]) {
  const unresolved = files.flatMap((file) =>
    findUnresolvedTemplatePlaceholders(file.content.toString("utf8")).map(
      (placeholder) => `${file.path}:${placeholder}`,
    ),
  );

  if (unresolved.length > 0) {
    throw new Error(
      `Firmware template still has unresolved placeholders: ${unresolved.join(", ")}`,
    );
  }
}

function createFirmwareZipBuffer({
  files,
  generatedAt,
}: {
  files: FirmwarePackageFile[];
  generatedAt: Date;
}): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const { dosDate, dosTime } = toDosDateTime(generatedAt);
  let localOffset = 0;

  for (const file of files) {
    const filename = Buffer.from(normalizeZipPath(file.path), "utf8");
    const content = file.content;
    const checksum = crc32(content);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(ZIP_VERSION_NEEDED, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(filename.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, filename, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0);
    centralHeader.writeUInt16LE(ZIP_VERSION_NEEDED, 4);
    centralHeader.writeUInt16LE(ZIP_VERSION_NEEDED, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(filename.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, filename);

    localOffset += localHeader.length + filename.length + content.length;
  }

  const centralDirectoryOffset = localOffset;
  const centralDirectory = Buffer.concat(centralParts);
  const endHeader = Buffer.alloc(22);

  endHeader.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  endHeader.writeUInt16LE(0, 4);
  endHeader.writeUInt16LE(0, 6);
  endHeader.writeUInt16LE(files.length, 8);
  endHeader.writeUInt16LE(files.length, 10);
  endHeader.writeUInt32LE(centralDirectory.length, 12);
  endHeader.writeUInt32LE(centralDirectoryOffset, 16);
  endHeader.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endHeader]);
}

export function sanitizeFirmwareFileSegment(
  value: string,
  fallback = DEFAULT_DEVICE_SEGMENT,
): string {
  const cleanValue = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return cleanValue || fallback;
}

export function createFirmwarePackageFilename({
  deviceCode,
  generatedAt = new Date(),
  prefix = DEFAULT_PACKAGE_PREFIX,
}: {
  deviceCode: string;
  generatedAt?: Date;
  prefix?: string;
}): string {
  return [
    sanitizeFirmwareFileSegment(prefix, DEFAULT_PACKAGE_PREFIX),
    sanitizeFirmwareFileSegment(deviceCode),
    toDateStamp(generatedAt),
  ].join("-") + ".zip";
}

export function findUnresolvedTemplatePlaceholders(content: string): string[] {
  const matches = content.matchAll(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g);
  const placeholders = new Set<string>();

  for (const match of matches) {
    if (match[1]) {
      placeholders.add(match[1]);
    }
  }

  return [...placeholders].sort();
}

export function getDevicePackageDownloadTtlDays(): number {
  return parsePositiveIntegerEnv({
    envValue: process.env.DEVICE_PACKAGE_DOWNLOAD_TTL_DAYS,
    fallback: DEFAULT_DOWNLOAD_TTL_DAYS,
    max: 30,
    min: 1,
  });
}

export function getDevicePackageMaxDownloads(): number {
  return parsePositiveIntegerEnv({
    envValue: process.env.DEVICE_PACKAGE_MAX_DOWNLOADS,
    fallback: DEFAULT_MAX_DOWNLOADS,
    max: 10,
    min: 1,
  });
}

export function createDownloadExpiresAt(now = new Date()): Date {
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + getDevicePackageDownloadTtlDays());
  return expiresAt;
}

export function createDownloadToken(): string {
  return `dpt_${randomBytes(32).toString("base64url")}`;
}

export function hashDownloadToken(token: string): string {
  return `sha256:${createHash("sha256").update(token.trim()).digest("hex")}`;
}

export function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function encryptFirmwarePackage(
  zipBuffer: Buffer,
): EncryptedFirmwarePackage {
  const key = getDevicePackageEncryptionKey();
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(zipBuffer), cipher.final()]);

  return {
    authTag: cipher.getAuthTag(),
    ciphertext,
    iv,
  };
}

export function decryptFirmwarePackage({
  authTag,
  ciphertext,
  iv,
}: EncryptedFirmwarePackage): Buffer {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getDevicePackageEncryptionKey(),
    iv,
  );

  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function resolveFirmwareTemplatePath(sourcePath: string): string {
  const basePath = path.join(process.cwd(), "firmware", "templates");
  const normalizedPath = sourcePath.replaceAll("\\", "/").replace(/^\/+/, "");
  const relativeTemplatePath = normalizedPath.startsWith("firmware/templates/")
    ? normalizedPath.slice("firmware/templates/".length)
    : normalizedPath;
  const templateSegments = relativeTemplatePath
    .split("/")
    .filter(Boolean);

  if (
    path.isAbsolute(sourcePath) ||
    templateSegments.length === 0 ||
    templateSegments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Firmware template path is invalid.");
  }

  const resolvedPath = path.join(basePath, ...templateSegments);

  if (
    resolvedPath !== basePath &&
    !resolvedPath.startsWith(`${basePath}${path.sep}`)
  ) {
    throw new Error("Firmware template path is outside the firmware/templates folder.");
  }

  return resolvedPath;
}

async function readFirmwareTemplateSource(
  template: MonitoringFirmwareTemplate,
): Promise<string> {
  const templatePath = resolveFirmwareTemplatePath(template.sourcePath);
  return readFile(path.join(templatePath, "solar_tank_firmware.ino"), "utf8");
}

export function renderDeviceConfigHeader({
  appBaseUrl,
  deviceKey,
  request,
}: Pick<FirmwarePackageContext, "appBaseUrl" | "deviceKey" | "request">): string {
  return `#pragma once

// This file is generated automatically by FTM.
// Do not share its contents because it contains the device key.

#define SOLARTANK_API_BASE_URL ${toCppString(appBaseUrl)}
#define SOLARTANK_DEVICE_CODE ${toCppString(request.deviceCode)}
#define SOLARTANK_DEVICE_LABEL ${toCppString(request.deviceLabel)}
#define SOLARTANK_DEVICE_SENSOR_TYPE ${toCppString(request.deviceSensorType)}
#define SOLARTANK_DEVICE_KEY ${toCppString(deviceKey)}

#define SOLARTANK_SITE_CODE ${toCppString(request.siteCode)}
#define SOLARTANK_SITE_NAME ${toCppString(request.siteName)}
#define SOLARTANK_AREA_LABEL ${toCppString(request.areaLabel)}
#define SOLARTANK_REGIONAL_LABEL ${toCppString(request.regionalLabel)}
#define SOLARTANK_WILAYAH_LABEL ${toCppString(request.wilayahLabel)}
#define SOLARTANK_SITE_LATITUDE ${toCppCoordinate(request.latitude)}
#define SOLARTANK_SITE_LONGITUDE ${toCppCoordinate(request.longitude)}
#define SOLARTANK_TANK_SHAPE ${toCppString(request.tankShape)}
#define SOLARTANK_TANK_CAPACITY_LITER ${toCppNumber(request.capacityLiter)}
#define SOLARTANK_TANK_LENGTH_CM ${toCppNumber(request.lengthCm)}
#define SOLARTANK_TANK_WIDTH_CM ${toCppNumber(request.widthCm)}
#define SOLARTANK_TANK_HEIGHT_CM ${toCppNumber(request.heightCm)}
#define SOLARTANK_TANK_DIAMETER_CM ${toCppNumber(request.diameterCm)}
#define SOLARTANK_SENSOR_MOUNT_HEIGHT_CM ${toCppNumber(request.sensorMountHeightCm)}
#define SOLARTANK_LOW_LEVEL_PERCENT ${toCppNumber(request.lowLevelPercent)}
#define SOLARTANK_CRITICAL_LEVEL_PERCENT ${toCppNumber(request.criticalLevelPercent)}
#define SOLARTANK_CONSUMPTION_LITER_PER_HOUR ${toCppNumber(request.consumptionLiterPerHour)}
#define SOLARTANK_LOAD_VALUE ${toCppNumber(request.loadValue)}
#define SOLARTANK_LOAD_UNIT ${toCppString(request.loadUnit)}
#define SOLARTANK_DIESEL_ENGINE_CAPACITY_KVA ${toCppNumber(request.dieselEngineCapacityKva)}
#define SOLARTANK_COS_PHI ${toCppNumber(request.cosPhi)}
`;
}

export function renderHardwareProfileHeader({
  hardwareProfile,
}: Pick<FirmwarePackageContext, "hardwareProfile">): string {
  return `#pragma once

// Official hardware profile selected when the device was requested.

#define SOLARTANK_HARDWARE_PROFILE_CODE ${toCppString(hardwareProfile.code)}
#define SOLARTANK_BOARD_FAMILY ${toCppString(hardwareProfile.boardFamily)}
#define SOLARTANK_BOARD_LABEL ${toCppString(hardwareProfile.boardLabel)}
#define SOLARTANK_SENSOR_TYPE ${toCppString(hardwareProfile.sensorType)}
#define SOLARTANK_TRIGGER_PIN ${hardwareProfile.triggerPin}
#define SOLARTANK_ECHO_PIN ${hardwareProfile.echoPin}
#define SOLARTANK_REPORT_INTERVAL_MS ${Math.round(hardwareProfile.reportIntervalMs)}
`;
}

export function renderFirmwareReadme({
  hardwareProfile,
  request,
}: Pick<FirmwarePackageContext, "hardwareProfile" | "request">): string {
  return `# FTM Firmware Upload Steps

This package was created for:

- STO: ${request.siteName} (${request.siteCode})
- Regional: ${request.regionalLabel}
- Territory: ${request.wilayahLabel}
- Area: ${request.areaLabel}
- Device: ${request.deviceCode}
- Sensor mode: ${request.deviceSensorType}
- Hardware: ${hardwareProfile.name}
- Tank: ${request.tankShape === "rectangular" ? "rectangular" : "horizontal cylinder"}
- Capacity: ${request.capacityLiter} liters
- Location load: ${request.loadValue} ${request.loadUnit.toUpperCase()}
- Diesel engine: ${request.dieselEngineCapacityKva} kVA
- Cos phi: ${request.cosPhi}
- Estimated consumption: ${request.consumptionLiterPerHour} liters/hour

## Package Contents

1. solar_tank_firmware.ino
2. device_config.h
3. hardware_profile.h
4. README_UPLOAD_STEPS.md
5. manifest.json

## Upload Instructions

1. Extract this ZIP to a local folder.
2. Open Arduino IDE.
3. Open the solar_tank_firmware.ino file.
4. Fill in SOLARTANK_WIFI_SSID and SOLARTANK_WIFI_PASSWORD at the top of the firmware file, or use the WIFI/PASS serial commands for temporary testing.
5. Select the board that matches the hardware profile: ${hardwareProfile.boardLabel}.
6. Select the board port.
7. Click Upload.
8. After the upload finishes, open the Serial Monitor to check the connection, sensor, and POST status.
9. Do not share the device_config.h file because it contains the device key.

## Security Notes

The device key may only be used for this device. If this file is sent to the wrong recipient or lost, contact an admin so the key can be revoked and a new package created.
`;
}

export function renderFirmwareManifest({
  firmwareTemplate,
  generatedAt,
  hardwareProfile,
  request,
}: Pick<
  FirmwarePackageContext,
  "firmwareTemplate" | "hardwareProfile" | "request"
> & {
  generatedAt: Date;
}): string {
  return JSON.stringify(
    {
      capacityLiter: request.capacityLiter,
      cosPhi: request.cosPhi,
      dieselEngineCapacityKva: request.dieselEngineCapacityKva,
      deviceCode: request.deviceCode,
      deviceSensorType: request.deviceSensorType,
      firmwareTemplate: {
        key: firmwareTemplate.templateKey,
        version: firmwareTemplate.version,
      },
      generatedAt: generatedAt.toISOString(),
      hardwareProfile: {
        code: hardwareProfile.code,
        name: hardwareProfile.name,
      },
      packageVersion: 1,
      requestCode: request.requestCode,
      siteCode: request.siteCode,
      siteRegional: request.regionalLabel,
      siteWilayah: request.wilayahLabel,
      siteLocation: {
        area: request.areaLabel,
        latitude: request.latitude ?? null,
        longitude: request.longitude ?? null,
      },
      tankShape: request.tankShape,
      operationalLoad: {
        unit: request.loadUnit,
        value: request.loadValue,
      },
    },
    null,
    2,
  );
}

export async function createFirmwarePackageBundle({
  appBaseUrl,
  deviceKey,
  firmwareTemplate,
  hardwareProfile,
  request,
}: FirmwarePackageContext): Promise<FirmwarePackageBundle> {
  const generatedAt = new Date();
  const firmwareSource = await readFirmwareTemplateSource(firmwareTemplate);
  const files: FirmwarePackageFile[] = [
    {
      path: "solar_tank_firmware.ino",
      content: Buffer.from(firmwareSource, "utf8"),
    },
    {
      path: "device_config.h",
      content: Buffer.from(
        renderDeviceConfigHeader({ appBaseUrl, deviceKey, request }),
        "utf8",
      ),
    },
    {
      path: "hardware_profile.h",
      content: Buffer.from(renderHardwareProfileHeader({ hardwareProfile }), "utf8"),
    },
    {
      path: "README_UPLOAD_STEPS.md",
      content: Buffer.from(
        renderFirmwareReadme({ hardwareProfile, request }),
        "utf8",
      ),
    },
    {
      path: "manifest.json",
      content: Buffer.from(
        renderFirmwareManifest({
          firmwareTemplate,
          generatedAt,
          hardwareProfile,
          request,
        }),
        "utf8",
      ),
    },
  ];

  assertNoUnresolvedPlaceholders(files);

  const zipBuffer = createFirmwareZipBuffer({ files, generatedAt });

  return {
    checksumSha256: sha256Buffer(zipBuffer),
    files,
    filename: createFirmwarePackageFilename({
      deviceCode: request.deviceCode,
      generatedAt,
    }),
    generatedAt,
    zipBuffer,
  };
}
