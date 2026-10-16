import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

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

function getEnv(name) {
  return process.env[name]?.trim() ?? "";
}

function fail(message) {
  console.error(`MySQL restore failed: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[restore] ${message}`);
}

function parseArguments(argv) {
  const options = {
    allowProduction: false,
    backupFile: null,
    confirm: null,
    dryRun: false,
    skipChecksum: false,
    targetUrl: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--file":
        options.backupFile = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--target-url":
        options.targetUrl = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--confirm":
        options.confirm = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--allow-production":
        options.allowProduction = true;
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

function printUsage() {
  console.log(`Usage:
  node scripts/restore-mysql.mjs --file <backup.sql[.gz][.enc]> --confirm <database-name> [options]

Options:
  --target-url <mysql://...>  Target database (defaults to MYSQL_BACKUP_RESTORE_URL)
  --confirm <database-name>   Required safety confirmation: must equal the target database name
  --allow-production          Required when the target host is the configured operational host
  --dry-run                   Decrypt, verify checksum, and report without importing
  --skip-checksum             Skip manifest checksum verification

The restore always runs against a target database given explicitly; it never
defaults to MYSQL_DATABASE_URL so a drill cannot overwrite production by
accident.`);
}

function parseMysqlUrl(raw, label) {
  try {
    const url = new URL(raw);

    if (url.protocol !== "mysql:") {
      fail(`${label} must use the mysql:// protocol.`);
    }

    const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

    if (!url.username || !url.password || !url.hostname || !database) {
      fail(`${label} must contain user, password, host, and database name.`);
    }

    return { database, url };
  } catch (error) {
    if (error instanceof TypeError) {
      fail(`${label} is invalid.`);
    }

    throw error;
  }
}

async function verifyChecksum({ backupFile }) {
  const manifestPath = `${backupFile}.json`;

  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const hash = createHash("sha256");

    await pipeline(createReadStream(backupFile), hash);

    const actual = hash.digest("hex");

    if (actual !== manifest.checksumSha256) {
      fail(
        `Checksum mismatch for ${path.basename(backupFile)}. The backup is corrupt or was modified (expected ${manifest.checksumSha256}, got ${actual}).`,
      );
    }

    log(`checksum verified: ${actual}`);

    return manifest;
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail(
        `Manifest ${path.basename(manifestPath)} is not valid JSON. Re-create the backup or pass --skip-checksum to continue at your own risk.`,
      );
    }

    if (error.code === "ENOENT") {
      log(
        "WARNING: no manifest found next to the backup, so the checksum could not be verified.",
      );

      return null;
    }

    throw error;
  }
}

async function preparePlainSqlFile({ backupFile, key, tempDir }) {
  const encrypted = await isEncryptedBackup(backupFile);
  const plainPath = path.join(tempDir, "restore.sql");

  if (encrypted) {
    if (!key) {
      fail(
        "This backup is encrypted. Set MYSQL_BACKUP_ENCRYPTION_KEY to the key used when the backup was created.",
      );
    }

    const result = await decryptBackupToFile({
      inputPath: backupFile,
      key,
      outputPath: plainPath,
    });

    log(
      `decrypted backup${result.compressed ? " (gzip payload)" : ""} into a temporary file.`,
    );

    return plainPath;
  }

  if (backupFile.endsWith(".gz")) {
    await pipeline(
      createReadStream(backupFile),
      createGunzip(),
      createWriteStream(plainPath, { flags: "wx" }),
    );
    log("decompressed backup into a temporary file.");

    return plainPath;
  }

  return backupFile;
}

async function runMysqlImport({ database, password, sqlFile, url }) {
  const args = [
    "--host",
    url.hostname,
    "--port",
    url.port || "3306",
    "--user",
    decodeURIComponent(url.username),
    "--default-character-set=utf8mb4",
  ];

  if (getEnv("MYSQL_SSL_MODE").toLowerCase() === "required") {
    args.push("--ssl-mode=REQUIRED");
  }

  const sslCa = getEnv("MYSQL_SSL_CA");

  if (sslCa && !sslCa.includes("BEGIN CERTIFICATE")) {
    args.push(`--ssl-ca=${sslCa}`);
  }

  args.push(database);

  const child = spawn("mysql", args, {
    env: { ...process.env, MYSQL_PWD: password },
    stdio: ["pipe", "inherit", "pipe"],
    windowsHide: true,
  });
  let stderr = "";

  // The listener must exist before anything is piped: a spawn failure (no mysql
  // binary) emits "error" immediately, and an unhandled event would abort with a
  // stack trace instead of the actionable message below.
  const processExit = new Promise((resolve, reject) => {
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        fail(
          "mysql command not found. Install the MySQL client and make sure PATH is correct.",
        );
      }

      reject(error);
    });
    child.on("close", resolve);
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const exitCode = await Promise.all([
    processExit,
    pipeline(createReadStream(sqlFile), child.stdin).catch((error) => {
      // A failed spawn closes stdin, which surfaces here as EPIPE; the process
      // exit code carries the real reason.
      if (error.code !== "EPIPE") {
        throw error;
      }
    }),
  ]).then(([code]) => code);

  if (exitCode !== 0) {
    fail(stderr.trim() || `mysql exited with code ${exitCode}.`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  if (!options.backupFile) {
    printUsage();
    fail("--file is required.");
  }

  const backupFile = path.resolve(options.backupFile);

  try {
    await stat(backupFile);
  } catch {
    fail(`Backup file not found: ${backupFile}`);
  }

  const targetRaw =
    options.targetUrl ?? getEnv("MYSQL_BACKUP_RESTORE_URL") ?? "";

  if (!targetRaw) {
    printUsage();
    fail(
      "A target database is required. Pass --target-url or set MYSQL_BACKUP_RESTORE_URL. MYSQL_DATABASE_URL is deliberately not used as a default.",
    );
  }

  const target = parseMysqlUrl(targetRaw, "Restore target");

  if (options.confirm !== target.database) {
    fail(
      `Safety confirmation failed. Pass --confirm ${target.database} to confirm that you intend to import into that database.`,
    );
  }

  const operationalRaw = getEnv("MYSQL_DATABASE_URL");

  if (operationalRaw) {
    const operational = parseMysqlUrl(operationalRaw, "MYSQL_DATABASE_URL");

    if (
      operational.database === target.database &&
      operational.url.hostname === target.url.hostname &&
      !options.allowProduction
    ) {
      fail(
        "The target looks like the operational database. Re-run with --allow-production if this is an intentional disaster recovery restore.",
      );
    }
  }

  if (!options.skipChecksum) {
    await verifyChecksum({ backupFile });
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ftm-restore-"));
  const key = getBackupEncryptionKey();

  try {
    const sqlFile = await preparePlainSqlFile({ backupFile, key, tempDir });
    const sqlStat = await stat(sqlFile);

    log(`prepared SQL payload: ${sqlStat.size} bytes`);

    if (options.dryRun) {
      log(
        "dry run complete. The backup can be decrypted and verified; no data was imported.",
      );

      return;
    }

    log(
      `importing into ${target.database} at ${target.url.hostname}. Existing tables in that database are replaced by the dump.`,
    );

    await runMysqlImport({
      database: target.database,
      password: decodeURIComponent(target.url.password),
      sqlFile,
      url: target.url,
    });

    log("restore completed.");
    log(
      "Next step: run the readiness check (GET /api/ready) and compare row counts with the pre-restore report.",
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
