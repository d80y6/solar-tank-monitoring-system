# Device Data Ingestion

This document explains how data from a device or simulator enters the application.

## Basic Concepts

A device does not send liters magically. Usually the sensor reads a distance.

Data flow:

```text
sensor distance
  -> fuel height
  -> volume in liters
  -> fill percent
  -> runtime
  -> status
```

In development mode, the simulator can send `raw.volume` and
`raw.percent` directly to make the API flow easy to test. For the
pilot, a device or smoke test can send a real-format payload that
carries tank configuration such as shape, capacity, dimensions, and
hourly consumption.

## Endpoint

```http
POST /api/ingest
```

## Headers

Required headers:

```http
Content-Type: application/json
X-Device-Id: demo-tph-01
X-Api-Key: demo-tph-key
```

Alternative:

```http
X-Device-Key: demo-tph-key
```

Available demo keys:

| Device | Demo key |
|---|---|
| `demo-tph-01` | `demo-tph-key` |
| `demo-nja-01` | `demo-nja-key` |
| `demo-jto-01` | `demo-jto-key` |
| `demo-skp-01` | `demo-skp-key` |

The `local-development-key` fallback can still be used for early practice if `SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK` is not disabled. For a mode closer to the pilot, use per-device keys and set the global fallback to `false`.

## Supported Payloads

CAT-like payload:

```json
{
  "device": "demo-tph-01",
  "ts": 0,
  "distance": 40.5,
  "voltage": 3.86,
  "raw": {
    "H_cm": 109.5,
    "volume": 3650,
    "percent": 73,
    "wifi_rssi": -55
  }
}
```

Explanation:

| Field | Meaning |
|---|---|
| `device` | device code |
| `ts` | timestamp from the device, may be `0` for server time fallback |
| `distance` | empty space height: sensor distance above the tank to the liquid surface |
| `voltage` | device voltage |
| `raw.H_cm` | liquid height |
| `raw.volume` | volume in liters |
| `raw.percent` | fill percent |
| `raw.wifi_rssi` | WiFi signal |

Timestamp notes:

- Send `measuredAt`/`ts_iso` in ISO UTC format once the firmware has correct time.
- If only a Unix timestamp is available, send `ts` in seconds or milliseconds.
- If the device time is not trusted yet, send `ts: 0`; the server uses the receive time.
- The dashboard displays operational time in WIB, but API data is still stored as UTC to stay consistent across local, Vercel, and office servers.

Real-format payload for the pilot:

```json
{
  "device": "pilot-tph-01",
  "ts": 1780000000,
  "tank_shape": "rectangular",
  "capacity_liter": 540,
  "length_cm": 150,
  "width_cm": 60,
  "height_cm": 60,
  "sensor_mount_height_cm": 60,
  "low_level_percent": 30,
  "critical_level_percent": 15,
  "consumption_liter_per_hour": 25,
  "distance": 10.2,
  "distance_cm": 10.2,
  "voltage": 3.7,
  "rssi": -54,
  "raw": {
    "local_H_cm": 49.8,
    "local_volume_l": 448.2,
    "local_percent": 83,
    "wifi_rssi": -54
  }
}
```

The API still uses the registry as the official site/tank/device identity. Configuration from the payload is read as a snapshot. If the payload snapshot differs significantly from the registry, the ingest response carries `needsReview=true` and the dashboard/detail shows a review status.

Regional, territory, and area do not need to be sent repeatedly every 20 seconds. They are stored in the location registry, then the server combines them with readings based on the sending device. This keeps device payloads smaller and prevents location names from changing just because of a firmware typo.

For the map pilot phase, dashboard map marker positions still come from `latitude` and `longitude` in the site registry. Device payloads may carry `lat`/`lng` if available someday, but those values are not yet used to move STO points. The reason is that current devices do not use a GPS module and STO location must be entered manually from approved data.

## Performed Validation

The API checks:

- the `X-Device-Id` header exists;
- the key exists;
- the payload is a JSON object;
- the device is registered;
- the device is active;
- the key matches the device key hash or an allowed development fallback;
- the device in the payload does not conflict with the header;
- the tank for the device is found.
- payload configuration is not silently used without review when it differs significantly from the registry.

If all checks pass, the payload is normalized and stored to active storage. The development default uses the memory store. In MySQL mode, one transaction UPSERTs the latest snapshot per device for the live dashboard and the 5-minute aggregate bucket for history. Aggregate rows store mean, min, max, and sample count; the full raw payload is not stacked on every new history row.

## Simulator

Run the dev server:

```powershell
pnpm dev
```

Send one reading:

```powershell
pnpm simulate:device --once
```

Send a critical condition:

```powershell
pnpm simulate:device --critical --once
```

Send for a specific device:

```powershell
pnpm simulate:device --device demo-nja-01 --once
```

## Pilot Smoke Test

To test the real-format payload without waiting for a physical device:

```powershell
$env:PILOT_API_BASE_URL="https://solar-tank-monitoring-system.vercel.app"
$env:PILOT_DEVICE_ID="pilot-tph-01"
$env:PILOT_DEVICE_KEY="real-device-key"
pnpm pilot:smoke
```

To view the payload without sending:

```powershell
pnpm pilot:smoke -- --dry-run
```

If the smoke test fails:

| Status | Meaning |
|---|---|
| `401` | wrong key or the registry hash does not match |
| `404` | device not yet in the active registry |
| `503` | MySQL storage not ready |
| `needsReview=true` | payload accepted, but the payload configuration differs from the registry |

## Available Sample Devices

| Device | Tank |
|---|---|
| `demo-tph-01` | `tank-tph-main` |
| `demo-nja-01` | `tank-nja-main` |
| `demo-jto-01` | `tank-jto-main` |
| `demo-skp-01` | `tank-skp-main` |

## Not Final Yet

Before real devices are used, these must be locked:

- device send interval;
- firmware payload format;
- per-device key;
- tank dimensions;
- sensor position;
- calibration method;
- whether volume calculation happens on the device or server;
- network and deployment target.
- how to rotate keys if a device is replaced or a key leaks.

## Security Notes

Do not put production keys in code.

For production later:

- do not use the global fallback;
- store per-device key hashes in the database;
- use HTTPS;
- add rate limiting;
- record an audit log;
- rotate keys if a device is lost or a key leaks.
