# Safety and Limitations

This document explains the system limits and the safety points that must be observed.

## Current Security Status

This repository supports an active internal operational pilot that already
receives data from real devices. That status is not the same as
production-hardened.

Must not be considered:

- production-ready;
- safe for device expansion without security and safety review;
- calibrated sensor results for all tanks;
- the single source of operational decisions;
- official approval for national deployment.

## Software Limits

Available:

- development-only sample data and simulator;
- local and deployed ingest API;
- per-device key hash validation;
- development memory store;
- live snapshot and rollup history on MySQL;
- MySQL registry already used by the pilot;
- MySQL-based user/admin auth;
- sessions, admin OTP, email verification, password reset, and auth audit;
- rate limiting for auth and ingest endpoints when MySQL storage is active;
- device requests, admin review, device key generation, and firmware ZIP packages;
- first valid ping activation so new devices are not active before the key matches;
- admin cleanup of device/test data without deleting accounts or firmware templates;
- local pilot registry validation from a Git-untracked file;
- real-format payload smoke tests;
- simulator;
- domain tests.

Not yet available:

- encrypted backups and tested restore drills;
- detailed operational roles beyond `admin` and `user`;
- routinely tested backup and restore;
- server monitoring;
- critical-level/offline operational alerts;
- hardware calibration and safety approval for every location;
- admin pages to fully manage device registry, hardware profiles, and firmware templates;
- final production deployment decisions and final environment perimeter protection;
- device approve/reject through Telegram.

## Data Limits

Data in the repo must be public-safe.

Do not include:

- real telemetry data;
- sensitive coordinates;
- internal domains;
- internal IPs;
- credentials;
- internal dashboard screenshots;
- network configuration;
- production API keys.

For the pilot, real data may be used only through:

- local/Vercel environment variables;
- the intended cloud/server database;
- the Git-ignored `config/pilot-registry.local.json`.

The sample file `config/pilot-registry.example.json` must not be treated
as final field data.

## Hardware Limits

Installing devices near fuel must follow official procedures.

Do not:

- install sensors yourself without permission;
- open or drill into tanks;
- place open circuits near fuel;
- test devices in risky areas without a companion;
- claim sensors are safe before validation.

Early testing should use:

- software simulation;
- water containers;
- a safe environment;
- low-voltage devices;
- a companion who understands the procedure.

## Formula Limits

The horizontal cylinder formula is prepared, but real results still need calibration.

That must be validated:

- tank diameter;
- tank length;
- real capacity;
- sensor position;
- sensor blind spots;
- non-ideal tank shapes;
- error tolerance;
- liquid surface effects.

## Operational Decision Limits

The dashboard helps read conditions.

The dashboard does not replace:

- field inspection;
- operational SOPs;
- technician decisions;
- safety procedures;
- mentor or responsible-person validation.

## Before Production-Hardened

Minimum checklist:

- data model approved;
- device payload agreed;
- security review;
- database and backup;
- HTTPS;
- perimeter protection on the final environment;
- application rate limiting and request protection at the proxy;
- user roles;
- audit log;
- device key rotation;
- operational documentation;
- device testing in a safe environment;
- volume accuracy validation.
