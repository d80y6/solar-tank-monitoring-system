"use server";

import { revalidatePath } from "next/cache";

import { requirePageUser } from "@/features/auth/lib/auth-guards";
import {
  createDeviceRequestInMysql,
  type CreateDeviceRequestFromMysqlResult,
} from "@/features/monitoring/lib/mysql-device-request-repository";
import { notifyAdminsDeviceRequestCreated } from "@/features/monitoring/lib/device-request-notifications";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";
import { getSafeErrorMessage } from "@/lib/safe-error-message";
import type {
  DeviceSensorType,
  DeviceRequestDraft,
  DeviceRequestValidationIssue,
  LoadPowerUnit,
  TankShape,
} from "@/features/monitoring/types/monitoring";

const USER_DEVICE_REQUEST_PATH = "/dashboard/devices/request";
const ADMIN_DEVICE_REQUEST_PATH = "/dashboard/admin/device-requests";
const DEVICE_REQUEST_SCHEMA_COLUMNS = [
  "device_sensor_type",
  "regional_label",
  "wilayah_label",
  "load_value",
  "load_unit",
  "diesel_engine_capacity_kva",
  "cos_phi",
] as const;

export type DeviceRequestFormState = {
  status: "idle" | "success" | "error";
  message: string;
  requestCode?: string;
  issues?: DeviceRequestValidationIssue[];
};

function getOptionalFormValue(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function getRequiredFormValue(formData: FormData, key: string): string {
  const value = getOptionalFormValue(formData, key);

  if (!value) {
    throw new Error("Device request form is incomplete.");
  }

  return value;
}

function parseNumberField(formData: FormData, key: string): number | undefined {
  const value = getOptionalFormValue(formData, key);

  if (!value) {
    return undefined;
  }

  const parsed = Number(value.replace(",", "."));

  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a number.`);
  }

  return parsed;
}

function parseTankShape(formData: FormData): TankShape {
  const value = getRequiredFormValue(formData, "tankShape");

  if (value === "rectangular" || value === "horizontal-cylinder") {
    return value;
  }

  throw new Error("Tank type is invalid.");
}

function parseDeviceSensorType(formData: FormData): DeviceSensorType {
  const value = getRequiredFormValue(formData, "deviceSensorType");

  if (value === "fuel" || value === "energy") {
    return value;
  }

  throw new Error("Sensor mode is invalid.");
}

function parseLoadUnit(formData: FormData): LoadPowerUnit {
  const value = getRequiredFormValue(formData, "loadUnit");

  if (value === "kw" || value === "kva") {
    return value;
  }

  throw new Error("Load unit is invalid.");
}

function buildDeviceRequestDraft(formData: FormData): DeviceRequestDraft {
  return {
    siteName: getRequiredFormValue(formData, "siteName"),
    areaLabel: getRequiredFormValue(formData, "areaLabel"),
    regionalLabel: getRequiredFormValue(formData, "regionalLabel"),
    wilayahLabel: getRequiredFormValue(formData, "wilayahLabel"),
    latitude: parseNumberField(formData, "latitude"),
    longitude: parseNumberField(formData, "longitude"),
    deviceSensorType: parseDeviceSensorType(formData),
    tankShape: parseTankShape(formData),
    lengthCm: parseNumberField(formData, "lengthCm"),
    widthCm: parseNumberField(formData, "widthCm"),
    heightCm: parseNumberField(formData, "heightCm"),
    diameterCm: parseNumberField(formData, "diameterCm"),
    sensorMountHeightCm: parseNumberField(formData, "sensorMountHeightCm"),
    loadValue: parseNumberField(formData, "loadValue") ?? 0,
    loadUnit: parseLoadUnit(formData),
    dieselEngineCapacityKva:
      parseNumberField(formData, "dieselEngineCapacityKva") ?? 0,
    cosPhi: parseNumberField(formData, "cosPhi") ?? 0,
    hardwareProfileId: getRequiredFormValue(formData, "hardwareProfileId"),
  };
}

function getResultState(
  result: CreateDeviceRequestFromMysqlResult,
): DeviceRequestFormState {
  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      issues: result.issues,
    };
  }

  return {
    status: "success",
    message:
      "Device request saved. The device code is created automatically and an admin will review the data before the firmware package is created.",
    requestCode: result.request.requestCode,
    issues: result.warnings,
  };
}

function isDeviceRequestSchemaError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("unknown column") &&
    DEVICE_REQUEST_SCHEMA_COLUMNS.some((columnName) =>
      message.includes(columnName),
    )
  );
}

function getErrorState(error: unknown): DeviceRequestFormState {
  if (isDeviceRequestSchemaError(error)) {
    return {
      status: "error",
      message:
        "Request could not be processed because the database schema is incomplete. The administrator needs to run the latest device operational field migrations.",
    };
  }

  return {
    status: "error",
    message: getSafeErrorMessage(error, {
      fallbackMessage: "Device request could not be processed yet.",
      internalMessage:
        "Device request could not be processed because the database service is not ready. Contact the administrator.",
    }),
  };
}

export async function createDeviceRequestAction(
  _state: DeviceRequestFormState,
  formData: FormData,
): Promise<DeviceRequestFormState> {
  const user = await requirePageUser();

  try {
    if (getMonitoringStorageDriver() !== "mysql") {
      throw new Error(
        "Device requests require a MySQL database for admin review.",
      );
    }

    const result = await createDeviceRequestInMysql({
      draft: buildDeviceRequestDraft(formData),
      requesterEmail: user.email,
      requesterUserId: user.id,
    });

    if (result.ok) {
      await notifyAdminsDeviceRequestCreated(result.request).catch(() => undefined);
    }

    revalidatePath(USER_DEVICE_REQUEST_PATH);
    revalidatePath(ADMIN_DEVICE_REQUEST_PATH);

    return getResultState(result);
  } catch (error) {
    return getErrorState(error);
  }
}
