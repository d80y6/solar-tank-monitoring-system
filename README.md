# FTM — Fuel Tank Management

<div align="center">

<img src="public/logo/android-icon-192x192.png" alt="FTM" width="112" />

**IoT platform for fuel monitoring, device management, and tank operational visibility.**

[![Status](https://img.shields.io/badge/status-pilot_operational_active-0f766e)](docs/current-operational-truth.md)
[![CI](https://github.com/Zendin110206/solar-tank-monitoring-system/actions/workflows/ci.yml/badge.svg)](https://github.com/Zendin110206/solar-tank-monitoring-system/actions/workflows/ci.yml)
[![Next.js](https://img.shields.io/badge/Next.js-16.2.9-111827)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-2563eb)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-16a34a)](LICENSE)

[Live application](https://solar-tank-monitoring-system.vercel.app) · [Operational status](docs/current-operational-truth.md) · [Architecture](docs/architecture.md) · [User manual](docs/ftm-user-manual.html)

</div>

## Overview

FTM connects tank sensors, ESP8266 devices, the data ingestion service,
MySQL, and the web dashboard in a single monitoring flow. The platform
provides the latest readings, volume history, runtime estimates, device
connection status, account management, device setup, and operational
support through Telegram and the helpdesk.

The system is currently running as an **active operational pilot** within
the Telkom Indonesia/Telkominfra infrastructure context, with initial
coverage of TIF Pasuruan–Sidoarjo. The live application runs on Vercel
and receives telemetry from field devices registered on Aiven MySQL.

FTM is managed as a continuously evolving system. Device communication
security, system monitoring, data recovery, per-location access control,
and capacity validation are part of the roadmap toward broader coverage.

> Pilot status does not present FTM as a national product or a safety
> system that has obtained corporate production approval. Operational
> decisions still follow field verification and applicable procedures.

## Operational Status

| Section | Status |
|---|---|
| Development stage | Active operational pilot; maintained and developed continuously |
| Initial coverage | TIF Pasuruan–Sidoarjo |
| Registered devices | Snapshot 2 August 2026: 6 locations, 6 tanks, and 6 devices; 5 active, consisting of 3 online and 2 offline, plus 1 disabled |
| Application platform | Vercel |
| Operational database | Aiven MySQL |
| Live monitoring | Latest snapshot per device with dashboard refresh every 20 seconds |
| Telemetry history | 5-minute aggregates containing average, minimum, maximum, and sample count |
| Data snapshot | 23,889 history rows representing 247,639 samples; 16,195 5-minute rollup rows representing 239,945 samples (average 14.82 samples per row) |
| Access setup | Verified accounts with admin and user roles |

Device counts can change as the rollout progresses. Current conditions,
claim limits, and operational notes are maintained in the
[Current Operational Truth](docs/current-operational-truth.md) document.

## System Architecture

```text
Ultrasonic sensor
       │
       ▼
ESP8266 device
       │  authenticated telemetry
       ▼
POST /api/ingest
       │
       ├── device identity and data validation
       ├── configuration normalization
       └── registry consistency check
       │
       ▼
Aiven MySQL
       ├── latest snapshot per device ──► live dashboard
       └── 5-minute aggregate ─────────────────► charts and CSV export
       │
       ▼
Next.js application on Vercel
       ├── operator and admin dashboard
       ├── account and device management
       └── Telegram and helpdesk integration
```

Component explanations, responsibility limits, and feature relationships
are available in [Architecture](docs/architecture.md) and
[System Boundaries](docs/system-boundaries.md).

## Data Lifecycle

FTM separates data for live display and historical analysis:

- **Latest snapshot** stores the most recent reading for each device.
  Its value is updated whenever new telemetry arrives and is the primary
  source for the live dashboard.
- **5-minute aggregates** summarize samples into average, minimum,
  maximum, and sample count. This model preserves analytical information
  with more controlled storage growth.
- **Registry data** stores location identity, tanks, devices, capacity
  parameters, and approved configuration.
- **Audit trail** stores important account and administrative changes.

Contracts and data structures are explained further in
[Data Model](docs/data-model.md), [API Contract](docs/api-contract.md),
and [Device Ingestion](docs/device-ingestion.md).

## Key Capabilities

### Monitoring

- location summary through card and map views;
- filters for regional, territory, area, STO, and device status;
- volume reading, fill percentage, data receipt time, and connection status;
- runtime estimates based on capacity and consumption;
- daily, weekly, and monthly trends;
- CSV export for the selected data range;
- detection of differences between device configuration and registry.

### Device lifecycle

- device request and location data submitted by users;
- review and approval by admins;
- capacity and consumption parameter calculation;
- device key, configuration, and firmware package generation per device;
- activation after the device sends its first valid data;
- test data management and selective reading cleanup.

### Identity and access

- sign up, email verification, sign in, and password recovery;
- admin and user roles;
- `httpOnly` session cookies and Argon2id password hashing;
- OTP for specific administrative actions;
- Cloudflare Turnstile for public forms when enabled;
- one Telegram identity for one FTM account;
- session revocation and audit of important activity.

### Operations

- web helpdesk with Telegram notifications;
- Telegram commands for help, account status, and dashboard access;
- service health and readiness checks;
- manual and scheduled MySQL backups;
- sequential and safely re-runnable database migrations;
- automated quality checks through GitHub Actions.

## Technology

| Layer | Technology |
|---|---|
| Web application | Next.js 16 App Router, React 19, TypeScript strict |
| Interface | Tailwind CSS 4, lucide-react, Three.js |
| Data | MySQL, `mysql2`, Aiven |
| Identity and communication | Argon2id, SMTP email, Cloudflare Turnstile, Telegram Bot API |
| Devices | ESP8266, ultrasonic sensor, per-device firmware package |
| Application deployment | Vercel |
| Quality testing | Vitest, ESLint, TypeScript, Next.js production build, GitHub Actions |

## Repository Structure

```text
.
├── .github/                 # CI workflow and report templates
├── config/                  # registry template safe to publish
├── database/
│   ├── migrations/         # sequential MySQL schema migrations
│   └── seeds/              # development-only sample data
├── docs/                    # architecture, operations, security, and guides
├── firmware/templates/      # device firmware template
├── scripts/                 # migration, backup, simulator, and smoke tests
└── src/
    ├── app/                 # Next.js pages and Route Handlers
    ├── components/          # shared interface components
    └── features/
        ├── auth/            # accounts, sessions, email, Telegram, and audit
        ├── helpdesk/        # web and Telegram support flow
        └── monitoring/      # domain logic, storage, dashboard, and tests
```

## Getting Started

### Prerequisites

- Node.js 20 or newer;
- pnpm 9.15.3;
- MySQL for development with persistent storage.

### Running the development server

```powershell
git clone https://github.com/Zendin110206/solar-tank-monitoring-system.git
cd solar-tank-monitoring-system
corepack enable
pnpm install
pnpm dev
```

The application can be opened at `http://localhost:3000`.

Development mode uses in-memory storage and publicly safe sample data by
default. Device telemetry can be simulated without physical hardware:

```powershell
pnpm simulate:device --once
```

### MySQL development environment

Create `.env.local` based on `.env.example`, enter the allowed database
development credentials, then set up the schema:

```powershell
pnpm db:setup:mysql
pnpm auth:create-admin
pnpm dev
```

The `db:setup:mysql` command includes sample data and is only intended
for development databases that are still empty. Databases that already
contain data must be backed up before sequential migrations are run and
must not receive development sample data.

```powershell
pnpm db:backup:mysql
pnpm db:migrate:mysql
pnpm db:migrate:auth
pnpm db:migrate:auth-recovery
pnpm db:migrate:device-provisioning
pnpm db:migrate:device-request-fields
pnpm db:migrate:helpdesk
pnpm db:migrate:reading-rollup
pnpm db:migrate:auth-telegram
pnpm db:migrate:site-taxonomy
```

Deployment requirements, migration order, and readiness checks are
explained in the [Deployment Guide](docs/deployment.md).

## Key Commands

| Command | Function |
|---|---|
| `pnpm dev` | Runs the development server with Turbopack |
| `pnpm dev:lan` | Opens the development server on the allowed local network |
| `pnpm dev:webpack` | Uses Webpack as the compatibility option |
| `pnpm simulate:device` | Sends sample telemetry to the data ingestion endpoint |
| `pnpm pilot:hash-key` | Creates credentials for allowed device setup |
| `pnpm pilot:registry` | Validates and applies the Git-untracked local registry |
| `pnpm pilot:smoke` | Tests data ingestion with the device format |
| `pnpm db:backup:mysql` | Creates a MySQL backup in the Git-ignored directory |
| `pnpm db:migrate:*` | Runs a single schema migration |
| `pnpm check` | Runs type checking, lint, tests, and the production build |

## Configuration and Security

`.env.example` documents configuration names without operational values.
Production data and credentials are not stored in this repository.

- secrets, database URLs, device keys, tokens, and account data must stay
  outside version control;
- only browser-safe values may use the `NEXT_PUBLIC_` prefix;
- operational registries and detailed location data must not be committed;
- `config/pilot-registry.example.json` is a public template, while
  `*.local.json` is Git-untracked;
- seeds and simulator data are development data, not operational data;
- security reports follow the private process in [SECURITY.md](SECURITY.md).

Operational and physical device limits are maintained in
[Safety and Limitations](docs/safety-and-limitations.md).

## Quality Control

Every change must pass the full project check:

```powershell
pnpm check
```

The command runs TypeScript type checking, ESLint, all Vitest tests, and
the Next.js production build. Application behavior changes must also be
tested on the affected flows. Software checks do not replace sensor
calibration, installation inspection, or operational safety procedures.

## Product Roadmap

Development continues through the following focus areas:

- firmware communication security, OTA control, and diagnostic hardening;
- calibration and measurement tolerance documentation per tank;
- automated notifications for critical levels, delayed devices, and data
  delivery failures;
- location-based access restriction for larger operations teams;
- encrypted backup retention and periodic recovery drills;
- centralized system monitoring, incident handling, and credential rotation;
- load, quota, and cost validation before rollout expansion;
- release management and operational ownership for long-term maintenance.

Priorities and readiness requirements are explained in the
[Roadmap](docs/roadmap.md) and [Pilot Readiness](docs/pilot-readiness.md).

## Documentation

| Document | Scope |
|---|---|
| [Current Operational Truth](docs/current-operational-truth.md) | Rollout condition and current claim limits |
| [Architecture](docs/architecture.md) | Components, dependencies, and data flow |
| [API Contract](docs/api-contract.md) | Endpoint contract and data formats |
| [Data Model](docs/data-model.md) | Locations, tanks, devices, readings, and device setup |
| [Device Ingestion](docs/device-ingestion.md) | Authentication, normalization, and validation of incoming data |
| [Deployment](docs/deployment.md) | Environments, migrations, readiness, and release flow |
| [Vercel Deployment](docs/vercel-deploy.md) | Step-by-step vercel.app publish guide |
| [Database Backup](docs/database-backup.md) | Backup, retention, and recovery limits |
| [Safety and Limitations](docs/safety-and-limitations.md) | Software, data, physical device, and operational limits |
| [Reviewer Quickstart](docs/reviewer-quickstart.md) | Technical review flow |
| [User Manual](docs/ftm-user-manual.html) | End-user guidance |

## Contributing

Contribution terms are available in [CONTRIBUTING.md](CONTRIBUTING.md).
Every change must keep sample data safe for a public repository,
maintain the established security limits, include suitable tests, and
pass all project quality checks.

| Contributor | Contribution focus |
|---|---|
| [Muhammad Zaenal Abidin Abdurrahman](https://github.com/Zendin110206) | Project coordination, application architecture, server and database side, identity, deployment, integration, testing, and review |
| [Yattaqi Muazirul Mulki](https://github.com/ukiirving) | Interface design and application development |
| [Astra](https://github.com/Ata22) | Device and firmware development, field testing, Telegram integration, and operational feedback |

## License

Source code is available under the [MIT License](LICENSE). Names, logos,
credentials, operational data, and third-party information are not part
of the license grant.
