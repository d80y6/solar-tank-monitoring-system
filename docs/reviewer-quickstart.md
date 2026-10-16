# Reviewer Quickstart

This document is for people who want to check the repo quickly.

## 1. Clone and Install

Make sure you have:

- Git;
- Node.js 20 or newer;
- pnpm 9.x.

If `pnpm` is not available yet:

```powershell
corepack enable
corepack prepare pnpm@9.15.3 --activate
```

```powershell
git clone https://github.com/Zendin110206/solar-tank-monitoring-system.git
cd solar-tank-monitoring-system
pnpm install
```

## 2. Run the Application

```powershell
pnpm dev
```

Open:

```text
http://localhost:3000
```

Pages you can view:

| URL | Content |
|---|---|
| `/` | landing page |
| `/login` | user sign-in |
| `/register` | new user access request |
| `/forgot-password` | password reset request |
| `/dashboard` | operational tank monitoring |
| `/dashboard/operations/tanks/tank-tph-main` | sample tank operational detail |
| `/dashboard/detail` | admin-only technical analysis |
| `/dashboard/admin/users` | admin-only user management |
| `/dashboard/admin/audit` | admin-only auth security audit |

## 3. Check the Application and Storage

Check the application is alive:

```powershell
curl.exe http://localhost:3000/api/health
```

Check active storage readiness:

```powershell
curl.exe http://localhost:3000/api/ready
```

If the default `memory` mode is used, `/api/ready` still succeeds but its status is `degraded` because memory data is not permanent. If `mysql` mode is used and the database is not ready, `/api/ready` returns HTTP `503`.

## 4. Run the Checks

```powershell
pnpm check
```

This command runs:

```text
typecheck -> lint -> test -> build
```

## 5. Try the Memory Mode Simulator

Make sure the dev server is still running.

In another terminal:

```powershell
pnpm simulate:device --device demo-tph-01 --start-percent 73 --once
```

Expected output:

```text
[simulator] delivered demo-tph-01 | 73% | 3650 L | distance 40.5 cm | HTTP 201
```

The simulator automatically uses the demo key matching the device. To fill in the key manually:

```powershell
pnpm simulate:device --device demo-tph-01 --key demo-tph-key --once
```

## 6. Check the Detail API

```powershell
curl.exe http://localhost:3000/api/tanks/tank-tph-main
```

Look for the values:

```text
fillPercent = 73
volumeLiter = 3650
```

## 7. Check History

```powershell
curl.exe "http://localhost:3000/api/tanks/tank-tph-main/readings?range=24h"
```

History should grow after the simulator sends data.

## 8. What Reviewers Need to Understand

- The dashboard/detail UI reads the same active storage as the API endpoints.
- `/api/health` only checks that the application is alive.
- `/api/ready` checks whether active storage is usable.
- MySQL mode reads the site, tank, device, and key hash registry from the database.
- The pilot registry can be prepared via `pnpm pilot:registry`, but real files must stay local and never enter Git.
- Real-format smoke payloads can be sent via `pnpm pilot:smoke`.
- Sign-in/register already connect to the auth database once auth migrations and the initial admin are prepared.
- New user access requests enter pending status and must be reviewed by an admin.
- Public forms can be protected by Cloudflare Turnstile if `AUTH_CAPTCHA_PROVIDER="turnstile"` and the keys are complete.
- Admin OTP, email verification, and password reset require SMTP or an allowed non-production dev log.
- The API can already receive simulator data.
- When the server first starts, memory mode prepares demo data with relative timestamps so the dashboard does not immediately look stale.
- The memory store is lost when the server restarts.
- MySQL mode is available for persistent reading practice, but that alone does not mean production-ready.
- Per-device keys are validated using hashes in the development sample data.
- Real data may only be used through local/env files that are not committed.
- The repo must not contain credentials or internal data.

## 9. Try MySQL Mode If a Database Is Available

The default mode remains `memory`. If the reviewer has a local or cloud MySQL database for the demo, fill in `.env.local`:

```env
SOLAR_TANK_STORAGE_DRIVER="mysql"
MYSQL_DATABASE_URL="mysql://user:password@host:port/database"
MYSQL_CONNECTION_LIMIT="2"
MYSQL_SSL_MODE="disabled"
SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK="false"
AUTH_SECRET="replace-with-secret-minimum-32-characters"
AUTH_REQUIRE_ADMIN_OTP="true"
AUTH_ENABLE_REGISTER="true"
AUTH_ALLOW_PASSWORD_RESET="true"
AUTH_CAPTCHA_PROVIDER="disabled"
```

For cloud MySQL that requires TLS, use:

```env
MYSQL_SSL_MODE="required"
```

If the provider supplies a CA certificate, fill in `MYSQL_SSL_CA`.

Run the migrations and seed:

```powershell
pnpm db:setup:mysql
pnpm auth:create-admin
```

If the database was created before the device request operational fields were available, also run these migrations so the old schema stays compatible:

```powershell
pnpm db:migrate:device-provisioning
pnpm db:migrate:device-request-fields
pnpm db:migrate:reading-rollup
```

After changing `.env.local`, restart `pnpm dev`, then check:

```powershell
curl.exe http://localhost:3000/api/ready
```

## 10. Try the Pilot Flow If Data Is Approved

This section is only for reviewers who actually have pilot data they may use. Do not use real coordinates, keys, or connection strings in files that will be committed.

```powershell
pnpm db:migrate:mysql
pnpm pilot:hash-key
Copy-Item config/pilot-registry.example.json config/pilot-registry.local.json
```

Then edit `config/pilot-registry.local.json`:

- fill in the 5 approved STOs;
- change `coordinateStatus` to `approved`;
- fill in the device key hash from `pnpm pilot:hash-key`;
- make sure capacity and tank dimensions match the data in use.

Validate without writing to the database:

```powershell
pnpm pilot:registry -- --dry-run
```

If it succeeds:

```powershell
pnpm pilot:registry
```

Smoke test:

```powershell
$env:PILOT_API_BASE_URL="http://localhost:3000"
$env:PILOT_DEVICE_ID="pilot-tph-01"
$env:PILOT_DEVICE_KEY="real-device-key"
pnpm pilot:smoke
```

## 11. If There Is an Error

If `pnpm simulate:device` fails:

- make sure `pnpm dev` is running;
- make sure port `3000` is correct;
- make sure the key matches the device, e.g. `demo-tph-key` for `demo-tph-01`;
- if using the global fallback, make sure `SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK` is not set to `false`;
- try `pnpm simulate:device --help`.

If the dashboard shows a monitoring data read error:

- open `http://localhost:3000/api/ready`;
- if `/api/ready` returns HTTP `503`, check `MYSQL_DATABASE_URL`, database status, SSL/allowlist at the provider, and network connectivity;
- if you just changed `.env.local`, stop then restart `pnpm dev`.

If `pnpm check` fails:

- read the first error;
- do not push before fixing it;
- run it again after the fix.
