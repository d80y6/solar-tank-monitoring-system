import {
  getMonitoringReferenceData,
  type MonitoringReferenceData,
} from "./monitoring-registry";

import type {
  CatTelemetryPayload,
  Device,
  Reading,
  Tank,
  TankConfigStatus,
} from "../types/monitoring";
import {
  isGlobalDeviceKeyFallbackAllowed,
  verifyDeviceKey,
} from "./device-key";
import { provisionMonitoringDevice } from "./device-provisioning";
import { recordIngestNonce } from "./mysql-ingest-event-repository";
import {
  checkIngestSignature,
  getIngestSignatureMode,
  getIngestSignatureToleranceSeconds,
  type IngestSignatureMode,
} from "./ingest-signature";
import { normalizeCatPayload } from "./normalize-reading";
import {
  saveMonitoringReading,
  getMonitoringStorageDriver,
  type MonitoringStorageDriver,
} from "./monitoring-storage";
import {
  activateApprovedDeviceOnFirstPingFromMysql,
  type ActivateApprovedDeviceResult,
} from "./mysql-device-request-repository";

const DEFAULT_LOCAL_DEVICE_KEY = "local-development-key";

type IngestTelemetryInput = {
  deviceIdentifier?: string | null;
  deviceKey?: string | null;
  expectedDeviceKey?: string;
  allowGlobalDeviceKeyFallback?: boolean;
  allowDeviceAutoProvisioning?: boolean;
  provisioningKey?: string | null;
  expectedProvisioningKey?: string | null;
  payload: unknown;
  receivedAt?: Date;
  /** Raw request body, required when request signing is enabled. */
  rawBody?: string;
  /** Request headers, used to read the signature, nonce, and timestamp. */
  headers?: Headers;
  signatureMode?: IngestSignatureMode;
  signatureToleranceSeconds?: number;
};

type IngestTelemetrySuccess = {
  ok: true;
  status: 201;
  reading: Reading;
  data: {
    readingId: string;
    deviceId: string;
    deviceInternalId: string;
    tankId: string;
    receivedAt: string;
    measuredAt: string;
    sensorDistanceCm: number;
    fuelHeightCm: number;
    volumeLiter: number;
    fillPercent: number;
    runtimeHour: number;
    batteryVolt: number | null;
    rssiDbm: number | null;
    configStatus: TankConfigStatus | null;
    needsReview: boolean;
    warnings: string[];
    storage: MonitoringStorageDriver;
    provisioned: boolean;
    activated: boolean;
    signed: boolean;
  };
};

type IngestTelemetryFailure = {
  ok: false;
  status: 400 | 401 | 403 | 404 | 409 | 413 | 500;
  error: string;
};

export type IngestTelemetryResult =
  | IngestTelemetrySuccess
  | IngestTelemetryFailure;

function isRecord(value: unknown): value is CatTelemetryPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findDeviceByIdentifier(
  identifier: string,
  devices: Device[],
): Device | null {
  return (
    devices.find(
      (device) => device.id === identifier || device.code === identifier,
    ) ?? null
  );
}

function findTankByDevice(device: Device, tanks: Tank[]): Tank | null {
  return tanks.find((tank) => tank.id === device.tankId) ?? null;
}

function readPayloadDeviceIdentifier(
  payload: CatTelemetryPayload,
): string | null {
  const candidates = [
    payload.device,
    payload.device_id,
    payload.raw?.device,
    payload.raw?.device_id,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return null;
}

function isSameDeviceIdentifier(identifier: string, device: Device): boolean {
  return identifier === device.id || identifier === device.code;
}

export function getLocalDeviceKey(
  envValue = process.env.SOLAR_TANK_LOCAL_DEVICE_KEY,
): string {
  const trimmedValue = envValue?.trim();
  return trimmedValue || DEFAULT_LOCAL_DEVICE_KEY;
}

function activationFailureToIngestFailure(
  result: Exclude<ActivateApprovedDeviceResult, { ok: true }>,
): IngestTelemetryFailure | null {
  switch (result.reason) {
    case "not-found":
      return null;
    case "invalid-key":
      return {
        ok: false,
        status: 401,
        error: "Device key is invalid.",
      };
    case "not-ready":
      return {
        ok: false,
        status: 403,
        error:
          "Device is not ready to activate. Make sure the firmware package was downloaded from the official link.",
      };
    case "revoked":
      return {
        ok: false,
        status: 403,
        error: "Firmware package or device access is no longer valid.",
      };
  }
}

export async function ingestTelemetry({
  deviceIdentifier,
  deviceKey,
  expectedDeviceKey = DEFAULT_LOCAL_DEVICE_KEY,
  allowGlobalDeviceKeyFallback = isGlobalDeviceKeyFallbackAllowed(),
  allowDeviceAutoProvisioning = false,
  provisioningKey,
  expectedProvisioningKey,
  payload,
  receivedAt = new Date(),
  rawBody,
  headers,
  signatureMode = getIngestSignatureMode(),
  signatureToleranceSeconds = getIngestSignatureToleranceSeconds(),
}: IngestTelemetryInput): Promise<IngestTelemetryResult> {
  const cleanDeviceIdentifier = deviceIdentifier?.trim();

  if (!cleanDeviceIdentifier) {
    return {
      ok: false,
      status: 400,
      error: "Header X-Device-Id is required.",
    };
  }

  const cleanDeviceKey = deviceKey?.trim();

  if (!cleanDeviceKey) {
    return {
      ok: false,
      status: 401,
      error: "Header X-Api-Key or X-Device-Key is required.",
    };
  }

  if (!isRecord(payload)) {
    return {
      ok: false,
      status: 400,
      error: "Payload must be a JSON object.",
    };
  }

  let referenceData: MonitoringReferenceData;
  let device: Device | null = null;
  let provisioned = false;
  let activated = false;
  let tank: Tank | null = null;

  try {
    referenceData = await getMonitoringReferenceData();
  } catch {
    if (getMonitoringStorageDriver() === "mysql") {
      const activationResult = await activateApprovedDeviceOnFirstPingFromMysql({
        deviceIdentifier: cleanDeviceIdentifier,
        deviceKey: cleanDeviceKey,
        receivedAt,
      });

      if (activationResult.ok) {
        device = activationResult.device;
        tank = activationResult.tank;
        activated = true;
        referenceData = {
          devices: [activationResult.device],
          sites: [activationResult.site],
          tanks: [activationResult.tank],
        };
      } else {
        const activationFailure = activationFailureToIngestFailure(
          activationResult,
        );

        if (activationFailure) {
          return activationFailure;
        }

        return {
          ok: false,
          status: 500,
          error:
            "Site/tank/device registry could not be read from the active storage.",
        };
      }
    } else {
      return {
        ok: false,
        status: 500,
        error:
          "Site/tank/device registry could not be read from the active storage.",
      };
    }
  }

  if (!device) {
    device = findDeviceByIdentifier(
      cleanDeviceIdentifier,
      referenceData.devices,
    );
  }

  if (!device && getMonitoringStorageDriver() === "mysql") {
    const activationResult = await activateApprovedDeviceOnFirstPingFromMysql({
      deviceIdentifier: cleanDeviceIdentifier,
      deviceKey: cleanDeviceKey,
      receivedAt,
    });

    if (activationResult.ok) {
      device = activationResult.device;
      tank = activationResult.tank;
      activated = true;
    } else {
      const activationFailure = activationFailureToIngestFailure(
        activationResult,
      );

      if (activationFailure) {
        return activationFailure;
      }
    }
  }

  if (!device) {
    const payloadDeviceIdentifier = readPayloadDeviceIdentifier(payload);

    if (
      payloadDeviceIdentifier &&
      payloadDeviceIdentifier !== cleanDeviceIdentifier
    ) {
      return {
        ok: false,
        status: 400,
        error: "Device identity in payload does not match the header.",
      };
    }

    const provisioningResult = await provisionMonitoringDevice({
      deviceIdentifier: cleanDeviceIdentifier,
      deviceKey: cleanDeviceKey,
      expectedDeviceKey,
      allowGlobalDeviceKeyFallback,
      allowDeviceAutoProvisioning,
      provisioningKey,
      expectedProvisioningKey,
      payload,
    });

    if (!provisioningResult.ok) {
      if (
        provisioningResult.status === 403 &&
        !allowDeviceAutoProvisioning
      ) {
        return {
          ok: false,
          status: 404,
          error: "Device is not registered in operational data.",
        };
      }

      return provisioningResult;
    }

    device = provisioningResult.device;
    tank = provisioningResult.tank;
    provisioned = true;
  }

  if (!device.isActive) {
    return {
      ok: false,
      status: 403,
      error: "Device is inactive.",
    };
  }

  if (
    !verifyDeviceKey({
      device,
      suppliedDeviceKey: cleanDeviceKey,
      fallbackDeviceKey: expectedDeviceKey,
      allowGlobalFallback: allowGlobalDeviceKeyFallback,
      now: receivedAt,
    })
  ) {
    return {
      ok: false,
      status: 401,
      error: "Device key is invalid.",
    };
  }

  if (signatureMode !== "off" && rawBody !== undefined && headers) {
    const signatureCheck = checkIngestSignature({
      body: rawBody,
      deviceKey: cleanDeviceKey,
      headers,
      mode: signatureMode,
      now: receivedAt,
      toleranceSeconds: signatureToleranceSeconds,
    });

    if (!signatureCheck.ok) {
      return {
        ok: false,
        status: signatureCheck.reason === "clock-skew" ? 400 : 401,
        error:
          signatureCheck.reason === "clock-skew"
            ? "Device clock is outside the accepted window. Synchronise the device time."
            : "Telemetry signature is missing or invalid.",
      };
    }

    if (signatureCheck.signed) {
      const nonceAccepted = await recordIngestNonce({
        deviceId: device.id,
        nonce: signatureCheck.nonce,
        now: receivedAt,
        requestTimestamp: new Date(signatureCheck.timestampSeconds * 1_000),
      });

      if (!nonceAccepted) {
        return {
          ok: false,
          status: 409,
          error:
            "Duplicate telemetry signature rejected. The payload was already received.",
        };
      }
    }
  }

  const payloadDeviceIdentifier = readPayloadDeviceIdentifier(payload);

  if (
    payloadDeviceIdentifier &&
    !isSameDeviceIdentifier(payloadDeviceIdentifier, device)
  ) {
    return {
      ok: false,
      status: 400,
      error: "Device identity in payload does not match the header.",
    };
  }

  const canSyncProvisionedConfig =
    allowDeviceAutoProvisioning &&
    Boolean(provisioningKey?.trim()) &&
    (!expectedProvisioningKey?.trim() ||
      provisioningKey?.trim() === expectedProvisioningKey.trim());

  if (canSyncProvisionedConfig) {
    const syncResult = await provisionMonitoringDevice({
      deviceIdentifier: cleanDeviceIdentifier,
      deviceKey: cleanDeviceKey,
      expectedDeviceKey,
      allowGlobalDeviceKeyFallback,
      allowDeviceAutoProvisioning,
      provisioningKey,
      expectedProvisioningKey,
      payload,
    });

    if (syncResult.ok && syncResult.device.id === device.id) {
      device = syncResult.device;
      tank = syncResult.tank;
    }
  }

  tank = tank ?? findTankByDevice(device, referenceData.tanks);

  if (!tank) {
    return {
      ok: false,
      status: 404,
      error: "Tank configuration for the device was not found.",
    };
  }

  const reading = normalizeCatPayload({
    payload,
    tank,
    fallbackDeviceId: device.id,
    receivedAt,
    readingId: `reading-${device.id}-${receivedAt.getTime()}`,
  });

  try {
    const stored = await saveMonitoringReading({
      ...reading,
      deviceId: device.id,
      tankId: tank.id,
    });

    return {
      ok: true,
      status: 201,
      reading: stored.reading,
      data: {
        readingId: stored.reading.id,
        deviceId: device.code,
        deviceInternalId: device.id,
        tankId: tank.id,
        receivedAt: stored.reading.receivedAt,
        measuredAt: stored.reading.measuredAt,
        sensorDistanceCm: stored.reading.sensorDistanceCm,
        fuelHeightCm: stored.reading.fuelHeightCm,
        volumeLiter: stored.reading.volumeLiter,
        fillPercent: stored.reading.fillPercent,
        runtimeHour: stored.reading.runtimeHour,
        batteryVolt: stored.reading.batteryVolt ?? null,
        rssiDbm: stored.reading.rssiDbm ?? null,
        configStatus: stored.reading.quality?.configStatus ?? null,
        needsReview: stored.reading.quality?.needsReview ?? false,
        warnings: stored.reading.quality?.warnings ?? [],
        storage: stored.storage,
        provisioned,
        activated,
        signed: signatureMode !== "off" && rawBody !== undefined,
      },
    };
  } catch {
    return {
      ok: false,
      status: 500,
      error: "Failed to save telemetry data to the active storage.",
    };
  }
}
