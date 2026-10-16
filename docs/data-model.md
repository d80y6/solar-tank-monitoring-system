# Data Model

This document explains the main data used in the monitoring system.

## Plain Overview

The system has several main objects:

```text
Location
  -> Regional
  -> Territory
  -> Area
  -> STO
  -> Tank
  -> Device
  -> Reading
```

That means:

- one location can have one or several tanks;
- one tank is monitored by a device;
- a device sends many readings;
- readings are used to create status and charts.

The current device onboarding flow is:

```text
User requests a device
  -> Admin reviews
  -> System creates device key and firmware package
  -> User downloads firmware
  -> Device sends first data
  -> Site, tank, and device are active on the dashboard
```

## Site

A site is an operational location.

Examples:

```text
STO TPH
STO NJA
STO JTO
```

Important fields:

| Field | Meaning |
|---|---|
| `id` | internal location ID |
| `code` | short location code |
| `name` | location name |
| `regionalLabel` | largest location group, e.g. `TREG 5` |
| `wilayahLabel` | group below regional, e.g. `TIF 3` |
| `areaLabel` | area label |
| `coordinate` | manual coordinate example |
| `markerLeft` / `markerTop` | marker position on the illustrative map |

## Tank

A tank is a fuel tank.

Important fields:

| Field | Meaning |
|---|---|
| `id` | tank ID |
| `siteId` | tank location |
| `name` | tank name |
| `shape` | tank shape |
| `capacityLiter` | maximum capacity |
| `diameterCm` | diameter if horizontal cylinder |
| `lengthCm` | length if horizontal cylinder |
| `sensorMountHeightCm` | sensor reference height |
| `consumptionLiterPerHour` | hourly consumption assumption |
| `lowLevelPercent` | low level limit |
| `criticalLevelPercent` | critical level limit |

## Device

A device is the hardware that sends data.

Important fields:

| Field | Meaning |
|---|---|
| `id` | internal device ID |
| `code` | device code used in headers |
| `siteId` | device location |
| `tankId` | monitored tank |
| `label` | device name |
| `expectedReportIntervalSec` | expected send interval |
| `apiKeyHash` | device key hash for ingest validation |
| `isActive` | whether the device is active |

Active device example:

```text
code: demo-tph-01
tankId: tank-tph-main
expectedReportIntervalSec: 20
```

That means the operational device is expected to send data every 20 seconds. This interval does not determine history row count because history is still rolled up every 5 minutes.

## Device Request

A device request is temporary data before a device is truly active. Its purpose is so field users do not have to create device codes and keys manually.

Important fields:

| Field | Meaning |
|---|---|
| `requestCode` | request code that is easy for admins to track |
| `requesterEmail` | email of the requesting user |
| `status` | review and provisioning status |
| `siteName` | STO name shown on the dashboard |
| `regionalLabel` / `wilayahLabel` / `areaLabel` | location group order from largest to closest to the STO |
| `latitude` / `longitude` | manual coordinates for the map |
| `deviceCode` | system-generated device code |
| `deviceSensorType` | sensor type, currently focused on fuel sensors |
| `tankShape` | tank shape, rectangular or horizontal cylinder |
| `capacityLiter` | tank capacity calculated by the system from dimensions, not manual user input |
| `lengthCm`, `widthCm`, `heightCm`, `diameterCm` | physical tank dimensions per shape |
| `sensorMountHeightCm` | sensor reference height that must be filled consistently with firmware/field guidance |
| `loadValue`, `loadUnit`, `dieselEngineCapacityKva`, `cosPhi` | generator load parameters for calculating hourly diesel consumption |
| `hardwareProfileId` | board, sensor, and pin profile used by the firmware |
| `firmwareTemplateId` | firmware template used to create the ZIP |

Important notes:

- users do not freely fill STO code, device code, device key, liter capacity, liters per hour consumption, low level, critical level, or send interval;
- codes and keys are created by the system;
- capacity is calculated from tank dimensions;
- consumption is calculated from site load, diesel engine capacity, and cos phi;
- low/critical levels and send interval follow system or hardware profile defaults.

Important statuses:

| Status | Meaning |
|---|---|
| `pending_admin_review` | waiting for admin approve/reject |
| `approved_package_ready` | firmware package created |
| `waiting_firmware_download` | firmware link sent and waiting for download |
| `waiting_first_valid_ping` | firmware downloaded, waiting for the device to send valid data |
| `active` | device active and shown on the dashboard |
| `rejected` / `revoked` / `expired` | request can no longer be used |

## Firmware Package

A firmware package is a ZIP created after an admin approves the request.

Package contents:

```text
solar_tank_firmware.ino
device_config.h
hardware_profile.h
README_UPLOAD_STEPS.md
manifest.json
```

The firmware package contains the device key and configuration generated from the request data. In the database, the ZIP contents are stored encrypted with `DEVICE_PACKAGE_ENCRYPTION_KEY`. Download links have an expiry and a download limit so device keys do not spread too freely.

## Device/Test Data Maintenance

Device/test data may be cleaned from the admin page when the team genuinely wants to restart device testing. Admins can clean up one request card, several selected cards, or all device monitoring data. This reset is for monitoring operational data, not account data.

Tables that count as monitoring operational data:

| Table | Content |
|---|---|
| `monitoring_sites` | STO locations |
| `monitoring_tanks` | tank configuration |
| `monitoring_devices` | active or prepared devices |
| `monitoring_readings` | sensor reading history |
| `monitoring_device_requests` | device requests from users |
| `monitoring_device_packages` | firmware packages created from approvals |
| `monitoring_device_provisioning_events` | approve, reject, reissue, revoke, and package email events |
| `monitoring_ingest_events` | device ingest events |

For single or selected cleanup, the system only deletes sites, tanks, and devices related to the selection. If a site or tank is still used by other data, that data is not deleted.

Tables deliberately not deleted:

| Table | Reason |
|---|---|
| `auth_*` | admin/user accounts, sessions, OTP, auth audit, and password resets must stay safe |
| `monitoring_firmware_templates` | firmware templates are still needed to create new packages |
| `monitoring_hardware_profiles` | board, sensor, and pin profiles are still needed by subsequent requests |

After operational data is cleaned, the dashboard stays empty until a new device request is approved or the monitoring registry is prepared again.

## Reading

A reading is one reading record.

Important fields:

| Field | Meaning |
|---|---|
| `id` | reading ID |
| `deviceId` | sending device |
| `tankId` | tank being read |
| `measuredAt` | measurement time from the device or server fallback |
| `receivedAt` | time the server received the data |
| `sensorDistanceCm` | empty space height: distance from the sensor at the top of the tank to the fuel surface |
| `fuelHeightCm` | fuel height |
| `volumeLiter` | estimated volume |
| `fillPercent` | fill percentage |
| `runtimeHour` | estimated operational duration |
| `batteryVolt` | device voltage when available |
| `rssiDbm` | WiFi signal when available |
| `rawPayload` | raw payload for development audit |
| `quality` | notes on number sources and config review status when the payload carries tank configuration |
| `resolution` | `raw`, `5m`, or `latest` in the application read model |
| `bucketStart`, `bucketEnd` | aggregate bucket time bounds |
| `sampleCount` | number of samples represented by one aggregate row |
| `volumeLiterMin`, `volumeLiterMax` | minimum and maximum volume in the bucket |
| `fillPercentMin`, `fillPercentMax` | minimum and maximum percentage in the bucket |

`quality` helps answer:

- whether measurement time came from the device or server fallback;
- whether volume came from the device or was calculated by the backend;
- whether percent came from the device or was calculated by the backend;
- whether runtime came from the device or was calculated by the backend;
- whether payload configuration matches or differs from the registry.

If payload configuration differs significantly from the registry, the reading may carry the status:

```text
config_mismatch
```

The dashboard/detail can then flag that the data needs review instead of silently treating it as safe.

Time notes:

- `measuredAt` and `receivedAt` are stored as UTC times and leave the API as ISO strings ending in `Z`;
- the operational UI displays clock labels in WIB/Asia Jakarta so local and Vercel results do not drift;
- if the device sends a timestamp too far from server time, the system uses server time and adds a warning in `quality`.

## Status

Status is derived from reading data and configuration.

Status types:

| Status | Based on |
|---|---|
| `runtimeStatus` | runtime estimate |
| `levelStatus` | fill percentage |
| `deviceStatus` | latest data age |
| `operationalStatus` | combined main status |

## Current Storage Notes

Currently the application has two reading storage modes:

| Mode | Function |
|---|---|
| `memory` | Development default, data is lost when the server restarts |
| `mysql` | Readings are stored to MySQL through an optional repository |

Memory store characteristics:

- fast for development;
- needs no database;
- on server start, demo data is shifted relative to the running time so the initial state is not stale;
- lost when the dev server restarts;
- not suitable for production;
- suitable for proving the simulator and API flow.

Current MySQL characteristics:

- has migrations and demo seed;
- `monitoring_latest_readings` stores exactly one latest snapshot per device for the live dashboard;
- `monitoring_readings` stores old raw and the new 5-minute aggregate history;
- each new ingest upserts the snapshot and 5-minute bucket in one transaction;
- the main value of a `5m` row is a running mean, accompanied by min, max, and `sample_count`;
- the full raw payload only exists on the latest snapshot; new rollup rows do not stack raw payloads;
- tank history queries fetch per-tank history;
- overview queries fetch the latest reading per tank so rarely-sending tanks are not crowded out by data from tanks that report more often;
- during deployment transition, overview queries compare the snapshot with the latest history and pick the newest `receivedAt`;
- MySQL `DATETIME` values are treated as UTC by the application repository;
- can already read site, tank, device, and key hash registry from the database;
- can be populated with the pilot registry through a local Git-untracked file;
- still requires production SOPs such as backup, restore, key rotation, and database monitoring.
