import { randomBytes } from "node:crypto";

import type {
  DeviceSensorType,
  DeviceRequestCapacityCheck,
  DeviceRequestDraft,
  DeviceRequestStatus,
  DeviceRequestValidationIssue,
  LoadPowerUnit,
  MonitoringDeviceRequest,
  MonitoringFirmwareTemplate,
  MonitoringHardwareProfile,
  NormalizedDeviceRequestDraft,
  TankShape,
} from "../types/monitoring";
import {
  normalizeRegionalLabel,
  normalizeWilayahLabel,
} from "./location-taxonomy";
import { roundTo } from "./number";

const DEFAULT_LOW_LEVEL_PERCENT = 30;
const DEFAULT_CRITICAL_LEVEL_PERCENT = 15;
const DEFAULT_DEVICE_SENSOR_TYPE: DeviceSensorType = "fuel";
const GENSET_LOAD_LITER_PER_KWH = 0.21;
const DEFAULT_CAPACITY_TOLERANCE_PERCENT = 5;
const DEFAULT_CAPACITY_TOLERANCE_LITER = 5;
const REQUEST_CODE_RANDOM_BYTES = 3;
const GENERATED_DEVICE_CODE_RANDOM_BYTES = 3;
const MONITORING_ID_RANDOM_BYTES = 18;

type DeviceRequestValidationOptions = {
  capacityToleranceLiter?: number;
  capacityTolerancePercent?: number;
  firmwareTemplates?: MonitoringFirmwareTemplate[];
  hardwareProfiles?: MonitoringHardwareProfile[];
};

type DeviceRequestValidationResult = {
  ok: boolean;
  errors: DeviceRequestValidationIssue[];
  warnings: DeviceRequestValidationIssue[];
  normalized: NormalizedDeviceRequestDraft | null;
  capacityCheck: DeviceRequestCapacityCheck | null;
};

type BuildPendingDeviceRequestInput = DeviceRequestValidationOptions & {
  draft: DeviceRequestDraft;
  requesterEmail: string;
  requesterUserId: string;
  now?: Date;
};

type BuildPendingDeviceRequestResult =
  | {
      ok: true;
      request: MonitoringDeviceRequest;
      validation: DeviceRequestValidationResult;
    }
  | {
      ok: false;
      validation: DeviceRequestValidationResult;
    };

function createMonitoringId(prefix: string): string {
  return `${prefix}_${randomBytes(MONITORING_ID_RANDOM_BYTES).toString("base64url")}`;
}

function normalizeSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeSiteCode(value: string): string {
  return normalizeSpaces(value)
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeDeviceCode(value: string): string {
  return normalizeSpaces(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeDeviceSensorType(value: unknown): DeviceSensorType {
  return value === "energy" || value === "fuel"
    ? value
    : DEFAULT_DEVICE_SENSOR_TYPE;
}

function normalizeLoadPowerUnit(value: unknown): LoadPowerUnit {
  return value === "kva" || value === "kw" ? value : "kw";
}

function normalizeOptionalText(value?: string | null): string | null {
  const cleanValue = value ? normalizeSpaces(value) : "";
  return cleanValue || null;
}

function normalizePositiveNumber(value?: number | null): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function normalizePercent(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeCosPhi(value?: number | null): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1
    ? value
    : undefined;
}

function createIssue(
  field: string,
  message: string,
  severity: DeviceRequestValidationIssue["severity"] = "error",
): DeviceRequestValidationIssue {
  return {
    field,
    message,
    severity,
  };
}

function isValidCoordinate(value: number | undefined, min: number, max: number): boolean {
  return typeof value === "undefined" || (value >= min && value <= max);
}

function calculateRectangularCapacityLiter({
  heightCm,
  lengthCm,
  widthCm,
}: {
  heightCm?: number;
  lengthCm?: number;
  widthCm?: number;
}): number | null {
  if (!heightCm || !lengthCm || !widthCm) {
    return null;
  }

  return roundTo((heightCm * lengthCm * widthCm) / 1000, 2);
}

function calculateHorizontalCylinderCapacityLiter({
  diameterCm,
  lengthCm,
}: {
  diameterCm?: number;
  lengthCm?: number;
}): number | null {
  if (!diameterCm || !lengthCm) {
    return null;
  }

  const radiusCm = diameterCm / 2;
  return roundTo((Math.PI * radiusCm * radiusCm * lengthCm) / 1000, 2);
}

export function calculateDeviceRequestCapacityLiter(
  draft: Pick<
    NormalizedDeviceRequestDraft,
    "diameterCm" | "heightCm" | "lengthCm" | "tankShape" | "widthCm"
  >,
): number | null {
  if (draft.tankShape === "rectangular") {
    return calculateRectangularCapacityLiter(draft);
  }

  return calculateHorizontalCylinderCapacityLiter(draft);
}

export function evaluateDeviceRequestCapacity({
  calculatedCapacityLiter,
  capacityToleranceLiter = DEFAULT_CAPACITY_TOLERANCE_LITER,
  capacityTolerancePercent = DEFAULT_CAPACITY_TOLERANCE_PERCENT,
  declaredCapacityLiter,
}: {
  calculatedCapacityLiter: number | null;
  capacityToleranceLiter?: number;
  capacityTolerancePercent?: number;
  declaredCapacityLiter: number;
}): DeviceRequestCapacityCheck {
  if (!calculatedCapacityLiter || calculatedCapacityLiter <= 0) {
    return {
      calculatedCapacityLiter: null,
      declaredCapacityLiter,
      differenceLiter: null,
      differencePercent: null,
      isConsistent: false,
    };
  }

  const differenceLiter = roundTo(
    Math.abs(declaredCapacityLiter - calculatedCapacityLiter),
    2,
  );
  const differencePercent = roundTo(
    (differenceLiter / calculatedCapacityLiter) * 100,
    2,
  );

  return {
    calculatedCapacityLiter,
    declaredCapacityLiter,
    differenceLiter,
    differencePercent,
    isConsistent:
      differenceLiter <= capacityToleranceLiter ||
      differencePercent <= capacityTolerancePercent,
  };
}

export function isTankShapeSupportedByHardwareProfile({
  profile,
  tankShape,
}: {
  profile: MonitoringHardwareProfile;
  tankShape: TankShape;
}): boolean {
  return (
    profile.supportedTankShape === "any" ||
    profile.supportedTankShape === tankShape
  );
}

export function getDeviceSensorTypeLabel(sensorType: DeviceSensorType): string {
  switch (sensorType) {
    case "energy":
      return "Energy sensor";
    case "fuel":
      return "Fuel sensor";
  }
}

export function createSiteCodeFromName({
  areaLabel,
  siteName,
}: {
  areaLabel?: string | null;
  siteName?: string | null;
}): string {
  const cleanSiteName = normalizeSpaces(siteName ?? "")
    .replace(/^STO\s+/i, "")
    .replace(/\bSTO\b/gi, "");
  const baseValue = cleanSiteName || normalizeSpaces(areaLabel ?? "");
  const code = normalizeSiteCode(baseValue).slice(0, 24);

  return code || "STO";
}

export function createGeneratedDeviceCode({
  siteCode,
}: {
  siteCode: string;
}): string {
  const safeSiteCode =
    normalizeDeviceCode(siteCode).replace(/^sto-?/, "") || "sto";
  const randomPart = randomBytes(GENERATED_DEVICE_CODE_RANDOM_BYTES)
    .toString("hex")
    .toLowerCase();

  return normalizeDeviceCode(`device-${safeSiteCode}-${randomPart}`);
}

export function calculateOperationalLoadKw({
  cosPhi,
  loadUnit,
  loadValue,
}: {
  cosPhi: number;
  loadUnit: LoadPowerUnit;
  loadValue: number;
}): number {
  return roundTo(loadUnit === "kva" ? loadValue * cosPhi : loadValue, 2);
}

export function calculateOperationalConsumptionLiterPerHour({
  cosPhi,
  dieselEngineCapacityKva,
  loadUnit,
  loadValue,
}: {
  cosPhi: number;
  dieselEngineCapacityKva: number;
  loadUnit: LoadPowerUnit;
  loadValue: number;
}): number {
  const effectiveLoadKw = calculateOperationalLoadKw({
    cosPhi,
    loadUnit,
    loadValue,
  });
  const engineCapacityKw = dieselEngineCapacityKva * cosPhi;

  if (engineCapacityKw <= 0) {
    return 0;
  }

  const loadRatio = effectiveLoadKw / engineCapacityKw;
  const loadConsumption =
    dieselEngineCapacityKva * loadRatio * GENSET_LOAD_LITER_PER_KWH;

  return roundTo(Math.max(0, loadConsumption), 2);
}

export function createDeviceRequestCode({
  now = new Date(),
  siteCode,
}: {
  now?: Date;
  siteCode: string;
}): string {
  const safeSiteCode = normalizeSiteCode(siteCode) || "STO";
  const datePart = now.toISOString().slice(0, 10).replaceAll("-", "");
  const randomPart = randomBytes(REQUEST_CODE_RANDOM_BYTES)
    .toString("hex")
    .toUpperCase();

  return `REQ-${safeSiteCode}-${datePart}-${randomPart}`;
}

export function createDeviceRequestId(): string {
  return createMonitoringId("device_request");
}

export function createFirmwarePackageId(): string {
  return createMonitoringId("device_package");
}

export function validateDeviceRequestDraft(
  draft: DeviceRequestDraft,
  options: DeviceRequestValidationOptions = {},
): DeviceRequestValidationResult {
  const errors: DeviceRequestValidationIssue[] = [];
  const warnings: DeviceRequestValidationIssue[] = [];
  const siteName = normalizeOptionalText(draft.siteName);
  const areaLabel = normalizeOptionalText(draft.areaLabel);
  const regionalLabel = normalizeRegionalLabel(draft.regionalLabel);
  const wilayahLabel = normalizeWilayahLabel(draft.wilayahLabel);
  const explicitSiteCode = normalizeOptionalText(draft.siteCode);
  const siteCode = normalizeSiteCode(
    explicitSiteCode ?? createSiteCodeFromName({ areaLabel, siteName }),
  );
  const deviceSensorType = normalizeDeviceSensorType(draft.deviceSensorType);
  const explicitDeviceCode = normalizeOptionalText(draft.deviceCode);
  const deviceCode = normalizeDeviceCode(
    explicitDeviceCode ?? createGeneratedDeviceCode({ siteCode }),
  );
  const lengthCm = normalizePositiveNumber(draft.lengthCm);
  const widthCm = normalizePositiveNumber(draft.widthCm);
  const heightCm = normalizePositiveNumber(draft.heightCm);
  const diameterCm = normalizePositiveNumber(draft.diameterCm);
  const loadValue = normalizePositiveNumber(draft.loadValue);
  const loadUnit = normalizeLoadPowerUnit(draft.loadUnit);
  const dieselEngineCapacityKva = normalizePositiveNumber(
    draft.dieselEngineCapacityKva,
  );
  const cosPhi = normalizeCosPhi(draft.cosPhi);
  const lowLevelPercent = normalizePercent(null, DEFAULT_LOW_LEVEL_PERCENT);
  const criticalLevelPercent = normalizePercent(
    null,
    DEFAULT_CRITICAL_LEVEL_PERCENT,
  );
  const consumptionLiterPerHour =
    loadValue && dieselEngineCapacityKva && cosPhi
      ? calculateOperationalConsumptionLiterPerHour({
          cosPhi,
          dieselEngineCapacityKva,
          loadUnit,
          loadValue,
        })
      : 0;
  const capacityLiter = calculateDeviceRequestCapacityLiter({
    tankShape: draft.tankShape,
    lengthCm,
    widthCm,
    heightCm,
    diameterCm,
  });

  if (!siteName) {
    errors.push(createIssue("siteName", "STO name is required."));
  }

  if (!areaLabel) {
    errors.push(createIssue("areaLabel", "STO area is required."));
  }

  if (!regionalLabel) {
    errors.push(createIssue("regionalLabel", "Regional must be selected."));
  }

  if (!wilayahLabel) {
    errors.push(createIssue("wilayahLabel", "Territory must be selected."));
  }

  if (deviceCode && deviceCode.length < 4) {
    errors.push(
      createIssue("deviceCode", "Device code must be at least 4 characters."),
    );
  }

  if (deviceSensorType !== "fuel") {
    errors.push(
      createIssue(
        "deviceSensorType",
        "Energy sensor mode is not active in the current firmware package. Use the fuel sensor first.",
      ),
    );
  }

  if (!isValidCoordinate(draft.latitude ?? undefined, -90, 90)) {
    errors.push(
      createIssue("latitude", "Latitude must be between -90 and 90."),
    );
  }

  if (!isValidCoordinate(draft.longitude ?? undefined, -180, 180)) {
    errors.push(
      createIssue(
        "longitude",
        "Longitude must be between -180 and 180.",
      ),
    );
  }

  if (draft.tankShape === "rectangular") {
    if (!lengthCm) {
      errors.push(createIssue("lengthCm", "Rectangular tanks must have a length."));
    }

    if (!widthCm) {
      errors.push(createIssue("widthCm", "Rectangular tanks must have a width."));
    }

    if (!heightCm) {
      errors.push(createIssue("heightCm", "Rectangular tanks must have a height."));
    }
  } else if (draft.tankShape === "horizontal-cylinder") {
    if (!lengthCm) {
      errors.push(
        createIssue("lengthCm", "Cylinder tanks must have a length."),
      );
    }

    if (!diameterCm) {
      errors.push(
        createIssue("diameterCm", "Cylinder tanks must have a diameter."),
      );
    }
  } else {
    errors.push(createIssue("tankShape", "Unknown tank type."));
  }

  if (!capacityLiter) {
    errors.push(
      createIssue(
        "capacityLiter",
        "Tank capacity cannot be calculated yet. Complete the tank dimensions.",
      ),
    );
  }

  const inferredSensorMountHeightCm =
    normalizePositiveNumber(draft.sensorMountHeightCm) ??
    (draft.tankShape === "rectangular" ? heightCm : diameterCm);

  if (!inferredSensorMountHeightCm) {
    errors.push(
      createIssue(
        "sensorMountHeightCm",
        "Sensor reference height must be available from input or tank dimensions.",
      ),
    );
  }

  if (!loadValue) {
    errors.push(
      createIssue(
        "loadValue",
        "Location load must be greater than 0 so hourly fuel consumption can be calculated.",
      ),
    );
  }

  if (!dieselEngineCapacityKva) {
    errors.push(
      createIssue(
        "dieselEngineCapacityKva",
        "Diesel engine capacity must be greater than 0 kVA.",
      ),
    );
  }

  if (!cosPhi) {
    errors.push(
      createIssue("cosPhi", "Cos phi must be a number greater than 0 and up to 1."),
    );
  }

  if (loadValue && dieselEngineCapacityKva && cosPhi) {
    const effectiveLoadKw = calculateOperationalLoadKw({
      cosPhi,
      loadUnit,
      loadValue,
    });
    const engineCapacityKw = roundTo(dieselEngineCapacityKva * cosPhi, 2);

    if (effectiveLoadKw > engineCapacityKw * 1.05) {
      warnings.push(
        createIssue(
          "loadValue",
          "Location load appears larger than the diesel engine capacity. Admin confirmation is needed before approval.",
          "warning",
        ),
      );
    }
  }

  const hardwareProfile = options.hardwareProfiles?.find(
    (profile) => profile.id === draft.hardwareProfileId,
  );

  if (options.hardwareProfiles && !hardwareProfile) {
    errors.push(
      createIssue(
        "hardwareProfileId",
        "Hardware profile not found or unavailable.",
      ),
    );
  }

  if (hardwareProfile) {
    if (!hardwareProfile.isActive) {
      errors.push(
        createIssue(
          "hardwareProfileId",
          "Hardware profile is not active for device requests.",
        ),
      );
    }

    if (
      !isTankShapeSupportedByHardwareProfile({
        profile: hardwareProfile,
        tankShape: draft.tankShape,
      })
    ) {
      errors.push(
        createIssue(
          "hardwareProfileId",
          "Hardware profile does not match the selected tank type.",
        ),
      );
    }

    const firmwareTemplate = options.firmwareTemplates?.find(
      (template) => template.id === hardwareProfile.firmwareTemplateId,
    );

    if (options.firmwareTemplates && !firmwareTemplate) {
      errors.push(
        createIssue(
          "firmwareTemplateId",
          "Firmware template for the hardware profile was not found.",
        ),
      );
    }

    if (firmwareTemplate && !firmwareTemplate.isActive) {
      errors.push(
        createIssue(
          "firmwareTemplateId",
          "Firmware template is not active for creating device packages.",
        ),
      );
    }
  }

  const normalized: NormalizedDeviceRequestDraft | null =
    siteCode &&
    siteName &&
    areaLabel &&
    regionalLabel &&
    wilayahLabel &&
    deviceCode &&
    capacityLiter &&
    loadValue &&
    dieselEngineCapacityKva &&
    cosPhi
      ? {
          siteCode,
          siteName,
          areaLabel,
          regionalLabel,
          wilayahLabel,
          deviceCode,
          deviceLabel:
            normalizeOptionalText(draft.deviceLabel) ??
            `${getDeviceSensorTypeLabel(deviceSensorType)} ${siteName}`,
          deviceSensorType,
          tankShape: draft.tankShape,
          capacityLiter,
          ...(typeof draft.latitude === "number" ? { latitude: draft.latitude } : {}),
          ...(typeof draft.longitude === "number"
            ? { longitude: draft.longitude }
            : {}),
          ...(typeof lengthCm === "number" ? { lengthCm } : {}),
          ...(draft.tankShape === "rectangular" && typeof widthCm === "number"
            ? { widthCm }
            : {}),
          ...(draft.tankShape === "rectangular" && typeof heightCm === "number"
            ? { heightCm }
            : {}),
          ...(draft.tankShape === "horizontal-cylinder" &&
          typeof diameterCm === "number"
            ? { diameterCm }
            : {}),
          sensorMountHeightCm: inferredSensorMountHeightCm ?? 0,
          loadValue,
          loadUnit,
          dieselEngineCapacityKva,
          cosPhi,
          lowLevelPercent,
          criticalLevelPercent,
          consumptionLiterPerHour,
          hardwareProfileId: draft.hardwareProfileId,
        }
      : null;

  const capacityCheck =
    normalized && capacityLiter
      ? evaluateDeviceRequestCapacity({
          calculatedCapacityLiter: capacityLiter,
          capacityToleranceLiter: options.capacityToleranceLiter,
          capacityTolerancePercent: options.capacityTolerancePercent,
          declaredCapacityLiter: capacityLiter,
        })
      : null;

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalized: errors.length === 0 ? normalized : null,
    capacityCheck,
  };
}

export function buildPendingDeviceRequest({
  draft,
  firmwareTemplates,
  hardwareProfiles = [],
  now = new Date(),
  requesterEmail,
  requesterUserId,
  ...validationOptions
}: BuildPendingDeviceRequestInput): BuildPendingDeviceRequestResult {
  const validation = validateDeviceRequestDraft(draft, {
    ...validationOptions,
    firmwareTemplates,
    hardwareProfiles,
  });
  const errors = [...validation.errors];
  const normalizedRequesterUserId = requesterUserId.trim();
  const normalizedRequesterEmail = requesterEmail.trim().toLowerCase();

  if (!normalizedRequesterUserId) {
    errors.push(createIssue("requesterUserId", "Requesting user is required."));
  }

  if (!normalizedRequesterEmail) {
    errors.push(createIssue("requesterEmail", "Requesting user email is required."));
  }

  if (!validation.ok || !validation.normalized || errors.length > 0) {
    return {
      ok: false,
      validation: {
        ...validation,
        errors,
        ok: false,
        normalized: null,
      },
    };
  }

  const hardwareProfile = hardwareProfiles.find(
    (profile) => profile.id === validation.normalized?.hardwareProfileId,
  );

  if (!hardwareProfile) {
    return {
      ok: false,
      validation: {
        ...validation,
        errors: [
          ...validation.errors,
          createIssue(
            "hardwareProfileId",
            "Hardware profile must be available before creating the request.",
          ),
        ],
        ok: false,
        normalized: null,
      },
    };
  }

  const createdAt = now.toISOString();
  const request: MonitoringDeviceRequest = {
    ...validation.normalized,
    id: createDeviceRequestId(),
    requestCode: createDeviceRequestCode({
      now,
      siteCode: validation.normalized.siteCode,
    }),
    requesterUserId: normalizedRequesterUserId,
    requesterEmail: normalizedRequesterEmail,
    status: "pending_admin_review",
    firmwareTemplateId: hardwareProfile.firmwareTemplateId,
    adminReviewedByUserId: null,
    adminReviewedAt: null,
    rejectionReason: null,
    validationWarnings: validation.warnings,
    createdAt,
    updatedAt: createdAt,
  };

  return {
    ok: true,
    request,
    validation,
  };
}

export function getDeviceRequestStatusLabel(status: DeviceRequestStatus): string {
  switch (status) {
    case "pending_admin_review":
      return "Waiting for admin";
    case "rejected":
      return "Rejected";
    case "approved_waiting_package":
      return "Approved, waiting for firmware package";
    case "approved_package_ready":
      return "Firmware package ready";
    case "waiting_firmware_download":
      return "Waiting for firmware download";
    case "waiting_first_valid_ping":
      return "Waiting for device online";
    case "active":
      return "Device active";
    case "expired":
      return "Expired";
    case "revoked":
      return "Revoked";
    case "package_generation_failed":
      return "Package generation failed";
  }
}
