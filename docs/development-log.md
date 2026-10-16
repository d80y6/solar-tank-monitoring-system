# Development Log

This document records implementation progress concisely.

## 2026-06-24 - Repository Foundation and Initial Documentation

Work:

- repository scaffold;
- initial README;
- documentation structure;
- public security boundaries;
- Next.js, TypeScript, Tailwind, ESLint, Vitest configuration.

## 2026-06-25 - Landing Page

Work:

- created the landing page;
- adjusted the context to tank monitoring;
- added navigation to the dashboard;
- kept a clean, professional visual style.

## 2026-06-25 - Dashboard and Detail Frontend

Work:

- created the `/dashboard` page;
- created the `/dashboard/tanks/[tankId]` page;
- displayed an illustrative map;
- displayed location status;
- displayed tank visuals and sensor parameters.

Note:

```text
The first pages used sample data so layout and operational terms could be validated before the ingest API was built.
```

## 2026-06-25 - Monitoring Domain

Work:

- created monitoring types;
- created mock sites, tanks, devices, readings;
- created runtime logic;
- created status logic;
- created tank volume logic;
- created the payload normalizer;
- created dashboard and detail view models;
- added unit tests.

## 2026-06-26 - Read-only API

Work:

- `GET /api/dashboard/overview`;
- `GET /api/tanks/[tankId]`;
- `GET /api/tanks/[tankId]/readings`;
- endpoints read data from domain/view models.

## 2026-06-26 - Ingest API and Memory Store

Work:

- `POST /api/ingest`;
- `X-Device-Id` validation;
- `X-Api-Key` validation;
- CAT-like payload normalization;
- local memory store;
- ingest tests and error cases.

## 2026-06-26 - Device Simulator

Work:

- `scripts/simulate-device.mjs`;
- `pnpm simulate:device` script;
- one-shot mode;
- repeat mode;
- device, key, interval, start percent, and critical mode options;
- verification that payloads reach the API.

## 2026-06-26 - Documentation and Repository Maintenance

Work:

- README synchronized with actual conditions;
- `docs/` filled in;
- CONTRIBUTING and SECURITY clarified;
- `.env.example` updated;
- GitHub Actions CI added;
- issue templates added;
- placeholder `.gitkeep` files cleaned.

## 2026-06-26 - Persistent Storage Foundation

Work:

- MySQL migrations for sites, tanks, devices, and readings;
- MySQL demo seed;
- MySQL reading repository;
- storage facade to select memory or MySQL;
- initial reading queries used global bounds for the storage foundation;
- the memory store remains available for local development, but MySQL mode shows no sample data when the reading table is empty.

## 2026-06-26 - Auto-refresh Dashboard and Detail

Work:

- manual refresh component;
- pause/resume auto-refresh;
- auto-refresh stops when the tab is inactive;
- default interval of 20 seconds via env;
- real-time dashboard clock as a small client component.

## 2026-06-26 - Per-Device Key

Work:

- hashed key per sample device;
- ingest key validation using the hash;
- global fallback remains available for development;
- simulator uses the demo key matching the device;
- device key tests added.

## 2026-06-27 - Deployment Readiness

Work:

- added `GET /api/health` to check the application is alive without touching the database;
- added `GET /api/ready` to check active storage readiness;
- added a direct MySQL probe so readiness is not masked by the memory fallback;
- added dashboard and tank detail error boundaries;
- clarified the error message that `.env.local` changes require a dev server restart;
- added deployment probe tests;
- synchronized README, API contract, deployment, architecture, and reviewer quickstart.

## 2026-06-28 - Cloud MySQL and STO Detail Navigation

Work:

- split site, tank, device, and key hash registry into a MySQL repository;
- made the dashboard, detail, and APIs read the active registry from memory or MySQL;
- added `pnpm db:migrate:mysql`, `pnpm db:seed:mysql`, and `pnpm db:setup:mysql` scripts;
- added `MYSQL_CONNECTION_LIMIT`, `MYSQL_SSL_MODE`, and `MYSQL_SSL_CA` configuration for cloud MySQL deployment;
- kept MySQL reading queries fetching chronological data for detail charts;
- made STO markers and dashboard rows open the related tank detail page;
- made location markers on the detail page jump to another STO detail;
- removed temporary payloads from the working tree so they are not committed.

## 2026-06-30 - Real Device Payload and Pilot Readiness

Work:

- added payload config vs registry review so the system does not silently trust device configuration when it differs significantly;
- added reading data sources such as volume from device or backend;
- added a config review panel on the tank detail page;
- added `config/pilot-registry.example.json` as a public-safe template;
- added `pnpm pilot:hash-key` to create device key and hash;
- added `pnpm pilot:registry` to validate and apply the local pilot registry to MySQL;
- added `pnpm pilot:smoke` to send real-format payloads to `/api/ingest`;
- added `docs/pilot-readiness.md` documentation.

Note:

```text
Real data, raw keys, sensitive coordinates, and local registry files must not be committed. The pilot path uses Git-ignored .local.json files.
```

## 2026-06-30 - Real Map Phase and Field Guide

Work:

- replaced the illustrative dashboard map with a tile-based map using registry coordinates;
- added zoom, drag, recenter, search, status filter, marker tooltip, and interactive detail overview;
- added latitude and longitude to the dashboard view model so the API and UI carry registry positions;
- added `docs/field-pilot-5-sto-guide.md` as the field guide for 5 STOs;
- reaffirmed that map markers come from manual registry, not device GPS payloads.

## 2026-07-06 - Device/Test Data Maintenance

Work:

- added an admin panel to clean up one device/test datum, several selected items, or all device/test data before real tests are repeated;
- limited cleanup to monitoring and provisioning operational data only;
- kept selective cleanup so sites/tanks still used by other data are not deleted;
- kept admin/user accounts, auth audit, firmware templates, and hardware profiles stored;
- added manual confirmation so admins do not delete data accidentally;
- added repository tests to ensure cleanup order follows database relations;
- updated README, pilot readiness, and data model.

## 2026-07-07 - Operational Documentation Sync

Work:

- added `docs/current-operational-truth.md` as a concise source of current project conditions;
- aligned README, SECURITY, deployment, safety, system boundaries, data model, and roadmap so existing features are not described as missing;
- reaffirmed that device approval stays through the web admin while Telegram remains for binding/notifications;
- reaffirmed that RTU/Modbus, production alerts, tested backup/restore, and final deployment hardening are still follow-up work;
- recorded that tank capacity and estimated consumption come from system calculations, not free user input.

Note:

```text
This change is documentation only. Final chosen deployment details are not published in the main repository at this stage.
```

## 2026-07-11 - Live Snapshot and 5-Minute Reading Rollup

Work:

- added migration 007 for rollup metadata and the latest snapshot table;
- changed MySQL ingest into two atomic upserts: live snapshot and 5-minute bucket;
- stored mean, min, max, sample count, and quality in the compact history;
- made overview, detail, and APIs select the freshest reading consistently during the writer transition;
- updated charts and CSV to understand aggregates;
- made sure reset/cleanup also deletes related snapshots;
- added rollup schema readiness check;
- added regression tests for stale snapshot versus newer raw;
- updated storage, deployment, API, data model, and pilot documentation.
- updated the CI action to a stable major based on Node 24 runtime so it does not depend on the deprecated Node 20 action.

Verification before publication:

```text
MySQL backup succeeded and is not in Git
migration 007 succeeded and is safe to rerun on existing objects
typecheck, lint, all tests, and production build must pass
```

## 2026-07-14 - Location Grouping and Dashboard Branding Review

Work from PR #15 that was reviewed:

- added regional and territory above area/STO;
- added location search and filter on the dashboard;
- brought location data into device requests and device packages;
- clarified the empty space height term on sensor readings;
- added Telkom identity to the STO cards;
- clarified the message after Telegram connects successfully.

Refinements during review:

- deployment readiness now detects an old database that lacks regional/territory;
- the pilot registry can store regional/territory and stays safe for old files;
- `TREG5`/`TIF3` input is automatically tidied to the official form;
- location form order and hints were made easier to understand;
- tests cover database mapping, device requests, firmware packages, and deployment checks;
- README, deployment guide, data model, pilot, API, user manual, and PDF were aligned.

## 2026-07-14 - Public Operational Pilot Status Alignment

Work:

- positioned the README on real deployment and database evidence;
- separated the verified 3-site condition from the initial 5-STO rollout target and the 29-STO expansion direction;
- removed internal batch numbering terms from documentation and user messages;
- replaced uninterrupted location and monitoring count claims with a verifiable pilot snapshot;
- aligned operational status, deployment, safety, system boundaries, and roadmap without claiming production-ready;
- kept sample data available only as a development facility.

## Last Verification Status

Command:

```powershell
pnpm check
```

Expectation:

```text
typecheck passes
lint passes
test passes
build passes
```
