# Incident Response

What to do when something breaks in production: how to recognize an incident,
who does what, and how to close it out. Keep this short enough to read during an
incident and specific enough to act on.

## 1. Severity Levels

| Level | Meaning | Examples | Response time |
|---|---|---|---|
| **SEV-1** | Monitoring is down or data is at risk | Database unavailable, ingestion stopped for all devices, suspected credential leak, data loss | Immediate, all hands |
| **SEV-2** | Important function degraded | One site offline, alerts not firing, backups failing, one operator locked out | Same day |
| **SEV-3** | Cosmetic or partial | A report is wrong, a dashboard filter misbehaves, a typo in a notification | Next working day |

## 2. Roles

| Role | Responsibility |
|---|---|
| **Incident lead** | Decides severity, coordinates, is the single voice to stakeholders |
| **Operator** | Runs the commands and checks in the runbooks |
| **Communicator** | Updates site operators and management; keeps the timeline |

On a small team one person may hold all three — say so out loud, so the others
know who is doing what.

## 3. First Five Minutes

1. **Confirm** it is real: `/api/health`, `/api/ready`, the dashboard, and the
   alert centre. Note the exact time.
2. **Declare** severity and the incident lead.
3. **Stop the bleeding** — pick the first that applies:
   - ingestion failing → check `monitoring_ingest_events` rejection reasons and
     the device key state;
   - database unavailable → `docs/disaster-recovery-runbook.md`;
   - a bad deploy → `docs/upgrade-and-rollback.md` § 4;
   - suspected credential leak → rotate the device key from the device registry
     page, disable the affected account, revoke its sessions;
   - alerts not firing → check scheduler runs and `OPS_CRON_SECRET`.
4. **Write down** what you observed and at what time. Timestamps make the
   post-incident review possible.
5. **Tell** the operators what to do in the field if data is unreliable — for
   example, dip-check tanks manually while telemetry is suspect.

## 4. Playbooks

### SEV-1: Database unavailable

1. Check the provider status page.
2. Confirm with `GET /api/ready` — the `mysql` check carries the latency and the
   failure message.
3. If the provider is down: ingest will reject; tell operators to expect a gap.
4. If data is damaged: follow `docs/disaster-recovery-runbook.md` § 5.
5. Record the gap window so the history is honest about missing readings.

### SEV-1: Suspected device key leak or cloned device

1. Open `/dashboard/admin/devices`, rotate the key for the affected device.
2. Re-flash or reconfigure the device with the new key within the grace window
   (`DEVICE_KEY_ROTATION_GRACE_HOURS`, default 72 h).
3. Review `monitoring_ingest_events` for the device: unexpected source IPs,
   unusual volumes, or payloads that do not match the site.
4. If telemetry cannot be trusted, disable the device so its data stops entering
   the history.
5. Rotate any other key that may have been exposed with it, then record the
   rotation in the audit trail notes.

### SEV-2: Telemetry rejected for many devices

1. Alert centre → telemetry rejection alert; read the top device identifiers.
2. Check whether a deploy, a key rotation, or a signature-mode change happened in
   the same window.
3. If `INGEST_SIGNATURE_MODE` was just switched to `required`, verify the fleet
   was flash-updated first; otherwise set it back to `optional` and schedule the
   firmware work.
4. Confirm recovery: acceptances return in the ingest metrics.

### SEV-2: Alerts stopped firing

1. Alert centre → scheduler runs. A failing job shows the error message.
2. Trigger a manual evaluation from the alert centre to reproduce.
3. Check `OPS_CRON_SECRET`, the cron registration, and whether
   `OPS_ALERTS_ENABLED` was disabled for maintenance.
4. Confirm the next scheduled run succeeds, then close the alert that reported it.

### SEV-2: Backup failure

1. Run `pnpm db:backup:mysql` manually and read the error.
2. If the disk is full or the path is unreachable, fix the target and re-run.
3. Run `pnpm db:verify:backup` on the newest successful backup.
4. If no verified backup exists for the current day, treat data recovery as
   at-risk and raise to SEV-1.

### SEV-3: Reading or report looks wrong

1. Compare the reading with the adjacent history and the device's payload
   configuration review (`config_mismatch`).
2. Check the tank configuration against the field record — capacity, mount
   height, thresholds.
3. Correct the registry value if it is wrong; schedule a calibration check if the
   sensor is suspect. Never adjust thresholds to hide a measurement problem.

## 5. Communication Template

```text
[FTM] SEV-<level> — <one line summary>
Impact: <who and what is affected>
Started: <time, timezone>
Status: investigating | mitigated | resolved
Actions: <what we are doing now>
Next update: <time>
```

## 6. Closing an Incident

1. Confirm the service is healthy: `/api/health`, `/api/ready`, fresh readings,
   alert centre quiet (or only known-open alerts).
2. Confirm the data gap or corrupted window is recorded, and that operators know
   what was missing.
3. Write the timeline: detection, decisions, commands, recovery, and duration.
4. Add an entry to `docs/development-log.md`.
5. Create follow-up tasks with owners. Post-incident review within five working
   days for SEV-1 and SEV-2, blameless and focused on system gaps — unclear
   alerts, missing runbook steps, and untested recovery paths.

## 7. What Good Looks Like

- The alert told us before an operator noticed.
- The runbook step we needed already existed.
- The recovery was measured against the drill, so the duration was expected.
- The gap in data is documented, not hidden.
