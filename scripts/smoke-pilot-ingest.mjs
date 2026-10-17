#!/usr/bin/env node

import process from "node:process";

const DEFAULT_OPTIONS = {
  baseUrl: process.env.PILOT_API_BASE_URL || "http://localhost:3000",
  endpointPath: process.env.PILOT_INGEST_PATH || "/api/ingest",
  deviceId: process.env.PILOT_DEVICE_ID || "pilot-tph-01",
  deviceKey: process.env.PILOT_DEVICE_KEY || "",
  tankShape: process.env.PILOT_TANK_SHAPE || "rectangular",
  capacityLiter: process.env.PILOT_CAPACITY_LITER || 540,
  lengthCm: process.env.PILOT_LENGTH_CM || 150,
  widthCm: process.env.PILOT_WIDTH_CM || 60,
  heightCm: process.env.PILOT_HEIGHT_CM || 60,
  sensorMountHeightCm: process.env.PILOT_SENSOR_MOUNT_HEIGHT_CM || 60,
  distanceCm: process.env.PILOT_DISTANCE_CM || 10.2,
  lowLevelPercent: process.env.PILOT_LOW_LEVEL_PERCENT || 30,
  criticalLevelPercent: process.env.PILOT_CRITICAL_LEVEL_PERCENT || 15,
  consumptionLiterPerHour: process.env.PILOT_CONSUMPTION_LITER_PER_HOUR || 25,
  batteryVolt: process.env.PILOT_BATTERY_VOLT || 3.7,
  rssiDbm: process.env.PILOT_RSSI_DBM || -54,
  latitude: process.env.PILOT_LATITUDE || "",
  longitude: process.env.PILOT_LONGITUDE || "",
  deviceIp: process.env.PILOT_DEVICE_IP || "",
  expectStorage: process.env.PILOT_EXPECT_STORAGE || "mysql",
  dryRun: false,
  allowConfigReview: false,
};

const VALUE_FLAGS = new Map([
  ["--base-url", "baseUrl"],
  ["--endpoint", "endpointPath"],
  ["--device", "deviceId"],
  ["--key", "deviceKey"],
  ["--capacity-liter", "capacityLiter"],
  ["--length-cm", "lengthCm"],
  ["--width-cm", "widthCm"],
  ["--height-cm", "heightCm"],
  ["--sensor-mount-height-cm", "sensorMountHeightCm"],
  ["--distance-cm", "distanceCm"],
  ["--low-level-percent", "lowLevelPercent"],
  ["--critical-level-percent", "criticalLevelPercent"],
  ["--consumption-liter-per-hour", "consumptionLiterPerHour"],
  ["--battery", "batteryVolt"],
  ["--rssi", "rssiDbm"],
  ["--lat", "latitude"],
  ["--lng", "longitude"],
  ["--device-ip", "deviceIp"],
  ["--expect-storage", "expectStorage"],
]);

function printHelp() {
  globalThis.console.log(`
Smoke test pilot ingest with real-format payloads.

Usage:
  PILOT_DEVICE_KEY="key-real" pnpm pilot:smoke
  pnpm pilot:smoke -- --base-url https://solar-tank-monitoring-system.vercel.app --device pilot-tph-01

Key options:
  --base-url <url>                    Default: PILOT_API_BASE_URL or http://localhost:3000
  --device <id>                       Default: PILOT_DEVICE_ID or pilot-tph-01
  --key <key>                         Default: PILOT_DEVICE_KEY
  --distance-cm <number>              Default: 10.2
  --capacity-liter <number>           Default: 540
  --length-cm <number>                Default: 150
  --width-cm <number>                 Default: 60
  --height-cm <number>                Default: 60
  --sensor-mount-height-cm <number>   Default: 60
  --lat <number> --lng <number>     Optional, only when coordinates may be sent
  --device-ip <ip>                    Optional, do not use an internal IP if it must not be shared
  --dry-run                           Show the payload without sending
  --allow-config-review               Do not fail when response needsReview=true
  --help                              Show this help
`);
}

function normalizeBaseUrl(value) {
  const cleanValue = String(value).trim();

  if (!cleanValue) {
    throw new Error("Base URL must not be empty.");
  }

  return cleanValue.replace(/\/+$/, "");
}

function normalizeEndpointPath(value) {
  const cleanValue = String(value).trim();

  if (!cleanValue) {
    throw new Error("Endpoint must not be empty.");
  }

  return cleanValue.startsWith("/") ? cleanValue : `/${cleanValue}`;
}

function toNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a number.`);
  }

  if (number < min || number > max) {
    throw new Error(`${label} must be in the range ${min} to ${max}.`);
  }

  return number;
}

function toOptionalNumber(value, label, range) {
  const cleanValue = String(value).trim();

  if (!cleanValue) {
    return undefined;
  }

  return toNumber(cleanValue, label, range);
}

function round(value, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { ...options, help: true };
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--allow-config-review") {
      options.allowConfigReview = true;
      continue;
    }

    const optionKey = VALUE_FLAGS.get(arg);

    if (!optionKey) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} requires a value.`);
    }

    options[optionKey] = value;
    index += 1;
  }

  return normalizeOptions(options);
}

function normalizeOptions(options) {
  const tankShape = String(options.tankShape).trim();

  if (tankShape !== "rectangular") {
    throw new Error("Smoke pilot currently only supports tankShape rectangular.");
  }

  const normalized = {
    ...options,
    baseUrl: normalizeBaseUrl(options.baseUrl),
    endpointPath: normalizeEndpointPath(options.endpointPath),
    deviceId: String(options.deviceId).trim(),
    deviceKey: String(options.deviceKey).trim(),
    tankShape,
    capacityLiter: toNumber(options.capacityLiter, "capacityLiter", { min: 1 }),
    lengthCm: toNumber(options.lengthCm, "lengthCm", { min: 1 }),
    widthCm: toNumber(options.widthCm, "widthCm", { min: 1 }),
    heightCm: toNumber(options.heightCm, "heightCm", { min: 1 }),
    sensorMountHeightCm: toNumber(
      options.sensorMountHeightCm,
      "sensorMountHeightCm",
      { min: 1 },
    ),
    distanceCm: toNumber(options.distanceCm, "distanceCm", { min: 0 }),
    lowLevelPercent: toNumber(options.lowLevelPercent, "lowLevelPercent", {
      min: 0,
      max: 100,
    }),
    criticalLevelPercent: toNumber(
      options.criticalLevelPercent,
      "criticalLevelPercent",
      { min: 0, max: 100 },
    ),
    consumptionLiterPerHour: toNumber(
      options.consumptionLiterPerHour,
      "consumptionLiterPerHour",
      { min: 0.01 },
    ),
    batteryVolt: toNumber(options.batteryVolt, "batteryVolt", { min: 0 }),
    rssiDbm: toNumber(options.rssiDbm, "rssiDbm"),
    latitude: toOptionalNumber(options.latitude, "latitude", {
      min: -90,
      max: 90,
    }),
    longitude: toOptionalNumber(options.longitude, "longitude", {
      min: -180,
      max: 180,
    }),
    deviceIp: String(options.deviceIp).trim(),
    expectStorage: String(options.expectStorage).trim(),
  };

  if (!normalized.deviceId) {
    throw new Error("Device ID is required.");
  }

  if (!normalized.deviceKey && !normalized.dryRun) {
    throw new Error("PILOT_DEVICE_KEY or --key is required to send.");
  }

  if (normalized.criticalLevelPercent >= normalized.lowLevelPercent) {
    throw new Error("criticalLevelPercent must be smaller than lowLevelPercent.");
  }

  if (normalized.distanceCm > normalized.sensorMountHeightCm) {
    throw new Error("distanceCm must not be greater than sensorMountHeightCm.");
  }

  return normalized;
}

function createPayload(options) {
  const fuelHeightCm = round(options.sensorMountHeightCm - options.distanceCm);
  const volumeLiter = round(
    (options.lengthCm * options.widthCm * fuelHeightCm) / 1000,
  );
  const fillPercent = round((volumeLiter / options.capacityLiter) * 100);

  return {
    device: options.deviceId,
    ts: Math.floor(Date.now() / 1000),
    measuredAt: new Date().toISOString(),
    tank_shape: options.tankShape,
    capacity_liter: options.capacityLiter,
    length_cm: options.lengthCm,
    width_cm: options.widthCm,
    height_cm: options.heightCm,
    sensor_mount_height_cm: options.sensorMountHeightCm,
    low_level_percent: options.lowLevelPercent,
    critical_level_percent: options.criticalLevelPercent,
    consumption_liter_per_hour: options.consumptionLiterPerHour,
    distance: options.distanceCm,
    distance_cm: options.distanceCm,
    dist: options.distanceCm,
    dist_cm: options.distanceCm,
    voltage: round(options.batteryVolt, 3),
    rssi: Math.round(options.rssiDbm),
    wifi_rssi: Math.round(options.rssiDbm),
    ...(typeof options.latitude === "number" ? { lat: options.latitude } : {}),
    ...(typeof options.longitude === "number" ? { lng: options.longitude } : {}),
    ...(options.deviceIp ? { ip: options.deviceIp } : {}),
    tank: {
      shape: options.tankShape,
      capacity_liter: options.capacityLiter,
      length_cm: options.lengthCm,
      width_cm: options.widthCm,
      height_cm: options.heightCm,
      sensor_mount_height_cm: options.sensorMountHeightCm,
    },
    local_result: {
      fuel_height_cm: fuelHeightCm,
      volume_liter: volumeLiter,
      fill_percent: fillPercent,
      runtime_hour: round(volumeLiter / options.consumptionLiterPerHour),
    },
    raw: {
      local_H_cm: fuelHeightCm,
      local_volume_l: volumeLiter,
      local_percent: fillPercent,
      wifi_rssi: Math.round(options.rssiDbm),
      ...(options.deviceIp ? { ip: options.deviceIp } : {}),
    },
  };
}

async function readResponseBody(response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const text = await response.text();
  return text || null;
}

async function postPayload(options, payload) {
  const response = await globalThis.fetch(
    `${options.baseUrl}${options.endpointPath}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": options.deviceId,
        "X-Device-Key": options.deviceKey,
      },
      body: JSON.stringify(payload),
    },
  );

  return {
    ok: response.ok,
    status: response.status,
    body: await readResponseBody(response),
  };
}

function validateResult(options, result) {
  if (!result.ok) {
    throw new Error(`Ingest failed with HTTP ${result.status}.`);
  }

  if (!result.body?.ok) {
    throw new Error("Ingest response does not carry ok=true.");
  }

  const data = result.body.data;

  if (options.expectStorage && data?.storage !== options.expectStorage) {
    throw new Error(
      `Storage response ${data?.storage ?? "-"} does not match the expectation ${options.expectStorage}.`,
    );
  }

  if (data?.needsReview && !options.allowConfigReview) {
    throw new Error(
      "Ingest succeeded but the config needs review. Run with --allow-config-review only for intentional mismatch tests.",
    );
  }

  return data;
}

function printResult(data) {
  globalThis.console.log("[pilot-smoke] ingest sukses");
  globalThis.console.log(`deviceId     : ${data.deviceId}`);
  globalThis.console.log(`tankId       : ${data.tankId}`);
  globalThis.console.log(`volumeLiter  : ${data.volumeLiter}`);
  globalThis.console.log(`fillPercent  : ${data.fillPercent}`);
  globalThis.console.log(`runtimeHour  : ${data.runtimeHour}`);
  globalThis.console.log(`storage      : ${data.storage}`);

  if ("configStatus" in data) {
    globalThis.console.log(`configStatus : ${data.configStatus}`);
    globalThis.console.log(`needsReview  : ${data.needsReview}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const payload = createPayload(options);

  if (options.dryRun) {
    globalThis.console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (typeof globalThis.fetch !== "function") {
    throw new Error("Fetch is unavailable. Use Node.js 18 or newer.");
  }

  const result = await postPayload(options, payload);
  const data = validateResult(options, result);
  printResult(data);
}

main().catch((error) => {
  globalThis.console.error(`[pilot-smoke] ${error.message}`);
  process.exitCode = 1;
});
