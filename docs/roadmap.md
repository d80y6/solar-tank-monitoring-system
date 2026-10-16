# Roadmap

This roadmap explains the phased development plan.

## Phase 1 - Repository Foundation

Status: done.

Contents:

- Next.js project;
- TypeScript;
- Tailwind CSS;
- documentation structure;
- public security rules;
- basic CI.

## Phase 2 - Landing Page

Status: done for the initial version.

Contents:

- landing page;
- clean visual style;
- tank monitoring context;
- dashboard entry button.

## Phase 3 - Initial Dashboard and Detail

Status: done for the initial version.

Contents:

- dashboard page;
- tank detail page;
- illustrative map;
- status cards;
- monitoring table;
- tank visual.

Note:

```text
The monitoring and detail UI already reads the same active storage as the API endpoints. MySQL registry, pilot tooling, and the database auth foundation are available, but production hardening still needs refinement.
```

## Phase 4 - Domain Logic and Tests

Status: done for the initial version.

Contents:

- monitoring data model;
- volume calculation;
- runtime;
- status;
- payload normalization;
- unit tests.

## Phase 5 - API and Local Simulator

Status: done for the initial version.

Contents:

- read-only API;
- ingest API;
- memory store;
- terminal simulator;
- payload arrival verification;
- growing history.

## Phase 6 - Connect UI to Active Storage/Local API

Status: done for the initial version.

Contents:

- dashboard reads the latest data from active storage;
- detail reads the latest data from active storage;
- charts use the same history as the readings endpoint;
- the UI changes when the simulator sends data and the page re-renders;
- API endpoints remain available for integration contracts.

## Phase 7 - Persistent Storage and Registry

Status: used in the operational pilot; production hardening not finished.

Available:

- MySQL migrations;
- MySQL demo seed;
- MySQL reading repository;
- MySQL registry repository for sites, tanks, devices, and key hashes;
- `memory` or `mysql` storage facade;
- queries fetch the latest data first;
- pilot registry apply script from a local file.

Available now:

- device key rotation with a grace window for the previous key;
- encrypted backup, verification, and a documented restore procedure;
- real database integration tests (skipped locally, run against MySQL 8.4 in CI);
- boot guardrails that refuse unsafe production configuration.

Not finished:

- restore drills must still be executed by an operator against a scratch
  database and recorded in `docs/disaster-recovery-runbook.md` § 6;
- periodic audits so sample data stays active only in local development mode —
  the go-live checklist makes this a pre-promotion review item rather than a
  scheduled job.

## Phase 8 - Auth and Roles

Status: main foundation available, production hardening continues.

Available:

- sign-in;
- `admin` and `user` roles;
- dashboard and admin page protection;
- access requests pending admin review;
- admin OTP, password reset, email verification, session management, and auth audit log.

Available now:

- per-location access scopes with opt-in enforcement;
- hardware profile and firmware template CRUD;
- audit-log filtering, pagination, and CSV export.

Still to refine (operational, not code):

- production SMTP credentials and deliverability testing;
- production Turnstile keys;
- more detailed operational roles if truly needed;
- account recovery procedures;
- periodic audit review.

## Phase 9 - Physical Device Integration

Status: physical devices already send data in the pilot; calibration and field hardening still need validation.

Available:

- physical devices connected to the pilot deployment;
- real-format payload normalization;
- payload config vs registry review;
- ingest smoke test script;
- minimal firmware payload guidance;
- device request flow by users;
- admin review to approve/reject requests;
- device key and firmware ZIP package generation;
- firmware download links with expiry and download limits;
- device activation after first valid ping.

Available now:

- firmware templates sign telemetry (HMAC-SHA256) and can pin the server
  certificate, both configured from deployment variables;
- staging verification for the payload configuration review.

Next targets:

- final firmware validation with the field team;
- final pin and hardware profile validation;
- testing in a safe environment;
- sensor accuracy validation;
- operational device provisioning documentation once the final flow is approved.

Note:

The ingest endpoint and per-device keys are prepared for practice and the early pilot. Physical devices must still follow payload, network, security, and field safety validation.

## Phase 10 - Pilot Deployment

Status: Vercel + Aiven MySQL active for a limited pilot. Final production readiness, expansion target capacity, and long-term SOPs are not yet approved.

Available:

- health check;
- readiness check;
- cloud MySQL guide;
- pilot registry tooling;
- smoke ingest to local or Vercel URL;
- current operational truth document.
- registry of 3 sites, 3 tanks, and 3 devices as of the 14 July 2026 verification.

Available now:

- encrypted backups with verification and a restore script;
- `docs/upgrade-and-rollback.md`: the release procedure, migration rules, and
  rollback steps that leave data untouched;
- monitoring endpoints for health, readiness, and Prometheus metrics, with the
  alert rules that watch them;
- `docs/production-go-live-checklist.md`: the sign-off gate for 5 devices/STOs;
- `docs/incident-response.md`: severities, roles, and playbooks.

Next targets:

- execute the first restore drill on the production size database and record it;
- connect a long-term log service to the structured JSON logs;
- establish the production approval path with the platform owner.

## Roadmap Principles

- Do not add big features before the core data flow is stable.
- Do not use real data before security is ready.
- Do not claim production-ready before field validation.
- Every phase must be testable from the terminal.
