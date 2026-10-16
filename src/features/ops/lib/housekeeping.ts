import type { ResultSetHeader } from "mysql2/promise";

import { getMysqlPool } from "@/features/monitoring/lib/mysql-connection";
import { pruneMonitoringReadingsOlderThanFromMysql } from "@/features/monitoring/lib/mysql-maintenance-repository";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";
import { createLogger } from "@/lib/logger";

import { getOpsConfig, type OpsConfig } from "./ops-config";

const log = createLogger({ module: "ops-housekeeping" });

export type HousekeepingResult = {
  retention: {
    alertDays: number;
    auditEventDays: number;
    ingestEventDays: number;
    jobRunDays: number;
    rateLimitHours: number;
    readingDays: number;
  };
  deleted: Record<string, number>;
  skipped?: "memory-storage";
  totalDeleted: number;
};

type DeletionSpec = {
  key: string;
  sql: string;
  values: Array<string | number | Date>;
};

async function runDeletions(specs: DeletionSpec[]): Promise<Record<string, number>> {
  const pool = getMysqlPool();
  const deleted: Record<string, number> = {};

  for (const spec of specs) {
    try {
      const [result] = await pool.execute<ResultSetHeader>(spec.sql, spec.values);

      deleted[spec.key] = result.affectedRows;
    } catch (error) {
      // A missing table (older environment) or a locked table must not abort
      // the whole housekeeping run.
      deleted[spec.key] = -1;
      log.warn("ops.housekeeping.step-failed", {
        error: error instanceof Error ? error : String(error),
        step: spec.key,
      });
    }
  }

  return deleted;
}

/**
 * Bounded data growth: expired security tokens, stale rate-limit buckets,
 * old ingest audit rows, old job runs, resolved alerts, and (only when the
 * operator opts in) raw readings older than the retention window.
 *
 * Deleting readings is disabled by default (`MONITORING_READING_RETENTION_DAYS=0`)
 * because operational history is the product's core asset.
 */
export async function runOperationalHousekeeping({
  config = getOpsConfig(),
  now = new Date(),
}: {
  config?: OpsConfig;
  now?: Date;
} = {}): Promise<HousekeepingResult> {
  if (getMonitoringStorageDriver() !== "mysql") {
    return {
      deleted: {},
      retention: { ...config.retention },
      skipped: "memory-storage",
      totalDeleted: 0,
    };
  }

  const specs: DeletionSpec[] = [
    {
      key: "auth_sessions_expired",
      sql: `DELETE FROM auth_sessions
             WHERE expires_at < DATE_SUB(?, INTERVAL 7 DAY)
             LIMIT 5000`,
      values: [now],
    },
    {
      key: "auth_otp_codes_expired",
      sql: `DELETE FROM auth_otp_codes
             WHERE expires_at < DATE_SUB(?, INTERVAL 7 DAY)
             LIMIT 5000`,
      values: [now],
    },
    {
      key: "auth_password_reset_tokens_expired",
      sql: `DELETE FROM auth_password_reset_tokens
             WHERE expires_at < DATE_SUB(?, INTERVAL 7 DAY)
             LIMIT 5000`,
      values: [now],
    },
    {
      key: "auth_email_verification_tokens_expired",
      sql: `DELETE FROM auth_email_verification_tokens
             WHERE expires_at < DATE_SUB(?, INTERVAL 7 DAY)
             LIMIT 5000`,
      values: [now],
    },
    {
      key: "auth_telegram_bind_tokens_expired",
      sql: `DELETE FROM auth_telegram_bind_tokens
             WHERE expires_at < DATE_SUB(?, INTERVAL 1 DAY)
             LIMIT 5000`,
      values: [now],
    },
    {
      key: "auth_rate_limits_stale",
      sql: `DELETE FROM auth_rate_limits
             WHERE window_expires_at < DATE_SUB(?, INTERVAL ? HOUR)
             LIMIT 10000`,
      values: [now, config.retention.rateLimitHours],
    },
    {
      key: "monitoring_ingest_events_old",
      sql: `DELETE FROM monitoring_ingest_events
             WHERE created_at < DATE_SUB(?, INTERVAL ? DAY)
             LIMIT 20000`,
      values: [now, config.retention.ingestEventDays],
    },
    {
      key: "monitoring_ops_job_runs_old",
      sql: `DELETE FROM monitoring_ops_job_runs
             WHERE started_at < DATE_SUB(?, INTERVAL ? DAY)
             LIMIT 5000`,
      values: [now, config.retention.jobRunDays],
    },
    {
      key: "monitoring_alert_events_old",
      sql: `DELETE monitoring_alert_events
             FROM monitoring_alert_events
             JOIN monitoring_alerts
               ON monitoring_alerts.id = monitoring_alert_events.alert_id
            WHERE monitoring_alerts.status = 'resolved'
              AND monitoring_alert_events.created_at < DATE_SUB(?, INTERVAL ? DAY)
            LIMIT 20000`,
      values: [now, config.retention.alertDays],
    },
    {
      key: "monitoring_alerts_resolved_old",
      sql: `DELETE FROM monitoring_alerts
             WHERE status = 'resolved'
               AND resolved_at < DATE_SUB(?, INTERVAL ? DAY)
             LIMIT 5000`,
      values: [now, config.retention.alertDays],
    },
  ];

  const deleted = await runDeletions(specs);
  let totalDeleted = Object.values(deleted).reduce(
    (total, value) => total + Math.max(0, value),
    0,
  );

  if (config.retention.readingDays > 0) {
    const pruning = await pruneMonitoringReadingsOlderThanFromMysql({
      olderThanDays: config.retention.readingDays,
      now,
    });

    deleted.monitoring_readings_old = pruning.deletedRows;
    totalDeleted += pruning.deletedRows;
  }

  log.info("ops.housekeeping.completed", { deleted, totalDeleted });

  return {
    deleted,
    retention: { ...config.retention },
    totalDeleted,
  };
}
