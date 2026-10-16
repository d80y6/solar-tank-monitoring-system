"use server";

import { revalidatePath } from "next/cache";

import { getAppBaseUrl } from "@/features/auth/lib/auth-config";
import { verifyAdminActionCsrfToken } from "@/features/auth/lib/auth-csrf";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import { sendDevicePackageReadyEmail } from "@/features/monitoring/lib/device-package-email";
import {
  approveDeviceRequestInMysql,
  recordFirmwarePackageEmailDeliveryInMysql,
  refreshDevicePackageDownloadTokenInMysql,
  rejectDeviceRequestInMysql,
  reissueDevicePackageInMysql,
  revokeDeviceProvisioningInMysql,
} from "@/features/monitoring/lib/mysql-device-request-repository";
import {
  cleanupMonitoringDeviceRequestsInMysql,
  resetMonitoringDeviceDataInMysql,
} from "@/features/monitoring/lib/mysql-maintenance-repository";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";
import { getSafeErrorMessage } from "@/lib/safe-error-message";

const ADMIN_DEVICE_REQUEST_PATH = "/dashboard/admin/device-requests";
const USER_DEVICE_REQUEST_PATH = "/dashboard/devices/request";
const CLEANUP_SELECTED_CONFIRMATION = "CLEANUP SELECTED DEVICE REQUESTS";
const CLEANUP_SINGLE_CONFIRMATION = "CLEANUP SINGLE DEVICE REQUEST";
const RESET_DEVICE_DATA_CONFIRMATION = "CLEANUP ALL DEVICE DATA";
const DEVICE_REQUEST_SCHEMA_COLUMNS = [
  "device_sensor_type",
  "regional_label",
  "wilayah_label",
  "load_value",
  "load_unit",
  "diesel_engine_capacity_kva",
  "cos_phi",
] as const;

export type DeviceRequestAdminActionState = {
  status: "idle" | "success" | "error";
  message: string;
  downloadUrl?: string;
};

function getRequiredFormValue(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();

  if (!value) {
    throw new Error("Admin action data is incomplete.");
  }

  return value;
}

function assertValidAdminActionCsrf({
  formData,
  sessionId,
}: {
  formData: FormData;
  sessionId: string;
}) {
  const csrfToken = String(formData.get("csrfToken") ?? "");

  if (
    !verifyAdminActionCsrfToken({
      sessionId,
      token: csrfToken,
    })
  ) {
    throw new Error("Admin session is invalid. Reload the page and try again.");
  }
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

function getActionError(error: unknown): DeviceRequestAdminActionState {
  if (isDeviceRequestSchemaError(error)) {
    return {
      status: "error",
      message:
        "Action could not be processed because the device request database schema is incomplete. Run all latest migrations and try again.",
    };
  }

  return {
    status: "error",
    message: getSafeErrorMessage(error, {
      fallbackMessage: "Device request action could not be processed yet.",
      internalMessage:
        "Action could not be processed because the database service is not ready. Check the migrations and database connection.",
    }),
  };
}

function getActionSuccess(message: string): DeviceRequestAdminActionState {
  return {
    status: "success",
    message,
  };
}

function formatResetSummary(totalRows: number): string {
  if (totalRows === 0) {
    return "No device operational data needs cleanup.";
  }

  return `${totalRows} rows of device operational data were cleaned up. Accounts, admins, firmware templates, and hardware profiles remain stored.`;
}

function formatCleanupSummary({
  matchedRequestCount,
  totalRows,
}: {
  matchedRequestCount: number;
  totalRows: number;
}): string {
  if (matchedRequestCount === 0) {
    return "No device requests match the cleanup.";
  }

  return `${matchedRequestCount} device requests cleaned up. ${totalRows} related data rows deleted without removing accounts, firmware templates, or hardware profiles.`;
}

function buildDevicePackageDownloadUrl(downloadToken: string): string {
  const url = new URL("/api/device-packages/download", getAppBaseUrl());
  url.searchParams.set("token", downloadToken);
  return url.toString();
}

function assertMysqlStorageIsReady() {
  if (getMonitoringStorageDriver() !== "mysql") {
    throw new Error("Device request review requires MySQL storage.");
  }
}

function revalidateMonitoringDevicePages() {
  revalidatePath(ADMIN_DEVICE_REQUEST_PATH);
  revalidatePath(USER_DEVICE_REQUEST_PATH);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/summary");
  revalidatePath("/dashboard/detail");
  revalidatePath("/dashboard/tanks/[tankId]", "page");
  revalidatePath("/dashboard/operations/tanks/[tankId]", "page");
}

function getRequestIdsFromForm(formData: FormData): string[] {
  return formData
    .getAll("requestIds")
    .map((value) => String(value).trim())
    .filter(Boolean);
}

export async function approveDeviceRequestAction(
  _state: DeviceRequestAdminActionState,
  formData: FormData,
): Promise<DeviceRequestAdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ formData, sessionId: admin.sessionId });
    assertMysqlStorageIsReady();

    const requestId = getRequiredFormValue(formData, "requestId");
    const approval = await approveDeviceRequestInMysql({
      adminUserId: admin.id,
      appBaseUrl: getAppBaseUrl(),
      requestId,
    });
    const downloadUrl = buildDevicePackageDownloadUrl(approval.downloadToken);
    const delivery = await sendDevicePackageReadyEmail({
      deviceCode: approval.request.deviceCode,
      downloadExpiresAt: approval.downloadExpiresAt,
      downloadUrl,
      email: approval.request.requesterEmail,
      requestCode: approval.request.requestCode,
      siteName: approval.request.siteName,
    });

    await recordFirmwarePackageEmailDeliveryInMysql({
      adminUserId: admin.id,
      delivered: delivery.delivered,
      delivery: delivery.delivery,
      errorReason: delivery.delivered ? undefined : delivery.reason,
      packageId: approval.package.id,
      requestId: approval.request.id,
    }).catch(() => undefined);

    revalidatePath(ADMIN_DEVICE_REQUEST_PATH);
    revalidatePath(USER_DEVICE_REQUEST_PATH);

    return {
      ...getActionSuccess(
        delivery.delivered
          ? "Request approved and firmware link sent."
          : "Request approved and firmware package created, but the email was not delivered.",
      ),
      downloadUrl,
    };
  } catch (error) {
    return getActionError(error);
  }
}

export async function rejectDeviceRequestAction(
  _state: DeviceRequestAdminActionState,
  formData: FormData,
): Promise<DeviceRequestAdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ formData, sessionId: admin.sessionId });
    assertMysqlStorageIsReady();

    const requestId = getRequiredFormValue(formData, "requestId");
    const rejectionReason = getRequiredFormValue(formData, "rejectionReason");

    await rejectDeviceRequestInMysql({
      adminUserId: admin.id,
      rejectionReason,
      requestId,
    });

    revalidatePath(ADMIN_DEVICE_REQUEST_PATH);
    revalidatePath(USER_DEVICE_REQUEST_PATH);

    return getActionSuccess("Device request rejected successfully.");
  } catch (error) {
    return getActionError(error);
  }
}

async function sendPackageEmailAndRecord({
  adminUserId,
  downloadExpiresAt,
  downloadToken,
  packageId,
  request,
}: {
  adminUserId: string;
  downloadExpiresAt: string;
  downloadToken: string;
  packageId: string;
  request: {
    deviceCode: string;
    id: string;
    requesterEmail: string;
    requestCode: string;
    siteName: string;
  };
}): Promise<{
  delivered: boolean;
  downloadUrl: string;
}> {
  const downloadUrl = buildDevicePackageDownloadUrl(downloadToken);
  const delivery = await sendDevicePackageReadyEmail({
    deviceCode: request.deviceCode,
    downloadExpiresAt,
    downloadUrl,
    email: request.requesterEmail,
    requestCode: request.requestCode,
    siteName: request.siteName,
  });

  await recordFirmwarePackageEmailDeliveryInMysql({
    adminUserId,
    delivered: delivery.delivered,
    delivery: delivery.delivery,
    errorReason: delivery.delivered ? undefined : delivery.reason,
    packageId,
    requestId: request.id,
  }).catch(() => undefined);

  return {
    delivered: delivery.delivered,
    downloadUrl,
  };
}

export async function resendDevicePackageAction(
  _state: DeviceRequestAdminActionState,
  formData: FormData,
): Promise<DeviceRequestAdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ formData, sessionId: admin.sessionId });
    assertMysqlStorageIsReady();

    const requestId = getRequiredFormValue(formData, "requestId");
    const refresh = await refreshDevicePackageDownloadTokenInMysql({
      adminUserId: admin.id,
      requestId,
    });
    const email = await sendPackageEmailAndRecord({
      adminUserId: admin.id,
      downloadExpiresAt: refresh.downloadExpiresAt,
      downloadToken: refresh.downloadToken,
      packageId: refresh.package.id,
      request: refresh.request,
    });

    revalidatePath(ADMIN_DEVICE_REQUEST_PATH);
    revalidatePath(USER_DEVICE_REQUEST_PATH);

    return {
      ...getActionSuccess(
        email.delivered
          ? "New firmware link sent to the requester's email."
          : "New firmware link created, but the email was not delivered.",
      ),
      downloadUrl: email.downloadUrl,
    };
  } catch (error) {
    return getActionError(error);
  }
}

export async function reissueDevicePackageAction(
  _state: DeviceRequestAdminActionState,
  formData: FormData,
): Promise<DeviceRequestAdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ formData, sessionId: admin.sessionId });
    assertMysqlStorageIsReady();

    const requestId = getRequiredFormValue(formData, "requestId");
    const reissue = await reissueDevicePackageInMysql({
      adminUserId: admin.id,
      appBaseUrl: getAppBaseUrl(),
      requestId,
    });
    const email = await sendPackageEmailAndRecord({
      adminUserId: admin.id,
      downloadExpiresAt: reissue.downloadExpiresAt,
      downloadToken: reissue.downloadToken,
      packageId: reissue.package.id,
      request: reissue.request,
    });

    revalidatePath(ADMIN_DEVICE_REQUEST_PATH);
    revalidatePath(USER_DEVICE_REQUEST_PATH);

    return {
      ...getActionSuccess(
        email.delivered
          ? "New firmware package and key created and sent to the requester's email."
          : "New firmware package and key created, but the email was not delivered.",
      ),
      downloadUrl: email.downloadUrl,
    };
  } catch (error) {
    return getActionError(error);
  }
}

export async function revokeDeviceProvisioningAction(
  _state: DeviceRequestAdminActionState,
  formData: FormData,
): Promise<DeviceRequestAdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ formData, sessionId: admin.sessionId });
    assertMysqlStorageIsReady();

    const requestId = getRequiredFormValue(formData, "requestId");

    await revokeDeviceProvisioningInMysql({
      adminUserId: admin.id,
      requestId,
    });

    revalidatePath(ADMIN_DEVICE_REQUEST_PATH);
    revalidatePath(USER_DEVICE_REQUEST_PATH);
    revalidatePath("/dashboard");

    return getActionSuccess("Device access revoked successfully.");
  } catch (error) {
    return getActionError(error);
  }
}

export async function resetMonitoringDeviceDataAction(
  _state: DeviceRequestAdminActionState,
  formData: FormData,
): Promise<DeviceRequestAdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ formData, sessionId: admin.sessionId });
    assertMysqlStorageIsReady();

    const confirmation = getRequiredFormValue(formData, "confirmation");

    if (confirmation !== RESET_DEVICE_DATA_CONFIRMATION) {
      throw new Error(
        `Type ${RESET_DEVICE_DATA_CONFIRMATION} to clean up the test device data.`,
      );
    }

    const result = await resetMonitoringDeviceDataInMysql();

    revalidateMonitoringDevicePages();

    return getActionSuccess(formatResetSummary(result.totalRows));
  } catch (error) {
    return getActionError(error);
  }
}

export async function cleanupDeviceRequestsAction(
  _state: DeviceRequestAdminActionState,
  formData: FormData,
): Promise<DeviceRequestAdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ formData, sessionId: admin.sessionId });
    assertMysqlStorageIsReady();

    const cleanupMode = getRequiredFormValue(formData, "cleanupMode");
    const requestIds = getRequestIdsFromForm(formData);

    if (requestIds.length === 0) {
      throw new Error("Select at least one device request to clean up.");
    }

    if (cleanupMode === "single") {
      const confirmation = getRequiredFormValue(formData, "confirmation");

      if (
        requestIds.length !== 1 ||
        confirmation !== CLEANUP_SINGLE_CONFIRMATION
      ) {
        throw new Error("Single device cleanup action is invalid.");
      }
    } else if (cleanupMode === "selected") {
      const confirmation = getRequiredFormValue(formData, "confirmation");

      if (confirmation !== CLEANUP_SELECTED_CONFIRMATION) {
        throw new Error(
          `Type ${CLEANUP_SELECTED_CONFIRMATION} to clean up the selected requests.`,
        );
      }
    } else {
      throw new Error("Device cleanup mode is invalid.");
    }

    const result = await cleanupMonitoringDeviceRequestsInMysql({ requestIds });

    revalidateMonitoringDevicePages();

    return getActionSuccess(formatCleanupSummary(result));
  } catch (error) {
    return getActionError(error);
  }
}
