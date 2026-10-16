# Initial 5-STO Rollout Target

This document explains how to expand the operational pilot toward the initial 5-STO target with approved data. As of 13–14 July 2026, the verified condition is 3 registered sites, 3 tanks, and 3 devices; the number 5 in this document is the next-stage target, not a claim of active location count. The focus is proving the flow:

```text
real device or smoke test
  -> POST /api/ingest
  -> MySQL live snapshot + 5-minute rollup
  -> dashboard
  -> tank detail
```

This document is deliberately written slowly so non-IT readers can follow it.

## Status

Available:

- active pilot deployment on Vercel;
- MySQL cloud storage option;
- site/tank/device registry from MySQL;
- regional, territory, area, and STO location grouping;
- per-device key validation;
- real device payload normalization;
- payload config vs registry review;
- pilot registry apply script;
- device key/hash generation script;
- ingest smoke test script.
- dashboard map based on registry coordinates.
- MySQL-based sign-in, access request, user session, admin/user roles, admin OTP, password reset, email verification, and auth audit.

Not final:

- production SMTP and official email domain;
- production Turnstile for public forms;
- extra protection outside the application to limit harmful traffic to the ingest endpoint;
- dedicated audit log for failed ingest requests;
- production database backup;
- final server decision;
- RTU/Modbus integration;
- MQTT broker.

## Safety Principles

Never commit:

- `config/pilot-registry.local.json`;
- `.env.local`;
- raw device keys;
- database connection strings;
- internal IPs;
- coordinates that may not be shared;
- screenshots showing credentials.

The only file allowed to be committed is the safe template:

```text
config/pilot-registry.example.json
```

## Important Files

| File | Function |
|---|---|
| `config/pilot-registry.example.json` | sample pilot registry format |
| `config/pilot-registry.local.json` | local real file, must be created yourself and never committed |
| `scripts/generate-device-key.mjs` | creates device key and hash |
| `scripts/apply-pilot-registry.mjs` | validates and applies the registry to MySQL |
| `scripts/smoke-pilot-ingest.mjs` | sends real-format payloads for quick testing |
| `docs/field-pilot-5-sto-guide.md` | 5-STO field guide from coordinates to device sending data |

## Big Flow

```text
1. Prepare the MySQL database.
2. Prepare .env.local for MySQL, auth, SMTP, and CAPTCHA per the target.
3. Generate the device key and hash.
4. Copy the registry template to a local file.
5. Fill in 5 STOs, approved coordinates, tanks, devices, and hashes.
6. Validate the registry with dry-run.
7. Apply the registry to MySQL.
8. Check /api/ready.
9. Send a smoke payload.
10. Open the dashboard and detail.
```

## 1. Prepare the Environment

For cloud MySQL such as Aiven, the minimum `.env.local`:

```env
SOLAR_TANK_STORAGE_DRIVER="mysql"
MYSQL_DATABASE_URL="mysql://user:password@host:port/database"
MYSQL_CONNECTION_LIMIT="1"
MYSQL_SSL_MODE="required"
SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK="false"
AUTH_SECRET="replace-with-secret-minimum-32-characters"
AUTH_REQUIRE_ADMIN_OTP="true"
AUTH_ENABLE_REGISTER="true"
AUTH_ALLOW_PASSWORD_RESET="true"
AUTH_REQUIRE_EMAIL_VERIFICATION_FOR_APPROVAL="true"
AUTH_CAPTCHA_PROVIDER="turnstile"
NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY="turnstile-site-key"
AUTH_CAPTCHA_SECRET_KEY="turnstile-secret-key"
```

If the provider supplies a CA certificate:

```env
MYSQL_SSL_CA="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
```

Note:

```text
After changing .env.local, restart the dev server.
The dashboard refresh button does not re-read env.
```

## 2. Run the Migrations

The migrations create the required monitoring and auth tables:

```powershell
pnpm db:setup:mysql
pnpm auth:create-admin
```

If the database was created before the device request operational fields were available, also run these migrations:

```powershell
pnpm db:migrate:device-provisioning
pnpm db:migrate:device-request-fields
pnpm db:migrate:reading-rollup
pnpm db:migrate:auth-telegram
pnpm db:migrate:site-taxonomy
```

For an operational database that already contains data, run `pnpm db:backup:mysql` before migrating. The rollup migration does not delete old raw data; it adds schema, backfills the latest snapshot, and prepares 5-minute history for the new writer.

If it fails, check:

- `MYSQL_DATABASE_URL`;
- SSL/CA;
- database status;
- provider allowlist if any;
- internet connection.

## 2.1 Clean Device/Test Data If a Restart Is Needed

Use these steps when the team wants to delete temporary device data, for example after firmware template testing and before entering real device data.

Safe steps:

1. Sign in as admin.
2. Open the **Review requests** page:

```text
http://localhost:3000/dashboard/admin/device-requests
```

or the deployment domain in use.

3. If old data appears on dashboard cards and does not come from a new request, open the dashboard then click the **X** icon on that STO card.
4. If only one device request needs deletion, find its card then click **Delete data**.
5. If there are many requests, use the search field or status filter on the **Review requests** page.
6. If several requests need deletion, check **Delete checked requests** on the matching cards, fill the confirmation phrase in the **Delete checked requests** control, then click **Clean up selection**.
7. If all device monitoring data must be cleared, open the **Clean up all device operational data** section and type the requested confirmation phrase.
8. Read the browser confirmation before approving the action.
9. Check the success message.
10. Open the dashboard to make sure the application is still alive. If you used the reset-all option, it is reasonable for `/api/ready` to report an incomplete registry until device data is created again.

Cleaned:

- `monitoring_ingest_events`;
- `monitoring_device_provisioning_events`;
- `monitoring_device_packages`;
- `monitoring_device_requests`;
- `monitoring_readings`;
- `monitoring_devices`;
- `monitoring_tanks`;
- `monitoring_sites` when no longer used by other devices/tanks.

Not cleaned:

- admin/user accounts;
- auth sessions and audit;
- firmware templates;
- hardware profiles;
- environment configuration.

After specific items are cleaned, only data related to those items disappears. After reset-all, the dashboard is reasonably empty until a new device request is approved or the device registry is recreated.

## 3. Generate the Device Key and Hash

Every pilot device must have its own key.

Run:

```powershell
pnpm pilot:hash-key
```

The output contains two parts:

```text
RAW_DEVICE_KEY_STORE_SAFELY
API_KEY_HASH_FOR_DATABASE
```

What goes into the registry is the hash:

```text
sha256:...
```

The raw key is only used in firmware/device or during smoke tests.

If you already have a key from the device:

```powershell
$env:DEVICE_KEY="real-device-key"
pnpm pilot:hash-key
```

The script will not print the key from env again. It only prints the hash.

## 4. Create the Local Registry

Copy the template:

```powershell
Copy-Item config/pilot-registry.example.json config/pilot-registry.local.json
```

Edit:

```text
config/pilot-registry.local.json
```

What must be replaced:

- the names of the 5 STOs per data you may use;
- the regional, territory, and area of every STO per the approved organizational structure;
- approved real coordinates;
- `coordinateStatus` to `approved`;
- final device code;
- final device key hash;
- tank capacity and dimensions;
- device send interval.

Important section example:

```json
{
  "id": "site-tph",
  "code": "TPH",
  "name": "STO TPH",
  "regionalLabel": "TREG 5",
  "wilayahLabel": "TIF 3",
  "areaLabel": "Pasuruan",
  "latitude": -7.6500000,
  "longitude": 112.9000000,
  "coordinateStatus": "approved",
  "tank": {
    "shape": "rectangular",
    "capacityLiter": 540,
    "lengthCm": 150,
    "widthCm": 60,
    "heightCm": 60,
    "sensorMountHeightCm": 60,
    "lowLevelPercent": 30,
    "criticalLevelPercent": 15,
    "consumptionLiterPerHour": 25
  },
  "device": {
    "code": "pilot-tph-01",
    "expectedReportIntervalSec": 20,
    "apiKeyHash": "sha256:hash_result_here"
  }
}
```

## 5. Validate the Registry Without Writing the Database

Run:

```powershell
pnpm pilot:registry -- --dry-run
```

If it succeeds, the script shows a 5-STO summary.

If it fails, follow the error message. Examples:

| Error | Meaning |
|---|---|
| `coordinateStatus must be approved` | coordinates are not yet marked allowed for use |
| `apiKeyHash is still a placeholder hash` | real key hash not yet generated |
| `criticalLevelPercent must be smaller` | the critical limit must not be higher than the low limit |
| `The pilot registry must contain at least 5 active sites` | not enough STOs |

## 6. Apply the Registry to MySQL

If dry-run succeeded:

```powershell
pnpm pilot:registry
```

The script will upsert:

- `monitoring_sites`;
- `monitoring_tanks`;
- `monitoring_devices`.

Upsert means:

```text
If the data does not exist yet, it is created.
If the data already exists, it is updated.
```

The script does not delete reading history.

## 7. Check Readiness

Local:

```powershell
curl.exe http://localhost:3000/api/ready
```

Vercel:

```powershell
curl.exe https://solar-tank-monitoring-system.vercel.app/api/ready
```

What to look for:

```text
ok: true
status: ready
storageDriver: mysql
mysql: ok
mysql-reference-registry: active
mysql-reading-rollup: active
mysql-location-taxonomy: active
```

## 8. Smoke Test the Payload

A smoke test sends a payload without waiting for a physical device.

Local:

```powershell
$env:PILOT_API_BASE_URL="http://localhost:3000"
$env:PILOT_DEVICE_ID="pilot-tph-01"
$env:PILOT_DEVICE_KEY="real-tph-device-key"
pnpm pilot:smoke
```

Vercel:

```powershell
$env:PILOT_API_BASE_URL="https://solar-tank-monitoring-system.vercel.app"
$env:PILOT_DEVICE_ID="pilot-tph-01"
$env:PILOT_DEVICE_KEY="real-tph-device-key"
pnpm pilot:smoke
```

The default payload uses this technical example:

```text
rectangular tank 150 x 60 x 60 cm
capacity 540 L
distance 10.2 cm
fuel height 49.8 cm
volume 448.2 L
fill 83%
consumption 25 L/hr
runtime 17.93 hrs
```

To view the payload without sending:

```powershell
pnpm pilot:smoke -- --dry-run
```

To change the distance:

```powershell
pnpm pilot:smoke -- --distance-cm 18.5
```

If the response is `401`:

```text
Wrong key or the registry hash does not match.
```

If the response is `404`:

```text
Device not found in the MySQL registry.
```

If the response is `503`:

```text
Database/storage not ready. Check /api/ready.
```

If the response succeeds but `needsReview=true`:

```text
Payload accepted, but the payload configuration differs from the registry. Check dimensions, capacity, shape, and hourly consumption.
```

## 9. Check the Dashboard

Open:

```text
https://solar-tank-monitoring-system.vercel.app/dashboard
```

Expected:

- the dashboard shows at least 5 STOs after the pilot registry is applied;
- the dashboard map shows points from registry latitude and longitude;
- map search and filter can find the target STO;
- the STO that just received a smoke payload has latest data;
- device status is not offline when new data arrives and the interval is correct;
- tank detail shows volume, percent, runtime, and config status.

Detail:

```text
https://solar-tank-monitoring-system.vercel.app/dashboard/operations/tanks/tank-tph-main
```

## 10. Where a Real Device Sends

Endpoint:

```text
POST https://solar-tank-monitoring-system.vercel.app/api/ingest
```

Headers:

```http
Content-Type: application/json
X-Device-Id: pilot-tph-01
X-Device-Key: real-device-key
```

Recommended minimum payload:

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

Firmware notes:

- do not put the key in public screenshots;
- make sure the device ID matches the registry;
- make sure the raw key matches the hash in the database;
- use HTTPS;
- the send interval follows `expectedReportIntervalSec`;
- if the endpoint changes, the firmware must be pointed to the new URL.
- map latitude and longitude come from the manual registry, not from the device.

A longer field guide is available at:

```text
docs/field-pilot-5-sto-guide.md
```

## 11. Team Demo Checklist

Before the demo:

```powershell
curl.exe https://solar-tank-monitoring-system.vercel.app/api/health
curl.exe https://solar-tank-monitoring-system.vercel.app/api/ready
curl.exe https://solar-tank-monitoring-system.vercel.app/api/dashboard/overview
```

Make sure:

- `/api/health` succeeds;
- `/api/ready` succeeds;
- the registry count matches the pilot target;
- the smoke payload succeeded;
- the dashboard changed;
- the detail numbers match the payload;
- no credentials are on screen;
- the displayed data is allowed to be shared.

Safe report wording:

```text
The web monitoring pilot flow can be tried:
a 5-STO registry is prepared in MySQL,
a device sends a payload to /api/ingest,
the API validates the device and key,
data enters the database,
the dashboard reads the latest data,
and tank detail shows volume, percent, runtime, and config status.
```

## 12. Pilot Limits

This pilot does not yet mean final production.

Before production, still needed:

- production SMTP and Turnstile;
- extra network protection beyond application rate limiting;
- a dedicated audit log for failed ingest requests;
- database backup recovery drills;
- device key rotation from the UI/official procedure;
- server monitoring;
- SOP for when a device goes offline;
- device safety validation;
- location data approval;
- final server decision.
