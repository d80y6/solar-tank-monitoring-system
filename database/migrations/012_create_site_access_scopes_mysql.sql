-- Migration 012: per-location access scopes.
--
-- Until now every signed-in account could read every location. Operators need
-- to grant access per STO/site while keeping platform admins unrestricted.
--
-- Enforcement is opt-in through AUTH_ENFORCE_SITE_SCOPES so an environment can
-- assign scopes first and turn enforcement on without locking anyone out.

CREATE TABLE IF NOT EXISTS auth_user_site_scopes (
  id VARCHAR(96) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  site_id VARCHAR(64) NOT NULL,
  scope_role VARCHAR(16) NOT NULL DEFAULT 'viewer',
  note VARCHAR(255) NULL,
  granted_by_user_id VARCHAR(64) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_auth_user_site_scopes_user_site (user_id, site_id),
  KEY idx_auth_user_site_scopes_site (site_id),
  CONSTRAINT fk_auth_user_site_scopes_user
    FOREIGN KEY (user_id)
    REFERENCES auth_users(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_auth_user_site_scopes_site
    FOREIGN KEY (site_id)
    REFERENCES monitoring_sites(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_auth_user_site_scopes_granted_by
    FOREIGN KEY (granted_by_user_id)
    REFERENCES auth_users(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT chk_auth_user_site_scopes_role
    CHECK (scope_role IN ('viewer', 'operator'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
