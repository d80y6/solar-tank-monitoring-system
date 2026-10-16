# Current Operational Truth

Status date: 2026-07-14

This document is the reference for FTM's operational status. Dated
information represents the condition at verification time and is updated
when coverage, deployment, or system readiness changes.

## Current Product Status

FTM is an **active internal operational pilot**. The system receives
telemetry from physical devices through the Vercel deployment, stores it
in Aiven MySQL, and displays it to users who have been granted access.
The rollout context is within the Telkom
Indonesia/Telkominfra environment for the TIF Pasuruan–Sidoarjo area.

The system already has monitoring flows, auth, device requests, firmware
package generation, first valid ping activation, safe reading reset,
period-based CSV export, MySQL backup, Telegram, helpdesk, and device
data cleanup.

The system must not yet be called fully production-ready because firmware
hardening, restore drills, field device calibration, and final production
approval have not finished.

Software review update (2026-10-16): the deep review in
`docs/production-readiness-review.md` closed the software gaps for
observability, operational alerting, device key rotation, encrypted backups
with a restore path, and per-location access restriction. Those capabilities
are implemented and covered by `pnpm check`, but the deployment snapshot
figures in this document are unchanged: nothing here claims that a restore
drill has already been run, that alerts have been tuned on live data, or that
per-location enforcement is switched on in the pilot environment.

## Verified Snapshot 13–14 July 2026

| Indicator | Result |
|---|---|
| Landing page and Vercel health check | HTTP 200 |
| Readiness check without admin access | HTTP 401, as designed |
| Operational storage | Aiven MySQL active |
| MySQL registry | 3 locations, 3 tanks, 3 devices |
| Telemetry history in the 13 July snapshot | 9,272 readings |
| Device freshness in the snapshot | 2 devices sending latest data, 1 device delayed |
| Live snapshot and 5-minute aggregate | Ready to use |
| Regional, territory, area, and STO | Schema ready to use |

These figures are a dated snapshot, not a promise that all devices are
always online. The initial target of 5 STOs and the expansion direction
of up to 29 STOs must be read as a phased plan, not an achieved
deployment count.

## What Exists

- Sign in, register request, email verification, forgot/reset password.
- `httpOnly` session cookie and basic `admin` / `user` roles.
- Admin OTP email when `AUTH_REQUIRE_ADMIN_OTP` is active.
- Cloudflare Turnstile for public forms when the env is enabled.
- Admin user management: approve/reject access requests, change role, activate/disable, revoke sessions, send password reset.
- Auth/admin audit log.
- Account security page: change password, view sessions, revoke other sessions, Telegram binding.
- Device request from users.
- Admin device request review through the web.
- The system generates site code/device code/device key automatically.
- Tank capacity is calculated from dimensions, not manual user input.
- Diesel consumption per hour is calculated from site load, diesel engine capacity, and cos phi.
- Low level, critical level, and send interval use system/profile defaults, not free user input.
- Firmware ZIP is created after admin approval.
- Firmware ZIP is stored encrypted and downloaded through a limited token.
- A new device activates after a first valid ping with a matching key.
- `POST /api/ingest` accepts device payloads and stores readings.
- MySQL ingest stores one live snapshot per device and one 5-minute rollup history row per bucket in a single transaction.
- The summary page, detail page, and APIs consistently select the latest time during the old-storage to new-aggregate transition.
- Ingest has rate limiting when MySQL storage is active.
- Compact dashboard, detail dashboard, map, tank details, and trend charts.
- Locations are grouped in order as regional, territory, area, then STO; the dashboard can search and filter each level.
- Reading CSV download from the tank detail page with 1 day, 7 day, or 30 day periods following the chart selection.
- Admin reading reset per STO and reset of all readings without deleting registry/devices.
- Admin cleanup for STO/device/test data without deleting user/admin accounts, firmware templates, or hardware profiles.
- MySQL backup script `pnpm db:backup:mysql` and Task Scheduler wrapper `scripts/run-mysql-backup-task.ps1`.
- Health check `/api/health` and readiness check `/api/ready`.
- Test suite and CI `pnpm check`.

## Not Final Yet

Items marked *(software ready)* have working, tested software; what is still
missing is the operational step, not the code.

- Final production approval.
- Routinely tested database restore *(software ready)* — tooling and the drill
  procedure exist (`docs/disaster-recovery-runbook.md`); the first recorded
  drill on operational data is still pending.
- Long-term operational SOPs *(software ready)* — daily/weekly/monthly
  procedures are written down in `docs/operational-runbook.md`; adoption and
  review cadence still need to be established.
- Production monitoring/log service *(software ready)* — structured logs,
  `/api/metrics`, and an error-tracking sink exist; a hosted monitoring
  backend and dashboards still have to be selected.
- Critical-level/offline operational alerts *(software ready)* — the rule
  engine, scheduler, and Telegram/e-mail notifications exist; thresholds still
  need tuning against live pilot data.
- Per-location access restriction *(software ready)* — scopes and the
  enforcement switch exist; they must be assigned and enabled deliberately.
- Final firmware TLS validation — **decided and implemented**: generated
  firmware validates TLS against a pinned CA or certificate fingerprint and
  signs every request with HMAC-SHA256 (`SOLARTANK_TLS_CA_CERT`,
  `SOLARTANK_TLS_CERT_FINGERPRINT`, `SOLARTANK_ENABLE_REQUEST_SIGNING`); see
  `docs/decision-log.md`. What remains is operational: flash the field devices
  and then switch `INGEST_SIGNATURE_MODE` to `required`.
- One-click firmware compile/upload for field users — the package, upload
  steps, and generated configuration exist; compiling still happens in the
  Arduino IDE.
- More detailed operational roles beyond `admin` and `user` — per-location
  scope roles (`viewer`/`operator`) exist; any further role separation is still
  open.
- Explicitly out of scope for the current rollout: Telegram device
  approve/reject and RTU/Modbus/OPNIMUS integration stay future work.
- Documented real tank/device calibration — sensor accuracy must still be
  validated per tank in the field.

## Current New Device Flow

```text
User signs in
  -> requests a device
  -> system calculates capacity and consumption
  -> request pending with admin
  -> admin approves/rejects through the web
  -> if approved, the system creates the key and firmware ZIP
  -> user downloads the firmware from the email/link
  -> user compiles/uploads the firmware
  -> device sends first valid ping
  -> device is active and appears on the dashboard
```

Telegram is not yet the official approve/reject channel.

## Current Monitoring Data Flow

```text
Device or simulator
  -> POST /api/ingest
  -> validate device id and key
  -> first ping activation when the request lifecycle is met
  -> payload normalization
  -> payload config review against registry
  -> store in memory; or on MySQL:
       -> UPSERT live snapshot per device
       -> UPSERT 5-minute history aggregate
  -> dashboard/detail reads registry and readings
```

The registry remains the source of truth when the payload carries
configuration that differs significantly.

## Deployment Condition

For development:

- `memory` may be used.
- data is lost when the server restarts.

For the currently running pilot/operations:

- the application is live on Vercel;
- the active database uses Aiven MySQL;
- use `SOLAR_TANK_STORAGE_DRIVER=mysql`;
- disable the global device key fallback;
- prepare SMTP, auth secret, package encryption key, backup output dir, and admin bootstrap;
- check `/api/ready` before considering the system ready;
- run `pnpm db:backup:mysql` before large migrations, large resets, or deploys;
- run `pnpm db:migrate:reading-rollup` before deploying the snapshot/rollup writer;
- test restoring a backup to a staging/local database before claiming a final backup SOP.

The active Vercel deployment is used for the pilot and team review, but
it is not proof that all final production SOPs are complete. The
Regional/Territory migration has been applied to the checked database and
the `mysql-location-taxonomy` check passed on 14 July 2026. New
environments must still run the same migrations before the deployed code
is used.

## Data Notes

Demo data, pilot data, and real data must be kept separate.

- `config/pilot-registry.example.json` is only a safe template.
- `config/pilot-registry.local.json`, if present, is private and must not be committed.
- MySQL demo seeds are not evidence of real data.
- Old screenshots/chats must not be used as operational data sources without verification.
- Figures in the README or landing page must state the snapshot date and must not turn rollout targets into actual deployment claims.
