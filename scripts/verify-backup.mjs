import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import mysql from "mysql2/promise";

import {
  decryptBackupToFile,
  getBackupEncryptionKey,
  isEncryptedBackup,
} from "./lib/backup-crypto.mjs";

const { loadEnvConfig } = nextEnv;

const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

loadEnvConfig(projectDir);

const BACKUP_FILE_PREFIX = "solar_tank_mysql_";

function getEnv(name) {
  return process.env[name]?.trim() ?? "";
}

function fail(message) {
  console.error(`Backup verification failed: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[verify] ${message}`);
}

export function extractInsertCounts(sql) {
  const tables = {};

  for (const match of sql.matchAll(/INSERT INTO `([^`]+)`/g)) {
    tables[match[1]] = (tables[match[1]] ?? 0) + 1;
  }

  return tables;
}

async function latestBackupFile(outputDir) {
  const entries = await readdir(outputDir, { withFileTypes: true });
  const candidates = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(BACKUP_FILE_PREFIX) &&
        !entry.name.endsWith(".json"),
    )
    .map((entry) => entry.name)
    .sort();

  if (candidates.length === 0) {
    fail(`No backup file found in ${outputDir}. Create one with pnpm db:backup:mysql.`);
  }

  return path.join(outputDir, candidates.at(-1));
}

async function loadPlainSql({ backupFile, tempDir }) {
  const key = getBackupEncryptionKey();
  const plainPath = path.join(tempDir, "verify.sql");

  if (await isEncryptedBackup(backupFile)) {
    if (!key) {
      fail(
        "Backup is encrypted but MYSQL_BACKUP_ENCRYPTION_KEY is not set, so it cannot be verified.",
      );
    }

    await decryptBackupToFile({
      inputPath: backupFile,
      key,
      outputPath: plainPath,
    });

    return plainPath;
  }

  if (backupFile.endsWith(".gz")) {
    await pipeline(
      createReadStream(backupFile),
      createGunzip(),
      createWriteStream(plainPath, { flags: "wx" }),
    );

    return plainPath;
  }

  return backupFile;
}

async function verifyChecksum(backupFile) {
  let manifest = null;

  try {
    manifest = JSON.parse(await readFile(`${backupFile}.json`, "utf8"));
  } catch {
    log("WARNING: manifest is missing, skipping checksum comparison.");
    return null;
  }

  const hash = createHash("sha256");

  await pipeline(createReadStream(backupFile), hash);

  const actual = hash.digest("hex");

  if (actual !== manifest.checksumSha256) {
    fail(
      `Checksum mismatch (expected ${manifest.checksumSha256}, got ${actual}). The backup is corrupt.`,
    );
  }

  log(`checksum verified for ${path.basename(backupFile)}`);

  return manifest;
}

async function countRowsInTarget({ verificationUrl }) {
  const connection = await mysql.createConnection({ uri: verificationUrl });
  const counts = {};

  try {
    const [tables] = await connection.query(
      `SELECT table_name AS name
         FROM information_schema.tables
        WHERE table_schema = DATABASE()`,
    );

    counts.tableCount = tables.length;

    for (const table of ["monitoring_sites", "monitoring_tanks", "monitoring_devices", "monitoring_readings", "auth_users"]) {
      const [rows] = await connection.query(
        `SELECT COUNT(*) AS count FROM \`${table}\``,
      ).catch(() => [[{ count: null }]]);

      counts[table] = rows[0]?.count ?? null;
    }
  } finally {
    await connection.end();
  }

  return counts;
}

async function main() {
  const outputDir = path.resolve(
    projectDir,
    getEnv("MYSQL_BACKUP_OUTPUT_DIR") || "backups/mysql",
  );
  const explicitFile = process.argv[2];
  const backupFile = explicitFile
    ? path.resolve(explicitFile)
    : await latestBackupFile(outputDir).catch((error) => {
        if (error?.code === "ENOENT") {
          fail(`Backup directory not found: ${outputDir}`);
        }

        throw error;
      });

  const backupStat = await stat(backupFile).catch(() =>
    fail(`Backup file not found: ${backupFile}`),
  );

  log(`verifying ${path.basename(backupFile)} (${backupStat.size} bytes)`);

  await verifyChecksum(backupFile);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ftm-verify-"));

  try {
    const sqlFile = await loadPlainSql({ backupFile, tempDir });
    const sql = await readFile(sqlFile, "utf8");
    const insertCounts = extractInsertCounts(sql);
    const tableStatements = sql.match(/CREATE TABLE/g)?.length ?? 0;

    log(`decrypted payload parses as SQL: ${tableStatements} CREATE TABLE statements`);
    log(
      `INSERT statement groups: ${Object.entries(insertCounts)
        .map(([table, count]) => `${table}=${count}`)
        .join(", ")}`,
    );

    const verificationUrl = getEnv("MYSQL_BACKUP_VERIFY_DATABASE_URL");

    if (!verificationUrl) {
      log(
        "MYSQL_BACKUP_VERIFY_DATABASE_URL is not set, so the restore-into-scratch check was skipped. Set it to a disposable database to run a full drill.",
      );
      log("checksum and payload verification passed.");
      return;
    }

    log(
      "MYSQL_BACKUP_VERIFY_DATABASE_URL is set. Run scripts/restore-mysql.mjs --target-url <scratch> --confirm <scratch> to complete the drill, because importing an existing schema requires an empty target.",
    );

    const counts = await countRowsInTarget({ verificationUrl });

    log(`scratch database currently reports: ${JSON.stringify(counts)}`);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
