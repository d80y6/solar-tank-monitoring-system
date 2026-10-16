import type {
  Tank,
  TankConfigIssue,
  TankConfigReview,
  TankConfigSnapshot,
  TankShape,
} from "../types/monitoring";
import { roundTo, toFiniteNumber } from "./number";

type PayloadRecord = Record<string, unknown>;

type NumberTolerance = {
  minorRatio: number;
  majorRatio: number;
  unit: string;
};

const PHYSICAL_TOLERANCE: NumberTolerance = {
  minorRatio: 0.02,
  majorRatio: 0.1,
  unit: "cm",
};

const CAPACITY_TOLERANCE: NumberTolerance = {
  minorRatio: 0.02,
  majorRatio: 0.1,
  unit: "L",
};

const CONSUMPTION_TOLERANCE: NumberTolerance = {
  minorRatio: 0.05,
  majorRatio: 0.2,
  unit: "L/h",
};

const PERCENT_TOLERANCE: NumberTolerance = {
  minorRatio: 0.03,
  majorRatio: 0.15,
  unit: "%",
};

const configLabels: Record<keyof TankConfigSnapshot, string> = {
  shape: "Tank shape",
  capacityLiter: "Tank capacity",
  diameterCm: "Tank diameter",
  lengthCm: "Tank length",
  heightCm: "Tank height",
  widthCm: "Tank width",
  sensorMountHeightCm: "Sensor height",
  lowLevelPercent: "Low level",
  criticalLevelPercent: "Critical level",
  consumptionLiterPerHour: "Consumption per hour",
};

export function isPayloadRecord(value: unknown): value is PayloadRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readPayloadPath(source: unknown, path: string): unknown {
  if (!isPayloadRecord(source)) {
    return undefined;
  }

  return path.split(".").reduce<unknown>((current, key) => {
    if (
      isPayloadRecord(current) &&
      Object.prototype.hasOwnProperty.call(current, key)
    ) {
      return current[key];
    }

    return undefined;
  }, source);
}

export function pickPayloadNumber(
  payload: unknown,
  paths: string[],
): number | null {
  for (const path of paths) {
    const value = readPayloadPath(payload, path);
    const parsed = toFiniteNumber(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export function pickPayloadString(
  payload: unknown,
  paths: string[],
): string | null {
  for (const path of paths) {
    const value = readPayloadPath(payload, path);

    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return null;
}

function pickPositivePayloadNumber(
  payload: unknown,
  paths: string[],
): number | undefined {
  const value = pickPayloadNumber(payload, paths);
  return value !== null && value > 0 ? value : undefined;
}

function pickPercentPayloadNumber(
  payload: unknown,
  paths: string[],
): number | undefined {
  const value = pickPayloadNumber(payload, paths);

  if (value === null || value < 0 || value > 100) {
    return undefined;
  }

  return value;
}

function normalizeTankShape(value: string | null): TankShape | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");

  if (["rectangular", "box", "balok"].includes(normalized)) {
    return "rectangular";
  }

  if (
    [
      "horizontal-cylinder",
      "cylinder-horizontal",
      "cylindrical",
      "cylinder",
      "silinder-horizontal",
      "tabung-horizontal",
    ].includes(normalized)
  ) {
    return "horizontal-cylinder";
  }

  return null;
}

function formatShape(shape: TankShape | undefined): string {
  if (!shape) {
    return "-";
  }

  return shape === "rectangular" ? "Rectangular tank" : "Horizontal cylinder";
}

function formatNumberValue(value: number | undefined, unit: string): string {
  if (typeof value !== "number") {
    return "-";
  }

  return `${roundTo(value, 2)} ${unit}`;
}

function formatSnapshotValue(
  field: keyof TankConfigSnapshot,
  value: TankConfigSnapshot[keyof TankConfigSnapshot],
): string {
  if (field === "shape") {
    return formatShape(value as TankShape | undefined);
  }

  const unit = field.includes("Percent")
    ? "%"
    : field === "capacityLiter"
      ? "L"
      : field === "consumptionLiterPerHour"
        ? "L/h"
        : "cm";

  return formatNumberValue(value as number | undefined, unit);
}

function getNumberCandidate(
  payload: unknown,
  paths: string[],
): { value: number | null; hasCandidate: boolean; rawValue: unknown } {
  for (const path of paths) {
    const rawValue = readPayloadPath(payload, path);

    if (typeof rawValue !== "undefined") {
      return {
        value: toFiniteNumber(rawValue),
        hasCandidate: true,
        rawValue,
      };
    }
  }

  return {
    value: null,
    hasCandidate: false,
    rawValue: undefined,
  };
}

function createInvalidNumberIssue({
  field,
  payloadValue,
  message,
}: {
  field: keyof TankConfigSnapshot;
  payloadValue: unknown;
  message: string;
}): TankConfigIssue {
  return {
    field,
    label: configLabels[field],
    severity: "invalid",
    registryValue: "-",
    payloadValue: String(payloadValue),
    message,
  };
}

function validatePositiveNumber(
  payload: unknown,
  field: keyof TankConfigSnapshot,
  paths: string[],
): TankConfigIssue[] {
  const candidate = getNumberCandidate(payload, paths);

  if (!candidate.hasCandidate) {
    return [];
  }

  if (candidate.value === null) {
    return [
      createInvalidNumberIssue({
        field,
        payloadValue: candidate.rawValue,
        message: `${configLabels[field]} from payload is not a valid number.`,
      }),
    ];
  }

  if (candidate.value <= 0) {
    return [
      createInvalidNumberIssue({
        field,
        payloadValue: candidate.rawValue,
        message: `${configLabels[field]} from payload must be greater than 0.`,
      }),
    ];
  }

  return [];
}

function validatePercentNumber(
  payload: unknown,
  field: keyof TankConfigSnapshot,
  paths: string[],
): TankConfigIssue[] {
  const candidate = getNumberCandidate(payload, paths);

  if (!candidate.hasCandidate) {
    return [];
  }

  if (candidate.value === null || candidate.value < 0 || candidate.value > 100) {
    return [
      createInvalidNumberIssue({
        field,
        payloadValue: candidate.rawValue,
        message: `${configLabels[field]} from payload must be within 0-100%.`,
      }),
    ];
  }

  return [];
}

function collectInvalidConfigIssues(payload: unknown): TankConfigIssue[] {
  const issues: TankConfigIssue[] = [];
  const rawShape = pickPayloadString(payload, [
    "tank_shape",
    "shape",
    "tank.shape",
    "tank.tank_shape",
  ]);

  if (rawShape && !normalizeTankShape(rawShape)) {
    issues.push({
      field: "shape_raw",
      label: "Tank shape",
      severity: "invalid",
      registryValue: "-",
      payloadValue: rawShape,
      message:
        "Tank shape from payload is not recognized. Use rectangular or horizontal-cylinder.",
    });
  }

  issues.push(
    ...validatePositiveNumber(payload, "capacityLiter", [
      "capacity_liter",
      "capacityLiter",
      "tank.capacity_liter",
      "tank.capacityLiter",
    ]),
    ...validatePositiveNumber(payload, "lengthCm", [
      "length_cm",
      "lengthCm",
      "tank.length_cm",
      "tank.lengthCm",
    ]),
    ...validatePositiveNumber(payload, "widthCm", [
      "width_cm",
      "widthCm",
      "tank.width_cm",
      "tank.widthCm",
    ]),
    ...validatePositiveNumber(payload, "heightCm", [
      "height_cm",
      "heightCm",
      "tank.height_cm",
      "tank.heightCm",
    ]),
    ...validatePositiveNumber(payload, "diameterCm", [
      "diameter_cm",
      "diameterCm",
      "tank.diameter_cm",
      "tank.diameterCm",
    ]),
    ...validatePositiveNumber(payload, "sensorMountHeightCm", [
      "sensor_mount_height_cm",
      "sensorMountHeightCm",
      "tank.sensor_mount_height_cm",
      "tank.sensorMountHeightCm",
    ]),
    ...validatePositiveNumber(payload, "consumptionLiterPerHour", [
      "consumption_liter_per_hour",
      "consumptionLiterPerHour",
      "tank.consumption_liter_per_hour",
      "tank.consumptionLiterPerHour",
    ]),
    ...validatePercentNumber(payload, "lowLevelPercent", [
      "low_level_percent",
      "lowLevelPercent",
      "tank.low_level_percent",
      "tank.lowLevelPercent",
    ]),
    ...validatePercentNumber(payload, "criticalLevelPercent", [
      "critical_level_percent",
      "criticalLevelPercent",
      "tank.critical_level_percent",
      "tank.criticalLevelPercent",
    ]),
  );

  return issues;
}

export function tankToConfigSnapshot(tank: Tank): TankConfigSnapshot {
  return {
    shape: tank.shape,
    capacityLiter: tank.capacityLiter,
    diameterCm: tank.diameterCm,
    lengthCm: tank.lengthCm,
    heightCm: tank.heightCm,
    widthCm: tank.widthCm,
    sensorMountHeightCm: tank.sensorMountHeightCm,
    lowLevelPercent: tank.lowLevelPercent,
    criticalLevelPercent: tank.criticalLevelPercent,
    consumptionLiterPerHour: tank.consumptionLiterPerHour,
  };
}

export function extractPayloadTankConfig(
  payload: unknown,
): TankConfigSnapshot | null {
  const shape = normalizeTankShape(
    pickPayloadString(payload, [
      "tank_shape",
      "shape",
      "tank.shape",
      "tank.tank_shape",
    ]),
  );

  const config: TankConfigSnapshot = {
    ...(shape ? { shape } : {}),
    capacityLiter: pickPositivePayloadNumber(payload, [
      "capacity_liter",
      "capacityLiter",
      "tank.capacity_liter",
      "tank.capacityLiter",
    ]),
    lengthCm: pickPositivePayloadNumber(payload, [
      "length_cm",
      "lengthCm",
      "tank.length_cm",
      "tank.lengthCm",
    ]),
    widthCm: pickPositivePayloadNumber(payload, [
      "width_cm",
      "widthCm",
      "tank.width_cm",
      "tank.widthCm",
    ]),
    heightCm: pickPositivePayloadNumber(payload, [
      "height_cm",
      "heightCm",
      "tank.height_cm",
      "tank.heightCm",
    ]),
    diameterCm: pickPositivePayloadNumber(payload, [
      "diameter_cm",
      "diameterCm",
      "tank.diameter_cm",
      "tank.diameterCm",
    ]),
    sensorMountHeightCm: pickPositivePayloadNumber(payload, [
      "sensor_mount_height_cm",
      "sensorMountHeightCm",
      "tank.sensor_mount_height_cm",
      "tank.sensorMountHeightCm",
    ]),
    lowLevelPercent: pickPercentPayloadNumber(payload, [
      "low_level_percent",
      "lowLevelPercent",
      "tank.low_level_percent",
      "tank.lowLevelPercent",
    ]),
    criticalLevelPercent: pickPercentPayloadNumber(payload, [
      "critical_level_percent",
      "criticalLevelPercent",
      "tank.critical_level_percent",
      "tank.criticalLevelPercent",
    ]),
    consumptionLiterPerHour: pickPositivePayloadNumber(payload, [
      "consumption_liter_per_hour",
      "consumptionLiterPerHour",
      "tank.consumption_liter_per_hour",
      "tank.consumptionLiterPerHour",
    ]),
  };

  const cleanConfig = Object.fromEntries(
    Object.entries(config).filter(([, value]) => typeof value !== "undefined"),
  ) as TankConfigSnapshot;

  return Object.keys(cleanConfig).length > 0 ? cleanConfig : null;
}

function createComparableIssue({
  field,
  severity,
  registryValue,
  payloadValue,
  message,
}: {
  field: keyof TankConfigSnapshot;
  severity: "warning" | "mismatch";
  registryValue: TankConfigSnapshot[keyof TankConfigSnapshot];
  payloadValue: TankConfigSnapshot[keyof TankConfigSnapshot];
  message: string;
}): TankConfigIssue {
  return {
    field,
    label: configLabels[field],
    severity,
    registryValue: formatSnapshotValue(field, registryValue),
    payloadValue: formatSnapshotValue(field, payloadValue),
    message,
  };
}

function compareShape(
  registry: TankConfigSnapshot,
  payload: TankConfigSnapshot,
): TankConfigIssue[] {
  if (!payload.shape || !registry.shape || payload.shape === registry.shape) {
    return [];
  }

  return [
    createComparableIssue({
      field: "shape",
      severity: "mismatch",
      registryValue: registry.shape,
      payloadValue: payload.shape,
      message: "Payload tank shape differs from the official registry.",
    }),
  ];
}

function compareNumberField(
  registry: TankConfigSnapshot,
  payload: TankConfigSnapshot,
  field: keyof TankConfigSnapshot,
  tolerance: NumberTolerance,
): TankConfigIssue[] {
  const registryValue = registry[field];
  const payloadValue = payload[field];

  if (
    typeof registryValue !== "number" ||
    typeof payloadValue !== "number" ||
    registryValue <= 0
  ) {
    return [];
  }

  const differenceRatio = Math.abs(payloadValue - registryValue) / registryValue;

  if (differenceRatio <= tolerance.minorRatio) {
    return [];
  }

  const severity =
    differenceRatio > tolerance.majorRatio ? "mismatch" : "warning";
  const differencePercent = roundTo(differenceRatio * 100, 2);

  return [
    createComparableIssue({
      field,
      severity,
      registryValue,
      payloadValue,
      message: `${configLabels[field]} payload differs by ${differencePercent}% from the registry.`,
    }),
  ];
}

function isPayloadConfigComplete(config: TankConfigSnapshot | null): boolean {
  if (
    !config?.shape ||
    !config.capacityLiter ||
    !config.sensorMountHeightCm ||
    !config.consumptionLiterPerHour
  ) {
    return false;
  }

  if (config.shape === "rectangular") {
    return Boolean(config.lengthCm && config.widthCm && config.heightCm);
  }

  return Boolean(config.lengthCm && config.diameterCm);
}

function buildConfigSummary({
  status,
  hasPayloadConfig,
  isPayloadComplete,
}: {
  status: TankConfigReview["status"];
  hasPayloadConfig: boolean;
  isPayloadComplete: boolean;
}): string {
  if (status === "invalid_config") {
    return "Payload config is invalid";
  }

  if (status === "config_mismatch") {
    return "Config mismatch needs review";
  }

  if (status === "minor_config_difference") {
    return "Minor configuration difference";
  }

  if (!hasPayloadConfig) {
    return "Using registry configuration";
  }

  return isPayloadComplete
    ? "Payload config within tolerance"
    : "Partial payload config, remainder from registry";
}

function canApplyPayloadConfig(status: TankConfigReview["status"]): boolean {
  return status === "normal" || status === "minor_config_difference";
}

export function resolveTankFromPayloadConfig(
  payload: unknown,
  baseTank: Tank,
): Tank {
  const payloadConfig = extractPayloadTankConfig(payload);

  if (!payloadConfig) {
    return baseTank;
  }

  const shape = payloadConfig.shape ?? baseTank.shape;

  return {
    ...baseTank,
    shape,
    capacityLiter: payloadConfig.capacityLiter ?? baseTank.capacityLiter,
    sensorMountHeightCm:
      payloadConfig.sensorMountHeightCm ?? baseTank.sensorMountHeightCm,
    lowLevelPercent: payloadConfig.lowLevelPercent ?? baseTank.lowLevelPercent,
    criticalLevelPercent:
      payloadConfig.criticalLevelPercent ?? baseTank.criticalLevelPercent,
    consumptionLiterPerHour:
      payloadConfig.consumptionLiterPerHour ??
      baseTank.consumptionLiterPerHour,
    ...(shape === "rectangular"
      ? {
          lengthCm: payloadConfig.lengthCm ?? baseTank.lengthCm,
          widthCm: payloadConfig.widthCm ?? baseTank.widthCm,
          heightCm: payloadConfig.heightCm ?? baseTank.heightCm,
          diameterCm: undefined,
        }
      : {
          lengthCm: payloadConfig.lengthCm ?? baseTank.lengthCm,
          diameterCm: payloadConfig.diameterCm ?? baseTank.diameterCm,
          widthCm: undefined,
          heightCm: undefined,
        }),
  };
}

export function compareRegistryVsPayloadConfig(
  registryTank: Tank,
  payload: unknown,
): TankConfigReview {
  const registryTankConfig = tankToConfigSnapshot(registryTank);
  const payloadTankConfig = extractPayloadTankConfig(payload);
  const payloadAppliedTankConfig = tankToConfigSnapshot(
    resolveTankFromPayloadConfig(payload, registryTank),
  );
  const invalidIssues = collectInvalidConfigIssues(payload);
  const comparisonIssues = payloadTankConfig
    ? [
        ...compareShape(registryTankConfig, payloadTankConfig),
        ...compareNumberField(
          registryTankConfig,
          payloadTankConfig,
          "capacityLiter",
          CAPACITY_TOLERANCE,
        ),
        ...compareNumberField(
          registryTankConfig,
          payloadTankConfig,
          "sensorMountHeightCm",
          PHYSICAL_TOLERANCE,
        ),
        ...compareNumberField(
          registryTankConfig,
          payloadTankConfig,
          "lengthCm",
          PHYSICAL_TOLERANCE,
        ),
        ...compareNumberField(
          registryTankConfig,
          payloadTankConfig,
          "widthCm",
          PHYSICAL_TOLERANCE,
        ),
        ...compareNumberField(
          registryTankConfig,
          payloadTankConfig,
          "heightCm",
          PHYSICAL_TOLERANCE,
        ),
        ...compareNumberField(
          registryTankConfig,
          payloadTankConfig,
          "diameterCm",
          PHYSICAL_TOLERANCE,
        ),
        ...compareNumberField(
          registryTankConfig,
          payloadTankConfig,
          "lowLevelPercent",
          PERCENT_TOLERANCE,
        ),
        ...compareNumberField(
          registryTankConfig,
          payloadTankConfig,
          "criticalLevelPercent",
          PERCENT_TOLERANCE,
        ),
        ...compareNumberField(
          registryTankConfig,
          payloadTankConfig,
          "consumptionLiterPerHour",
          CONSUMPTION_TOLERANCE,
        ),
      ]
    : [];
  const issues = [...invalidIssues, ...comparisonIssues];
  const hasInvalidIssue = issues.some((issue) => issue.severity === "invalid");
  const hasMismatchIssue = issues.some(
    (issue) => issue.severity === "mismatch",
  );
  const hasWarningIssue = issues.some((issue) => issue.severity === "warning");
  const isPayloadComplete = isPayloadConfigComplete(payloadTankConfig);
  const hasPayloadConfig =
    Boolean(payloadTankConfig) || invalidIssues.length > 0;
  const status: TankConfigReview["status"] = hasInvalidIssue
    ? "invalid_config"
    : hasMismatchIssue
      ? "config_mismatch"
      : hasWarningIssue
        ? "minor_config_difference"
        : "normal";
  const usePayloadConfig = canApplyPayloadConfig(status);
  const configSource = !payloadTankConfig || !usePayloadConfig
    ? "registry"
    : isPayloadComplete
      ? "payload"
      : "mixed";
  const appliedTankConfig = usePayloadConfig
    ? payloadAppliedTankConfig
    : registryTankConfig;
  const reasons = issues.map((issue) => issue.message);

  return {
    status,
    configSource,
    needsReview: status === "invalid_config" || status === "config_mismatch",
    summaryLabel: buildConfigSummary({
      status,
      hasPayloadConfig,
      isPayloadComplete,
    }),
    reasons,
    issues,
    registryTankConfig,
    payloadTankConfig,
    appliedTankConfig,
  };
}

export function resolveReviewedTankFromPayloadConfig(
  payload: unknown,
  baseTank: Tank,
  review?: TankConfigReview,
): Tank {
  const configReview = review ?? compareRegistryVsPayloadConfig(baseTank, payload);

  if (!canApplyPayloadConfig(configReview.status)) {
    return baseTank;
  }

  return resolveTankFromPayloadConfig(payload, baseTank);
}
