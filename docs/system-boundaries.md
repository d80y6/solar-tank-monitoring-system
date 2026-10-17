# System Boundaries

This document explains what is in and out of scope for the repository.

## In Current Scope

Included:

- landing page;
- operational dashboard, map, location filters, and tank details;
- public-safe sample data for development only;
- read APIs and the ingest API;
- payload normalization;
- terminal simulator;
- development memory store;
- MySQL live snapshot and 5-minute rollups;
- MySQL registry for sites, tanks, devices, and key hashes;
- public-safe pilot registry template;
- local pilot registry validation/apply scripts;
- real-format payload smoke test script;
- per-device key validation for development sample data;
- auth database for sign-in, sessions, admin OTP, password reset, email verification, Telegram binding, auth audit, and rate limiting;
- new device requests from users;
- admin review of device requests through the web;
- device key and firmware ZIP package generation after approval;
- first valid ping activation;
- monitoring/device/test data cleanup by admins without deleting accounts;
- CSV export, reading reset, MySQL backup, Telegram, and helpdesk;
- unit tests;
- English documentation.

## Not Yet in Current Scope

Not yet included:

- executed and recorded restore drills on operational data;
- more detailed operational roles beyond `admin` and `user`;
- one-click firmware compile/upload (firmware TLS validation and request signing
  are implemented — see `docs/decision-log.md`);
- real data in Git;
- field-tuned alert thresholds;
- device approve/reject through Telegram;
- final-calibrated hardware integration;
- RTU/Modbus/OPNIMUS integration;
- final production approval and deployment details;
- mobile app.

## Never Allowed in the Public Repo

Must never be committed:

- private working notes and unpublished context;
- credentials;
- real API keys;
- passwords;
- internal IPs;
- internal domains not intended for public access;
- private network configuration;
- sensitive real payloads;
- local registry files containing real coordinates/hashes;
- backup files;
- sensitive location information.

## Claim Limits

Safe claims:

```text
FTM is an active internal operational pilot with real devices, accounts,
a Vercel deployment, and a MySQL database within limited coverage.
```

Claims that are not allowed yet:

```text
The system is production-ready.
The system has been deployed nationally.
All devices are always online.
Sensors are safe for real tanks.
Real data is final and field-validated.
FTM has obtained formal approval as a Telkom Indonesia production system.
```

## Brand and Institutional Data Limits

Public documentation uses general terms such as:

- operational location;
- site;
- STO;
- device;
- tank;
- monitoring dashboard.

Do not add institutional, network, or internal details that have not been approved.

## Memory Store Limits

The memory store is for development only.

That means:

- data is lost when the server restarts;
- not suitable for audit;
- not suitable for multi-server setups;
- not suitable for production.

The final storage must use a database.

## Current MySQL Limits

MySQL is used in the pilot, but the existence of an active database does
not mean the whole system is production-ready.

Included:

- monitoring and auth table migrations;
- demo seeds;
- live snapshot and 5-minute history aggregates;
- dashboard, detail, and CSV queries;
- site, tank, device, and key hash registry;
- local pilot registry apply script that is not committed.
- auth, session, OTP, audit, and rate limit tables;
- device request, firmware package, hardware profile, firmware template, provisioning event, and ingest event tables.

Not final yet:

- device key rotation from the admin UI;
- encrypted backups and restore drills;
- more detailed operational roles;
- SOP for separating sample data and real data in daily operations.
- server monitoring and alerting.
