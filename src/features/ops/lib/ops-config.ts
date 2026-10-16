import type { AlertSeverity } from "../types";

const DEFAULTS = {
  enabled: true,
  offlineGraceMultiplier: 4,
  delayedGraceMultiplier: 2,
  neverReportedHours: 24,
  ingestRejectionWarningCount: 25,
  ingestRejectionWindowMinutes: 60,
  packageTokenAnomalyCount: 5,
  packageTokenWindowMinutes: 60,
  escalationAfterMinutes: 30,
  renofifyCooldownMinutes: 60,
  resolveAfterMissingEvaluations: 3,
  retention: {
    auditEventDays: 400,
    ingestEventDays: 120,
    ingestNonceMinutes: 120,
    jobRunDays: 60,
    alertDays: 400,
    rateLimitHours: 24,
    readingDays: 0,
  },
} as const;

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  const cleanValue = value?.trim().toLowerCase();

  if (!cleanValue) {
    return fallback;
  }

  if (["0", "false", "no", "off"].includes(cleanValue)) {
    return false;
  }

  if (["1", "true", "yes", "on"].includes(cleanValue)) {
    return true;
  }

  return fallback;
}

function readNumber({
  fallback,
  max,
  min,
  value,
}: {
  fallback: number;
  max: number;
  min: number;
  value: string | undefined;
}): number {
  const parsed = Number(value?.trim());

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

export type OpsConfig = {
  enabled: boolean;
  delayedGraceMultiplier: number;
  escalationAfterMinutes: number;
  ingestRejectionWarningCount: number;
  ingestRejectionWindowMinutes: number;
  neverReportedHours: number;
  offlineGraceMultiplier: number;
  packageTokenAnomalyCount: number;
  packageTokenWindowMinutes: number;
  renofifyCooldownMinutes: number;
  resolveAfterMissingEvaluations: number;
  retention: {
    alertDays: number;
    auditEventDays: number;
    ingestEventDays: number;
    ingestNonceMinutes: number;
    jobRunDays: number;
    rateLimitHours: number;
    readingDays: number;
  };
};

export function getOpsConfig(
  env: NodeJS.ProcessEnv = process.env,
): OpsConfig {
  return {
    enabled: readBoolean(env.OPS_ALERTS_ENABLED, DEFAULTS.enabled),
    delayedGraceMultiplier: DEFAULTS.delayedGraceMultiplier,
    escalationAfterMinutes: readNumber({
      fallback: DEFAULTS.escalationAfterMinutes,
      max: 10_080,
      min: 5,
      value: env.OPS_ALERT_ESCALATION_MINUTES,
    }),
    ingestRejectionWarningCount: readNumber({
      fallback: DEFAULTS.ingestRejectionWarningCount,
      max: 100_000,
      min: 1,
      value: env.OPS_INGEST_REJECTION_WARNING_COUNT,
    }),
    ingestRejectionWindowMinutes: readNumber({
      fallback: DEFAULTS.ingestRejectionWindowMinutes,
      max: 1_440,
      min: 5,
      value: env.OPS_INGEST_REJECTION_WINDOW_MINUTES,
    }),
    neverReportedHours: readNumber({
      fallback: DEFAULTS.neverReportedHours,
      max: 720,
      min: 1,
      value: env.OPS_NEVER_REPORTED_HOURS,
    }),
    offlineGraceMultiplier: DEFAULTS.offlineGraceMultiplier,
    packageTokenAnomalyCount: readNumber({
      fallback: DEFAULTS.packageTokenAnomalyCount,
      max: 100_000,
      min: 1,
      value: env.OPS_PACKAGE_TOKEN_ANOMALY_COUNT,
    }),
    packageTokenWindowMinutes: readNumber({
      fallback: DEFAULTS.packageTokenWindowMinutes,
      max: 1_440,
      min: 5,
      value: env.OPS_PACKAGE_TOKEN_WINDOW_MINUTES,
    }),
    renofifyCooldownMinutes: readNumber({
      fallback: DEFAULTS.renofifyCooldownMinutes,
      max: 10_080,
      min: 5,
      value: env.OPS_ALERT_RENOTIFY_COOLDOWN_MINUTES,
    }),
    resolveAfterMissingEvaluations: readNumber({
      fallback: DEFAULTS.resolveAfterMissingEvaluations,
      max: 50,
      min: 1,
      value: env.OPS_ALERT_RESOLVE_AFTER_MISSES,
    }),
    retention: {
      alertDays: readNumber({
        fallback: DEFAULTS.retention.alertDays,
        max: 3_650,
        min: 30,
        value: env.OPS_ALERT_RETENTION_DAYS,
      }),
      auditEventDays: readNumber({
        fallback: DEFAULTS.retention.auditEventDays,
        max: 3_650,
        min: 30,
        value: env.OPS_AUDIT_RETENTION_DAYS,
      }),
      ingestEventDays: readNumber({
        fallback: DEFAULTS.retention.ingestEventDays,
        max: 3_650,
        min: 7,
        value: env.OPS_INGEST_EVENT_RETENTION_DAYS,
      }),
      ingestNonceMinutes: readNumber({
        fallback: DEFAULTS.retention.ingestNonceMinutes,
        max: 10_080,
        min: 5,
        value: env.OPS_INGEST_NONCE_RETENTION_MINUTES,
      }),
      jobRunDays: readNumber({
        fallback: DEFAULTS.retention.jobRunDays,
        max: 3_650,
        min: 7,
        value: env.OPS_JOB_RUN_RETENTION_DAYS,
      }),
      rateLimitHours: readNumber({
        fallback: DEFAULTS.retention.rateLimitHours,
        max: 720,
        min: 1,
        value: env.OPS_RATE_LIMIT_RETENTION_HOURS,
      }),
      readingDays: readNumber({
        fallback: DEFAULTS.retention.readingDays,
        max: 3_650,
        min: 0,
        value: env.MONITORING_READING_RETENTION_DAYS,
      }),
    },
  };
}

export function getAlertSeverityWeight(severity: AlertSeverity): number {
  switch (severity) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    default:
      return 1;
  }
}
