# Disaster Recovery Runbook

This runbook explains how FTM data is protected, how to restore it, and how
to prove the restore works. A backup that has never been restored is a
hypothesis, not a backup — the drill in section 5 is the proof.

## 1. Objectives

| Item | Target |
|---|---|
| Recovery point objective (RPO) | 24 hours (daily backup; run twice a day when the pilot expands) |
| Recovery time objective (RTO) | 60 minutes for a full database restore to a reachable MySQL |
| Backup retention | 90 days by default (`MYSQL_BACKUP_RETENTION_DAYS`) |
| Restore verification | Monthly drill recorded in section 6 |

## 2. What Is Protected

| Asset | Protection |
|---|---|
| Registry (sites, tanks, devices, keys) | MySQL dump, included in every backup |
| Reading history and live snapshots | MySQL dump, included in every backup |
| Accounts, sessions, audit log | MySQL dump, included in every backup |
| Firmware packages (encrypted blobs) | MySQL dump (the ciphertext rows) plus `DEVICE_PACKAGE_ENCRYPTION_KEY` |
| Application code and migrations | Git repository |
| Environment configuration | Vercel project environment + the operations password manager |

Two secrets are **not** in the database and must be stored in the operations
password manager, otherwise the restore is incomplete:

- `DEVICE_PACKAGE_ENCRYPTION_KEY` (without it, existing firmware packages
  cannot be decrypted);
- `MYSQL_BACKUP_ENCRYPTION_KEY` (without it, encrypted backups cannot be
  restored).

## 3. Creating a Backup

```powershell
pnpm db:backup:mysql
```

The command writes three artefacts next to each other:

```text
solar_tank_mysql_20261016T020000Z.sql.gz.enc    # encrypted, gzipped dump (STB1 container)
solar_tank_mysql_20261016T020000Z.sql.gz.enc.json  # manifest: checksum, size, host, key fingerprint
```

Encryption uses AES-256-GCM, so the file is confidential *and* tamper-evident:
a modified backup fails to restore instead of silently importing bad data.

Required environment for encrypted backups:

```env
MYSQL_BACKUP_ENCRYPTION_KEY="<32-byte base64url key>"
MYSQL_BACKUP_OUTPUT_DIR="backups/mysql"
MYSQL_BACKUP_RETENTION_DAYS="90"
MYSQL_BACKUP_COMPRESS="true"
```

Generate the key once and store it in the password manager:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## 4. Verifying a Backup

```powershell
pnpm db:verify:backup                     # verifies the newest backup in the output directory
pnpm db:verify:backup backups/mysql/solar_tank_mysql_20261016T020000Z.sql.gz.enc
```

Verification checks the manifest checksum, decrypts with the configured key,
and parses the payload. If `MYSQL_BACKUP_VERIFY_DATABASE_URL` is set it also
reports the row counts currently present in the verification database.

## 5. Restoring

A restore never defaults to the operational database: the target must be
given explicitly and confirmed by name.

```powershell
# 1. Restore into a scratch database for a drill
$env:MYSQL_BACKUP_RESTORE_URL="mysql://user:pass@host:3306/ftm_restore_drill"
pnpm db:restore:mysql --file backups/mysql/solar_tank_mysql_20261016T020000Z.sql.gz.enc --confirm ftm_restore_drill

# 2. Dry run (decrypt + checksum only, nothing imported)
pnpm db:restore:mysql --file <backup> --confirm <database> --dry-run

# 3. Real disaster recovery over the operational database
pnpm db:restore:mysql --file <backup> --confirm <database> --allow-production
```

Safety guards:

- `--confirm <database>` must equal the target database name;
- restoring over the host/database found in `MYSQL_DATABASE_URL` requires
  `--allow-production`;
- a checksum mismatch aborts the restore;
- a truncated, tampered, or wrongly-keyed backup aborts the restore.

### One-command drill

`pnpm db:restore:drill` automates the repetitive part of a drill: it finds the
newest backup, runs the restore into a scratch database, compares six tables
against the operational database, prints a record, and (with `--record`) appends
it to `docs/disaster-recovery-drills.md`.

```powershell
# Check what would be restored, without importing anything
pnpm db:restore:drill --dry-run --operator "<name>"

# Full drill into a scratch database
pnpm db:restore:drill `
  --target-url "mysql://user:pass@host:3306/ftm_restore_drill" `
  --confirm ftm_restore_drill `
  --operator "<name>" `
  --record
```

Exit codes: `0` passed, `1` configuration or restore error, `2` row counts did
not match. `monitoring_readings` is compared with a tolerance of 50 rows because
the operational database keeps receiving telemetry during the drill; every other
table must match exactly.

The drill refuses to run when the target is the host and database in
`MYSQL_DATABASE_URL`, so it cannot overwrite production by accident.

### Restore order for a full recovery

1. Announce the incident and freeze device onboarding (`SOLAR_TANK_AUTO_PROVISION_DEVICES=false`).
2. Restore the database (section 5).
3. Run `pnpm db:migrations:check` — it must report `0 pending, 0 drifted`.
4. Confirm `/api/ready` returns `ready` (or only expected `degraded` checks).
5. Confirm devices are reporting again in the alert centre
   (`/dashboard/admin/alerts`).
6. Ask each operator to sign in again; revoke all sessions if the incident
   involved credential exposure.
7. Close the incident and record it in section 6.

## 6. Drill Log

Drills are appended to `docs/disaster-recovery-drills.md` by
`pnpm db:restore:drill --record`, which keeps the evidence next to the runbook
without hand-editing this file.

Summary of the drills run so far:

| Date | Backup file | Target | Verified checksum | Rows compared | Result | Notes |
|---|---|---|---|---|---|---|
| _no drill recorded yet_ | | | | | | |

A drill is only complete when the operator has also confirmed, by hand:

1. the restored registry (`monitoring_sites`, `monitoring_tanks`,
   `monitoring_devices`) matches the operational registry;
2. `schema_migrations` lists the same migration files as the operational
   database;
3. the newest `monitoring_readings` row is no newer than the backup timestamp;
4. every administrator account that should be able to sign in exists in
   `auth_users`;
5. the scratch database credentials used for the drill are deleted or rotated.

## 7. Migration Ledger

Every migration run records itself in `schema_migrations` (file path,
checksum, statements applied, duration). Check the state of an environment
with:

```powershell
pnpm db:migrations:check
```

- `PENDING` — the file exists in the repository but was never applied here.
  Apply it before deploying code that depends on it.
- `DRIFT` — the file changed after it was applied. This is a process error:
  never edit an applied migration; add a new migration instead.

## 8. Failure Scenarios

| Scenario | Response |
|---|---|
| MySQL provider incident | Restore the newest backup to a new instance, update `MYSQL_DATABASE_URL`, redeploy, confirm readiness |
| Accidental data deletion | Restore into a scratch database, extract the missing rows, then import them only |
| Lost encryption key | Backups with that key are unrecoverable; rotate the key going forward and record the loss |
| Suspected device key leak | Rotate the device key from the device registry page; the previous key stays valid only for the grace window |
| Lost `DEVICE_PACKAGE_ENCRYPTION_KEY` | Existing firmware packages cannot be decrypted; reissue packages for affected devices |

## 9. Limits

- Backups live on the machine that runs the command; syncing them to cloud
  storage is an operational task (Google Drive Desktop, `rclone`, or a
  provider snapshot).
- A notification channel that fails during an incident (SMTP down, bot
  blocked) is not itself a data-loss event, but it must be tested as part of
  the drill.
- Physical sensor accuracy, calibration, and fuel-safety procedures are
  outside this runbook.
