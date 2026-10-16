/**
 * Restore drill.
 *
 * Restores the newest backup into a scratch database, compares the restored
 * copy with the operational database, and writes a record that can be pasted
 * into docs/disaster-recovery-runbook.md. The point is to prove recovery works
 * before the day it is needed, and to leave evidence that it was proven.
 *
 * Usage:
 *   node scripts/restore-drill.mjs --confirm <scratch-database> [options]
 *
 * The target database is never taken from MYSQL_DATABASE_URL: a drill that
 * overwrites production is not a drill.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import mysql from "mysql2/promise";

import {
  compareCounts,
  comparedTables,
  DRILL_CONFIRMATION_STEPS,
  formatCountTable,
  formatDrillRecord,
  selectLatestBackup,
} from "./lib/restore-drill.mjs";

const { loadEnvConfig } = nextEnv;

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadEnvConfig(projectDir);

const DEFAULT_OUTPUT_DIR = "backups";
const DEFAULT_DRILL_LOG = "docs/disaster-recovery-drills.md";

function getEnv(name) {
  return process.env[name]?.trim() ?? "";
}

function fail(message) {
  console.error(`Restore drill failed: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[drill] ${message}`);
}

function printUsage() {
  console.log(`Usage:
  node scripts/restore-drill.mjs --confirm <scratch-database> [options]

Options:
  --target-url <mysql://...>  Scratch database (defaults to MYSQL_BACKUP_RESTORE_URL)
  --confirm <database-name>   Required: must equal the target database name
  --file <path>               Backup to restore (defaults to the newest in --output-dir)
  --output-dir <path>         Where backups live (defaults to MYSQL_BACKUP_OUTPUT_DIR or ${DEFAULT_OUTPUT_DIR})
  --source-url <mysql://...>  Database to compare against (defaults to MYSQL_DATABASE_URL)
  --operator <name>           Name recorded in the drill log
  --record                    Append the result to ${DEFAULT_DRILL_LOG}
  --dry-run                   Discover and verify the backup, then stop before importing
  --skip-checksum             Skip manifest checksum verification
  --help                      Show this message

Exit codes: 0 = drill passed, 1 = configuration or restore error, 2 = counts did not match.`);
}

function parseArguments(argv) {
  const options = {
    confirm: null,
    dryRun: false,
    file: null,
    operator: null,
    outputDir: null,
    record: false,
    skipChecksum: false,
    sourceUrl: null,
    targetUrl: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--confirm":
        options.confirm = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--target-url":
        options.targetUrl = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--source-url":
        options.sourceUrl = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--file":
        options.file = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--output-dir":
        options.outputDir = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--operator":
        options.operator = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--record":
        options.record = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--skip-checksum":
        options.skipChecksum = true;
        break;
      case "--help":
        printUsage();
        process.exit(0);
        break;
      default:
        fail(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function parseMysqlUrl(raw, label) {
  let url;

  try {
    url = new URL(raw);
  } catch {
    fail(`${label} is not a valid connection string.`);
  }

  if (url.protocol !== "mysql:") {
    fail(`${label} must use the mysql:// protocol.`);
  }

  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

  if (!url.username || !url.hostname || !database) {
    fail(`${label} must contain user, host, and database name.`);
  }

  return { database, url };
}

async function resolveBackupFile({ file, outputDir }) {
  if (file) {
    return path.resolve(file);
  }

  let entries;

  try {
    entries = await readdir(outputDir);
  } catch (error) {
    if (error.code === "ENOENT") {
      fail(
        `No backup directory at ${outputDir}. Run pnpm db:backup:mysql first, or pass --output-dir.`,
      );
    }

    throw error;
  }

  const latest = selectLatestBackup(entries);

  if (!latest) {
    fail(`No backup found in ${outputDir}. Run pnpm db:backup:mysql first.`);
  }

  return path.join(outputDir, latest);
}

function runRestore({ backupFile, confirm, dryRun, skipChecksum, targetUrl }) {
  return new Promise((resolve, reject) => {
    const args = [
      path.join(projectDir, "scripts", "restore-mysql.mjs"),
      "--file",
      backupFile,
      "--target-url",
      targetUrl,
      "--confirm",
      confirm,
    ];

    if (skipChecksum) {
      args.push("--skip-checksum");
    }

    if (dryRun) {
      args.push("--dry-run");
    }

    const child = spawn(process.execPath, args, {
      cwd: projectDir,
      stdio: "inherit",
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function countTables({ connectionUrl }) {
  const connection = await mysql.createConnection({ uri: connectionUrl });
  const counts = {};

  try {
    for (const table of comparedTables()) {
      const [rows] = await connection
        .query(`SELECT COUNT(*) AS count FROM \`${table}\``)
        .catch(() => [[{ count: null }]]);

      counts[table] = Number(rows[0]?.count ?? 0);
    }
  } finally {
    await connection.end();
  }

  return counts;
}

async function appendDrillRecord(record) {
  const logPath = path.join(projectDir, DEFAULT_DRILL_LOG);

  await mkdir(path.dirname(logPath), { recursive: true });

  let existing = "";

  try {
    existing = await readFile(logPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    existing = `# Restore Drill Log

Every drill appends a block here. The log is the evidence that recovery was
tested; a drill that is not written down did not happen.
`;
  }

  await writeFile(logPath, `${existing.trimEnd()}\n${record}\n`, "utf8");
  log(`record appended to ${DEFAULT_DRILL_LOG}`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  if (options.dryRun && !options.targetUrl && !getEnv("MYSQL_BACKUP_RESTORE_URL")) {
    // A dry run only needs the backup, so do not require a target database.
    options.confirm = options.confirm ?? "dry-run";
  }

  const targetRaw = options.targetUrl ?? getEnv("MYSQL_BACKUP_RESTORE_URL");

  if (!targetRaw && !options.dryRun) {
    printUsage();
    fail(
      "A scratch database is required. Pass --target-url or set MYSQL_BACKUP_RESTORE_URL.",
    );
  }

  const target = targetRaw ? parseMysqlUrl(targetRaw, "Restore target") : null;

  if (target && options.confirm !== target.database) {
    fail(
      `Safety confirmation failed. Pass --confirm ${target.database} to confirm you intend to import into that database.`,
    );
  }

  const sourceRaw = options.sourceUrl ?? getEnv("MYSQL_DATABASE_URL");

  if (target && sourceRaw) {
    const source = parseMysqlUrl(sourceRaw, "MYSQL_DATABASE_URL");

    if (
      source.database === target.database &&
      source.url.hostname === target.url.hostname
    ) {
      fail(
        "The drill target is the operational database. A drill must never write into production — create a scratch database instead.",
      );
    }
  }

  const outputDir = path.resolve(
    options.outputDir || getEnv("MYSQL_BACKUP_OUTPUT_DIR") || DEFAULT_OUTPUT_DIR,
  );
  const backupFile = await resolveBackupFile({
    file: options.file,
    outputDir,
  });
  const backupName = path.basename(backupFile);

  log(`using backup: ${backupName}`);

  if (options.dryRun && !target) {
    log("dry run: discovery only (no target database configured).");
    log(`next step: run again with --target-url and --confirm <database>.`);
    return 0;
  }

  const startedAt = Date.now();
  const restoreExit = await runRestore({
    backupFile,
    confirm: options.confirm,
    dryRun: options.dryRun,
    skipChecksum: options.skipChecksum,
    targetUrl: targetRaw,
  });

  if (restoreExit !== 0) {
    fail(`restore script exited with code ${restoreExit}.`);
  }

  if (options.dryRun) {
    log(
      "dry run complete: the backup was discovered, decrypted, and verified, but nothing was imported.",
    );

    return 0;
  }

  log("restore finished; counting rows in the restored copy.");

  const restoredCounts = await countTables({ connectionUrl: targetRaw });
  let sourceCounts = {};

  if (sourceRaw) {
    sourceCounts = await countTables({ connectionUrl: sourceRaw });
  } else {
    log(
      "WARNING: MYSQL_DATABASE_URL is not set, so the restored copy cannot be compared with the operational database.",
    );
  }

  const comparison = compareCounts({
    source: sourceCounts,
    target: restoredCounts,
  });
  const durationMs = Date.now() - startedAt;

  console.log("");
  console.log(formatCountTable(comparison.rows));
  console.log("");

  const record = formatDrillRecord({
    backupFile: backupName,
    durationMs,
    ok: comparison.ok,
    operator: options.operator ?? "unnamed operator",
    rows: comparison.rows,
    targetDatabase: target.database,
  });

  console.log(record);
  console.log("Manual confirmation still required:");
  console.log(
    DRILL_CONFIRMATION_STEPS.map((step, index) => `  ${index + 1}. ${step}`).join("\n"),
  );

  if (options.record) {
    await appendDrillRecord(record);
  } else {
    log(
      `not recorded. Re-run with --record to append this block to ${DEFAULT_DRILL_LOG}.`,
    );
  }

  return comparison.ok ? 0 : 2;
}

main()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
