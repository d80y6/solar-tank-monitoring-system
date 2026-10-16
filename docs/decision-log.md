# Decision Log

This document records important technical decisions so the reasons for changes remain traceable.

## 2026-06-24 - Use Next.js App Router

Decision:

```text
The initial frontend and API are built in a single Next.js application.
```

Reasons:

- easy to run locally;
- suitable for fast iteration;
- API routes are enough for the MVP;
- simpler development deployment.

Note:

If backend needs grow, backend services can be split later.

## 2026-06-25 - Separate Domain Logic from UI

Decision:

```text
Volume, runtime, status calculations, and payload normalization live in src/features/monitoring/lib.
```

Reasons:

- operational numbers must be testable;
- the UI must not be the home of core formulas;
- the logic can be shared by the API and UI.

## 2026-06-25 - Use Public-safe Sample Data

Decision:

```text
All initial data uses sample data.
```

Reasons:

- safe for a public repo;
- does not expose internal data;
- sufficient to build the UI and API.

## 2026-06-26 - Add Ingest API and Memory Store

Decision:

```text
POST /api/ingest accepts device payloads and stores readings to the memory store.
```

Reasons:

- proves the data flow without a database;
- makes simulator testing easy;
- reduces hardware blockers.

Limit:

Data is lost when the dev server restarts.

## 2026-06-26 - Add Terminal Simulator

Decision:

```text
The simulator is built as scripts/simulate-device.mjs without extra dependencies.
```

Reasons:

- easy to run;
- no build step;
- lightweight;
- suitable for terminal learning.

## 2026-06-26 - Remove Excess Placeholders

Decision:

```text
Empty .gitkeep-based folders are cleaned from the Git structure.
```

Reasons:

- repo is easier to read;
- the structure reflects real files;
- the roadmap stays recorded in documentation, not empty folders.

## 2026-06-26 - Separate Memory and MySQL Storage

Decision:

```text
telemetry-store.ts is kept for local development mode, while MySQL queries moved to mysql-reading-repository.ts and are selected through monitoring-storage.ts. When MySQL mode is active, an empty reading table is no longer filled from sample data so the pilot/production dashboard does not show simulation data as field data.
```

Reasons:

- files stay lean;
- development mode remains simple;
- database queries are easier to audit;
- storage mode can be switched via env without changing pages.

Note:

The initial MySQL query fetched the latest global readings then reversed them for charts. As real data grows, the overview uses the latest-reading-per-tank query while detail history uses a tank-specific query so it is not cut off by other tanks' data.

## 2026-06-26 - Use Per-Device Key

Decision:

```text
The ingest API accepts a per-device key validated against a hash, with a global fallback only for development.
```

Reasons:

- closer to real device needs;
- not all devices depend on one global key;
- the local fallback still helps early practice.

Note:

For modes closer to pilot or production, `SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK` must be set to `false`.

## 2026-06-26 - Use Small Client Components for Real-time UI

Decision:

```text
Dashboard and detail stay Server Components, while the refresh control and real-time clock are built as small Client Components.
```

Reasons:

- keeps client JavaScript light;
- data is still read on the server;
- browser interactions such as timers and visibility state still work correctly.

## 2026-07-11 - Separate Live Snapshot and 5-Minute History Rollup

Decision:

```text
Telemetry MySQL every ±20 seconds updates one latest snapshot per device, while history only adds one aggregate bucket every 5 minutes.
```

Reasons:

- the dashboard keeps showing the latest data without waiting for the bucket to complete;
- history row growth drops roughly 15x compared to 20-second raw;
- the mean is still accompanied by min, max, and sample count so short spikes are not lost;
- both upserts sit in one transaction so snapshot and history do not silently differ;
- old raw history is not auto-deleted so migrations do not damage audit data.

Compatibility note:

Overview and detail compare the snapshot with the latest history by `receivedAt`. This prevents differing status when the database is already migrated but an old deployment still writes raw during rollout.

## 2026-07-14 - Use Regional, Territory, Area, and STO Order

Decision:

```text
Every STO is grouped as Regional -> Territory -> Area -> STO.
```

Reasons:

- the list stays easy to search as STO counts grow across areas;
- location terms stay consistent between device requests, dashboard, map, firmware packages, and the pilot registry;
- devices do not need to send location names on every reading because the server takes them from the registry;
- older pilot locations use the initial values `TREG 5` and `TIF 3` so database changes do not erase existing data.

Note: the current choice list follows the approved pilot needs. Adding new regional/territory values must use official organizational data, not developer guesses.

## 2026-10-17 - Validate TLS and Sign Every Device Request

Decision:

```text
Generated firmware validates the server certificate (pinned CA or certificate
fingerprint) and signs each telemetry POST with HMAC-SHA256 over
"<unixSeconds>.<nonce>.<rawBody>" using the device key. TLS material and the
signing switch are deployment variables, not per-device edits.
```

Reasons:

- the ESP8266 has enough flash and RAM for BearSSL with a small trust anchor, so
  unvalidated TLS is a choice rather than a hardware limit;
- pinning at build time is easier to operate than a device-side trust store;
- binding the timestamp and nonce into the signature gives replay protection
  that a key-only signature cannot;
- the same device key already authenticates the device, so no new secret type or
  provisioning step is introduced;
- an unsigned request is still accepted while `INGEST_SIGNATURE_MODE` is `off`,
  which keeps the existing fleet reporting until it is reflashed.

Consequences:

- `SOLARTANK_TLS_CA_CERT` (preferred) or `SOLARTANK_TLS_CERT_FINGERPRINT` must be
  set in the deployment, otherwise the firmware logs a warning on every boot and
  sends telemetry over an unvalidated session;
- devices need a synchronized clock for signing, so NTP must be reachable from
  the site network; when it is not, the request is sent unsigned and the serial
  console says so;
- switching `INGEST_SIGNATURE_MODE` to `required` is a field-coordination task:
  every device must be reflashed first, and the go-live checklist requires either
  `required` or a dated migration plan;
- a fingerprint pin means renewing the server certificate requires a firmware
  update, which is why a CA pin is the preferred option.
