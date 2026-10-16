# Database Backup

Database backup must be prepared before the application is used as an operational system.

## Principles

- Backups are created from MySQL, not from the browser.
- Devices are never given the database password.
- Backup files must not be committed.
- Restore must have been tested to a local/staging database.
- For Google Drive, use the Google Drive Desktop folder or `rclone` on the server, not OAuth Drive in the web application.
- Vercel is not a good place to create periodic backup files because the serverless runtime has no permanent storage and cannot maintain a long-term scheduler process.
- Backup automation is done on the operational laptop/server that has `MYSQL_DATABASE_URL`, `mysqldump`, and access to the Google Drive folder.

## Environment

Local/server env example:

```env
SOLAR_TANK_STORAGE_DRIVER="mysql"
MYSQL_DATABASE_URL="mysql://user:password@host:3306/database"
MYSQL_SSL_MODE="required"
MYSQL_BACKUP_OUTPUT_DIR="backups/mysql"
MYSQL_BACKUP_RETENTION_DAYS="90"
```

For two backups per month, a 90-day retention keeps roughly the last 6 backup files. If Drive storage is small, use 45 or 60 days.

When using Google Drive Desktop on a Windows server/operational laptop, point `MYSQL_BACKUP_OUTPUT_DIR` to a synchronized folder, for example:

```env
MYSQL_BACKUP_OUTPUT_DIR="C:\Users\SolarTank\Google Drive\SolarTank Backups\mysql"
```

Make sure that folder is not inside the repository so `.sql` files are not detected by git.

## Creating a Manual Backup

Make sure the MySQL client is available and the `mysqldump` command can be called from the terminal.

```powershell
pnpm db:backup:mysql
```

The output is a file:

```text
solar_tank_mysql_YYYYMMDDTHHMMSSZ.sql
```

## Automatic Backup to Google Drive Desktop

This is the easiest method on Windows because Google Drive Desktop handles the automatic upload to Google Drive.

1. Install the MySQL client until the `mysqldump` command can be called from PowerShell.
2. Install Google Drive Desktop and sign in with the operational Google Drive account.
3. Create a dedicated Drive folder, for example `SolarTank Backups\mysql`.
4. Fill the local/server `.env.local` with `MYSQL_BACKUP_OUTPUT_DIR` pointing to that Drive folder.
5. Run once:

```powershell
pnpm db:backup:mysql
```

6. Make sure the `solar_tank_mysql_YYYYMMDDTHHMMSSZ.sql` file appears in the Drive folder.
7. Wait for Google Drive Desktop until the file finishes syncing.
8. Only then schedule automation through Task Scheduler.

Use this script for Task Scheduler:

```text
scripts/run-mysql-backup-task.ps1
```

Example Windows Task Scheduler setup:

```text
Program/script:
powershell.exe

Arguments:
-NoProfile -ExecutionPolicy Bypass -File "D:\path\solar-tank-monitoring-system\scripts\run-mysql-backup-task.ps1"

Start in:
D:\path\solar-tank-monitoring-system
```

Recommended schedule:

- the 1st at 02:00;
- the 15th at 02:00;
- run manually again before large migrations, mass resets, or large data cleanups.

The automatic backup log is created at:

```text
backups/logs/mysql_backup_YYYYMMDDTHHMMSSZ.log
```

## Automatic Backup to Google Drive via rclone

Use `rclone` when the backup runs on a headless/server without Google Drive Desktop.

1. Install `rclone`.
2. Create a Google Drive remote:

```powershell
rclone config
```

3. Create a local output folder, for example:

```env
MYSQL_BACKUP_OUTPUT_DIR="backups/mysql"
```

4. Schedule the backup, then sync the result to Drive:

```powershell
pnpm db:backup:mysql
rclone copy ".\backups\mysql" "gdrive:SolarTank Backups/mysql" --include "solar_tank_mysql_*.sql" --drive-use-trash=false
```

On a Linux server, use cron:

```cron
0 2 1,15 * * cd /srv/solar-tank-monitoring-system && pnpm db:backup:mysql && rclone copy ./backups/mysql "gdrive:SolarTank Backups/mysql" --include "solar_tank_mysql_*.sql" --drive-use-trash=false
```

## Checking That Backup Succeeded

A backup is not considered safe just because the `.sql` file exists. Minimum checks:

- a new file appears on schedule;
- the file size is reasonable and not `0 bytes`;
- Google Drive Desktop/rclone finished uploading;
- old files are deleted per retention;
- a restore drill once succeeded on a local/staging database;
- backup files do not appear in `git status`.

## Restore Drill

Do not restore directly to the production database before testing.

Example restore to a local/staging database:

```powershell
mysql -h 127.0.0.1 -P 3306 -u solar_tank_app -p solar_tank_restore < .\backups\mysql\solar_tank_mysql_YYYYMMDDTHHMMSSZ.sql
```

Restore checklist:

- the application can sign in;
- `/api/ready` does not error;
- the site/tank/device registry is readable;
- the dashboard displays;
- reading history matches the backup;
- no backup credentials ended up in git.
