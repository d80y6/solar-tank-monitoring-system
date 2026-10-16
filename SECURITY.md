# Security Policy

This repository is public-safe: every example payload, configuration value, and
document must be safe to read publicly.

## Never Commit Sensitive Data

Never commit:

- real API keys;
- deployment tokens;
- database passwords;
- `.env.local` files;
- WiFi credentials;
- private keys;
- production domains;
- internal IP addresses;
- real telemetry payloads;
- sensitive location data;
- database backups;
- private server configuration;
- screenshots that contain internal information.

Use `.env.example` only for variable names and dummy values.

## Local Device Keys

For local development the ingest API can use the demo key of each device:

```text
demo-tph-01 -> demo-tph-key
demo-nja-01 -> demo-nja-key
demo-jto-01 -> demo-jto-key
demo-skp-01 -> demo-skp-key
```

Those keys are examples only and must never be used in production.

The global `local-development-key` fallback remains available for early practice
until it is switched off. To change the local fallback key:

```powershell
$env:SOLAR_TANK_LOCAL_DEVICE_KEY="replace-with-a-local-key"
pnpm dev
```

Then run the simulator with the same key:

```powershell
pnpm simulate:device --key replace-with-a-local-key --once
```

## Current Security Boundary

Already in place:

- the ingest API checks `X-Device-Id`, `X-Api-Key` (or `X-Device-Key`), the
  device registry, and the active state of the device;
- a device payload whose identity does not match its headers is rejected;
- per-device key hashes are compared in constant time;
- the global key fallback can be disabled with
  `SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK="false"`, and readiness refuses
  it in production-like environments;
- optional HMAC-SHA256 request signing with a timestamp window and a nonce
  store (`INGEST_SIGNATURE_MODE`), plus request-body size limits;
- user accounts, sessions, and roles are stored in MySQL; browser cookies are
  `httpOnly`, `sameSite=lax`, and `secure` in production;
- `admin` and `user` roles gate the admin pages, and per-location scopes
  (`viewer`/`operator` per site) gate which tank and reading data an operator
  can read once `AUTH_ENFORCE_SITE_SCOPES` is enabled;
- passwords use Argon2id, legacy hashes are flagged for upgrade, and admin
  sign-in can require an e-mail OTP;
- public access requests stay pending until an administrator reviews them;
- e-mail verification, password reset, and password change use single-use
  hashed tokens;
- public forms can be protected by Cloudflare Turnstile through
  `AUTH_CAPTCHA_PROVIDER="turnstile"`;
- rate limiting covers sign-in, access requests, password reset, verification
  resend, helpdesk, and ingest (durable MySQL buckets with an in-process
  fallback);
- the security audit log records sign-in, OTP, password reset, e-mail
  verification, role changes, account activation/deactivation, location scope
  changes, device key rotation, hardware registry changes, and session actions;
- account security pages let a user change the password, review active
  sessions, revoke other sessions, and bind Telegram;
- device requests generate a device key and an encrypted firmware package
  after approval, downloaded only through a limited, expiring token;
- new devices stay inactive until the first valid ping with a matching key;
- admin cleanup of device/test data never deletes user/admin accounts, firmware
  templates, or hardware profiles.

Not in place yet:

- perimeter/CDN request protection (WAF, bot rules, IP allowlists) on the final
  deployment;
- Telegram approve/reject for device requests (Telegram currently handles
  binding and notifications);
- firmware code signing or verified TLS trust anchors in the field template
  (see `docs/decision-log.md`);
- physical sensor calibration and safety approval per location.

## Reporting a Security Issue

If you find a security issue:

1. Do not open a public issue containing secrets or exploitation details.
2. Contact the maintainers privately.
3. Include reproduction steps without sharing real credentials.
4. If a sensitive file already reached Git, stop pushing and clean the history
   carefully with the maintainers.

## Pre-Deployment Checklist

Before a real deployment:

- replace every example key;
- keep secrets in the environment, never in the repository;
- disable the global device key fallback;
- run all monitoring and auth database migrations, then
  `pnpm db:migrations:check` (0 pending, 0 drifted);
- create the first administrator with `pnpm auth:create-admin`;
- set `AUTH_SECRET` to at least 32 characters;
- configure SMTP for admin OTP, e-mail verification, and password reset;
- enable Turnstile for public forms and make sure the site key and secret key
  come from the same widget;
- set `AUTH_COOKIE_SECURE="true"` on an HTTPS domain;
- enforce HTTPS;
- keep admin pages restricted to the `admin` role;
- run ingest in MySQL mode so the durable rate limiter is active;
- configure TLS, timeouts, payload limits, and logging at the agreed perimeter;
- use a database with backups, encrypt them with
  `MYSQL_BACKUP_ENCRYPTION_KEY`, and test a restore
  (`docs/disaster-recovery-runbook.md`);
- review the security audit log regularly;
- validate device payloads;
- review the server configuration;
- work through `docs/production-go-live-checklist.md`.

## Supported Branch

For this phase, security fixes target the `main` branch.
