# Production Go-Live Checklist

This checklist is the gate for promoting the pilot to a production service. It
covers the initial scope stated in `docs/roadmap.md`: **5 sites/tanks with 5
devices (5 STOs)**, with every item either completed or explicitly waived by the
platform owner in the sign-off table at the end.

Run the sections in order. Each section ends with the command or check that
proves it, because "we believe it is configured" is not evidence.

## 0. Preconditions

- [ ] `docs/current-operational-truth.md` has been reviewed and its status line
      is accurate for the deployment being promoted.
- [ ] The deployment branch is merged to `main` and CI is green.
- [ ] `pnpm check` passes locally on the exact commit being deployed.
- [ ] The change window and the person on call are announced to the operators.

## 1. Code and Release

- [ ] The deployed commit SHA is recorded (it appears in `GET /api/health`).
- [ ] `GET /api/health` returns `status: "ok"` and a non-null `build.commitSha`.
- [ ] The rollout procedure in `docs/upgrade-and-rollback.md` has been read by
      the operator who will run it.

## 2. Database

- [ ] `MYSQL_DATABASE_URL` points at the production instance with a dedicated
      application user (no root).
- [ ] `MYSQL_SSL_MODE="required"` and, if the provider supplies one, a CA
      certificate in `MYSQL_SSL_CA`.
- [ ] `pnpm db:setup:mysql` has been applied to the production database.
- [ ] `pnpm db:migrations:check` reports **0 pending, 0 drifted**.
- [ ] The reference registry contains only real locations, tanks, and devices —
      no demo or sample rows (`pnpm db:migrations:check` plus a registry review
      in the dashboard).
- [ ] Reading retention is a deliberate decision
      (`MONITORING_READING_RETENTION_DAYS`, `0` = keep forever).
- [ ] `SOLAR_TANK_STORAGE_DRIVER="mysql"` — memory storage is refused at boot in
      production.

## 3. Backups and Recovery

- [ ] `MYSQL_BACKUP_OUTPUT_DIR` points at a real backup location and
      `MYSQL_BACKUP_RETENTION_DAYS` is agreed (default 90).
- [ ] `MYSQL_BACKUP_ENCRYPTION_KEY` is set and stored in the operations password
      manager.
- [ ] `pnpm db:backup:mysql` produced a backup and a `.json` manifest.
- [ ] `pnpm db:verify:backup` passed on that backup.
- [ ] A restore drill has been executed into a scratch database
      (`pnpm db:restore:mysql --confirm <scratch>`) and recorded in
      `docs/disaster-recovery-runbook.md` § 6.
- [ ] The backup schedule is running on a machine that is not the database host.

## 4. Security

- [ ] `AUTH_SECRET` is at least 32 random characters and stored in the password
      manager.
- [ ] The initial administrator exists (`pnpm auth:create-admin`) and every
      operator account is verified, reviewed, and has an agreed role.
- [ ] `AUTH_REQUIRE_ADMIN_OTP="true"`, SMTP works, and an OTP was delivered to a
      mailbox you control.
- [ ] `AUTH_COOKIE_SECURE="true"` on the HTTPS domain.
- [ ] `AUTH_CAPTCHA_PROVIDER="turnstile"` with matching site and secret keys
      (or an explicit, recorded decision to keep it disabled).
- [ ] `SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK="false"`.
- [ ] `DEVICE_PACKAGE_ENCRYPTION_KEY` is set and stored in the password manager.
- [ ] Every device has its own key; no device uses a demo key or
      `local-development-key`.
- [ ] `INGEST_SIGNATURE_MODE` is `required`, or is `optional`/`off` with a dated
      migration plan recorded in the sign-off table.
- [ ] Location scopes are assigned and `AUTH_ENFORCE_SITE_SCOPES="true"` (or an
      explicit decision to keep enforcement off is recorded).
- [ ] `AUTH_ALLOWED_ORIGINS` lists any additional trusted origin, or is empty.
- [ ] Per-device keys were rotated at least once on the production database
      (proves the rotation flow works before it is needed in an incident).

## 5. Observability and Alerting

- [ ] `OPS_CRON_SECRET` is set and Vercel Cron (or the equivalent scheduler) is
      registered for `/api/cron/ops?tasks=alerts,housekeeping`.
- [ ] A manual evaluation succeeds from the alert centre and writes a job run.
- [ ] `OPS_METRICS_TOKEN` is set and the monitoring system scrapes
      `GET /api/metrics` successfully.
- [ ] `READINESS_CHECK_TOKEN` is set and the monitoring system polls
      `GET /api/ready`; a failing check is known to alert someone.
- [ ] `ERROR_TRACKING_WEBHOOK_URL` is configured, or structured logs are shipped
      to a log service with retention and search.
- [ ] Alert notifications reach Telegram and e-mail; a test alert was delivered
      to the on-call channel.
- [ ] Alert thresholds (`OPS_NEVER_REPORTED_HOURS`, escalation, re-notify,
      rejection spike) were reviewed against observed pilot data.
- [ ] "Device offline", "fuel critical", and "scheduler failure" each have a
      named owner in the escalation table of `docs/operational-runbook.md`.

## 6. Devices and Field

- [ ] Each of the 5 devices has a registered site, tank, and hardware profile.
- [ ] Each device reports inside its expected interval and appears `online`.
- [ ] Tank capacity, sensor mount height, and thresholds were confirmed against
      the physical tank and agreed with the site operator.
- [ ] A calibration check was performed (sensor reading versus a physical dip)
      and the result is recorded per tank, following
      `docs/calibration-guide.md`.
- [ ] Firmware for every field device is built from the registered template and
      the decision in `docs/decision-log.md` (TLS validation) has been applied.
- [ ] A refuelling event was observed end to end (reading change, alert clear).

## 7. Operations Readiness

- [ ] Operators were trained on the dashboard, the alert centre, and device
      onboarding (`docs/ftm-user-manual.html`).
- [ ] `docs/operational-runbook.md` is accepted as the daily procedure; the
      routine schedule has an owner.
- [ ] Escalation names and contact details are current.
- [ ] The incident procedure in `docs/incident-response.md` has been exercised
      in a tabletop review.
- [ ] Claim discipline is understood: the dashboard is an aid, not a substitute
      for field inspection (`docs/safety-and-limitations.md`).

## 8. Perimeter and Platform

- [ ] HTTPS is enforced and the HTTP endpoint redirects.
- [ ] Security headers are present in production responses (CSP, HSTS,
      `X-Frame-Options`/frame-ancestors, referrer policy).
- [ ] Platform-level protections are configured as agreed (WAF/bot rules, IP
      allowlists, rate limits) — see `docs/system-boundaries.md`.
- [ ] Serverless function region is close to the database region.
- [ ] Environment variables in the hosting platform match this checklist, and no
      secret is stored in Git.

## 9. Sign-Off

| Area | Owner | Date | Decision | Notes |
|---|---|---|---|---|
| Code and release | | | | |
| Database | | | | |
| Backups and recovery | | | | |
| Security | | | | |
| Observability and alerting | | | | |
| Devices and field | | | | |
| Operations readiness | | | | |
| Perimeter and platform | | | | |

Final decision: **go / no-go** — recorded by:

```text
Name:
Role:
Date:
Waivers (with reason and expiry):
```
