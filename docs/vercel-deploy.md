# Deploying FTM to Vercel

This guide explains how to deploy FTM (Fuel Tank Management) to a
`*.vercel.app` domain. The sandbox that prepared this repository cannot
reach the Vercel API, so the deploy commands are run by you, locally.

## Prerequisites

- Node.js 20+ and pnpm installed locally.
- A Vercel account and a Git provider connection (GitHub/GitLab/Bitbucket).
- A MySQL database reachable from Vercel (for example Aiven, PlanetScale, or a self-hosted server).
- Optional but recommended for production: SMTP credentials, Cloudflare Turnstile keys, and Telegram bot token.

## 1. Push the repository

```powershell
git add .
git commit -m "Translate FTM to English and prepare Vercel deployment"
git push origin main
```

## 2. Import the project in Vercel

1. Open [vercel.com](https://vercel.com) and choose **Add New -> Project**.
2. Import the `solar-tank-monitoring-system` repository.
3. Keep the framework preset as **Next.js** (the repo contains `vercel.json` with the framework already declared).
4. Do not add env vars yet; deploy once to confirm the build works, then configure production env in the next step.

## 3. Configure environment variables

In the Vercel project, open **Settings -> Environment Variables** and add
these variables to **Production** (and **Preview** if you want the same on preview deployments):

| Variable | Required | Notes |
|---|---|---|
| `SOLAR_TANK_STORAGE_DRIVER` | Yes | `mysql` for pilot/production; `memory` only for local development |
| `MYSQL_DATABASE_URL` | Yes for mysql | Full connection string, e.g. `mysql://user:password@host:port/database` |
| `MYSQL_CONNECTION_LIMIT` | Recommended | Start with `1` on serverless |
| `MYSQL_SSL_MODE` | Recommended | `required` for cloud MySQL |
| `MYSQL_SSL_CA` | Optional | CA certificate PEM if the provider requires it |
| `AUTH_SECRET` | Yes | Generate once: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` |
| `AUTH_REQUIRE_ADMIN_OTP` | Recommended | `true` |
| `AUTH_ENABLE_REGISTER` | Yes | `true` to allow access requests |
| `AUTH_ALLOW_PASSWORD_RESET` | Recommended | `true` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION_FOR_APPROVAL` | Recommended | `true` |
| `AUTH_COOKIE_SECURE` | Yes on HTTPS | `true` |
| `APP_BASE_URL` | Yes | The final Vercel URL, e.g. `https://solar-tank-monitoring-system.vercel.app` |
| `DEVICE_PACKAGE_ENCRYPTION_KEY` | Yes for mysql | Generate once and store safely; needed to decrypt firmware packages |
| `DEVICE_PACKAGE_DOWNLOAD_TTL_DAYS` | Optional | Default `7` |
| `DEVICE_PACKAGE_MAX_DOWNLOADS` | Optional | Default `3` |
| `AUTH_CAPTCHA_PROVIDER` | Recommended | `turnstile` or `disabled` |
| `NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY` | If turnstile | Public site key |
| `AUTH_CAPTCHA_SECRET_KEY` | If turnstile | Secret key |
| `SMTP_HOST` | Recommended | SMTP host for OTP, verification, and reset emails |
| `SMTP_PORT` | Recommended | Usually `587` |
| `SMTP_USER` | Recommended | SMTP username |
| `SMTP_PASS` | Recommended | SMTP password |
| `SMTP_FROM` | Recommended | e.g. `FTM <noreply@example.com>` |
| `SMTP_SECURE` | Optional | `false` for STARTTLS on 587 |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram bot token for notifications and helpdesk |
| `TELEGRAM_WEBHOOK_SECRET` | Optional | Secret for the Telegram webhook |
| `TELEGRAM_BOT_USERNAME` | Optional | Bot username |
| `READINESS_CHECK_TOKEN` | Optional | Token for unauthenticated `/api/ready` checks in production |

Never commit `.env.local`, `config/pilot-registry.local.json`, raw device
keys, or database connection strings. The repository `.gitignore` already
blocks `.env*` (except `.env.example`) and `config/*.local.json`.

## 4. Run database setup

MySQL migrations and seed must run once against the production database.
Run them from your local machine with the production connection string:

```powershell
$env:MYSQL_DATABASE_URL="mysql://user:password@host:port/database"
pnpm db:migrate:mysql
pnpm db:migrate:auth
pnpm db:migrate:auth-recovery
pnpm db:migrate:device-provisioning
pnpm db:migrate:device-request-fields
pnpm db:migrate:reading-rollup
pnpm db:migrate:auth-telegram
pnpm db:migrate:site-taxonomy
pnpm auth:create-admin
```

If the database is fresh and empty, `pnpm db:setup:mysql` runs the same set
plus the reference seeds in one go.

## 5. Redeploy after env changes

Environment variable changes require a redeploy:

```powershell
vercel --prod
```

or use the **Redeploy** button in the Vercel dashboard.

## 6. Verify the deployment

```powershell
curl.exe https://your-project.vercel.app/api/health
curl.exe https://your-project.vercel.app/api/ready
```

- `/api/health` must return HTTP 200.
- `/api/ready` must return HTTP 200 with `"storageDriver":"mysql"` and all checks `ok`.
  If it returns 503, check `MYSQL_DATABASE_URL`, SSL/CA, database status,
  and the provider allowlist for Vercel's egress IPs.

Then sign in with the admin account created in step 4, apply the pilot
registry (`pnpm pilot:registry`), and send a smoke payload (`pnpm pilot:smoke`)
to confirm the full ingest flow.

## Rollback

Vercel keeps previous deployments. In the Vercel dashboard, open
**Deployments**, find the previous working deployment, and choose
**Promote to Production**. Database migrations are additive in this
project; see `docs/database-backup.md` before any destructive change.
