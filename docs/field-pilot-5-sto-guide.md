# Guide to Expanding the Pilot Toward 5 STOs

This document explains how to expand the field test toward the initial 5-STO target, from start to finish until data appears on the dashboard. As of 13–14 July 2026, the verified condition is 3 registered sites, 3 tanks, and 3 devices. The language is deliberately kept slow for non-IT readers.

## Simplest Overview

The flow to achieve:

```text
1. Data for 5 STOs is entered into the database.
2. Each STO has one tank and one device.
3. Each device has its own key.
4. The device sends data to the application URL.
5. The API checks the device and key.
6. Data enters MySQL.
7. The dashboard shows map points, status, volume, fill percent, runtime, and last update.
```

The dashboard uses a coordinate-based map. Map points do not come from device GPS, because current devices do not use a GPS module. Map points come from the location registry filled in manually and stored in MySQL.

## Data to Prepare for 5 STOs

Prepare a simple table like this before touching code or devices.

| Data | Example | Note |
|---|---|---|
| STO code | `TPH` | Short code that is easy to read |
| Location name | `STO TPH` | Name shown on the dashboard |
| Regional | `TREG 5` | Largest location group |
| Territory | `TIF 3` | Group below regional |
| Area | `Pasuruan` | Work area label |
| Latitude | `-7.6500000` | Must be the approved coordinate number |
| Longitude | `112.9000000` | Must be the approved coordinate number |
| Tank ID | `tank-tph-main` | Use a consistent format |
| Tank shape | `rectangular` | The initial example uses a rectangular tank |
| Capacity | `540` | Liters |
| Length | `150` | cm |
| Width | `60` | cm |
| Height | `60` | cm |
| Sensor height | `60` | cm from the reference base |
| Low limit | `30` | percent |
| Critical limit | `15` | percent |
| Consumption | `25` | liters per hour |
| Device code | `pilot-tph-01` | Must match the firmware |
| Send interval | `20` | seconds for live monitoring; history is still rolled up every 5 minutes |
| Key hash | `sha256:...` | Not the raw key |

## How to Get Coordinates

Coordinates may be taken from the map application the team uses, such as Google Maps, then copied into the registry.

Common browser steps:

1. Open Google Maps.
2. Search for the STO location or generator point.
3. Right-click the point considered correct.
4. Copy the coordinate numbers that appear.
5. Make sure the format looks like:

```text
-7.650000, 112.900000
```

The first number is latitude. The second number is longitude.

Enter into the registry:

```json
{
  "latitude": -7.6500000,
  "longitude": 112.9000000,
  "coordinateStatus": "approved"
}
```

Important:

- do not use estimated coordinates for a real demo;
- do not commit sensitive coordinates to GitHub;
- map points should be approved by the field owner;
- if a point is still uncertain, do not set `coordinateStatus` to `approved`.

## How to Prepare the 5-STO Registry

Copy the template:

```powershell
Copy-Item config/pilot-registry.example.json config/pilot-registry.local.json
```

Edit the local file:

```text
config/pilot-registry.local.json
```

For each STO, fill in:

- `id`;
- `code`;
- `name`;
- `regionalLabel`;
- `wilayahLabel`;
- `areaLabel`;
- `latitude`;
- `longitude`;
- `coordinateStatus`;
- `tank`;
- `device`.

This `.local.json` file must not be committed.

## How to Create a Device Key

Every device must have its own key.

Run:

```powershell
pnpm pilot:hash-key
```

Save both results:

```text
RAW_DEVICE_KEY_STORE_SAFELY
API_KEY_HASH_FOR_DATABASE
```

Usage split:

```text
Raw key     -> installed in firmware or used during smoke tests.
sha256 hash -> entered into registry/database.
```

Do not swap these two values.

## Validate and Apply the Registry

Validate without writing to the database:

```powershell
pnpm pilot:registry -- --dry-run
```

If it still errors, stop and fix the local registry file.

If successful:

```powershell
pnpm pilot:registry
```

After applying, check readiness:

```powershell
curl.exe https://solar-tank-monitoring-system.vercel.app/api/ready
```

What to look for:

```text
ok: true
status: ready
storageDriver: mysql
MySQL registry active: 5 sites, 5 tanks, 5 devices
```

If the site count has not reached the target, the 5-STO registry has not fully entered the MySQL used by Vercel.

## How to Read the Dashboard Map

Open:

```text
https://solar-tank-monitoring-system.vercel.app/dashboard
```

The map section can now:

- show a real coordinate-based map;
- show a marker per STO;
- zoom in;
- zoom out;
- pan the map;
- recenter the map;
- search STO, location name, regional, territory, area, or device;
- filter regional, territory, and area to narrow displayed locations;
- filter all, online, warning, critical, or offline;
- hover, keyboard focus, or click a marker to switch the `Overview detail` card;
- click the `Open tank details` button on the detail card to enter the detail page.

How to read the map:

1. Search for the STO through the search field once points are numerous.
2. Pick a status if you only want to see online, warning, critical, or offline devices.
3. Hover the cursor over a marker to see a brief summary.
4. Click a marker to make that STO the active selection.
5. Read the `Overview detail` card on the right side or below the map on phone screens.
6. Click `Open tank details` if you need fuller sensor, tank configuration, payload, and reading flow information.

If a marker does not appear:

1. Check latitude and longitude in the registry.
2. Check `coordinateStatus` when applying the registry.
3. Check whether the registry entered the MySQL used by Vercel.
4. Check browser internet connection, because map tiles come from OpenStreetMap.

## Real Device Endpoint

The device sends to:

```text
POST https://solar-tank-monitoring-system.vercel.app/api/ingest
```

Headers:

```http
Content-Type: application/json
X-Device-Id: pilot-tph-01
X-Device-Key: real-device-key
```

`X-Device-Id` must equal the device code in the registry.

`X-Device-Key` must be the raw key whose hash is already in the database.

## Recommended Payload from the Device

Minimum payload:

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

Most required:

- device id;
- sensor distance;
- tank config;
- battery if available;
- RSSI if available.

Latitude and longitude are not required in the payload, because map location comes from the manual registry.

## What to Check in the ESP8266/NodeMCU Firmware

The firmware must ensure:

1. The device is connected to WiFi.
2. The device knows the endpoint URL:

```text
https://solar-tank-monitoring-system.vercel.app/api/ingest
```

3. The device sends the `POST` method.
4. The device sends headers:

```text
Content-Type: application/json
X-Device-Id: device-code
X-Device-Key: real-device-key
```

5. The device sends a JSON body.
6. The device sends at every agreed interval. The current operational profile uses 20 seconds, while database history is rolled up every 5 minutes.
7. The device logs the HTTP response.

Meaning of common responses:

| Response | Meaning |
|---|---|
| `201` | data accepted |
| `400` | payload broken or field missing |
| `401` | wrong key |
| `404` | device not in the registry |
| `503` | database/storage not ready |

HTTPS notes:

- the Vercel endpoint uses HTTPS;
- ESP8266 needs a compatible HTTPS client;
- do not disable certificate validation for final use without technical approval;
- if HTTPS is problematic in firmware, test with a smoke test first so you know the server is healthy.

## How to Smoke Test Before the Real Device

Local smoke test:

```powershell
$env:PILOT_API_BASE_URL="https://solar-tank-monitoring-system.vercel.app"
$env:PILOT_DEVICE_ID="pilot-tph-01"
$env:PILOT_DEVICE_KEY="real-device-key"
pnpm pilot:smoke
```

If the smoke test succeeds but the device fails, the problem is likely in the firmware, device network, headers, key, or JSON format.

## If the Real Test Day Is Cancelled

Do not send practice data to the database used for an official demo if that data could confuse.

Safe options:

1. Use local development with `memory` storage.
2. Use a staging/practice database.
3. Use a dedicated demo device that is clearly not a field device.
4. Write in the report that the data is a connection test, not operational data.

If you still need to smoke test to Vercel, use the pilot device agreed for testing and do not claim it is operational data.

## Checklist Before the 5-STO Demo

Before the demo:

```powershell
curl.exe https://solar-tank-monitoring-system.vercel.app/api/health
curl.exe https://solar-tank-monitoring-system.vercel.app/api/ready
curl.exe https://solar-tank-monitoring-system.vercel.app/api/dashboard/overview
```

Make sure:

- `/api/health` succeeds;
- `/api/ready` succeeds;
- the registry has 5 sites, 5 tanks, 5 devices;
- the dashboard shows 5 points;
- every map marker is at the correct location;
- search finds the STO code;
- status filters work;
- smoke test succeeds for at least one device;
- the real device succeeds for at least one device;
- no credentials are on screen;
- the displayed location data is allowed to be shared.

## Limits of This Pilot Phase

This phase expands the pilot from the current verified condition toward 5 STOs on the dashboard and data flow side.

But this phase does not yet produce:

- final production SMTP and Turnstile configuration;
- registry admin in the browser;
- routine backup recovery drills;
- a dedicated audit log for failed ingest requests;
- extra network protection for the ingest endpoint;
- automatic key rotation;
- MQTT;
- RTU/Modbus;
- final firmware.

The focus is ensuring map points, registry, device payload, and dashboard can be used for the initial real test.
