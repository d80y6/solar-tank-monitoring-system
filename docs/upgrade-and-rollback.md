# Upgrade and Rollback Guide

How to ship a new version of FTM and how to get back to the previous one. The
guiding rule is that **data is never deleted by a deployment**: migrations are
additive, and a rollback reverts the application, not the database.

## 1. Before Every Upgrade

| Step | Command / action |
|---|---|
| Confirm the working tree is clean and on the intended commit | `git status`, `git log --oneline -5` |
| Run the full gate locally | `pnpm check` |
| Confirm CI is green on the same commit | GitHub Actions run for the branch |
| Take a fresh backup | `pnpm db:backup:mysql` then `pnpm db:verify:backup` |
| Read the migrations in the release | `git diff --stat <previous>..<new> -- database/migrations` |
| Announce the window | Operations channel |

Never deploy during an active incident, and never deploy a change whose
migrations you have not read.

## 2. Migration Rules

- Migrations are **additive and re-runnable**: they use
  `CREATE TABLE IF NOT EXISTS` and `INSERT IGNORE`, or an explicit
  `information_schema` guard.
- Every migration records itself in `schema_migrations` (path, checksum,
  statements, duration).
- **Never edit a migration that has been applied.** The ledger compares
  checksums and reports drift; the correct fix is a new migration.
- Destructive changes (dropping a column or table) are only acceptable with a
  recorded decision, a verified backup, and a two-step release: stop writing to
  the old shape, then remove it in a later release.

Apply migrations:

```powershell
pnpm db:migrations:check      # what is pending or drifted, before touching anything
pnpm db:setup:mysql           # applies every migration, re-runnable and idempotent
pnpm db:migrations:check      # must now report 0 pending, 0 drifted
```

Each migration can also be applied alone, for example:

```powershell
pnpm db:migrate:device-key-rotation
pnpm db:migrate:site-access
```

## 3. Deploying the Application

The application and the database are deployed separately, application first only
when the migrations it needs are already applied.

1. Apply migrations (section 2) — additive, so the current version keeps running.
2. Deploy the new build (push to `main`, or promote in the hosting platform).
3. Verify the deployment:

```powershell
curl.exe https://<host>/api/health
curl.exe -H "x-solar-tank-ops-token: $env:READINESS_CHECK_TOKEN" https://<host>/api/ready
```

4. Confirm the expected behaviour:

| Check | Expectation |
|---|---|
| `/api/health` | `status: "ok"` and a `build.commitSha` matching the deployed commit |
| `/api/ready` | `ready`, or `degraded` only for checks you expect to be degraded |
| Dashboard | Locations, tanks, and devices load; readings are fresh |
| Alert centre | Next scheduled run writes a job run row |
| Ingest | A device or simulator ping is accepted (`ingest_events` shows it) |

5. Watch for five minutes: `/api/metrics` error counters, `solar_tank_errors_total`,
   and server logs for a new error signature.

## 4. Rollback

Rollback is a traffic switch, not a database operation.

### Application rollback

1. Promote the previous build in the hosting platform (Vercel → Deployments →
   previous deployment → *Promote to Production*), or redeploy the previous
   commit.
2. Re-run the verification in section 3.
3. Keep the database as it is: every migration in this repository is additive,
   so the older application version keeps working against the newer schema.

### When a migration itself is the problem

1. Stop the writers that feed the affected table (disable the scheduler task, or
   set `OPS_ALERTS_ENABLED="false"` while investigating).
2. Restore into a scratch database to reproduce the failure safely.
3. Write a **new forward migration** that repairs or reshapes the data — do not
   edit the applied migration.
4. Only if the schema change is provably harmless to remove, drop the new column
   or table in its own migration, after a verified backup.

### Environment rollback

A bad environment variable is often mistaken for a bad build. Check
`/api/ready` first: fatal boot-guardrail findings (see
`src/lib/production-guardrails.ts`) make the deployment refuse to start and name
the variable in the logs. Restore the previous value, redeploy, then investigate.

## 5. Rollback Drills

A rollback path that has never been exercised is a guess. Twice a year:

- [ ] Deploy the current version to a preview environment.
- [ ] Promote the previous build and confirm `/api/health` reports the older
      commit while the newer schema is still in place.
- [ ] Restore the newest backup into a scratch database and run
      `pnpm db:migrations:check` against it.
- [ ] Record the outcome — date, versions, and anything that surprised the
      operator — in `docs/development-log.md`.

## 6. Troubleshooting Quick Reference

| Symptom | First check |
|---|---|
| Deploy fails immediately with `Unsafe production configuration detected` | The named variable in the log; fix it or restore the previous value |
| `/api/ready` is `not_ready` | The failing check name and message in the JSON payload |
| Readings stop after a deploy | Device key version, ingest signature mode, and `monitoring_ingest_events` rows |
| Dashboard empty for one operator | Location scopes: `/dashboard/admin/access-scopes` and `AUTH_ENFORCE_SITE_SCOPES` |
| Alerts stop firing | Scheduler runs in the alert centre, then `OPS_CRON_SECRET` and the cron registration |
| Slow queries after a release | New indexes are additive; check the database provider's slow query log |
