# Deployment

This document explains the active deployment, how to set up other environments, and its operational claim limits.

## Current Status

The application is currently live on Vercel and uses Aiven MySQL for the operational pilot and team review. The 14 July 2026 check showed the landing page and `/api/health` responding with HTTP 200, while the database registry contains 3 sites, 3 tanks, and 3 devices. That deployment must not be considered production-hardened until backup recovery, device calibration, observability, alerting, per-location access restriction, and rollback have finished testing.

Safe to do now:

- run the application locally;
- run the local simulator;
- test the local API;
- check the application is alive via `/api/health`;
- check active storage readiness via `/api/ready` using an admin session or the operational token in production;
- test memory store mode;
- prepare MySQL migration and seed for monitoring registry and persistent storage practice;
- run MySQL setup via `pnpm db:setup:mysql`;
- create pilot device key hashes via `pnpm pilot:hash-key`;
- validate and apply the local pilot registry via `pnpm pilot:registry`;
- send real-format smoke payloads via `pnpm pilot:smoke`;
- create manual MySQL backups via `pnpm db:backup:mysql`;
- run auth migrations via `pnpm db:migrate:auth` and `pnpm db:migrate:auth-recovery`;
- create the initial admin via `pnpm auth:create-admin`;
- test sign-in, access requests, email verification, password reset, and admin pages when auth env is complete;
- run `pnpm check`;
- build the production build locally.

Not final yet:

- encrypted backup with a tested restore SOP;
- final production domain;
- final production HTTPS on the chosen server;
- final production auth configuration, including SMTP, CAPTCHA, session secret, and secure cookies;
- backup;
- server monitoring;
- calibration and safety approval of physical devices per location.

For the latest operational status, also read:

```text
docs/current-operational-truth.md
docs/database-backup.md
```

## Running Locally

```powershell
pnpm install
pnpm dev
```

Open:

```text
http://localhost:3000
```

Check the application is alive:

```powershell
curl.exe http://localhost:3000/api/health
```

Check active storage:

```powershell
curl.exe http://localhost:3000/api/ready
```

Important difference:

```text
/api/health only proves the application is alive.
/api/ready proves active storage is ready and carries operational details. In production,
access to this endpoint is limited to signed-in admins or requests with the
x-solar-tank-readiness-token header.
```

If `/api/health` succeeds but `/api/ready` fails, the problem is usually in the database, connection string, SSL, allowlist, or network.

Local build:

```powershell
pnpm build
pnpm start
```

To try local or cloud MySQL storage, fill `.env.local` with `MYSQL_DATABASE_URL`, run `pnpm db:setup:mysql`, then set `SOLAR_TANK_STORAGE_DRIVER="mysql"`.

For an existing active database, run `pnpm db:migrate:auth-telegram` before deploying the new Telegram commands. This migration adds the one-Telegram-chat-per-FTM-account invariant and is checked by `/api/ready`. If duplicate bindings exist from an older version, the most recently verified binding is kept and the release of old bindings is recorded in the audit log.

After changing `.env.local`, restart `pnpm dev`. Environment changes are not always picked up just by pressing the dashboard refresh button.

## Pilot Deployment: Vercel + Aiven MySQL

The flow actively used now:

```text
Real device or smoke test
  -> Vercel URL
  -> /api/ingest
  -> Cloud MySQL
  -> dashboard/detail
```

Environment on Vercel must be filled through the Vercel dashboard, not Git files:

```env
SOLAR_TANK_STORAGE_DRIVER="mysql"
SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK="false"
MYSQL_DATABASE_URL="mysql://..."
MYSQL_CONNECTION_LIMIT="1"
MYSQL_SSL_MODE="required"
AUTH_SECRET="..."
AUTH_REQUIRE_ADMIN_OTP="true"
AUTH_ENABLE_REGISTER="true"
AUTH_ALLOW_PASSWORD_RESET="true"
AUTH_REQUIRE_EMAIL_VERIFICATION_FOR_APPROVAL="true"
AUTH_COOKIE_SECURE="true"
APP_BASE_URL="https://solar-tank-monitoring-system.vercel.app"
DEVICE_PACKAGE_ENCRYPTION_KEY="..."
DEVICE_PACKAGE_DOWNLOAD_TTL_DAYS="7"
DEVICE_PACKAGE_MAX_DOWNLOADS="3"
AUTH_CAPTCHA_PROVIDER="turnstile"
NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY="..."
AUTH_CAPTCHA_SECRET_KEY="..."
SMTP_HOST="..."
SMTP_PORT="587"
SMTP_USER="..."
SMTP_PASS="..."
SMTP_FROM="FTM <noreply@example.com>"
SMTP_SECURE="false"
```

If the provider supplies a CA certificate, fill in `MYSQL_SSL_CA` in the Vercel environment. Make sure `APP_BASE_URL` uses the correct application domain. Production must not use localhost because this URL is used for email verification and password reset links. `AUTH_CAPTCHA_PROVIDER` only accepts `disabled` or `turnstile`; a typo makes readiness fail so the problem is visible before users are affected.

`DEVICE_PACKAGE_ENCRYPTION_KEY` is required in production because firmware packages are stored encrypted. Create the value once, store it in a password manager, then use the same value while old firmware packages still need to be readable. Example key generation from the terminal:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Pilot steps:

```powershell
pnpm db:setup:mysql
pnpm pilot:hash-key
Copy-Item config/pilot-registry.example.json config/pilot-registry.local.json
# edit config/pilot-registry.local.json until coordinates and device hashes are real/approved
pnpm pilot:registry -- --dry-run
pnpm pilot:registry
$env:PILOT_API_BASE_URL="https://solar-tank-monitoring-system.vercel.app"
$env:PILOT_DEVICE_ID="pilot-tph-01"
$env:PILOT_DEVICE_KEY="real-device-key"
pnpm pilot:smoke
```

If the production database already exists and must not be re-seeded, do not use `pnpm db:setup:mysql`. Run the migrations one by one, then apply the approved registry:

```powershell
pnpm db:migrate:mysql
pnpm db:migrate:auth
pnpm db:migrate:auth-recovery
pnpm db:migrate:device-provisioning
pnpm db:migrate:device-request-fields
pnpm db:migrate:reading-rollup
pnpm db:migrate:auth-telegram
pnpm db:migrate:site-taxonomy
```

Notes:

- `config/pilot-registry.local.json` must not be committed;
- `config/pilot-registry.example.json` is only a safe template and deliberately does not use final coordinates/hashes;
- raw device keys must not enter the repo;
- the global key fallback must be `false` for the pilot;
- if `/api/ready` fails, do not continue device testing before storage is fixed;
- run `pnpm db:backup:mysql` before migrations on the operational database;
- the `mysql-reading-rollup` readiness check must pass before the rollup writer is considered ready;
- the `mysql-location-taxonomy` readiness check must pass so regional and territory labels are safely read by the application;
- after changing Vercel env, redeploy.

## Separate Development/Demo Deployment Option

For demos without sensitive data, the application can be pointed at a platform such as Vercel.

Requirements:

- only public-safe sample data;
- no real credentials;
- no real payloads;
- no sensitive locations;
- env vars filled through the platform dashboard, not Git files.

Advantages:

- easy for reviewers to open;
- fast for visual validation;
- suitable for early demos.

Limits:

- not automatically suitable for field devices;
- memory store is unstable on serverless;
- a database is needed for history to persist.
- `/api/ready` must succeed before the demo URL is considered ready for reviewers. Do not open this endpoint as a public URL without an admin session or readiness token.

## Environment Variables

Do not upload `.env.local`.

Use `.env.example` as the reference for variable names.

Current key variables:

```text
NEXT_PUBLIC_APP_NAME
NEXT_PUBLIC_APP_ENV
NEXT_PUBLIC_MONITORING_REFRESH_INTERVAL_MS
SOLAR_TANK_STORAGE_DRIVER
SOLAR_TANK_LOCAL_DEVICE_KEY
SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK
SOLAR_TANK_DEVICE_KEY
MYSQL_DATABASE_URL
MYSQL_CONNECTION_LIMIT
MYSQL_SSL_MODE
MYSQL_SSL_CA
DEVICE_PACKAGE_ENCRYPTION_KEY
DEVICE_PACKAGE_DOWNLOAD_TTL_DAYS
DEVICE_PACKAGE_MAX_DOWNLOADS
AUTH_SESSION_COOKIE_NAME
AUTH_SECRET
AUTH_REQUIRE_ADMIN_OTP
AUTH_ENABLE_REGISTER
AUTH_ALLOW_PASSWORD_RESET
AUTH_REQUIRE_EMAIL_VERIFICATION_FOR_APPROVAL
AUTH_COOKIE_SECURE
APP_BASE_URL
AUTH_BOOTSTRAP_ADMIN_EMAIL
AUTH_BOOTSTRAP_ADMIN_USERNAME
AUTH_BOOTSTRAP_ADMIN_FULL_NAME
AUTH_BOOTSTRAP_ADMIN_PASSWORD
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
SMTP_FROM
SMTP_SECURE
AUTH_CAPTCHA_PROVIDER
NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY
AUTH_CAPTCHA_SECRET_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_BOT_USERNAME
```

## Pre-Production Checklist

- Database is available.
- Secrets are not in Git.
- Monitoring and auth migrations have run.
- The initial admin is created.
- SMTP is tested for admin OTP, email verification, and password reset.
- Turnstile is active for public forms and the production domain is registered in Cloudflare.
- Device API keys do not use development/sample keys.
- Global device key fallback is disabled.
- HTTPS is active.
- The ingest endpoint has rate limiting.
- User sign-in, roles, admin approval, and account deactivation are tested.
- Database backup is prepared.
- Site, tank, device, and key registry come from the managed database.
- Volume formulas are calibrated.
- Physical devices are tested safe.
- Displayed data is approved.
- `/api/health` returns HTTP 200.
- `/api/ready` returns HTTP 200 for production/pilot storage.

## Important Notes

The memory store is currently for development only.

If the server restarts, simulator data is lost.

Deployments that need history must use database storage. The MySQL foundation is available for the monitoring registry, readings, and auth. Production still requires SMTP, Turnstile, HTTPS, backup/restore, ingest rate limiting, device key rotation, server monitoring, and operational procedures. Final deployment choices are postponed until the next team decision.
