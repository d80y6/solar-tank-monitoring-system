"use server";

import { revalidatePath } from "next/cache";

import { verifyAdminActionCsrfToken } from "@/features/auth/lib/auth-csrf";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import { recordAuthAuditEvent } from "@/features/auth/lib/mysql-auth-repository";
import {
  rotateMonitoringDeviceKeyInMysql,
  setMonitoringDeviceActiveStateInMysql,
} from "@/features/monitoring/lib/mysql-device-key-repository";
import { getSafeErrorMessage } from "@/lib/safe-error-message";

const DEVICES_PATH = "/dashboard/admin/devices";

export type DeviceActionState = {
  status: "idle" | "success" | "error";
  message: string;
  issuedDeviceKey?: string;
  issuedDeviceCode?: string;
};

function assertValidCsrf({
  formData,
  sessionId,
}: {
  formData: FormData;
  sessionId: string;
}): string {
  const csrfToken = String(formData.get("csrfToken") ?? "");
  const deviceId = String(formData.get("deviceId") ?? "").trim();

  if (
    !verifyAdminActionCsrfToken({
      sessionId,
      token: csrfToken,
    })
  ) {
    throw new Error("Admin session is invalid. Reload the page and try again.");
  }

  if (!deviceId) {
    throw new Error("Device identifier is missing.");
  }

  return deviceId;
}

function failure(error: unknown): DeviceActionState {
  return {
    message: getSafeErrorMessage(error, {
      fallbackMessage: "The device action could not be completed yet.",
      internalMessage:
        "The device action could not be completed. Check the database connection and try again.",
    }),
    status: "error",
  };
}

export async function rotateDeviceKeyAction(
  _state: DeviceActionState,
  formData: FormData,
): Promise<DeviceActionState> {
  const admin = await requirePageAdmin();

  try {
    const deviceId = assertValidCsrf({
      formData,
      sessionId: admin.sessionId,
    });
    const result = await rotateMonitoringDeviceKeyInMysql({
      actorLabel: admin.email,
      actorUserId: admin.id,
      deviceId,
    });

    if (!result.ok) {
      throw new Error(
        result.reason === "not-found"
          ? "Device was not found in the registry."
          : "A disabled device cannot be rotated. Enable it first.",
      );
    }

    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "device_key_rotated",
      metadata: {
        deviceCode: result.device.code,
        deviceId,
        keyVersion: result.keyVersion,
        previousKeyValidUntil: result.previousKeyValidUntil,
      },
    }).catch(() => undefined);

    revalidatePath(DEVICES_PATH);

    return {
      issuedDeviceCode: result.device.code,
      issuedDeviceKey: result.deviceKey,
      message: `Key rotated to version ${result.keyVersion}. The previous key stays valid until ${result.previousKeyValidUntil}. Update the firmware package and re-flash the device, then confirm traffic on the new key.`,
      status: "success",
    };
  } catch (error) {
    return failure(error);
  }
}

export async function setDeviceActiveStateAction(
  _state: DeviceActionState,
  formData: FormData,
): Promise<DeviceActionState> {
  const admin = await requirePageAdmin();

  try {
    const deviceId = assertValidCsrf({
      formData,
      sessionId: admin.sessionId,
    });
    const nextState = String(formData.get("isActive") ?? "") === "true";
    const device = await setMonitoringDeviceActiveStateInMysql({
      actorLabel: admin.email,
      actorUserId: admin.id,
      deviceId,
      isActive: nextState,
    });

    if (!device) {
      throw new Error("Device was not found in the registry.");
    }

    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: nextState ? "device_enabled" : "device_disabled",
      metadata: { deviceCode: device.code, deviceId },
    }).catch(() => undefined);

    revalidatePath(DEVICES_PATH);

    return {
      message: nextState
        ? `Device ${device.code} is enabled and can send telemetry again.`
        : `Device ${device.code} is disabled. Its telemetry will be rejected until it is enabled again.`,
      status: "success",
    };
  } catch (error) {
    return failure(error);
  }
}
