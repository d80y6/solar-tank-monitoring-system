# Operational Runbook

Daily operating procedure for the FTM monitoring platform: what to check,
what to do when an alert fires, and how to escalate.

## 1. Routine Schedule

| Frequency | Task | Where |
|---|---|---|
| Continuous | Alerts evaluated every 10 minutes | `/api/cron/ops` (Vercel Cron) |
| Daily | Review the alert centre; acknowledge and resolve conditions | `/dashboard/admin/alerts` |
| Daily | Confirm every active device is online or has a known reason | `/dashboard/admin/devices` |
| Weekly | Review the security audit log for unexpected role or session changes | `/dashboard/admin/audit` |
| Weekly | Confirm the last scheduler run succeeded | Alert centre → scheduler runs |
| Weekly | Check `/api/ready` reports `ready` | monitoring system or admin session |
| Monthly | Run a restore drill and record it | `docs/disaster-recovery-runbook.md` |
| Monthly | Rotate keys for any device that was replaced or repaired | Device registry |
| Quarterly | Review account list, remove accounts that no longer need access | `/dashboard/admin/users` |

## 2. Health Signals

| Endpoint | Purpose | Access |
|---|---|---|
| `/api/health` | Liveness only: is the process serving traffic, and which build is deployed | Public |
| `/api/ready` | Deep readiness: storage, migrations, auth configuration, alerting, backup target | Admin session or readiness token |
| `/api/metrics` | Prometheus metrics: ingest outcomes, latency, alerts, job runs, error counts | Admin session or ops metrics token |

Metric names worth watching:

- `solar_tank_ingest_requests_total{outcome="accepted"}` — telemetry volume;
- `solar_tank_ingest_rejections_total` — devices being turned away;
- `solar_tank_alerts_total{transition="created"}` — new operational problems;
- `solar_tank_ops_job_runs_total{outcome="failure"}` — scheduler failures;
- `solar_tank_errors_total` — application failures;
- `solar_tank_http_request_duration_seconds` — latency regression.

## 3. Alert Playbooks

### Device offline (`device_offline`, critical)

1. Open the device registry and confirm the last reading time.
2. Check the alert centre for a migration/config change in the same window.
3. Verify power and network at the site before assuming a software cause.
4. If the device was recently re-flashed, confirm its key version matches.
5. Acknowledge the alert while working; resolve with a note when telemetry
   resumes.

### Device delayed (`device_delayed`, warning)

Telemetry is arriving later than the expected interval. Check mobile/network
congestion first; escalate to offline handling if it does not recover within
one reporting cycle.

### Fuel level critical / low (`fuel_critical_level`, `fuel_low_level`)

1. Cross-check the reading against the tank detail chart (a single spurious
   reading should not trigger refuelling).
2. If confirmed, notify the site operator and follow the refuelling SOP.
3. If the reading contradicts a physical dipstick check, open a calibration
   review — do not adjust thresholds to hide it.

### Configuration mismatch (`device_config_mismatch`, warning)

The payload configuration disagrees with the registry (capacity, dimensions,
thresholds). Confirm which side is correct, update the registry if the field
value is right, or re-flash the device if the firmware carries stale values.

### Telemetry rejections high (`ingest_rejection_spike`, warning)

1. Look at the top rejected device identifiers in the alert detail.
2. A single device: check its key version and payload format.
3. Many devices: check for a recent deployment, a key rotation, or an
   infrastructure change affecting the ingest path.
4. Repeated rejections from an unknown identifier can indicate a mis-keyed or
   cloned device — escalate to security review.

### Firmware package downloads rejected (`package_token_anomaly`, warning)

Expired, exhausted, or revoked download tokens are being used. Reissue the
package for the affected request and confirm with the requester that no one is
sharing links.

### Operational database unavailable / registry incomplete (critical)

1. Check the database provider status first.
2. Follow `docs/disaster-recovery-runbook.md` if data recovery is required.
3. Ingest keeps rate limiting but cannot store readings until the database
   returns; expect a gap in history and note it in the incident record.

### Scheduled job failure

Open the alert centre → scheduler runs for the failing job key, then trigger
a manual evaluation to reproduce. Job failures never delete data; they leave
the previous state in place.

## 4. Scheduled Operations

The scheduler entry point is `/api/cron/ops` and it is protected by
`OPS_CRON_SECRET` (or `CRON_SECRET`/`READINESS_CHECK_TOKEN`). It runs:

| Task | Effect |
|---|---|
| `alerts` | Evaluates every rule, updates the alert store, sends notifications |
| `housekeeping` | Deletes expired tokens, stale rate-limit buckets, old ingest audit rows, old job runs, resolved alerts, and expired ingest nonces |

Manual invocation:

```powershell
curl.exe -H "x-solar-tank-ops-token: $env:OPS_CRON_SECRET" "http://localhost:3000/api/cron/ops?tasks=alerts"
```

Or press **Run evaluation now** in the alert centre.

Reading history is never pruned unless `MONITORING_READING_RETENTION_DAYS` is
set to a positive value; the default keeps history forever.

## 5. Access Management

- New users request access; an administrator approves or rejects and confirms
  the e-mail is verified first.
- Disable rather than delete an account when someone leaves; keep the audit
  trail intact.
- Admin sessions are short-lived and require OTP when `AUTH_REQUIRE_ADMIN_OTP`
  is enabled.
- Revoke all sessions from the user management page whenever credentials are
  suspected to be compromised.

## 6. Device Lifecycle

```text
request device → admin approval → firmware package → first valid ping
              → active device → scheduled review
              → key rotation or disable when hardware changes
```

- Rotating a key keeps the previous key valid for
  `DEVICE_KEY_ROTATION_GRACE_HOURS` (default 72). Re-flash before it expires.
- Disabling a device makes ingest reject its telemetry immediately; re-enable
  it after maintenance.
- Every rotation and status change is recorded in the audit log and in
  `monitoring_device_key_events`.

## 7. Escalation

| Situation | Action |
|---|---|
| Single device offline | Site operator; resolve within the day |
| Two or more devices offline in one location | Electric/network team; check site power |
| Database unavailable | Follow disaster recovery runbook; notify the platform owner |
| Suspected key leak or cloned device | Rotate the key, disable the old device identity, notify security |
| Data loss suspected | Freeze onboarding, take a fresh backup, follow the runbook |

## 8. Claim Discipline

The platform is an operational monitoring system. It does not replace field
inspection, refuelling procedure, or safety approval. When data and field
observation disagree, the field check wins until calibration is verified.
