# Restore Drill Log

Every restore drill appends a block here with
`pnpm db:restore:drill --record`. This file is the evidence that recovery was
tested; a drill that is not written down did not happen.

How to run a drill:

```powershell
# 1. Confirm which backup would be used
pnpm db:restore:drill --dry-run

# 2. Run the drill into a scratch database and record it
pnpm db:restore:drill `
  --target-url "mysql://user:pass@host:3306/ftm_restore_drill" `
  --confirm ftm_restore_drill `
  --operator "<your name>" `
  --record
```

Then complete the manual confirmations listed in
`docs/disaster-recovery-runbook.md` § 6 and summarise the result in the table
there.

<!-- Drill records are appended below this line by scripts/restore-drill.mjs. -->
