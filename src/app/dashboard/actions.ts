"use server";

import { revalidatePath } from "next/cache";

import { verifyAdminActionCsrfToken } from "@/features/auth/lib/auth-csrf";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import {
  cleanupMonitoringTanksInMysql,
  resetMonitoringReadingsInMysql,
} from "@/features/monitoring/lib/mysql-maintenance-repository";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";
import { getSafeErrorMessage } from "@/lib/safe-error-message";

const DELETE_TANK_CONFIRMATION = "DELETE STO DATA";
const RESET_TANK_READINGS_CONFIRMATION = "RESET STO READINGS";
const RESET_ALL_READINGS_CONFIRMATION = "RESET ALL READINGS";

export type DashboardAdminActionState = {
  status: "idle" | "success" | "error";
  message: string;
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
    throw new Error(
      "Admin session is invalid. Reload the page and try again.",
    );
  }
}

function assertMysqlStorageIsReady() {
  if (getMonitoringStorageDriver() !== "mysql") {
    throw new Error("STO data cleanup requires MySQL storage.");
  }
}

function revalidateDashboardMonitoringPages(tankId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/detail");
  if (tankId) {
    revalidatePath(`/dashboard/operations/tanks/${tankId}`);
  }
  revalidatePath("/dashboard/operations/tanks/[tankId]", "page");
  revalidatePath("/dashboard/tanks/[tankId]", "page");
  revalidatePath("/dashboard/admin/device-requests");
  revalidatePath("/dashboard/devices/request");
}

export async function cleanupDashboardTankAction(
  _state: DashboardAdminActionState,
  formData: FormData,
): Promise<DashboardAdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ formData, sessionId: admin.sessionId });
    assertMysqlStorageIsReady();

    const tankId = getRequiredFormValue(formData, "tankId");
    const siteLabel = getRequiredFormValue(formData, "siteLabel");
    const confirmation = getRequiredFormValue(formData, "confirmation");

    if (confirmation !== DELETE_TANK_CONFIRMATION) {
      throw new Error("STO data deletion confirmation is invalid.");
    }

    const result = await cleanupMonitoringTanksInMysql({ tankIds: [tankId] });

    revalidateDashboardMonitoringPages(tankId);

    if (result.matchedTankCount === 0) {
      return {
        status: "success",
        message:
          "STO data is already missing or has already been cleaned up.",
      };
    }

    return {
      status: "success",
      message: `${siteLabel} was cleaned from the FTM dashboard.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: getSafeErrorMessage(error, {
        fallbackMessage: "STO data could not be cleaned yet.",
        internalMessage:
          "STO data could not be cleaned because the database service is not ready yet.",
      }),
    };
  }
}

export async function resetDashboardTankReadingsAction(
  _state: DashboardAdminActionState,
  formData: FormData,
): Promise<DashboardAdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ formData, sessionId: admin.sessionId });
    assertMysqlStorageIsReady();

    const tankId = getRequiredFormValue(formData, "tankId");
    const siteLabel = getRequiredFormValue(formData, "siteLabel");
    const confirmation = getRequiredFormValue(formData, "confirmation");

    if (confirmation !== RESET_TANK_READINGS_CONFIRMATION) {
      throw new Error("STO reading reset confirmation is invalid.");
    }

    const result = await resetMonitoringReadingsInMysql({ tankIds: [tankId] });

    revalidateDashboardMonitoringPages(tankId);

    if (result.matchedTankCount === 0) {
      return {
        status: "success",
        message:
          "Tank is already missing or has no reading data yet.",
      };
    }

    return {
      status: "success",
      message:
        result.readingRows > 0
          ? `${siteLabel} was reset. ${result.readingRows} readings deleted.`
          : `${siteLabel} has no readings that need resetting.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: getSafeErrorMessage(error, {
        fallbackMessage: "STO readings could not be reset yet.",
        internalMessage:
          "STO readings could not be reset because the database service is not ready yet.",
      }),
    };
  }
}

export async function resetAllDashboardReadingsAction(
  _state: DashboardAdminActionState,
  formData: FormData,
): Promise<DashboardAdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ formData, sessionId: admin.sessionId });
    assertMysqlStorageIsReady();

    const confirmation = getRequiredFormValue(formData, "confirmation");

    if (confirmation !== RESET_ALL_READINGS_CONFIRMATION) {
      throw new Error("Reset-all-readings confirmation is invalid.");
    }

    const result = await resetMonitoringReadingsInMysql();

    revalidateDashboardMonitoringPages();

    return {
      status: "success",
      message:
        result.readingRows > 0
          ? `${result.readingRows} readings from ${result.matchedTankCount} tanks were reset.`
          : "No readings need resetting yet.",
    };
  } catch (error) {
    return {
      status: "error",
      message: getSafeErrorMessage(error, {
        fallbackMessage: "All readings could not be reset yet.",
        internalMessage:
          "All readings could not be reset because the database service is not ready yet.",
      }),
    };
  }
}
