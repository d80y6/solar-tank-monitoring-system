#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import nextEnv from "@next/env";
import mysql from "mysql2/promise";

const { loadEnvConfig } = nextEnv;

const DEFAULT_REGISTRY_FILE = "config/pilot-registry.local.json";
const DEFAULT_MIN_SITES = 5;
const MIN_REPORT_INTERVAL_SEC = 20;
const MAX_REPORT_INTERVAL_SEC = 86400;
const DEFAULT_REGIONAL_LABEL = "TREG 5";
const DEFAULT_WILAYAH_LABEL = "TIF 3";
const REGIONAL_LABELS = [
  "TREG 1",
  "TREG 2",
  "TREG 3",
  "TREG 4",
  "TREG 5",
  "TREG 6",
  "TREG 7",
];
const WILAYAH_LABELS = ["TIF 1", "TIF 2", "TIF 3", "TIF 4", "TIF 5"];
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_KEYS = new Set([
  "apiKey",
  "api_key",
  "deviceKey",
  "device_key",
  "key",
  "password",
  "secret",
  "token",
]);

loadEnvConfig(process.cwd());

function printHelp() {
  globalThis.console.log(`
Apply the pilot STO registry to MySQL.

Usage:
  pnpm pilot:registry -- --dry-run
  pnpm pilot:registry
  pnpm pilot:registry -- --file config/pilot-registry.local.json

Options:
  --file <path>            Default: config/pilot-registry.local.json
  --dry-run                Validate the file without writing to the database
  --allow-placeholder      Only for template practice, not for a real pilot
  --min-sites <number>     Default: 5
  --help                   Show this help

The real registry file must be local and must not be committed.
`);
}

function parseArgs(argv) {
  const options = {
    filePath: process.env.PILOT_REGISTRY_FILE || DEFAULT_REGISTRY_FILE,
    dryRun: false,
    allowPlaceholder: false,
    minSites: DEFAULT_MIN_SITES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { ...options, help: true };
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--allow-placeholder") {
      options.allowPlaceholder = true;
      continue;
    }

    if (arg === "--file") {
      const value = argv[index + 1];

      if (!value || value.startsWith("--")) {
        throw new Error("--file membutuhkan path file.");
      }

      options.filePath = value;
      index += 1;
      continue;
    }

    if (arg === "--min-sites") {
      const value = Number(argv[index + 1]);

      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--min-sites must be a positive integer.");
      }

      options.minSites = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function getMysqlDatabaseUrl() {
  const databaseUrl = process.env.MYSQL_DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("MYSQL_DATABASE_URL is required before applying the registry.");
  }

  return databaseUrl;
}

function getMysqlSslConfig() {
  const sslMode = process.env.MYSQL_SSL_MODE?.trim().toLowerCase();

  if (sslMode !== "required") {
    return undefined;
  }

  const ca = process.env.MYSQL_SSL_CA?.replaceAll("\\n", "\n").trim();

  return ca ? { ca } : { rejectUnauthorized: true };
}

function ensureString(value, label, { pattern } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be text.`);
  }

  const cleanValue = value.trim();

  if (pattern && !pattern.test(cleanValue)) {
    throw new Error(`${label} does not match the expected format.`);
  }

  return cleanValue;
}

function ensureNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a number.`);
  }

  if (number < min || number > max) {
    throw new Error(`${label} must be in the range ${min} to ${max}.`);
  }

  return number;
}

function optionalNumber(value, label, range) {
  if (value === null || typeof value === "undefined") {
    return null;
  }

  return ensureNumber(value, label, range);
}

function normalizeLocationLabel(value, label, options, fallback) {
  const normalizedKey = ensureString(value ?? fallback, label)
    .toUpperCase()
    .replace(/\s+/g, "");
  const match = options.find(
    (option) => option.replace(/\s+/g, "") === normalizedKey,
  );

  if (!match) {
    throw new Error(`${label} is not recognized. Choose one of: ${options.join(", ")}.`);
  }

  return match;
}

function assertNoForbiddenKeys(value, pathLabel = "registry") {
  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(
        `${pathLabel}.${key} must not be present. Store the raw key in a safe place, not in the registry file.`,
      );
    }

    if (Array.isArray(nestedValue)) {
      nestedValue.forEach((item, index) => {
        assertNoForbiddenKeys(item, `${pathLabel}.${key}[${index}]`);
      });
    } else {
      assertNoForbiddenKeys(nestedValue, `${pathLabel}.${key}`);
    }
  }
}

function assertUnique(items, keyName, label) {
  const seen = new Set();

  for (const item of items) {
    const key = item[keyName];

    if (seen.has(key)) {
      throw new Error(`${label} duplikat: ${key}`);
    }

    seen.add(key);
  }
}

function hasPlaceholderHash(hash) {
  return hash === "sha256:0000000000000000000000000000000000000000000000000000000000000000";
}

function normalizeTank(site, tank, allowPlaceholder) {
  const siteCode = site.code;
  const shape = ensureString(tank?.shape, `tank ${siteCode}.shape`);

  if (shape !== "rectangular" && shape !== "horizontal-cylinder") {
    throw new Error(
      `tank ${siteCode}.shape must be rectangular or horizontal-cylinder.`,
    );
  }

  const normalized = {
    id: ensureString(tank.id, `tank ${siteCode}.id`),
    siteId: site.id,
    name: ensureString(tank.name, `tank ${siteCode}.name`),
    shape,
    capacityLiter: ensureNumber(tank.capacityLiter, `tank ${siteCode}.capacityLiter`, {
      min: 1,
    }),
    diameterCm: optionalNumber(tank.diameterCm, `tank ${siteCode}.diameterCm`, {
      min: 1,
    }),
    lengthCm: optionalNumber(tank.lengthCm, `tank ${siteCode}.lengthCm`, {
      min: 1,
    }),
    heightCm: optionalNumber(tank.heightCm, `tank ${siteCode}.heightCm`, {
      min: 1,
    }),
    widthCm: optionalNumber(tank.widthCm, `tank ${siteCode}.widthCm`, {
      min: 1,
    }),
    sensorMountHeightCm: ensureNumber(
      tank.sensorMountHeightCm,
      `tank ${siteCode}.sensorMountHeightCm`,
      { min: 1 },
    ),
    lowLevelPercent: ensureNumber(
      tank.lowLevelPercent,
      `tank ${siteCode}.lowLevelPercent`,
      { min: 0, max: 100 },
    ),
    criticalLevelPercent: ensureNumber(
      tank.criticalLevelPercent,
      `tank ${siteCode}.criticalLevelPercent`,
      { min: 0, max: 100 },
    ),
    consumptionLiterPerHour: ensureNumber(
      tank.consumptionLiterPerHour,
      `tank ${siteCode}.consumptionLiterPerHour`,
      { min: 0.01 },
    ),
  };

  if (normalized.criticalLevelPercent >= normalized.lowLevelPercent) {
    throw new Error(
      `tank ${siteCode}.criticalLevelPercent must be smaller than lowLevelPercent.`,
    );
  }

  if (shape === "rectangular") {
    if (!normalized.lengthCm || !normalized.widthCm || !normalized.heightCm) {
      throw new Error(
        `tank ${siteCode} rectangular must have lengthCm, widthCm, and heightCm.`,
      );
    }
  }

  if (shape === "horizontal-cylinder") {
    if (!normalized.lengthCm || !normalized.diameterCm) {
      throw new Error(
        `tank ${siteCode} horizontal-cylinder must have lengthCm and diameterCm.`,
      );
    }
  }

  if (!allowPlaceholder && normalized.capacityLiter <= 0) {
    throw new Error(`tank ${siteCode}.capacityLiter is invalid.`);
  }

  return normalized;
}

function normalizeDevice(site, tank, device, allowPlaceholder) {
  const siteCode = site.code;
  const apiKeyHash = ensureString(
    device?.apiKeyHash,
    `device ${siteCode}.apiKeyHash`,
    {
      pattern: HASH_PATTERN,
    },
  );

  if (!allowPlaceholder && hasPlaceholderHash(apiKeyHash)) {
    throw new Error(
      `device ${siteCode}.apiKeyHash masih hash placeholder. Generate hash key real dulu.`,
    );
  }

  return {
    id: ensureString(device.id, `device ${siteCode}.id`),
    siteId: site.id,
    tankId: tank.id,
    code: ensureString(device.code, `device ${siteCode}.code`),
    label: ensureString(device.label, `device ${siteCode}.label`),
    expectedReportIntervalSec: ensureNumber(
      device.expectedReportIntervalSec,
      `device ${siteCode}.expectedReportIntervalSec`,
      { min: MIN_REPORT_INTERVAL_SEC, max: MAX_REPORT_INTERVAL_SEC },
    ),
    apiKeyHash,
  };
}

function normalizeRegistry(registry, options) {
  assertNoForbiddenKeys(registry);

  if (!Array.isArray(registry?.sites)) {
    throw new Error("registry.sites must be an array.");
  }

  if (registry.sites.length < options.minSites) {
    throw new Error(
      `The pilot registry must contain at least ${options.minSites} active sites.`,
    );
  }

  const sites = [];
  const tanks = [];
  const devices = [];

  for (const rawSite of registry.sites) {
    const site = {
      id: ensureString(rawSite.id, "site.id"),
      code: ensureString(rawSite.code, "site.code").toUpperCase(),
      name: ensureString(rawSite.name, "site.name"),
      regionalLabel: normalizeLocationLabel(
        rawSite.regionalLabel,
        `site ${rawSite.code}.regionalLabel`,
        REGIONAL_LABELS,
        DEFAULT_REGIONAL_LABEL,
      ),
      wilayahLabel: normalizeLocationLabel(
        rawSite.wilayahLabel,
        `site ${rawSite.code}.wilayahLabel`,
        WILAYAH_LABELS,
        DEFAULT_WILAYAH_LABEL,
      ),
      areaLabel: ensureString(rawSite.areaLabel, "site.areaLabel"),
      latitude: ensureNumber(rawSite.latitude, `site ${rawSite.code}.latitude`, {
        min: -90,
        max: 90,
      }),
      longitude: ensureNumber(
        rawSite.longitude,
        `site ${rawSite.code}.longitude`,
        { min: -180, max: 180 },
      ),
      coordinateStatus: ensureString(
        rawSite.coordinateStatus,
        `site ${rawSite.code}.coordinateStatus`,
      ),
    };

    if (!options.allowPlaceholder && site.coordinateStatus !== "approved") {
      throw new Error(
        `site ${site.code}.coordinateStatus must be "approved" to apply real data.`,
      );
    }

    const tank = normalizeTank(site, rawSite.tank, options.allowPlaceholder);
    const device = normalizeDevice(
      site,
      tank,
      rawSite.device,
      options.allowPlaceholder,
    );

    sites.push(site);
    tanks.push(tank);
    devices.push(device);
  }

  assertUnique(sites, "id", "site.id");
  assertUnique(sites, "code", "site.code");
  assertUnique(tanks, "id", "tank.id");
  assertUnique(devices, "id", "device.id");
  assertUnique(devices, "code", "device.code");

  return { sites, tanks, devices };
}

async function readRegistry(filePath, options) {
  const absolutePath = path.resolve(filePath);
  const content = await fs.readFile(absolutePath, "utf8");
  const registry = JSON.parse(content);

  return {
    absolutePath,
    registry: normalizeRegistry(registry, options),
  };
}

async function createConnection() {
  const ssl = getMysqlSslConfig();

  return mysql.createConnection({
    uri: getMysqlDatabaseUrl(),
    multipleStatements: false,
    ...(ssl ? { ssl } : {}),
  });
}

async function upsertRegistry(connection, registry) {
  await connection.beginTransaction();

  try {
    for (const site of registry.sites) {
      await connection.execute(
        `
          INSERT INTO monitoring_sites
            (
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
            code = VALUES(code),
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
          site.regionalLabel,
          site.wilayahLabel,
          site.latitude,
          site.longitude,
        ],
      );
    }

    for (const tank of registry.tanks) {
      await connection.execute(
        `
          INSERT INTO monitoring_tanks
            (
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
            is_active = TRUE
        `,
        [
          tank.id,
          tank.siteId,
          tank.name,
          tank.shape,
          tank.capacityLiter,
          tank.diameterCm,
          tank.lengthCm,
          tank.heightCm,
          tank.widthCm,
          tank.sensorMountHeightCm,
          tank.lowLevelPercent,
          tank.criticalLevelPercent,
          tank.consumptionLiterPerHour,
        ],
      );
    }

    for (const device of registry.devices) {
      await connection.execute(
        `
          INSERT INTO monitoring_devices
            (
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
            code = VALUES(code),
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
          device.apiKeyHash,
        ],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

function printSummary(registry, options, absolutePath) {
  globalThis.console.log(`[pilot-registry] file: ${absolutePath}`);
  globalThis.console.log(
    `[pilot-registry] site=${registry.sites.length}, tank=${registry.tanks.length}, device=${registry.devices.length}`,
  );

  for (const site of registry.sites) {
    const device = registry.devices.find((item) => item.siteId === site.id);
    const tank = registry.tanks.find((item) => item.siteId === site.id);

    globalThis.console.log(
      [
        `- ${site.code}`,
        site.name,
        `${site.regionalLabel} / ${site.wilayahLabel} / ${site.areaLabel}`,
        `${site.latitude}, ${site.longitude}`,
        `${tank?.shape} ${tank?.capacityLiter} L`,
        device?.code,
      ].join(" | "),
    );
  }

  if (options.dryRun) {
    globalThis.console.log("[pilot-registry] dry-run: not writing to the database.");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const { absolutePath, registry } = await readRegistry(options.filePath, options);
  printSummary(registry, options, absolutePath);

  if (options.dryRun) {
    return;
  }

  const connection = await createConnection();

  try {
    await upsertRegistry(connection, registry);
    globalThis.console.log("[pilot-registry] finished applying pilot registry.");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  globalThis.console.error(`[pilot-registry] ${error.message}`);
  process.exitCode = 1;
});
