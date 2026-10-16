# System Architecture

This document explains the FTM (Fuel Tank Management) architecture in easy-to-follow language.

## Summary

This application is designed as a web-based monitoring system.

The simple flow:

```text
Device or simulator
  -> ingest API
  -> data normalization
  -> active storage
  -> read API
  -> web dashboard
```

The dashboard does not read sensors directly. The device or simulator sends data to the server.

## Current Components

| Component | Location | Status |
|---|---|---|
| Landing page | `src/app/page.tsx` | Present |
| Sign in | `src/app/login/page.tsx` and `src/app/api/auth/login/route.ts` | Present, creates a database session |
| Access request | `src/app/register/page.tsx` and `src/app/api/auth/register-request/route.ts` | Present, pending admin approval and can be protected by Turnstile |
| Forgot/reset password | `src/app/forgot-password`, `src/app/reset-password`, and the auth password APIs | Present, uses one-time tokens |
| User management | `src/app/dashboard/admin/users/page.tsx` | Present, admin only |
| Auth security audit | `src/app/dashboard/admin/audit/page.tsx` | Present, admin only |
| Account security | `src/app/dashboard/account/security/page.tsx` | Present, active session, change password, and Telegram binding |
| Operational monitoring | `src/app/dashboard/page.tsx` | Present, reads active storage |
| Tank detail | `src/app/dashboard/operations/tanks/[tankId]/page.tsx` | Present, reads active storage |
| Health API | `src/app/api/health/route.ts` | Present, checks the application is alive |
| Readiness API | `src/app/api/ready/route.ts` | Present, checks active storage |
| Overview API | `src/app/api/dashboard/overview/route.ts` | Present |
| Tank detail API | `src/app/api/tanks/[tankId]/route.ts` | Present |
| Tank history API | `src/app/api/tanks/[tankId]/readings/route.ts` | Present |
| Ingest API | `src/app/api/ingest/route.ts` | Present |
| Memory store | `src/features/monitoring/lib/telemetry-store.ts` | Present for local development |
| MySQL reading repository | `src/features/monitoring/lib/mysql-reading-repository.ts` | Present, optional |
| MySQL reference repository | `src/features/monitoring/lib/mysql-reference-repository.ts` | Present, site/tank/device registry |
| Storage facade | `src/features/monitoring/lib/monitoring-storage.ts` | Present |
| Monitoring registry | `src/features/monitoring/lib/monitoring-registry.ts` | Present, selects memory or MySQL registry |
| Device key validation | `src/features/monitoring/lib/device-key.ts` | Present |
| Payload config review | `src/features/monitoring/lib/reading-tank-config.ts` | Present, compares payload config vs registry |
| UI auto-refresh | `src/features/monitoring/components/live-refresh-control.tsx` | Present |
| Real-time clock | `src/features/monitoring/components/live-clock.tsx` | Present |
| Simulator | `scripts/simulate-device.mjs` | Present |
| Pilot registry apply | `scripts/apply-pilot-registry.mjs` | Present, reads a local Git-untracked file |
| Pilot smoke ingest | `scripts/smoke-pilot-ingest.mjs` | Present, sends real-format payloads |
| Operational map | `src/features/monitoring/components/operational-map.tsx` | Present, shows markers from registry latitude/longitude |
| Unit tests | `src/features/monitoring/tests` | Present |
| Auth unit tests | `src/features/auth/tests` | Present |

## Frontend and Backend Boundaries

The frontend is responsible for:

- displaying pages;
- displaying sign-in, access request, password reset, and account security forms;
- displaying status and tidy numbers;
- providing an easy reading experience;
- not computing important operational matters in scattered places.

The backend/APIs are responsible for:

- signaling the application is alive through `/api/health`;
- signaling storage readiness through `/api/ready`;
- accepting payloads;
- validating the device;
- validating the key;
- normalizing the payload;
- reading tank configuration from the payload as a snapshot;
- comparing the payload snapshot with the official registry;
- providing a review status when payload configuration and registry differ;
- providing ready-to-read data for the dashboard;
- reading the site, tank, device, and key hash registry from memory or MySQL depending on storage mode;
- handling authentication, sessions, admin/user roles, admin OTP, password reset, email verification, access requests, public form CAPTCHA, and auth audit;
- storing reading data to active storage.

## Ingest Flow

When the simulator runs:

```powershell
pnpm simulate:device --once
```

what happens:

```text
1. The simulator creates a payload.
2. The simulator POSTs to /api/ingest.
3. The API reads the X-Device-Id header.
4. The API reads X-Api-Key.
5. The API looks up the device in the active registry, memory or MySQL.
6. The payload is normalized.
7. The reading is stored to active storage. Memory appends a regular reading; MySQL runs one transaction to UPSERT the live snapshot per device and the 5-minute history bucket.
8. An HTTP 201 response is sent.
```

## Read Flow

Read endpoints fetch data from active storage:

```text
GET /api/health
GET /api/ready
GET /api/dashboard/overview
GET /api/tanks/[tankId]
GET /api/tanks/[tankId]/readings
```

Overview and detail use the same freshness rules. The repository fetches
the `monitoring_latest_readings` snapshot and the latest history
candidates, then picks the latest `receivedAt` per tank. This history
fallback preserves compatibility while old deployments still write raw.
Once the new writer is active, the snapshot becomes the primary live
source and `monitoring_readings` becomes the history aggregate.

`GET /api/health` does not touch the database. It only ensures the application is alive.

`GET /api/ready` checks active storage. If MySQL mode is active and the database connection fails, this endpoint returns HTTP 503 so deployment problems are not hidden behind the dashboard.

When the dev server restarts, the memory store returns to the initial sample data with times shifted relative to the server start time. This keeps the early demo readable without using real data. If MySQL mode is active, the site/tank/device registry is read from the database and readings are stored in the database as long as the database remains available.

## Sample Data vs Real Data

Sample data is used for:

- building the UI;
- testing status;
- testing APIs;
- testing the simulator;
- avoiding the use of sensitive data.

Pilot tooling is available for using approved real data. Real data must not be placed in the repo. The real registry must be stored in a local file such as:

```text
config/pilot-registry.local.json
```

That local file is Git-ignored.

Before real data enters, validation is needed:

- permission to use the data;
- endpoint security;
- tank dimensions;
- sensor position;
- final payload format;
- deployment target.

## Initial 5-STO Rollout Flow

The verified condition as of 13–14 July 2026 is 3 sites, 3 tanks, and
3 registered devices. This section describes expansion toward the initial
5-STO target, not a claim that five locations are already active.

The prepared pilot flow:

```text
config/pilot-registry.local.json
  -> pnpm pilot:registry
  -> MySQL registry
  -> real device or pnpm pilot:smoke
  -> POST /api/ingest
  -> MySQL readings
  -> dashboard/detail
```

The pilot registry must use:

- at least 5 sites;
- approved coordinates;
- device key hashes, not raw keys;
- checked tank dimensions;
- global key fallback disabled.

The dashboard reads `latitude` and `longitude` from the site registry for map markers. Device payloads may carry sensor data and tank configuration, but STO location stays managed from the registry because current devices do not use GPS.

## Next Architecture Target

Current monitoring foundation state:

```text
UI dashboard/detail
  -> storage facade
  -> memory or MySQL monitoring registry
  -> memory store or MySQL reading repository
  -> local pilot registry can be applied to MySQL
  -> real-format smoke payloads can be sent to the ingest API
  -> coordinate map reads registry latitude/longitude
  -> changes when device/smoke sends data and the page is refreshed
```

After the auth foundation is available, remaining production hardening:

```text
real SMTP, real Turnstile, HTTPS, backup/restore, ingest rate limit, device key rotation
  -> validated before production
```

Current auth state:

```text
sign up/register/reset password
  -> auth API
  -> payload validation, rate limit, public form CAPTCHA when active
  -> MySQL auth tables
  -> httpOnly session cookie
  -> user/admin pages restricted by role
```

Remaining hardening before production is the production environment, real SMTP, real Turnstile, backup/restore, final HTTPS, ingest rate limiting, device key rotation, and operational procedures.

## Design Principles

- Use the API as the boundary between device and dashboard.
- Keep formulas in domain modules, not in UI components.
- Do not store credentials in the repo.
- Do not claim production-ready before deployment and calibration are validated.
- Make documentation clear enough for new contributors to continue.
- Do not turn the entire dashboard into Client Components; use small clients only for interactions such as refresh and the clock.
