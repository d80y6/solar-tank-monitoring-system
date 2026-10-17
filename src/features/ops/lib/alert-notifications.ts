import type { RowDataPacket } from "mysql2/promise";

import { sendOperationalEmail } from "@/features/auth/lib/auth-email";
import { sendAdminTelegramNotification } from "@/features/auth/lib/admin-telegram-notifications";
import { getAppBaseUrl } from "@/features/auth/lib/auth-config";
import { getMysqlPool } from "@/features/monitoring/lib/mysql-connection";
import { createLogger } from "@/lib/logger";

import type { MonitoringAlert } from "../types";

type AdminRow = RowDataPacket & {
  email: string;
};

const log = createLogger({ module: "ops-alerts" });

export type AlertNotificationResult = {
  attempted: number;
  delivered: number;
  failed: number;
  channels: { email: number; telegram: number };
};

function severityLabel(severity: string): string {
  return severity.toUpperCase();
}

export function formatAlertMessage({
  alert,
  kind,
}: {
  alert: MonitoringAlert;
  kind: "alert" | "reminder" | "recovery";
}): string {
  const dashboardUrl = `${getAppBaseUrl()}/dashboard/admin/alerts`;
  const heading =
    kind === "recovery"
      ? `RECOVERED — ${alert.title}`
      : kind === "reminder"
        ? `STILL ACTIVE — ${alert.title}`
        : `ALERT — ${alert.title}`;

  return [
    `[${severityLabel(alert.severity)}] ${heading}`,
    "",
    alert.detail ?? "",
    "",
    `Subject: ${alert.subjectType}${alert.subjectId ? ` ${alert.subjectId}` : ""}`,
    `First detected: ${alert.firstDetectedAt}`,
    `Last detected: ${alert.lastDetectedAt}`,
    `Rule: ${alert.ruleKey}`,
    "",
    `Open the alert centre: ${dashboardUrl}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export async function listActiveAdminEmailsFromMysql(): Promise<string[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AdminRow[]>(
    `SELECT email
       FROM auth_users
      WHERE role = 'admin'
        AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 50`,
  );

  return rows
    .map((row) => row.email?.trim())
    .filter((email): email is string => Boolean(email));
}

/**
 * Delivers an alert over every configured channel.
 *
 * Telegram is attempted first (fastest for an operations group); e-mail is a
 * fallback so an alert is never lost just because the bot is misconfigured.
 * Delivery failures are reported, never thrown, so one broken channel cannot
 * stop the remaining notifications in a batch.
 */
export async function deliverAlertNotification({
  alert,
  kind,
}: {
  alert: MonitoringAlert;
  kind: "alert" | "reminder" | "recovery";
}): Promise<AlertNotificationResult> {
  const message = formatAlertMessage({ alert, kind });
  const result: AlertNotificationResult = {
    attempted: 0,
    channels: { email: 0, telegram: 0 },
    delivered: 0,
    failed: 0,
  };

  try {
    const telegramResult = await sendAdminTelegramNotification(message, {
      topic: "system",
    });

    result.attempted += telegramResult.attempted;
    result.delivered += telegramResult.delivered;
    result.failed += telegramResult.failed;
    result.channels.telegram = telegramResult.delivered;
  } catch (error) {
    log.warn("ops.alert.telegram-failed", {
      alertId: alert.id,
      error: error instanceof Error ? error : String(error),
    });
  }

  if (result.delivered === 0) {
    try {
      const emails = await listActiveAdminEmailsFromMysql();

      for (const email of emails) {
        const delivery = await sendOperationalEmail({
          email,
          lines: message.split("\n"),
          subject:
            kind === "recovery"
              ? `[FTM recovered] ${alert.title}`
              : `[FTM ${alert.severity}] ${alert.title}`,
        });

        if (delivery.delivered) {
          result.delivered += 1;
          result.channels.email += 1;
        } else {
          result.failed += 1;
        }

        result.attempted += 1;
      }
    } catch (error) {
      log.warn("ops.alert.email-failed", {
        alertId: alert.id,
        error: error instanceof Error ? error : String(error),
      });
    }
  }

  return result;
}
