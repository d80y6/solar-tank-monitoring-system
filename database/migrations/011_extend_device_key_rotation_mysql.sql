-- Migration 011: device key rotation and telemetry replay protection.
--
-- A device key that can never be rotated is a permanent liability: a leaked
-- key means re-flashing the hardware. Rotation keeps the previous hash valid
-- for a grace window so a device in the field can pick up its new key, and
-- the nonce table makes replayed telemetry detectable when request signing is
-- enabled.

ALTER TABLE monitoring_devices
  ADD COLUMN key_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER api_key_hash;

ALTER TABLE monitoring_devices
  ADD COLUMN previous_api_key_hash VARCHAR(128) NULL AFTER key_version;

ALTER TABLE monitoring_devices
  ADD COLUMN previous_key_valid_until DATETIME(3) NULL AFTER previous_api_key_hash;

ALTER TABLE monitoring_devices
  ADD COLUMN key_rotated_at DATETIME(3) NULL AFTER previous_key_valid_until;

ALTER TABLE monitoring_devices
  ADD COLUMN key_rotated_by_user_id VARCHAR(64) NULL AFTER key_rotated_at;

ALTER TABLE monitoring_devices
  ADD COLUMN last_seen_at DATETIME(3) NULL AFTER key_rotated_by_user_id;

ALTER TABLE monitoring_devices
  ADD CONSTRAINT fk_monitoring_devices_key_rotated_by
    FOREIGN KEY (key_rotated_by_user_id)
    REFERENCES auth_users(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

ALTER TABLE monitoring_devices
  ADD KEY idx_monitoring_devices_last_seen (last_seen_at);

CREATE TABLE IF NOT EXISTS monitoring_ingest_nonces (
  device_id VARCHAR(64) NOT NULL,
  nonce_hash VARCHAR(128) NOT NULL,
  request_timestamp DATETIME(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (device_id, nonce_hash),
  KEY idx_monitoring_ingest_nonces_created (created_at),
  KEY idx_monitoring_ingest_nonces_device_timestamp (device_id, request_timestamp),
  CONSTRAINT fk_monitoring_ingest_nonces_device
    FOREIGN KEY (device_id)
    REFERENCES monitoring_devices(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitoring_device_key_events (
  id VARCHAR(96) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  key_version INT UNSIGNED NOT NULL,
  actor_user_id VARCHAR(64) NULL,
  actor_label VARCHAR(120) NULL,
  ip_hash VARCHAR(128) NULL,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_monitoring_device_key_events_device_created (device_id, created_at),
  KEY idx_monitoring_device_key_events_type_created (event_type, created_at),
  CONSTRAINT fk_monitoring_device_key_events_device
    FOREIGN KEY (device_id)
    REFERENCES monitoring_devices(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_monitoring_device_key_events_actor
    FOREIGN KEY (actor_user_id)
    REFERENCES auth_users(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT chk_monitoring_device_key_events_type
    CHECK (event_type IN ('rotated', 'grace_extended', 'grace_expired', 'revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
