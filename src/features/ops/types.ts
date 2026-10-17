export type AlertSeverity = "info" | "warning" | "critical";

export type AlertStatus = "open" | "acknowledged" | "resolved";

export type AlertRuleKey =
  | "device_offline"
  | "device_delayed"
  | "device_never_reported"
  | "device_config_mismatch"
  | "device_inactive"
  | "fuel_critical_level"
  | "fuel_low_level"
  | "runtime_critical"
  | "registry_incomplete"
  | "storage_unavailable"
  | "ingest_rejection_spike"
  | "package_token_anomaly";

export type AlertSubjectType =
  | "device"
  | "tank"
  | "site"
  | "system"
  | "package";

export type AlertCandidate = {
  ruleKey: AlertRuleKey;
  dedupeKey: string;
  severity: AlertSeverity;
  subjectType: AlertSubjectType;
  subjectId: string | null;
  title: string;
  detail: string;
  metadata?: Record<string, unknown>;
};

export type MonitoringAlert = {
  id: string;
  ruleKey: AlertRuleKey | string;
  dedupeKey: string;
  severity: AlertSeverity;
  status: AlertStatus;
  subjectType: AlertSubjectType | string;
  subjectId: string | null;
  title: string;
  detail: string | null;
  metadata: Record<string, unknown> | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  lastNotifiedAt: string | null;
  notificationCount: number;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
};

export type AlertEventType =
  | "detected"
  | "still_active"
  | "notified"
  | "notification_failed"
  | "acknowledged"
  | "resolved"
  | "auto_resolved"
  | "reopened"
  | "severity_changed";

export type AlertEvent = {
  id: string;
  alertId: string;
  eventType: AlertEventType | string;
  actorUserId: string | null;
  actorLabel: string | null;
  note: string | null;
  severity: AlertSeverity | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type AlertEvaluationSummary = {
  evaluatedAt: string;
  candidates: number;
  created: number;
  updated: number;
  resolved: number;
  reopened: number;
  notificationsAttempted: number;
  notificationsDelivered: number;
  notificationsFailed: number;
};

export type AlertTransition = {
  type: "created" | "updated" | "resolved" | "reopened" | "severity_changed";
  alert: MonitoringAlert;
  previousSeverity?: AlertSeverity;
};
