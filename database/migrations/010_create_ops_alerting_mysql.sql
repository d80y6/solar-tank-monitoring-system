-- Migration 010: operational alerting and scheduled job bookkeeping.
--
-- These tables turn the dashboard from "someone has to look at it" into a
-- system that reports its own problems: rules are evaluated on a schedule,
-- active alerts are deduplicated, and every notification, acknowledgement,
-- and resolution is recorded.

CREATE TABLE IF NOT EXISTS monitoring_alerts (
  id VARCHAR(96) NOT NULL,
  rule_key VARCHAR(80) NOT NULL,
  dedupe_key VARCHAR(191) NOT NULL,
  active_key VARCHAR(191) NULL,
  severity VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  subject_type VARCHAR(32) NOT NULL,
  subject_id VARCHAR(96) NULL,
  title VARCHAR(200) NOT NULL,
  detail TEXT NULL,
  metadata_json JSON NULL,
  first_detected_at DATETIME(3) NOT NULL,
  last_detected_at DATETIME(3) NOT NULL,
  last_notified_at DATETIME(3) NULL,
  notification_count INT UNSIGNED NOT NULL DEFAULT 0,
  missed_evaluations INT UNSIGNED NOT NULL DEFAULT 0,
  acknowledged_at DATETIME(3) NULL,
  acknowledged_by_user_id VARCHAR(64) NULL,
  resolved_at DATETIME(3) NULL,
  resolution_note VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_monitoring_alerts_active (active_key),
  KEY idx_monitoring_alerts_status_severity (status, severity, last_detected_at),
  KEY idx_monitoring_alerts_rule_last (rule_key, last_detected_at),
  KEY idx_monitoring_alerts_subject (subject_type, subject_id),
  CONSTRAINT chk_monitoring_alerts_severity
    CHECK (severity IN ('info', 'warning', 'critical')),
  CONSTRAINT chk_monitoring_alerts_status
    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  CONSTRAINT fk_monitoring_alerts_acknowledged_by
    FOREIGN KEY (acknowledged_by_user_id)
    REFERENCES auth_users(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitoring_alert_events (
  id VARCHAR(96) NOT NULL,
  alert_id VARCHAR(96) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  actor_user_id VARCHAR(64) NULL,
  actor_label VARCHAR(120) NULL,
  note VARCHAR(500) NULL,
  severity VARCHAR(16) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_monitoring_alert_events_alert_created (alert_id, created_at),
  KEY idx_monitoring_alert_events_type_created (event_type, created_at),
  CONSTRAINT fk_monitoring_alert_events_alert
    FOREIGN KEY (alert_id)
    REFERENCES monitoring_alerts(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_monitoring_alert_events_actor
    FOREIGN KEY (actor_user_id)
    REFERENCES auth_users(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitoring_ops_job_runs (
  id VARCHAR(96) NOT NULL,
  job_key VARCHAR(80) NOT NULL,
  trigger_source VARCHAR(40) NOT NULL DEFAULT 'schedule',
  status VARCHAR(16) NOT NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  duration_ms INT UNSIGNED NULL,
  detail_json JSON NULL,
  error_message VARCHAR(500) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_monitoring_ops_job_runs_job_started (job_key, started_at),
  KEY idx_monitoring_ops_job_runs_status_started (status, started_at),
  CONSTRAINT chk_monitoring_ops_job_runs_status
    CHECK (status IN ('succeeded', 'failed', 'skipped'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
