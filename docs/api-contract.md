# API Contract

This document describes the available endpoints and the expected data shapes.

Local base URL:

```text
http://localhost:3000
```

## Endpoint Summary

| Method | Endpoint | Function |
|---|---|---|
| `GET` | `/api/health` | Checks the application is alive without checking the database |
| `GET` | `/api/ready` | Checks active storage readiness |
| `GET` | `/api/dashboard/overview` | Summary of all locations/tanks |
| `GET` | `/api/tanks/[tankId]` | Detail of one tank |
| `GET` | `/api/tanks/[tankId]/readings` | Reading history of one tank |
| `GET` | `/api/tanks/[tankId]/readings/export` | Download one tank's reading CSV |
| `POST` | `/api/ingest` | Accepts device or simulator data |
| `POST` | `/api/auth/login` | Sign in with email/username and password |
| `POST` | `/api/auth/login/verify-otp` | Verify admin sign-in OTP |
| `POST` | `/api/auth/logout` | Sign out and revoke the active session |
| `GET` | `/api/auth/me` | Read the active user session |
| `POST` | `/api/auth/register-request` | Submit a new user access request |
| `GET` | `/api/auth/email/verify` | Verify email from the token link |
| `POST` | `/api/auth/email/resend-verification` | Resend the verification email |
| `POST` | `/api/auth/password/forgot` | Request a password reset link |
| `POST` | `/api/auth/password/reset` | Change password using the reset token |
| `POST` | `/api/auth/password/change` | Change password for the signed-in user |
| `GET` | `/api/auth/sessions` | View the user's active sessions |
| `POST` | `/api/auth/sessions/revoke` | Revoke the user's other sessions |
| `POST` | `/api/auth/telegram/bind/start` | Create a Telegram binding token |
| `POST` | `/api/auth/telegram/webhook` | Telegram webhook for binding |

## GET /api/health

Function:

```text
Checks whether the Next.js application is alive.
```

This endpoint does not check the database. Use it to tell whether a problem is in the application or in storage.

Example:

```powershell
curl.exe http://localhost:3000/api/health
```

Success response:

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "service": "solar-tank-monitoring-system",
    "timestamp": "2026-07-08T00:00:00.000Z"
  }
}
```

## GET /api/ready

Function:

```text
Checks whether active storage is ready for the dashboard and read APIs.
```

This endpoint carries operational details and in production may only be opened with an admin session or the readiness token.

If `SOLAR_TANK_STORAGE_DRIVER="memory"`, the endpoint still succeeds but its status is `degraded` because memory data is not permanent.

If `SOLAR_TANK_STORAGE_DRIVER="mysql"`, the endpoint tests the MySQL connection directly. If MySQL fails, the response uses HTTP `503`.

Example:

```powershell
curl.exe http://localhost:3000/api/ready
```

MySQL ready response:

```json
{
  "ok": true,
  "data": {
    "ok": true,
    "status": "ready",
    "storageDriver": "mysql",
    "checks": [
      {
        "name": "mysql",
        "ok": true,
        "status": "ok",
        "message": "MySQL connection active."
      },
      {
        "name": "mysql-reference-registry",
        "ok": true,
        "status": "ok",
        "message": "MySQL registry active: 3 sites, 3 tanks, 3 devices."
      },
      {
        "name": "mysql-reading-rollup",
        "ok": true,
        "status": "ok",
        "message": "Live snapshots and 5-minute reading rollups are ready."
      }
    ]
  }
}
```

MySQL not-ready response:

```json
{
  "ok": false,
  "data": {
    "ok": false,
    "status": "not_ready",
    "storageDriver": "mysql",
    "checks": [
      {
        "name": "mysql",
        "ok": false,
        "status": "error",
        "message": "MySQL connection failed. Check MYSQL_DATABASE_URL, database status, SSL, network, and the provider allowlist."
      }
    ]
  }
}
```

Note:

```text
If you just changed .env.local, restart the dev server.
The dashboard retry button does not reload env.
```

## GET /api/dashboard/overview

Function:

```text
Fetches the dashboard summary.
```

Example:

```powershell
curl.exe http://localhost:3000/api/dashboard/overview
```

Success response:

```json
{
  "ok": true,
  "data": {
    "summary": {
      "totalSites": 4,
      "totalTanks": 4,
      "onlineDevices": 1,
      "delayedDevices": 0,
      "offlineDevices": 3,
      "criticalTanks": 1
    },
    "rows": []
  },
  "meta": {
    "storage": {
      "configuredDriver": "mysql",
      "activeDriver": "mysql",
      "isFallback": false,
      "label": "Database MySQL"
    },
    "registry": {
      "configuredDriver": "mysql",
      "activeDriver": "mysql",
      "isFallback": false,
      "label": "Registry MySQL"
    }
  }
}
```

Note:

```text
The data field contains the dashboard contents. The meta.storage field helps you see whether readings are being read from MySQL or local memory. If MySQL mode is active but the reading table is still empty, the API still uses MySQL and returns an empty reading list; the dashboard shows STOs from the registry with a no data yet status. The meta.registry field helps you see whether site/tank/device references are read from local memory or MySQL. On MySQL, the overview compares the live snapshot with the latest history candidates and picks the newest receivedAt so status stays consistent during deployment transition.
```

## GET /api/tanks/[tankId]

Function:

```text
Fetches the detail of one tank.
```

Example:

```powershell
curl.exe http://localhost:3000/api/tanks/tank-tph-main
```

A successful response contains:

- tank identity;
- location;
- status;
- volume in liters;
- fill percent;
- runtime;
- sensor parameters;
- latest data;
- compact history;
- sample location points.

If `tankId` is not found:

```json
{
  "ok": false,
  "error": "Tank not found."
}
```

## GET /api/tanks/[tankId]/readings

Function:

```text
Fetches the reading history of one tank.
```

Notes:

- `measuredAt` and `receivedAt` are ISO UTC.
- The UI may display WIB labels, but the API still sends standard UTC times.
- This endpoint reads the related tank history, not the global dashboard list.
- After the rollup migration, new history items represent 5-minute buckets and may carry `resolution`, `bucketStart`, `bucketEnd`, `sampleCount`, mean values, and min/max.

Example:

```powershell
curl.exe "http://localhost:3000/api/tanks/tank-tph-main/readings?range=24h"
```

Success response:

```json
{
  "ok": true,
  "data": {
    "tankId": "tank-tph-main",
    "range": "24h",
    "items": [
      {
        "measuredAt": "2026-06-25T07:40:00.000Z",
        "receivedAt": "2026-06-25T07:40:03.000Z",
        "volumeLiter": 3900,
        "fillPercent": 78,
        "runtimeHour": 156
      }
    ]
  }
}
```

## GET /api/tanks/[tankId]/readings/export

Function:

```text
Downloads one tank's reading CSV for the selected period.
```

This endpoint requires an active user/admin session. The CSV uses English snake_case headers, includes UTC and WIB times, and the filename automatically contains the site, tank, range, and period dates.

The CSV also includes reading resolution, bucket bounds, sample count, mean in the main value columns, and min/max volume and percentage. Old raw history can still be exported alongside rollup rows.

Query:

| Parameter | Value | Default | Description |
|---|---|---|---|
| `range` | `day`, `week`, `month` | `day` | 1 day, 7 day, or 30 day period based on the WIB calendar |

Accepted aliases:

- `1d` and `24h` for `day`;
- `7d` for `week`;
- `30d` for `month`.

Example:

```powershell
curl.exe -L "http://localhost:3000/api/tanks/tank-tph-main/readings/export?range=week"
```

Example filename:

```text
solartank_tph_main-tank_reading_7-days_2026-07-01_to_2026-07-07.csv
```

If `range` is unknown:

```json
{
  "ok": false,
  "error": "Unknown export range. Use day, week, or month."
}
```

## POST /api/ingest

Function:

```text
Accepts payloads from a device, simulator, or pilot smoke test.
```

On MySQL storage, one valid request updates the live snapshot and the 5-minute aggregate in a single transaction. The success response is sent only after both operations are committed.

Required headers:

```http
Content-Type: application/json
X-Device-Id: demo-tph-01
X-Api-Key: demo-tph-key
```

`X-Device-Key` is also accepted as an alternative to `X-Api-Key`.

Key notes:

- each sample device has its own development key;
- the `local-development-key` fallback is only for local development;
- for a mode closer to the pilot, set `SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK="false"`.

Sample payload:

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

Real-format pilot payloads are also supported. This payload can carry tank configuration from the device:

```json
{
  "device": "pilot-tph-01",
  "tank_shape": "rectangular",
  "capacity_liter": 540,
  "length_cm": 150,
  "width_cm": 60,
  "height_cm": 60,
  "sensor_mount_height_cm": 60,
  "consumption_liter_per_hour": 25,
  "distance": 10.2,
  "voltage": 3.7,
  "raw": {
    "local_H_cm": 49.8,
    "local_volume_l": 448.2,
    "local_percent": 83,
    "wifi_rssi": -54
  }
}
```

Regional, territory, and area are not sent on every reading. That data comes from the approved site registry and is joined by the server based on device identity. This way, one firmware typo does not move an STO to a different location group.

curl example:

```powershell
curl.exe -X POST http://localhost:3000/api/ingest `
  -H "Content-Type: application/json" `
  -H "X-Device-Id: demo-tph-01" `
  -H "X-Api-Key: demo-tph-key" `
  -d "{\"device\":\"demo-tph-01\",\"ts\":0,\"distance\":40.5,\"voltage\":3.86,\"raw\":{\"H_cm\":109.5,\"volume\":3650,\"percent\":73,\"wifi_rssi\":-55}}"
```

Success response:

```json
{
  "ok": true,
  "data": {
    "deviceId": "demo-tph-01",
    "tankId": "tank-tph-main",
    "volumeLiter": 3650,
    "fillPercent": 73,
    "runtimeHour": 146,
    "storage": "memory",
    "configStatus": "no_payload_config",
    "needsReview": false,
    "warnings": []
  }
}
```

The `storage` value can be:

| Value | Meaning |
|---|---|
| `memory` | Reading stored temporarily in the development memory store |
| `mysql` | Reading stored to MySQL per `MYSQL_DATABASE_URL` |

The `configStatus` value helps you see whether the payload configuration matches the registry:

| Value | Meaning |
|---|---|
| `no_payload_config` | Payload carries no tank configuration |
| `config_match` | Payload configuration and registry match |
| `config_minor_difference` | Small difference worth knowing |
| `config_mismatch` | Large difference that needs review |
| `invalid_payload_config` | Payload configuration is invalid |

## Possible Errors

| Status | Cause |
|---|---|
| `400` | Body is not valid JSON or the payload does not match |
| `401` | Key is empty or wrong |
| `403` | Device is not active |
| `404` | Device or tank not found |
| `503` | Active storage not ready, especially MySQL cannot be connected |

Error response example:

```json
{
  "ok": false,
  "error": "Device key is invalid."
}
```

## Auth Endpoints

Auth endpoints use a common JSON response:

```json
{
  "ok": true,
  "data": {}
}
```

On failure:

```json
{
  "ok": false,
  "error": "Error message"
}
```

Auth security notes:

- `/api/auth/register-request`, `/api/auth/password/forgot`, and `/api/auth/email/resend-verification` can be protected by Turnstile when `AUTH_CAPTCHA_PROVIDER="turnstile"`;
- the security verification token is sent as `captchaToken`;
- admin sign-in can return an `otp_required` status when admin OTP is active;
- the session is sent as an `httpOnly` cookie;
- admin pages are still validated server-side using the admin role, not merely hidden from the UI;
- password reset, email verification, and Telegram binding use one-time tokens stored as hashes in the database.

Sign-in example:

```powershell
curl.exe -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" `
  -d "{\"identity\":\"admin@example.com\",\"password\":\"Password12345\"}"
```

Access request example:

```powershell
curl.exe -X POST http://localhost:3000/api/auth/register-request `
  -H "Content-Type: application/json" `
  -d "{\"fullName\":\"Monitoring Operator\",\"username\":\"operator_1\",\"email\":\"operator@example.com\",\"phone\":\"081234567890\",\"password\":\"Password12345\",\"confirmPassword\":\"Password12345\",\"requestedRole\":\"user\",\"accessReason\":\"Need to monitor the Pasuruan area STO\",\"captchaToken\":\"turnstile-token\"}"
```

## Version Notes

This API contract serves the development and pilot of the web monitoring. It is not yet a permanent contract for all devices nationwide.

Before production, these need to be added or refined:

- site/tank/device registry management pages;
- API versioning rules before many device models are installed;
- extra network protection beyond application rate limiting;
- device key rotation;
- routine database restore drills;
- production SMTP and Turnstile;
- API versioning once devices are numerous.
