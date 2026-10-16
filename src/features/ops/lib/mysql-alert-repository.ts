import { randomUUID } from "node:crypto";

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { getMysqlPool } from "@/features/monitoring/lib/mysql-connection";

import type {
  AlertCandidate,
  AlertEvent,
  AlertEventType,
  AlertSeverity,
  AlertStatus,
  MonitoringAlert,
} from "../types";
import { getAlertSeverityWeight, type OpsConfig } from "./ops-config";

type AlertRow = RowDataPacket & {
  acknowledged_at: Date | null;
  dedupe_key: string;
  acknowledged_by_user_id: string | null;
  detail: string | null;
  first_detected_at: Date;
  id: string;
  last_detected_at: Date;
  last_notified_at: Date | null;
  metadata_json: unknown;
  missed_evaluations: number;
  notification_count: number;
  resolution_note: string | null;
  resolved_at: Date | null;
  rule_key: string;
  severity: string;
  status: string;
  subject_id: string | null;
  subject_type: string;
  title: string;
};

type AlertEventRow = RowDataPacket & {
  actor_label: string | null;
  actor_user_id: string | null;
  alert_id: string;
  created_at: Date;
  event_type: string;
  id: string;
  metadata_json: unknown;
  note: string | null;
  severity: string | null;
};

type CountRow = RowDataPacket & {
  count: number | string;
  device_identifier?: string | null;
};

function parseJsonColumn(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);

      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return null;
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapAlert(row: AlertRow): MonitoringAlert {
  return {
    acknowledgedAt: toIsoString(row.acknowledged_at),
    acknowledgedByUserId: row.acknowledged_by_user_id,
    dedupeKey: row.dedupe_key,
    detail: row.detail,
    firstDetectedAt: row.first_detected_at.toISOString(),
    id: row.id,
    lastDetectedAt: row.last_detected_at.toISOString(),
    lastNotifiedAt: toIsoString(row.last_notified_at),
    metadata: parseJsonColumn(row.metadata_json),
    notificationCount: Number(row.notification_count),
    resolutionNote: row.resolution_note,
    resolvedAt: toIsoString(row.resolved_at),
    ruleKey: row.rule_key,
    severity: row.severity as AlertSeverity,
    status: row.status as AlertStatus,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    title: row.title,
  };
}

function mapAlertEvent(row: AlertEventRow): AlertEvent {
  return {
    actorLabel: row.actor_label,
    actorUserId: row.actor_user_id,
    alertId: row.alert_id,
    createdAt: row.created_at.toISOString(),
    eventType: row.event_type,
    id: row.id,
    metadata: parseJsonColumn(row.metadata_json),
    note: row.note,
    severity: (row.severity as AlertSeverity | null) ?? null,
  };
}

function stringifyJson(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  try {
    const text = JSON.stringify(value);

    return text.length > 8_000 ? text.slice(0, 8_000) : text;
  } catch {
    return null;
  }
}

export function createAlertId(): string {
  return `alert_${randomUUID()}`;
}

export function createAlertEventId(): string {
  return `alert_evt_${randomUUID()}`;
}

export async function recordAlertEvent({
  actorLabel,
  actorUserId,
  alertId,
  eventType,
  metadata,
  note,
  severity,
}: {
  actorLabel?: string | null;
  actorUserId?: string | null;
  alertId: string;
  eventType: AlertEventType;
  metadata?: Record<string, unknown> | null;
  note?: string | null;
  severity?: AlertSeverity | null;
}): Promise<void> {
  const pool = getMysqlPool();

  await pool.execute(
    `INSERT INTO monitoring_alert_events (
       id,
       alert_id,
       event_type,
       actor_user_id,
       actor_label,
       note,
       severity,
       metadata_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      createAlertEventId(),
      alertId,
      eventType,
      actorUserId ?? null,
      actorLabel ?? null,
      note ?? null,
      severity ?? null,
      stringifyJson(metadata ?? null),
    ],
  );
}

export async function listActiveMonitoringAlertsFromMysql(): Promise<
  MonitoringAlert[]
> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AlertRow[]>(
    `SELECT *
       FROM monitoring_alerts
      WHERE status IN ('open', 'acknowledged')
      ORDER BY FIELD(severity, 'critical', 'warning', 'info'), last_detected_at DESC`,
  );

  return rows.map(mapAlert);
}

export async function listMonitoringAlertsFromMysql({
  limit = 100,
  status,
}: {
  limit?: number;
  status?: AlertStatus;
} = {}): Promise<MonitoringAlert[]> {
  const pool = getMysqlPool();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const [rows] = await pool.execute<AlertRow[]>(
    `SELECT *
       FROM monitoring_alerts
      ${status ? "WHERE status = ?" : ""}
      ORDER BY FIELD(status, 'open', 'acknowledged', 'resolved'),
               FIELD(severity, 'critical', 'warning', 'info'),
               last_detected_at DESC
      LIMIT ${safeLimit}`,
    status ? [status] : [],
  );

  return rows.map(mapAlert);
}

export async function getMonitoringAlertFromMysql(
  alertId: string,
): Promise<MonitoringAlert | null> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AlertRow[]>(
    `SELECT * FROM monitoring_alerts WHERE id = ? LIMIT 1`,
    [alertId],
  );

  return rows[0] ? mapAlert(rows[0]) : null;
}

export async function listMonitoringAlertEventsFromMysql({
  alertId,
  limit = 50,
}: {
  alertId: string;
  limit?: number;
}): Promise<AlertEvent[]> {
  const pool = getMysqlPool();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const [rows] = await pool.execute<AlertEventRow[]>(
    `SELECT *
       FROM monitoring_alert_events
      WHERE alert_id = ?
      ORDER BY created_at DESC
      LIMIT ${safeLimit}`,
    [alertId],
  );

  return rows.map(mapAlertEvent);
}

export type AlertSyncTransition = {
  alert: MonitoringAlert;
  previousSeverity?: AlertSeverity;
  type: "created" | "updated" | "resolved" | "reopened" | "severity_changed";
};

export type AlertSyncResult = {
  activeAlerts: MonitoringAlert[];
  created: number;
  resolved: number;
  reopened: number;
  transitions: AlertSyncTransition[];
  updated: number;
};

/**
 * Reconciles the current rule output with the alert store.
 *
 * - a candidate without an active alert creates one;
 * - a candidate with an active alert refreshes it and clears its miss counter;
 * - a severity increase on an acknowledged alert reopens it;
 * - an alert that stops being detected is auto-resolved only after it has been
 *   missing for `resolveAfterMissingEvaluations` consecutive evaluations, which
 *   prevents flapping notifications.
 */
export async function syncMonitoringAlertsInMysql({
  candidates,
  config,
  now = new Date(),
}: {
  candidates: AlertCandidate[];
  config: OpsConfig;
  now?: Date;
}): Promise<AlertSyncResult> {
  const pool = getMysqlPool();
  const activeAlerts = await listActiveMonitoringAlertsFromMysql();
  const activeByDedupeKey = new Map(
    activeAlerts.map((alert) => [alert.dedupeKey, alert]),
  );
  const candidateKeys = new Set(candidates.map((candidate) => candidate.dedupeKey));
  const transitions: AlertSyncTransition[] = [];
  let created = 0;
  let updated = 0;
  let resolved = 0;
  let reopened = 0;

  for (const candidate of candidates) {
    const existing = activeByDedupeKey.get(candidate.dedupeKey);

    if (!existing) {
      const alertId = createAlertId();

      await pool.execute(
        `INSERT INTO monitoring_alerts (
           id,
           rule_key,
           dedupe_key,
           active_key,
           severity,
           status,
           subject_type,
           subject_id,
           title,
           detail,
           metadata_json,
           first_detected_at,
           last_detected_at,
           missed_evaluations
         )
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          alertId,
          candidate.ruleKey,
          candidate.dedupeKey,
          candidate.dedupeKey,
          candidate.severity,
          candidate.subjectType,
          candidate.subjectId,
          candidate.title,
          candidate.detail,
          stringifyJson(candidate.metadata ?? null),
          now,
          now,
        ],
      );

      await recordAlertEvent({
        alertId,
        eventType: "detected",
        metadata: candidate.metadata ?? null,
        note: candidate.detail,
        severity: candidate.severity,
      });

      const alert = await getMonitoringAlertFromMysql(alertId);

      if (alert) {
        transitions.push({ alert, type: "created" });
        activeByDedupeKey.set(candidate.dedupeKey, alert);
        created += 1;
      }

      continue;
    }

    const severityIncreased =
      getAlertSeverityWeight(candidate.severity) >
      getAlertSeverityWeight(existing.severity);
    const severityChanged = candidate.severity !== existing.severity;
    const shouldReopen = severityIncreased && existing.status === "acknowledged";

    await pool.execute(
      `UPDATE monitoring_alerts
          SET title = ?,
              detail = ?,
              metadata_json = ?,
              severity = ?,
              status = ?,
              subject_type = ?,
              subject_id = ?,
              last_detected_at = ?,
              missed_evaluations = 0
        WHERE id = ?`,
      [
        candidate.title,
        candidate.detail,
        stringifyJson(candidate.metadata ?? null),
        candidate.severity,
        shouldReopen ? "open" : existing.status,
        candidate.subjectType,
        candidate.subjectId,
        now,
        existing.id,
      ],
    );

    if (severityChanged) {
      await recordAlertEvent({
        alertId: existing.id,
        eventType: "severity_changed",
        metadata: { from: existing.severity, to: candidate.severity },
        severity: candidate.severity,
      });
    }

    if (shouldReopen) {
      await recordAlertEvent({
        alertId: existing.id,
        eventType: "reopened",
        metadata: { reason: "severity_increased" },
        severity: candidate.severity,
      });
      reopened += 1;
    }

    const refreshed = await getMonitoringAlertFromMysql(existing.id);

    if (refreshed) {
      transitions.push({
        alert: refreshed,
        previousSeverity: severityChanged ? existing.severity : undefined,
        type: severityChanged
          ? "severity_changed"
          : shouldReopen
            ? "reopened"
            : "updated",
      });
    }

    updated += 1;
  }

  for (const alert of activeAlerts) {
    if (candidateKeys.has(alert.dedupeKey)) {
      continue;
    }

    const missed = await incrementMissedEvaluations(alert.id);

    if (missed < config.resolveAfterMissingEvaluations) {
      await recordAlertEvent({
        alertId: alert.id,
        eventType: "still_active",
        metadata: { missedEvaluations: missed },
        note: `Rule no longer reports this condition (miss ${missed}/${config.resolveAfterMissingEvaluations}).`,
      });
      continue;
    }

    await pool.execute(
      `UPDATE monitoring_alerts
          SET status = 'resolved',
              active_key = NULL,
              resolved_at = ?,
              resolution_note = 'Automatically resolved: the condition is no longer detected.'
        WHERE id = ?`,
      [now, alert.id],
    );

    await recordAlertEvent({
      alertId: alert.id,
      eventType: "auto_resolved",
      note: "The monitored condition is back to normal.",
      severity: alert.severity,
    });

    const refreshed = await getMonitoringAlertFromMysql(alert.id);

    if (refreshed) {
      transitions.push({ alert: refreshed, type: "resolved" });
      resolved += 1;
    }
  }

  return {
    activeAlerts: Array.from(activeByDedupeKey.values()),
    created,
    reopened,
    resolved,
    transitions,
    updated,
  };
}

async function incrementMissedEvaluations(alertId: string): Promise<number> {
  const pool = getMysqlPool();

  await pool.execute(
    `UPDATE monitoring_alerts
        SET missed_evaluations = missed_evaluations + 1
      WHERE id = ?`,
    [alertId],
  );

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT missed_evaluations FROM monitoring_alerts WHERE id = ? LIMIT 1`,
    [alertId],
  );

  return Number(
    (rows[0] as { missed_evaluations?: number } | undefined)?.missed_evaluations ??
      0,
  );
}

export async function markMonitoringAlertNotifiedInMysql({
  alertId,
  delivered,
}: {
  alertId: string;
  delivered: boolean;
}): Promise<void> {
  const pool = getMysqlPool();

  if (!delivered) {
    await recordAlertEvent({
      alertId,
      eventType: "notification_failed",
      note: "No notification channel accepted the message.",
    });

    return;
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE monitoring_alerts
        SET last_notified_at = UTC_TIMESTAMP(3),
            notification_count = notification_count + 1
      WHERE id = ?`,
    [alertId],
  );

  if (result.affectedRows > 0) {
    await recordAlertEvent({
      alertId,
      eventType: "notified",
      note: "Operational alert delivered to administrators.",
    });
  }
}

export async function acknowledgeMonitoringAlertInMysql({
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
  const pool = getMysqlPool();

  await pool.execute(
    `UPDATE monitoring_alerts
        SET status = 'acknowledged',
            acknowledged_at = UTC_TIMESTAMP(3),
            acknowledged_by_user_id = ?,
            missed_evaluations = 0
      WHERE id = ?
        AND status IN ('open', 'acknowledged')`,
    [actorUserId, alertId],
  );

  await recordAlertEvent({
    actorLabel: actorLabel ?? null,
    actorUserId,
    alertId,
    eventType: "acknowledged",
    note: note ?? null,
  });

  return getMonitoringAlertFromMysql(alertId);
}

export async function resolveMonitoringAlertInMysql({
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
  const pool = getMysqlPool();

  await pool.execute(
    `UPDATE monitoring_alerts
        SET status = 'resolved',
            active_key = NULL,
            resolved_at = UTC_TIMESTAMP(3),
            resolution_note = ?
      WHERE id = ?
        AND status IN ('open', 'acknowledged')`,
    [note ?? "Resolved manually by an administrator.", alertId],
  );

  await recordAlertEvent({
    actorLabel: actorLabel ?? null,
    actorUserId,
    alertId,
    eventType: "resolved",
    note: note ?? null,
  });

  return getMonitoringAlertFromMysql(alertId);
}

export async function countRecentIngestRejectionsFromMysql({
  windowMinutes,
}: {
  windowMinutes: number;
}): Promise<{ count: number; topDeviceIdentifiers: string[] }> {
  const pool = getMysqlPool();
  const safeWindow = Math.min(Math.max(Math.trunc(windowMinutes), 1), 10_080);

  const [[countRow]] = await pool.execute<CountRow[]>(
    `SELECT COUNT(*) AS count
       FROM monitoring_ingest_events
      WHERE event_type IN ('ingest_rejected', 'ingest_rate_limited')
        AND created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)`,
    [safeWindow],
  );

  const [rows] = await pool.execute<CountRow[]>(
    `SELECT device_identifier, COUNT(*) AS count
       FROM monitoring_ingest_events
      WHERE event_type IN ('ingest_rejected', 'ingest_rate_limited')
        AND created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)
      GROUP BY device_identifier
      ORDER BY count DESC
      LIMIT 5`,
    [safeWindow],
  );

  return {
    count: Number(countRow?.count ?? 0),
    topDeviceIdentifiers: rows
      .map((row) => row.device_identifier?.trim())
      .filter((value): value is string => Boolean(value)),
  };
}

export async function countRecentPackageTokenAnomaliesFromMysql({
  windowMinutes,
}: {
  windowMinutes: number;
}): Promise<number> {
  const pool = getMysqlPool();
  const safeWindow = Math.min(Math.max(Math.trunc(windowMinutes), 1), 10_080);
  const [[row]] = await pool.execute<CountRow[]>(
    `SELECT COUNT(*) AS count
       FROM monitoring_device_provisioning_events
      WHERE event_type IN (
              'firmware_package_download_expired',
              'firmware_package_missing_content',
              'firmware_package_decrypt_failed'
            )
        AND created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)`,
    [safeWindow],
  );

  return Number(row?.count ?? 0);
}

export type OpsJobRunStatus = "succeeded" | "failed" | "skipped";

export async function recordOpsJobRunInMysql({
  detail,
  durationMs,
  errorMessage,
  finishedAt = new Date(),
  jobKey,
  startedAt,
  status,
  triggerSource = "schedule",
}: {
  detail?: Record<string, unknown> | null;
  durationMs: number;
  errorMessage?: string | null;
  finishedAt?: Date;
  jobKey: string;
  startedAt: Date;
  status: OpsJobRunStatus;
  triggerSource?: string;
}): Promise<void> {
  const pool = getMysqlPool();

  await pool.execute(
    `INSERT INTO monitoring_ops_job_runs (
       id,
       job_key,
       trigger_source,
       status,
       started_at,
       finished_at,
       duration_ms,
       detail_json,
       error_message
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `job_${randomUUID()}`,
      jobKey,
      triggerSource,
      status,
      startedAt,
      finishedAt,
      Math.max(0, Math.round(durationMs)),
      stringifyJson(detail ?? null),
      errorMessage ? errorMessage.slice(0, 500) : null,
    ],
  );
}

export async function listRecentOpsJobRunsFromMysql({
  jobKey,
  limit = 20,
}: {
  jobKey?: string;
  limit?: number;
} = {}): Promise<
  Array<{
    detail: Record<string, unknown> | null;
    durationMs: number | null;
    errorMessage: string | null;
    finishedAt: string | null;
    jobKey: string;
    startedAt: string;
    status: string;
    triggerSource: string;
  }>
> {
  const pool = getMysqlPool();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const [rows] = await pool.execute<
    Array<
      RowDataPacket & {
        detail_json: unknown;
        duration_ms: number | null;
        error_message: string | null;
        finished_at: Date | null;
        job_key: string;
        started_at: Date;
        status: string;
        trigger_source: string;
      }
    >
  >(
    `SELECT job_key, trigger_source, status, started_at, finished_at,
            duration_ms, detail_json, error_message
       FROM monitoring_ops_job_runs
      ${jobKey ? "WHERE job_key = ?" : ""}
      ORDER BY started_at DESC
      LIMIT ${safeLimit}`,
    jobKey ? [jobKey] : [],
  );

  return rows.map((row) => ({
    detail: parseJsonColumn(row.detail_json),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    errorMessage: row.error_message,
    finishedAt: toIsoString(row.finished_at),
    jobKey: row.job_key,
    startedAt: row.started_at.toISOString(),
    status: row.status,
    triggerSource: row.trigger_source,
  }));
}
