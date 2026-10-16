"use server";

import { revalidatePath } from "next/cache";

import { verifyAdminActionCsrfToken } from "@/features/auth/lib/auth-csrf";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import { recordAuthAuditEvent } from "@/features/auth/lib/mysql-auth-repository";
import { evaluateOperationalAlerts } from "@/features/ops/lib/alert-service";
import {
  acknowledgeMonitoringAlertInMysql,
  resolveMonitoringAlertInMysql,
} from "@/features/ops/lib/mysql-alert-repository";
import { getSafeErrorMessage } from "@/lib/safe-error-message";

const ALERTS_PATH = "/dashboard/admin/alerts";

export type AlertActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

function success(message: string): AlertActionState {
  return { message, status: "success" };
}

function failure(error: unknown): AlertActionState {
  return {
    message: getSafeErrorMessage(error, {
      fallbackMessage: "The alert action could not be completed yet.",
      internalMessage:
        "The alert action could not be completed. Check the database connection and try again.",
    }),
    status: "error",
  };
}

function assertValidCsrf({
  sessionId,
  formData,
}: {
  sessionId: string;
  formData: FormData;
}): string {
  const csrfToken = String(formData.get("csrfToken") ?? "");
  const alertId = String(formData.get("alertId") ?? "").trim();

  if (
    !verifyAdminActionCsrfToken({
      sessionId,
      token: csrfToken,
    })
  ) {
    throw new Error("Admin session is invalid. Reload the page and try again.");
  }

  if (!alertId) {
    throw new Error("Alert identifier is missing.");
  }

  return alertId;
}

export async function acknowledgeAlertAction(
  _state: AlertActionState,
  formData: FormData,
): Promise<AlertActionState> {
  const admin = await requirePageAdmin();

  try {
    const alertId = assertValidCsrf({
      formData,
      sessionId: admin.sessionId,
    });
    const note = String(formData.get("note") ?? "").trim();

    await acknowledgeMonitoringAlertInMysql({
      actorLabel: admin.email,
      actorUserId: admin.id,
      alertId,
      note: note || "Acknowledged from the alert centre.",
    });
    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "ops_alert_acknowledged",
      metadata: { alertId },
    }).catch(() => undefined);

    revalidatePath(ALERTS_PATH);

    return success("Alert acknowledged. It stays visible until it recovers.");
  } catch (error) {
    return failure(error);
  }
}

export async function resolveAlertAction(
  _state: AlertActionState,
  formData: FormData,
): Promise<AlertActionState> {
  const admin = await requirePageAdmin();

  try {
    const alertId = assertValidCsrf({
      formData,
      sessionId: admin.sessionId,
    });
    const note = String(formData.get("note") ?? "").trim();

    if (!note) {
      throw new Error(
        "A resolution note is required so the reason is auditable.",
      );
    }

    await resolveMonitoringAlertInMysql({
      actorLabel: admin.email,
      actorUserId: admin.id,
      alertId,
      note,
    });
    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "ops_alert_resolved",
      metadata: { alertId, note },
    }).catch(() => undefined);

    revalidatePath(ALERTS_PATH);

    return success("Alert resolved and recorded in the audit trail.");
  } catch (error) {
    return failure(error);
  }
}

export async function runAlertEvaluationAction(
  _state: AlertActionState,
  formData: FormData,
): Promise<AlertActionState> {
  const admin = await requirePageAdmin();

  try {
    const csrfToken = String(formData.get("csrfToken") ?? "");

    if (
      !verifyAdminActionCsrfToken({
        sessionId: admin.sessionId,
        token: csrfToken,
      })
    ) {
      throw new Error("Admin session is invalid. Reload the page and try again.");
    }

    const summary = await evaluateOperationalAlerts();

    if (summary.skipped === "memory-storage") {
      throw new Error(
        "Alert evaluation needs the MySQL storage driver to be active.",
      );
    }

    if (summary.skipped === "alerts-disabled") {
      throw new Error(
        "Alert evaluation is disabled. Set OPS_ALERTS_ENABLED=true to enable it.",
      );
    }

    revalidatePath(ALERTS_PATH);

    return success(
      `Evaluation finished: ${summary.created} new, ${summary.updated} updated, ${summary.resolved} resolved, ${summary.notificationsDelivered} notifications delivered.`,
    );
  } catch (error) {
    return failure(error);
  }
}
