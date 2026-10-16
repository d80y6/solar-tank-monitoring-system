import type {
  CatTelemetryPayload,
  NormalizeReadingInput,
  Reading,
  ReadingQuality,
  ReadingValueSource,
} from "../types/monitoring";
import { clampNumber, roundTo } from "./number";
import {
  compareRegistryVsPayloadConfig,
  pickPayloadNumber,
  pickPayloadString,
  resolveReviewedTankFromPayloadConfig,
} from "./reading-tank-config";
import { calculateRuntimeHours } from "./runtime";
import {
  calculateFillPercent,
  calculateFuelHeightCm,
  calculateTankVolumeLiter,
  getMaxFuelHeightCm,
} from "./tank-volume";

const MAX_DEVICE_TIME_DRIFT_MS = 24 * 60 * 60 * 1000;
const MAX_REASONABLE_VOLTAGE = 60;
const MIN_REASONABLE_RSSI = -120;
const MAX_REASONABLE_RSSI = 0;
const CALCULATION_MISMATCH_RATIO = 0.05;

type MeasuredAtResult = {
  measuredAt: string;
  source: ReadingValueSource;
  warning: string | null;
};

function resolveMeasuredAtCandidate(
  candidateDate: Date,
  receivedAt: Date,
): MeasuredAtResult {
  const candidateTime = candidateDate.getTime();

  if (!Number.isFinite(candidateTime)) {
    return {
      measuredAt: receivedAt.toISOString(),
      source: "server",
      warning: "Device timestamp is invalid; measuredAt uses server time.",
    };
  }

  const driftMs = Math.abs(receivedAt.getTime() - candidateTime);

  if (driftMs > MAX_DEVICE_TIME_DRIFT_MS) {
    return {
      measuredAt: receivedAt.toISOString(),
      source: "server",
      warning:
        "Device timestamp differs from server time by more than 24 hours; measuredAt uses server time."
    };
  }

  return {
    measuredAt: candidateDate.toISOString(),
    source: "device",
    warning: null,
  };
}

function resolveMeasuredAt(
  payload: CatTelemetryPayload,
  receivedAt: Date,
): MeasuredAtResult {
  const tsIso = pickPayloadString(payload, [
    "measuredAt",
    "measured_at",
    "ts_iso",
    "raw.measuredAt",
    "raw.measured_at",
    "raw.ts_iso",
  ]);

  if (tsIso) {
    return resolveMeasuredAtCandidate(new Date(tsIso), receivedAt);
  }

  const ts = pickPayloadNumber(payload, ["ts", "raw.ts"]);

  if (ts !== null && ts > 0) {
    const timestampMs = ts > 1_000_000_000_000 ? ts : ts * 1000;
    return resolveMeasuredAtCandidate(new Date(timestampMs), receivedAt);
  }

  return {
    measuredAt: receivedAt.toISOString(),
    source: "server",
    warning: null,
  };
}

function normalizeDistanceCm({
  value,
  maxFuelHeightCm,
  warnings,
}: {
  value: number | null;
  maxFuelHeightCm: number;
  warnings: string[];
}): number {
  if (value === null) {
    warnings.push(
      "Payload does not carry distance_cm; sensor distance falls back to 0 cm."
    );
    return 0;
  }

  if (value < 0) {
    warnings.push("distance_cm is negative; value clamped to 0 cm.");
  }

  if (value > maxFuelHeightCm) {
    warnings.push(
      "distance_cm exceeds the tank height limit; value clamped to the tank maximum height.",
    );
  }

  return roundTo(clampNumber(value, 0, maxFuelHeightCm), 2);
}

function normalizeClampedDeviceNumber({
  value,
  min,
  max,
  label,
  warnings,
}: {
  value: number | null;
  min: number;
  max: number;
  label: string;
  warnings: string[];
}): number | null {
  if (value === null) {
    return null;
  }

  if (value < min || value > max) {
    warnings.push(`${label} from payload is out of the reasonable range and clamped.`);
  }

  return roundTo(clampNumber(value, min, max), 2);
}

function normalizePercent({
  value,
  label,
  warnings,
}: {
  value: number | null;
  label: string;
  warnings: string[];
}): number | null {
  if (value === null) {
    return null;
  }

  if (value < 0 || value > 100) {
    warnings.push(
      `${label} from payload must be 0-100%; payload value ignored and recalculated by the backend.`,
    );
    return null;
  }

  return roundTo(value, 2);
}

function normalizeBatteryVolt(
  payload: CatTelemetryPayload,
  warnings: string[],
): number | null {
  const value = pickPayloadNumber(payload, [
    "voltage",
    "vbatt",
    "vbat",
    "batteryVolt",
    "raw.voltage",
    "raw.vbatt",
    "raw.vbat",
    "raw.batteryVolt",
  ]);

  if (value === null) {
    return null;
  }

  if (value < 0 || value > MAX_REASONABLE_VOLTAGE) {
    warnings.push("Payload voltage is out of the reasonable range; value ignored.");
    return null;
  }

  return roundTo(value, 2);
}

function normalizeRssiDbm(
  payload: CatTelemetryPayload,
  warnings: string[],
): number | null {
  const value = pickPayloadNumber(payload, [
    "rssi",
    "wifi_rssi",
    "raw.rssi",
    "raw.wifi_rssi",
  ]);

  if (value === null) {
    return null;
  }

  if (value < MIN_REASONABLE_RSSI || value > MAX_REASONABLE_RSSI) {
    warnings.push("Payload RSSI is out of the reasonable range; value ignored.");
    return null;
  }

  return roundTo(value, 2);
}

function pushCalculationMismatchWarning({
  deviceValue,
  backendValue,
  capacityLiter,
  label,
  warnings,
}: {
  deviceValue: number | null;
  backendValue: number;
  capacityLiter: number;
  label: string;
  warnings: string[];
}) {
  if (deviceValue === null || capacityLiter <= 0) {
    return;
  }

  const differenceRatio = Math.abs(deviceValue - backendValue) / capacityLiter;

  if (differenceRatio > CALCULATION_MISMATCH_RATIO) {
    warnings.push(
      `${label} from the device differs by more than 5% of capacity against the backend calculation.`,
    );
  }
}

export function normalizeCatPayload({
  payload,
  tank,
  fallbackDeviceId,
  receivedAt = new Date(),
  readingId,
}: NormalizeReadingInput): Reading {
  const warnings: string[] = [];
  const configReview = compareRegistryVsPayloadConfig(tank, payload);
  const readingTank = resolveReviewedTankFromPayloadConfig(
    payload,
    tank,
    configReview,
  );
  const canUseDeviceCalculatedValues = !configReview.needsReview;
  const deviceId =
    pickPayloadString(payload, ["device", "device_id", "raw.device"]) ??
    fallbackDeviceId ??
    "unknown-device";
  const measuredAtResult = resolveMeasuredAt(payload, receivedAt);

  if (measuredAtResult.warning) {
    warnings.push(measuredAtResult.warning);
  }

  if (!canUseDeviceCalculatedValues) {
    warnings.push(
      "Device height, volume, and percent values are ignored until the payload config is reviewed.",
    );
  }

  const maxFuelHeightCm = getMaxFuelHeightCm(readingTank);
  const sensorDistanceCm = normalizeDistanceCm({
    value: pickPayloadNumber(payload, [
      "dist_cm",
      "distance_cm",
      "dist",
      "distance",
      "raw.dist_cm",
      "raw.distance_cm",
      "raw.dist",
      "raw.distance",
    ]),
    maxFuelHeightCm,
    warnings,
  });
  const deviceFuelHeightCm = canUseDeviceCalculatedValues
    ? normalizeClampedDeviceNumber({
        value: pickPayloadNumber(payload, [
          "local_H_cm",
          "fuel_height_cm",
          "fuelHeightCm",
          "h_cm",
          "H_cm",
          "local_result.fuel_height_cm",
          "local_result.fuelHeightCm",
          "raw.local_H_cm",
          "raw.fuel_height_cm",
          "raw.fuelHeightCm",
          "raw.h_cm",
          "raw.H_cm",
        ]),
        min: 0,
        max: maxFuelHeightCm,
        label: "Fuel height",
        warnings,
      })
    : null;
  const backendFuelHeightCm = calculateFuelHeightCm({
    sensorMountHeightCm: readingTank.sensorMountHeightCm,
    sensorDistanceCm,
    maxFuelHeightCm,
  });
  const fuelHeightCm = deviceFuelHeightCm ?? backendFuelHeightCm;
  const fuelHeightSource: ReadingValueSource =
    deviceFuelHeightCm !== null ? "device" : "backend";
  const deviceVolumeLiter = canUseDeviceCalculatedValues
    ? normalizeClampedDeviceNumber({
        value: pickPayloadNumber(payload, [
          "local_volume_l",
          "volume_liter",
          "volume_l",
          "volume",
          "local_result.volume_liter",
          "local_result.volumeLiter",
          "raw.local_volume_l",
          "raw.volume_liter",
          "raw.volume_l",
          "raw.volume",
        ]),
        min: 0,
        max: readingTank.capacityLiter,
        label: "Volume",
        warnings,
      })
    : null;
  const backendVolumeLiter = calculateTankVolumeLiter(readingTank, fuelHeightCm);
  const volumeLiter = deviceVolumeLiter ?? backendVolumeLiter;
  const volumeSource: ReadingValueSource =
    deviceVolumeLiter !== null ? "device" : "backend";
  const deviceFillPercent = canUseDeviceCalculatedValues
    ? normalizePercent({
        value: pickPayloadNumber(payload, [
          "local_percent",
          "fill_percent",
          "percent",
          "local_result.fill_percent",
          "local_result.fillPercent",
          "raw.local_percent",
          "raw.fill_percent",
          "raw.percent",
        ]),
        label: "Fill percent",
        warnings,
      })
    : null;
  const backendFillPercent = calculateFillPercent(
    volumeLiter,
    readingTank.capacityLiter,
  );
  const fillPercent = deviceFillPercent ?? backendFillPercent;
  const fillPercentSource: ReadingValueSource =
    deviceFillPercent !== null ? "device" : "backend";
  const runtimeHour =
    calculateRuntimeHours(volumeLiter, readingTank.consumptionLiterPerHour) ??
    0;
  const batteryVolt = normalizeBatteryVolt(payload, warnings);
  const rssiDbm = normalizeRssiDbm(payload, warnings);

  pushCalculationMismatchWarning({
    deviceValue: deviceVolumeLiter,
    backendValue: backendVolumeLiter,
    capacityLiter: readingTank.capacityLiter,
    label: "Volume",
    warnings,
  });
  pushCalculationMismatchWarning({
    deviceValue: deviceFillPercent,
    backendValue: backendFillPercent,
    capacityLiter: 100,
    label: "Fill percent",
    warnings,
  });

  const quality: ReadingQuality = {
    measuredAtSource: measuredAtResult.source,
    fuelHeightSource,
    volumeSource,
    fillPercentSource,
    runtimeSource: "backend",
    configSource: configReview.configSource,
    configStatus: configReview.status,
    needsReview: configReview.needsReview,
    warnings: [...configReview.reasons, ...warnings],
    configMismatchReasons: configReview.reasons,
  };

  return {
    id: readingId ?? `reading-${deviceId}-${receivedAt.getTime()}`,
    deviceId,
    tankId: tank.id,
    measuredAt: measuredAtResult.measuredAt,
    receivedAt: receivedAt.toISOString(),
    sensorDistanceCm,
    fuelHeightCm,
    volumeLiter,
    fillPercent,
    runtimeHour,
    ...(batteryVolt !== null ? { batteryVolt } : {}),
    ...(rssiDbm !== null ? { rssiDbm } : {}),
    rawPayload: payload,
    quality,
  };
}
