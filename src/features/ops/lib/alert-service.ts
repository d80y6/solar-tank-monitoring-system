import { getMonitoringReferenceDataWithSource } from "@/features/monitoring/lib/monitoring-registry";
import { listLatestMonitoringReadingsByTankWithSource } from "@/features/monitoring/lib/monitoring-storage";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";
import { createLogger } from "@/lib/logger";
import { metricNames, metrics } from "@/lib/metrics";

import type { AlertEvaluationSummary, MonitoringAlert } from "../types";
import {
  acknowledgeMonitoringAlertInMysql,
  countRecentIngestRejectionsFromMysql,
  countRecentPackageTokenAnomaliesFromMysql,
  listActiveMonitoringAlertsFromMysql,
  markMonitoringAlertNotifiedInMysql,
  resolveMonitoringAlertInMysql,
  syncMonitoringAlertsInMysql,
} from "./mysql-alert-repository";
import { buildAlertCandidates } from "./alert-rules";
import { deliverAlertNotification } from "./alert-notifications";
import { getOpsConfig, type OpsConfig } from "./ops-config";

const log = createLogger({ module: "ops-alerts" });

function shouldNotifyOnTransition({
  alert,
  previousSeverity,
  type,
}: {
  alert: MonitoringAlert;
  previousSeverity?: string;
  type: "created" | "updated" | "resolved" | "reopened" | "severity_changed";
}): boolean {
  if (type === "created" || type === "reopened") {
    return alert.severity !== "info";
  }

  if (type === "resolved") {
    return alert.severity !== "info";
  }

  if (type === "severity_changed") {
    return (
      alert.severity === "critical" &&
      previousSeverity !== "critical" &&
      previousSeverity !== undefined
    );
  }

  return false;
}

function isReminderDue({
  alert,
  config,
  now,
}: {
  alert: MonitoringAlert;
  config: OpsConfig;
  now: Date;
}): boolean {
  if (alert.severity !== "critical" || alert.status !== "open") {
    return false;
  }

  const lastNotifiedMs = alert.lastNotifiedAt
    ? Date.parse(alert.lastNotifiedAt)
    : Number.NaN;

  if (!Number.isFinite(lastNotifiedMs)) {
    // Never notified (for example the very first evaluation after deploy).
    return true;
  }

  return now.getTime() - lastNotifiedMs >= config.renofifyCooldownMinutes * 60_000;
}

export type EvaluateAlertsResult = AlertEvaluationSummary & {
  skipped?: "alerts-disabled" | "memory-storage";
};

/**
 * Evaluates every alert rule, reconciles the alert store, and notifies
 * administrators about new, escalated, and recovered conditions.
 *
 * Runs on a schedule (`/api/cron/ops`) and is safe to run manually: it is
 * idempotent per evaluation thanks to the deduplication key on each alert.
 */
export async function evaluateOperationalAlerts({
  config = getOpsConfig(),
  now = new Date(),
}: {
  config?: OpsConfig;
  now?: Date;
} = {}): Promise<EvaluateAlertsResult> {
  const summary: AlertEvaluationSummary = {
    candidates: 0,
    created: 0,
    evaluatedAt: now.toISOString(),
    notificationsAttempted: 0,
    notificationsDelivered: 0,
    notificationsFailed: 0,
    reopened: 0,
    resolved: 0,
    updated: 0,
  };

  if (!config.enabled) {
    return { ...summary, skipped: "alerts-disabled" };
  }

  if (getMonitoringStorageDriver() !== "mysql") {
    return { ...summary, skipped: "memory-storage" };
  }

  let storageError: string | null = null;
  let sites: Awaited<
    ReturnType<typeof getMonitoringReferenceDataWithSource>
  >["reference"]["sites"] = [];
  let tanks: Awaited<
    ReturnType<typeof getMonitoringReferenceDataWithSource>
  >["reference"]["tanks"] = [];
  let devices: Awaited<
    ReturnType<typeof getMonitoringReferenceDataWithSource>
  >["reference"]["devices"] = [];
  let latestReadings: Awaited<
    ReturnType<typeof listLatestMonitoringReadingsByTankWithSource>
  >["readings"] = [];

  try {
    const [referenceResult, readingsResult] = await Promise.all([
      getMonitoringReferenceDataWithSource(),
      listLatestMonitoringReadingsByTankWithSource(),
    ]);

    sites = referenceResult.reference.sites;
    tanks = referenceResult.reference.tanks;
    devices = referenceResult.reference.devices;
    latestReadings = readingsResult.readings;
  } catch (error) {
    storageError = error instanceof Error ? error.message : String(error);
    log.error("ops.alerts.registry-unavailable", { error });
  }

  const [ingestRejectionCounts, packageTokenAnomalyCount] = await Promise.all([
    countRecentIngestRejectionsFromMysql({
      windowMinutes: config.ingestRejectionWindowMinutes,
    }).catch(() => null),
    countRecentPackageTokenAnomaliesFromMysql({
      windowMinutes: config.packageTokenWindowMinutes,
    }).catch(() => null),
  ]);
  const ingestRejections = ingestRejectionCounts
    ? {
        count: ingestRejectionCounts.count,
        topDeviceIdentifiers: ingestRejectionCounts.topDeviceIdentifiers,
        windowMinutes: config.ingestRejectionWindowMinutes,
      }
    : undefined;
  const packageTokenAnomalies =
    packageTokenAnomalyCount === null
      ? undefined
      : {
          count: packageTokenAnomalyCount,
          windowMinutes: config.packageTokenWindowMinutes,
        };

  const candidates = buildAlertCandidates({
    config,
    devices,
    ingestRejections: ingestRejections ?? undefined,
    latestReadings,
    now,
    packageTokenAnomalies: packageTokenAnomalies ?? undefined,
    sites,
    storageError,
    tanks,
  });
  summary.candidates = candidates.length;

  const syncResult = await syncMonitoringAlertsInMysql({
    candidates,
    config,
    now,
  });

  summary.created = syncResult.created;
  summary.updated = syncResult.updated;
  summary.resolved = syncResult.resolved;
  summary.reopened = syncResult.reopened;

  for (const transition of syncResult.transitions) {
    metrics.incrementCounter({
      name: metricNames.alerts,
      help: "Alert state transitions grouped by rule, severity, and type.",
      labels: {
        rule: transition.alert.ruleKey,
        severity: transition.alert.severity,
        transition: transition.type,
      },
    });

    if (
      !shouldNotifyOnTransition({
        alert: transition.alert,
        previousSeverity: transition.previousSeverity,
        type: transition.type,
      })
    ) {
      continue;
    }

    const result = await deliverAlertNotification({
      alert: transition.alert,
      kind:
        transition.type === "resolved"
          ? "recovery"
          : transition.type === "reopened" ||
              transition.type === "severity_changed"
            ? "reminder"
            : "alert",
    });

    summary.notificationsAttempted += result.attempted;
    summary.notificationsDelivered += result.delivered;
    summary.notificationsFailed += result.failed;

    await markMonitoringAlertNotifiedInMysql({
      alertId: transition.alert.id,
      delivered: result.delivered > 0,
    });
  }

  const activeAlerts = await listActiveMonitoringAlertsFromMysql();

  for (const alert of activeAlerts) {
    if (!isReminderDue({ alert, config, now })) {
      continue;
    }

    const result = await deliverAlertNotification({ alert, kind: "reminder" });

    summary.notificationsAttempted += result.attempted;
    summary.notificationsDelivered += result.delivered;
    summary.notificationsFailed += result.failed;

    await markMonitoringAlertNotifiedInMysql({
      alertId: alert.id,
      delivered: result.delivered > 0,
    });
  }

  log.info("ops.alerts.evaluated", {
    active: activeAlerts.length,
    candidates: summary.candidates,
    created: summary.created,
    notificationsDelivered: summary.notificationsDelivered,
    resolved: summary.resolved,
  });

  return summary;
}

export async function acknowledgeAlert({
  alertId,
  actorLabel,
  actorUserId,
  note,
}: {
  alertId: string;
  actorLabel?: string | null;
  actorUserId: string;
  note?: string | null;
}): Promise<MonitoringAlert | null> {
  return acknowledgeMonitoringAlertInMysql({
    actorLabel,
    actorUserId,
    alertId,
    note,
  });
}

export async function resolveAlert({
  alertId,
  actorLabel,
  actorUserId,
  note,
}: {
  alertId: string;
  actorLabel?: string | null;
  actorUserId: string;
  note?: string | null;
}): Promise<MonitoringAlert | null> {
  return resolveMonitoringAlertInMysql({
    actorLabel,
    actorUserId,
    alertId,
    note,
  });
}
