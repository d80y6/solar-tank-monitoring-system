"use server";

import { revalidatePath } from "next/cache";

import { verifyAdminActionCsrfToken } from "@/features/auth/lib/auth-csrf";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import { recordAuthAuditEvent } from "@/features/auth/lib/mysql-auth-repository";
import {
  createFirmwareTemplateInMysql,
  createHardwareProfileInMysql,
  deleteFirmwareTemplateFromMysql,
  deleteHardwareProfileFromMysql,
  findFirmwareTemplateFromMysql,
  findHardwareProfileFromMysql,
  isHardwareBoardFamily,
  isHardwareTankShape,
  updateFirmwareTemplateInMysql,
  updateHardwareProfileInMysql,
} from "@/features/monitoring/lib/mysql-hardware-registry-repository";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";
import { getSafeErrorMessage } from "@/lib/safe-error-message";

const HARDWARE_REGISTRY_PATH = "/dashboard/admin/hardware-registry";

export type HardwareActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

function readString(formData: FormData, field: string): string {
  return String(formData.get(field) ?? "").trim();
}

function readBoolean(formData: FormData, field: string): boolean {
  const value = readString(formData, field).toLowerCase();

  return value === "on" || value === "true" || value === "1";
}

function readNumber(formData: FormData, field: string): number {
  const value = Number(readString(formData, field));

  return Number.isFinite(value) ? value : Number.NaN;
}

async function assertAdminAction(formData: FormData) {
  const admin = await requirePageAdmin();

  if (getMonitoringStorageDriver() !== "mysql") {
    throw new Error(
      "The hardware registry is stored in MySQL. Activate MySQL storage before editing it.",
    );
  }

  const csrfToken = readString(formData, "csrfToken");

  if (!verifyAdminActionCsrfToken({ sessionId: admin.sessionId, token: csrfToken })) {
    throw new Error("Admin session is invalid. Reload the page and try again.");
  }

  return admin;
}

function failure(error: unknown): HardwareActionState {
  return {
    message: getSafeErrorMessage(error, {
      fallbackMessage: "The change could not be saved yet.",
      internalMessage:
        "The hardware registry could not be updated. Check the database connection and try again.",
    }),
    status: "error",
  };
}

function success(message: string): HardwareActionState {
  revalidatePath(HARDWARE_REGISTRY_PATH);

  return { message, status: "success" };
}

export async function createFirmwareTemplateAction(
  _state: HardwareActionState,
  formData: FormData,
): Promise<HardwareActionState> {
  try {
    const admin = await assertAdminAction(formData);
    const templateKey = readString(formData, "templateKey");
    const version = readString(formData, "version");
    const displayName = readString(formData, "displayName");
    const sourcePath = readString(formData, "sourcePath");
    const checksumSha256 = readString(formData, "checksumSha256");
    const isActive = readBoolean(formData, "isActive");

    if (!templateKey || !version || !displayName || !sourcePath) {
      throw new Error(
        "Template key, version, display name, and source path are all required.",
      );
    }

    if (checksumSha256 && !/^[a-f0-9]{64}$/i.test(checksumSha256)) {
      throw new Error("The checksum must be a 64 character hex SHA-256 value.");
    }

    const created = await createFirmwareTemplateInMysql({
      checksumSha256: checksumSha256 || null,
      displayName,
      isActive,
      sourcePath,
      templateKey,
      version,
    });

    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "firmware_template_created",
      metadata: {
        isActive: created.isActive,
        templateKey: created.templateKey,
        version: created.version,
      },
    }).catch(() => undefined);

    return success(
      `Firmware template ${created.templateKey} ${created.version} created.`,
    );
  } catch (error) {
    return failure(error);
  }
}

export async function updateFirmwareTemplateAction(
  _state: HardwareActionState,
  formData: FormData,
): Promise<HardwareActionState> {
  try {
    const admin = await assertAdminAction(formData);
    const id = readString(formData, "id");
    const displayName = readString(formData, "displayName");
    const sourcePath = readString(formData, "sourcePath");
    const checksumSha256 = readString(formData, "checksumSha256");
    const isActive = readBoolean(formData, "isActive");

    if (!id || !displayName || !sourcePath) {
      throw new Error("Display name and source path are required.");
    }

    if (checksumSha256 && !/^[a-f0-9]{64}$/i.test(checksumSha256)) {
      throw new Error("The checksum must be a 64 character hex SHA-256 value.");
    }

    const previous = await findFirmwareTemplateFromMysql(id);
    const updated = await updateFirmwareTemplateInMysql({
      checksumSha256: checksumSha256 || null,
      displayName,
      id,
      isActive,
      sourcePath,
    });

    if (!updated) {
      throw new Error("That firmware template no longer exists.");
    }

    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "firmware_template_updated",
      metadata: {
        isActiveChanged:
          Boolean(previous) && previous?.isActive !== updated.isActive,
        templateKey: updated.templateKey,
        version: updated.version,
      },
    }).catch(() => undefined);

    return success(
      `Firmware template ${updated.templateKey} ${updated.version} updated.`,
    );
  } catch (error) {
    return failure(error);
  }
}

export async function deleteFirmwareTemplateAction(
  _state: HardwareActionState,
  formData: FormData,
): Promise<HardwareActionState> {
  try {
    const admin = await assertAdminAction(formData);
    const id = readString(formData, "id");
    const template = await findFirmwareTemplateFromMysql(id);

    if (!template) {
      throw new Error("That firmware template no longer exists.");
    }

    const result = await deleteFirmwareTemplateFromMysql(id);

    if (!result.deleted) {
      if (result.reason === "in-use") {
        throw new Error(
          `${template.templateKey} ${template.version} is still used by ${result.usageCount} hardware profile(s). Deactivate it instead of deleting it.`,
        );
      }

      throw new Error("That firmware template no longer exists.");
    }

    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "firmware_template_deleted",
      metadata: { templateKey: template.templateKey, version: template.version },
    }).catch(() => undefined);

    return success(
      `Firmware template ${template.templateKey} ${template.version} deleted.`,
    );
  } catch (error) {
    return failure(error);
  }
}

export async function saveHardwareProfileAction(
  _state: HardwareActionState,
  formData: FormData,
): Promise<HardwareActionState> {
  try {
    const admin = await assertAdminAction(formData);
    const id = readString(formData, "id");
    const code = readString(formData, "code");
    const name = readString(formData, "name");
    const boardFamily = readString(formData, "boardFamily");
    const boardLabel = readString(formData, "boardLabel");
    const sensorType = readString(formData, "sensorType");
    const triggerPin = readString(formData, "triggerPin");
    const echoPin = readString(formData, "echoPin");
    const supportedTankShape = readString(formData, "supportedTankShape");
    const firmwareTemplateId = readString(formData, "firmwareTemplateId");
    const reportIntervalMs = readNumber(formData, "reportIntervalMs");
    const isActive = readBoolean(formData, "isActive");

    if (!isHardwareBoardFamily(boardFamily)) {
      throw new Error("Board family must be esp8266, esp32, or unknown.");
    }

    if (!isHardwareTankShape(supportedTankShape)) {
      throw new Error(
        "Supported tank shape must be rectangular, horizontal-cylinder, or any.",
      );
    }

    if (!name || !boardLabel || !sensorType || !triggerPin || !echoPin) {
      throw new Error(
        "Name, board label, sensor type, trigger pin, and echo pin are required.",
      );
    }

    if (!firmwareTemplateId) {
      throw new Error("Select the firmware template this profile compiles.");
    }

    if (!Number.isFinite(reportIntervalMs) || reportIntervalMs < 5000) {
      throw new Error("The report interval must be at least 5000 ms.");
    }

    const template = await findFirmwareTemplateFromMysql(firmwareTemplateId);

    if (!template) {
      throw new Error("The selected firmware template no longer exists.");
    }

    if (id) {
      const updated = await updateHardwareProfileInMysql({
        boardFamily,
        boardLabel,
        echoPin,
        firmwareTemplateId,
        id,
        isActive,
        name,
        reportIntervalMs,
        sensorType,
        supportedTankShape,
        triggerPin,
      });

      if (!updated) {
        throw new Error("That hardware profile no longer exists.");
      }

      await recordAuthAuditEvent({
        actorUserId: admin.id,
        eventType: "hardware_profile_updated",
        metadata: {
          code: updated.code,
          isActive: updated.isActive,
          reportIntervalMs: updated.reportIntervalMs,
          templateKey: template.templateKey,
          version: template.version,
        },
      }).catch(() => undefined);

      return success(`Hardware profile ${updated.code} updated.`);
    }

    if (!code) {
      throw new Error("The profile code is required when creating a profile.");
    }

    const created = await createHardwareProfileInMysql({
      boardFamily,
      boardLabel,
      code,
      echoPin,
      firmwareTemplateId,
      isActive,
      name,
      reportIntervalMs,
      sensorType,
      supportedTankShape,
      triggerPin,
    });

    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "hardware_profile_created",
      metadata: {
        code: created.code,
        isActive: created.isActive,
        templateKey: template.templateKey,
        version: template.version,
      },
    }).catch(() => undefined);

    return success(`Hardware profile ${created.code} created.`);
  } catch (error) {
    return failure(error);
  }
}

export async function deleteHardwareProfileAction(
  _state: HardwareActionState,
  formData: FormData,
): Promise<HardwareActionState> {
  try {
    const admin = await assertAdminAction(formData);
    const id = readString(formData, "id");
    const profile = await findHardwareProfileFromMysql(id);

    if (!profile) {
      throw new Error("That hardware profile no longer exists.");
    }

    const result = await deleteHardwareProfileFromMysql(id);

    if (!result.deleted) {
      if (result.reason === "in-use") {
        throw new Error(
          `${profile.code} is still referenced by ${result.usageCount} device request(s). Deactivate it instead of deleting it.`,
        );
      }

      throw new Error("That hardware profile no longer exists.");
    }

    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "hardware_profile_deleted",
      metadata: { code: profile.code },
    }).catch(() => undefined);

    return success(`Hardware profile ${profile.code} deleted.`);
  } catch (error) {
    return failure(error);
  }
}
