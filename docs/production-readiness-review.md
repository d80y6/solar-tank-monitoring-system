# Production Readiness Review

Review date: 2026-10-16
Reviewed revision: `ac08909` (`main`, working branch `arena/933f90cc-solar-tank-monitoring-system`)

This document is the result of a deep review of the repository against its
own production-readiness claims (`docs/current-operational-truth.md`,
`docs/safety-and-limitations.md`, `docs/roadmap.md`,
`docs/system-boundaries.md`). It lists what is already production grade,
what is missing, and the order in which the gaps are being closed.

## 1. Verified Baseline

Everything below was executed in a clean checkout during this review.

| Check | Command | Result |
|---|---|---|
| Dependency install | `pnpm install --frozen-lockfile` | OK (lockfile consistent) |
| Typecheck | `pnpm typecheck` | OK (strict mode) |
| Lint | `pnpm lint` | OK |
| Unit tests | `pnpm test` | OK — 30 files, 160 tests |
| Production build | `pnpm build` | OK |

Codebase size: ~40k lines of TypeScript/MJS plus SQL, docs, and firmware.

### What is already production grade

- **Domain separation.** Volume/status/runtime/config formulas live in
  `src/features/monitoring/lib`, not in components, and are unit tested.
- **Ingest authentication.** Per-device key hashes (`sha256:`), timing-safe
  comparison, optional global fallback that readiness force-disables in
  production (`device-key.ts`, `deployment-probes.ts`).
- **Auth.** Argon2id hashing, `httpOnly` + `SameSite=Lax` cookies, session
  revocation, OTP e-mail for admin sign-in, password reset, e-mail
  verification, audit log, rate limiting, HMAC CSRF tokens for admin actions.
- **Reading storage.** Live snapshot + 5-minute rollup written in one
  transaction, unique per device/resolution/bucket, so retries are idempotent.
- **Migrations.** Sequential, re-runnable, and idempotent; each migration is
  independently applied through `scripts/apply-mysql-schema.mjs`.
- **Readiness probes.** `/api/health` (liveness) and `/api/ready` (deep,
  admin- or token-protected) with per-subsystem checks and actionable
  messages.
- **Release gates.** CI runs `pnpm check` (typecheck → lint → test → build)
  on every push and pull request.
- **Secret hygiene.** No credentials, real coordinates, or production values
  are committed; `.env*` is ignored except `.env.example`; local registry
  files are Git-ignored.

## 2. Findings

Severity: **P0** blocks production operations · **P1** required before
declaring production ready · **P2** important, can follow shortly after.

### 2.1 Observability — P0

| # | Finding | Evidence |
|---|---|---|
| O1 | No structured logging. Only two ad-hoc `console.info` calls for dev e-mail dumps; there is no application log stream, no log levels, no request correlation. | `auth-email.ts:142`, `device-package-email.ts:150`, `grep -c console` = 2 |
| O2 | No metrics surface. Ingest volume, ingest failures, latency, and auth failures are invisible to any monitoring system. | no `/api/metrics` route |
| O3 | No request correlation ID. A failing ingest cannot be tied to a log line, an audit row, or a support report. | `src/proxy.ts` sets only pathname/search headers |
| O4 | No error-tracking hook. Server-side exceptions (ingest, MySQL, Telegram, SMTP) are swallowed and returned as generic messages with no durable record. | `catch {}` blocks in `ingest-telemetry.ts`, `monitoring-registry.ts` |

### 2.2 Alerting and scheduled operations — P0

| # | Finding | Evidence |
|---|---|---|
| A1 | No operational alerting. Device offline, delayed telemetry, critical fuel level, and repeated invalid device keys never notify anyone. Operators must watch the dashboard manually. | no alert module or table |
| A2 | No scheduler. There is no cron/worker entry point, so nothing can evaluate rules or run housekeeping on a schedule. | no `/api/cron/*`, `vercel.json` has no `crons` |
| A3 | Ingest audit table is dead code. `monitoring_ingest_events` is created by migration 004 and deleted by maintenance, but **nothing ever writes to it** — there is no record of rejected device requests, which is exactly the data needed to detect a mis-keyed or cloned device. | migration 004:225; only readers are `mysql-maintenance-repository.ts:412,638` |
| A4 | No data-retention or housekeeping job. `monitoring_readings`, `auth_audit_events`, `auth_rate_limits`, expired OTP/reset/bind tokens, and `monitoring_ingest_events` grow without bound. | no retention code outside manual admin cleanup |

### 2.3 Backup, restore, and recovery — P0

| # | Finding | Evidence |
|---|---|---|
| B1 | Backups are unencrypted. `mysqldump` output (which contains password hashes, device key hashes, and audit rows) is written in plaintext to disk. | `scripts/backup-mysql.mjs` |
| B2 | No restore procedure exists in the repository. There is no `restore` script, no restore drill, and no verification that a backup is usable — the exact gap the operational truth document admits. | no `scripts/restore-*.mjs` |
| B3 | No integrity metadata. A backup cannot be verified (checksum/manifest) after being copied to cloud storage. | `backup-mysql.mjs` writes only the `.sql` file |
| B4 | No migration ledger. Nothing records which migration was applied when, so "is this environment migrated?" is answered only by the readiness probe's schema spot-checks. | `scripts/apply-mysql-schema.mjs` has no ledger table |

### 2.4 Device security and lifecycle — P1

| # | Finding | Evidence |
|---|---|---|
| D1 | Device keys cannot be rotated. If a key leaks, the only remediation is direct SQL plus firmware rewrite; there is no rotation flow, no grace period, and no history. | roadmap Phase 7 "not finished"; no rotation columns/UI |
| D2 | No replay protection on `/api/ingest`. A captured payload with a valid key can be replayed indefinitely, and the rollup will accept repeated samples into the same bucket. | `ingest-telemetry.ts` uses only header identity + key |
| D3 | Rate limiting silently disables itself without MySQL. In memory mode (and during a database outage) `checkRateLimit` is never called at all — an outage turns into an open endpoint. | `src/app/api/ingest/route.ts` `checkIngestRateLimit` early-returns when the driver is not `mysql` |

### 2.5 Access control — P1

| # | Finding | Evidence |
|---|---|---|
| C1 | Only two roles (`admin`, `user`) and no location scoping: every signed-in account can read every site, tank, device, and reading in the registry, including CSV export. Per-location restriction is listed as unfinished by the project's own documents. | `types.ts` `AuthRole`; `requireApiUser` checks role only |
| C2 | Device-package download tokens are the only unauthenticated read path, by design, but there is no anomaly alert when an expired/revoked token is used. | `api/device-packages/download/route.ts` |

### 2.6 Application security posture — P1

| # | Finding | Evidence |
|---|---|---|
| S1 | No Content-Security-Policy and no HSTS. `next.config.ts` sets only four headers; responses are not restricted to a script origin, and browsers are not told to stay on HTTPS. | `next.config.ts:5-30` |
| S2 | No request-body size limit on `/api/ingest` before `request.json()`; a large body is parsed into memory. JSON parser depth/width is likewise unbounded. | `api/ingest/route.ts` |
| S3 | `NextResponse.json` CSRF/origin checks are absent on cookie-authenticated POST routes; protection currently relies on `SameSite=Lax` plus explicit CSRF tokens only for admin actions. | `auth-csrf.ts` used by admin actions only |

### 2.7 Operability and administration — P1/P2

| # | Finding | Evidence |
|---|---|---|
| P1 | No CRUD UI for hardware profiles and firmware templates, so onboarding a new board family requires SQL. | roadmap "Not finished" |
| P2 | Audit log has no filtering or export; incident review means reading a page of rows. | `dashboard/admin/audit/page.tsx` |
| P3 | No frontend error boundary telemetry: `error.tsx` files exist but nothing records the error outside the browser. | `dashboard/error.tsx`, `tanks/[tankId]/error.tsx` |
| P4 | No documented upgrade/rollback procedure, incident runbook, disaster-recovery drill, or go-live checklist. | docs gap |

### 2.8 Consistency and hygiene — P2

| # | Finding | Evidence |
|---|---|---|
| H1 | Readiness does not report application build identity (version/commit), so "which build is live?" cannot be answered from the deployment. | `deployment-probes.ts` |
| H2 | No integration test against a real MySQL instance; repository SQL is only covered by unit tests with mocked pools. | `src/features/monitoring/tests/*` |
| H3 | Memory storage mode is still selectable in production-like environments and only degrades readiness rather than being refused. | `getMonitoringStorageDriver()` |

## 3. Remediation Plan

The plan below is the implementation order used in this repository. Each
wave is expected to leave `pnpm check` green and to add tests for new logic.

### Wave 1 — Observability foundation (O1–O4, H1)

- structured JSON logger with levels, redaction, and field limits;
- request-scoped correlation IDs propagated from the edge proxy;
- in-process metric registry plus a token-protected Prometheus endpoint;
- error-tracking sink that records server-side failures;
- build/version identity in health and readiness payloads.

### Wave 2 — Alerting and scheduled operations (A1–A4)

- alert tables and deduplicating rule engine (offline, delayed, critical
  level, config mismatch, repeated ingest rejection, storage failure);
- Telegram/e-mail notification with escalation and resolution notices;
- admin alert centre with acknowledge/resolve;
- secret-protected cron endpoint (`/api/cron/ops`) that evaluates rules and
  runs retention housekeeping; registered in `vercel.json`;
- ingest-event audit rows actually written on accept **and** reject.

### Wave 3 — Device security (D1–D3)

- device key rotation with history, grace period, and admin UI;
- ingest replay protection (timestamp window + nonce table) with metrics;
- rate limiting that works without MySQL and degrades safely during an
  outage.

### Wave 4 — Backup and disaster recovery (B1–B4)

- encrypted, checksummed backups with a manifest;
- restore script with safety guards and a verification mode;
- migration ledger table so environments can be diffed;
- backup/restore runbook and drill log.

### Wave 5 — Access control (C1, C2)

- location scope assignments per account and enforcement in pages, APIs,
  CSV export, and the alert stream;
- anomaly alerting for revoked/expired package tokens.

### Wave 6 — Administration and operability (P1–P4)

- hardware profile and firmware template CRUD;
- audit-log filtering, pagination, and CSV export;
- error boundary telemetry;
- upgrade/rollback, incident, and go-live documentation.

### Wave 7 — Assurance (H2, H3, S2)

- MySQL-backed integration tests in CI;
- production guardrails that refuse unsafe configuration at boot;
- request-body limits and stricter production defaults.

## 4. Implementation Status

Updated as each wave landed. "Verified" means the commands below were run in
this checkout and passed; a wave is only closed when `pnpm check` is green.

| Wave | Scope | State | Evidence |
|---|---|---|---|
| 1 | Observability (O1–O4, H1) | Implemented | `src/lib/{logger,metrics,error-tracker,build-info,request-context,memory-rate-limit,api-observability}.ts`, `GET /api/metrics`, unit tests |
| 2 | Alerting and scheduled ops (A1–A4) | Implemented | migration 010, `src/features/ops/**`, `/api/cron/ops`, `/dashboard/admin/alerts`, Vercel cron entry |
| 3 | Device security (D1–D2) | Implemented | migration 011, `ingest-signature.ts`, `mysql-device-key-repository.ts`, `/dashboard/admin/devices` |
| 4 | Backup and disaster recovery (B1–B4) | Implemented | `scripts/lib/backup-crypto.mjs`, `scripts/{backup,restore,verify}-mysql.mjs`, `schema_migrations` ledger, `pnpm db:migrations:check`, `docs/disaster-recovery-runbook.md` |
| 5 | Access control (C1) | Implemented | migration 012, `src/features/auth/lib/site-scope.ts`, `/dashboard/admin/access-scopes`, scoped dashboard/API/export |
| 6 | Administration and operability (P1–P4) | Implemented | firmware/hardware CRUD, `GET /api/admin/audit/export`, `client-error-reporter.ts`, `docs/{upgrade-and-rollback,incident-response,production-go-live-checklist}.md` |
| 7 | Assurance (H2, H3, S2) | Implemented | `instrumentation.ts` + `src/lib/production-guardrails.ts`, `src/lib/request-body.ts` on every JSON POST, `src/features/monitoring/tests/mysql-integration.test.ts` + `mysql-integration` job in `.github/workflows/ci.yml` |

Verification after Wave 7:

```text
pnpm typecheck   -> OK
pnpm lint        -> OK
pnpm test        -> OK (44 files, 293 tests; 10 MySQL integration tests run in CI)
pnpm build       -> OK
pnpm check       -> OK (typecheck -> lint -> test -> build)
```

The MySQL integration suite is skipped locally (`RUN_MYSQL_INTEGRATION_TESTS`
unset) and enabled in the `mysql-integration` CI job, which provisions MySQL
8.4, applies every migration and the demo seed, checks the ledger, and runs the
tests against the real server.

Notes that stay true after Wave 7:

- **Rate limiting backend.** `checkRateLimit` uses the durable MySQL bucket
  when the operational database is active and falls back to the in-process
  limiter (`src/lib/memory-rate-limit.ts`) when it is not, or when the
  database call fails. The fallback is per-instance and reset by a redeploy,
  which is why the durable limiter stays the default in production.
- **Firmware trust boundary.** The ESP8266 template validates TLS when the
  package supplies `SOLARTANK_TLS_CA_CERT` or `SOLARTANK_TLS_CERT_FINGERPRINT`,
  and signs each POST with HMAC-SHA256 when `SOLARTANK_ENABLE_REQUEST_SIGNING`
  is 1 (both are generated from deployment variables). Without pinned TLS
  material the session is unvalidated and the firmware says so on the serial
  console every boot; that residual case is a deployment decision, not a code
  gap (see `docs/safety-and-limitations.md` and `docs/decision-log.md`).
- **Signing rollout.** `INGEST_SIGNATURE_MODE` stays `off` only while field
  devices are being flashed; the go-live checklist requires `required`, or a
  dated migration plan in the sign-off table.
- **Location scopes are opt-in.** With `AUTH_ENFORCE_SITE_SCOPES` unset every
  signed-in account still reads every location; assignments can be prepared
  first, and enforcement should be switched on only after every non-admin
  account has at least one scope.

## 5. Explicitly Out of Scope

These remain out of scope after this work, and the documentation keeps
saying so:

- sensor calibration and physical safety approval per location;
- RTU/Modbus/OPNIMUS protocol integration;
- one-click firmware compile/upload from the browser;
- a mobile application.

## 6. Claim Discipline

This review does not change the project's claim limits. Production
readiness here means **the software is operable, observed, recoverable, and
access-controlled**. It does not mean sensor accuracy has been validated,
that field procedures are approved, or that the deployment has corporate
production approval. Those remain operational decisions documented in
`docs/current-operational-truth.md`, `docs/safety-and-limitations.md`, and
`docs/production-go-live-checklist.md`.
