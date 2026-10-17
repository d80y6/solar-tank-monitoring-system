#!/usr/bin/env node

import process from "node:process";

const DEMO_DEVICE_KEYS = new Map([
  ["demo-tph-01", "demo-tph-key"],
  ["demo-nja-01", "demo-nja-key"],
  ["demo-jto-01", "demo-jto-key"],
  ["demo-skp-01", "demo-skp-key"],
]);

const DEFAULT_OPTIONS = {
  baseUrl: "http://localhost:3000",
  endpointPath: "/api/ingest",
  device: "demo-tph-01",
  deviceKey: process.env.SOLAR_TANK_DEVICE_KEY?.trim() || "",
  intervalMs: 5000,
  startPercent: 84,
  stepPercent: 1.5,
  minPercent: 5,
  capacityLiter: 5000,
  sensorMountHeightCm: 150,
  batteryVolt: 3.86,
  rssiDbm: -55,
  once: false,
};

const VALUE_FLAGS = new Map([
  ["--base-url", "baseUrl"],
  ["--endpoint", "endpointPath"],
  ["--device", "device"],
  ["--key", "deviceKey"],
  ["--interval-ms", "intervalMs"],
  ["--start-percent", "startPercent"],
  ["--step-percent", "stepPercent"],
  ["--min-percent", "minPercent"],
  ["--capacity-liter", "capacityLiter"],
  ["--sensor-height-cm", "sensorMountHeightCm"],
  ["--battery", "batteryVolt"],
  ["--rssi", "rssiDbm"],
]);

function printHelp() {
  globalThis.console.log(`
SolarTank device simulator

Usage:
  pnpm simulate:device --once
  pnpm simulate:device --device demo-tph-01 --interval-ms 5000
  pnpm simulate:device --critical --once

Options:
  --base-url <url>             Default: http://localhost:3000
  --endpoint <path>            Default: /api/ingest
  --device <id>                Default: demo-tph-01
  --key <key>                  Default: env SOLAR_TANK_DEVICE_KEY, demo device key, or local fallback
  --interval-ms <number>       Default: 5000
  --start-percent <number>     Default: 84
  --step-percent <number>      Default: 1.5
  --min-percent <number>       Default: 5
  --capacity-liter <number>    Default: 5000
  --sensor-height-cm <number>  Default: 150
  --battery <number>           Default: 3.86
  --rssi <number>              Default: -55
  --once                       Send one payload and exit
  --critical                   Start from 9 percent with step 0
  --help                       Show this help
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

function round(value, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function sleep(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { ...options, help: true };
    }

    if (arg === "--once") {
      options.once = true;
      continue;
    }

    if (arg === "--critical") {
      options.startPercent = 9;
      options.stepPercent = 0;
      options.minPercent = 0;
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
  const device = String(options.device).trim();
  const deviceKey =
    String(options.deviceKey).trim() ||
    DEMO_DEVICE_KEYS.get(device) ||
    process.env.SOLAR_TANK_LOCAL_DEVICE_KEY?.trim() ||
    "local-development-key";

  const normalized = {
    ...options,
    baseUrl: normalizeBaseUrl(options.baseUrl),
    endpointPath: normalizeEndpointPath(options.endpointPath),
    device,
    deviceKey,
    intervalMs: toNumber(options.intervalMs, "--interval-ms", { min: 500 }),
    startPercent: toNumber(options.startPercent, "--start-percent", {
      min: 0,
      max: 100,
    }),
    stepPercent: toNumber(options.stepPercent, "--step-percent", { min: 0 }),
    minPercent: toNumber(options.minPercent, "--min-percent", {
      min: 0,
      max: 100,
    }),
    capacityLiter: toNumber(options.capacityLiter, "--capacity-liter", {
      min: 1,
    }),
    sensorMountHeightCm: toNumber(
      options.sensorMountHeightCm,
      "--sensor-height-cm",
      { min: 1 },
    ),
    batteryVolt: toNumber(options.batteryVolt, "--battery", { min: 0 }),
    rssiDbm: toNumber(options.rssiDbm, "--rssi"),
  };

  if (!normalized.device) {
    throw new Error("--device must not be empty.");
  }

  if (!normalized.deviceKey) {
    throw new Error("--key must not be empty.");
  }

  if (normalized.minPercent > normalized.startPercent) {
    throw new Error("--min-percent must not be greater than --start-percent.");
  }

  return normalized;
}

function createPayload(options, percent) {
  const fillPercent = round(percent);
  const volumeLiter = round((options.capacityLiter * fillPercent) / 100);
  const fuelHeightCm = round(
    (options.sensorMountHeightCm * fillPercent) / 100,
  );
  const sensorDistanceCm = round(options.sensorMountHeightCm - fuelHeightCm);

  return {
    device: options.device,
    ts: Math.floor(Date.now() / 1000),
    distance: sensorDistanceCm,
    voltage: round(options.batteryVolt),
    raw: {
      H_cm: fuelHeightCm,
      volume: volumeLiter,
      percent: fillPercent,
      wifi_rssi: Math.round(options.rssiDbm),
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
        "X-Device-Id": options.device,
        "X-Api-Key": options.deviceKey,
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

function printResult(payload, result) {
  const statusText = result.ok ? "delivered" : "failed";

  globalThis.console.log(
    `[simulator] ${statusText} ${payload.device} | ${payload.raw.percent}% | ${payload.raw.volume} L | jarak ${payload.distance} cm | HTTP ${result.status}`,
  );

  if (!result.ok && result.body) {
    globalThis.console.error(result.body);
  }
}

function nextPercent(currentPercent, options) {
  if (options.stepPercent === 0) {
    return currentPercent;
  }

  const nextValue = round(currentPercent - options.stepPercent);
  return nextValue < options.minPercent ? options.startPercent : nextValue;
}

async function run(options) {
  if (typeof globalThis.fetch !== "function") {
    throw new Error("Fetch is unavailable. Use Node.js 18 or newer.");
  }

  let currentPercent = options.startPercent;

  process.once("SIGINT", () => {
    globalThis.console.log("\n[simulator] dihentikan.");
    process.exit(0);
  });

  do {
    const payload = createPayload(options, currentPercent);
    const result = await postPayload(options, payload);

    printResult(payload, result);

    if (!result.ok) {
      process.exitCode = 1;
    }

    if (options.once) {
      break;
    }

    currentPercent = nextPercent(currentPercent, options);
    await sleep(options.intervalMs);
  } while (true);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  await run(options);
}

main().catch((error) => {
  globalThis.console.error(`[simulator] ${error.message}`);
  process.exitCode = 1;
});
