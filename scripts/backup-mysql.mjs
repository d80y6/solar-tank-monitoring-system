import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import nextEnv from "@next/env";

import {
  getBackupEncryptionKey,
  getEncryptionKeyFingerprint,
  writeEncryptedBackup,
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
  console.error(`MySQL backup failed: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[backup] ${message}`);
}

function getTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseRetentionDays() {
  const raw = getEnv("MYSQL_BACKUP_RETENTION_DAYS");

  if (!raw) {
    return 90;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < 0) {
    fail("MYSQL_BACKUP_RETENTION_DAYS must be a number of 0 or more.");
  }

  return parsed;
}

function shouldCompress() {
  return getEnv("MYSQL_BACKUP_COMPRESS").toLowerCase() !== "false";
}

function getDatabaseUrl() {
  const raw = getEnv("MYSQL_DATABASE_URL");

  if (!raw) {
    fail("MYSQL_DATABASE_URL is not set.");
  }

  try {
    const url = new URL(raw);

    if (url.protocol !== "mysql:") {
      fail("MYSQL_DATABASE_URL must use the mysql:// protocol.");
    }

    if (!url.username || !url.password || !url.hostname) {
      fail("MYSQL_DATABASE_URL must contain user, password, and host.");
    }

    const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

    if (!database) {
      fail("MYSQL_DATABASE_URL must contain a database name.");
    }

    return { database, url };
  } catch (error) {
    if (error instanceof TypeError) {
      fail("MYSQL_DATABASE_URL is invalid.");
    }

    throw error;
  }
}

function buildMysqlDumpArgs({ database, url }) {
  const args = [
    "--host",
    url.hostname,
    "--port",
    url.port || "3306",
    "--user",
    decodeURIComponent(url.username),
    "--single-transaction",
    "--routines",
    "--triggers",
    "--events",
    "--hex-blob",
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

  return args;
}

async function cleanupOldBackups({ outputDir, retentionDays }) {
  if (retentionDays === 0) {
    return 0;
  }

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(outputDir, { withFileTypes: true });
  let deleted = 0;

  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.startsWith(BACKUP_FILE_PREFIX) ||
      entry.name.endsWith(".json")
    ) {
      continue;
    }

    const filePath = path.join(outputDir, entry.name);
    const fileStat = await stat(filePath);

    if (fileStat.mtimeMs < cutoffMs) {
      await rm(filePath, { force: true });
      await rm(`${filePath}.json`, { force: true });
      deleted += 1;
    }
  }

  return deleted;
}

async function hashFile(filePath) {
  const hash = createHash("sha256");

  await pipeline(createReadStream(filePath), hash);

  return hash.digest("hex");
}

function startMysqlDump({ args, password }) {
  return spawn("mysqldump", args, {
    env: {
      ...process.env,
      MYSQL_PWD: password,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function main() {
  const { database, url } = getDatabaseUrl();
  const outputDir = path.resolve(
    projectDir,
    getEnv("MYSQL_BACKUP_OUTPUT_DIR") || "backups/mysql",
  );
  const retentionDays = parseRetentionDays();
  const compressionEnabled = shouldCompress();
  const encryptionKey = getBackupEncryptionKey();
  const baseName = `${BACKUP_FILE_PREFIX}${getTimestamp()}`;
  const outputPath = path.join(
    outputDir,
    `${baseName}.sql${compressionEnabled ? ".gz" : ""}${encryptionKey ? ".enc" : ""}`,
  );

  await mkdir(outputDir, { recursive: true });

  const child = startMysqlDump({
    args: buildMysqlDumpArgs({ database, url }),
    password: decodeURIComponent(url.password),
  });

  const dumpStream = child.stdout;
  let dumpError = "";

  child.stderr.on("data", (chunk) => {
    dumpError += chunk.toString("utf8");
  });

  const encryptionSummary = encryptionKey
    ? await writeEncryptedBackup({
        compressionEnabled,
        inputStream: dumpStream,
        key: encryptionKey,
        outputPath,
      }).catch(async (error) => {
        await rm(outputPath, { force: true });
        throw error;
      })
    : await pipeline(
        dumpStream,
        ...(compressionEnabled ? [createGzip()] : []),
        createWriteStream(outputPath, { flags: "wx" }),
      )
        .then(() => null)
        .catch(async (error) => {
          await rm(outputPath, { force: true });
          throw error;
        });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  }).catch((error) => {
    if (error.code === "ENOENT") {
      fail(
        "mysqldump command not found. Install the MySQL client and make sure PATH is correct.",
      );
    }

    throw error;
  });

  if (exitCode !== 0) {
    await rm(outputPath, { force: true });

    fail(dumpError.trim() || `mysqldump exited with code ${exitCode}.`);
  }

  const checksumSha256 = await hashFile(outputPath);
  const fileStat = await stat(outputPath);
  const deleted = await cleanupOldBackups({ outputDir, retentionDays });
  const manifestPath = `${outputPath}.json`;

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        checksumSha256,
        compressed: compressionEnabled,
        createdAt: new Date().toISOString(),
        database,
        encrypted: Boolean(encryptionKey),
        encryption: encryptionSummary
          ? {
              algorithm: "aes-256-gcm",
              keyFingerprint: getEncryptionKeyFingerprint(encryptionKey),
            }
          : null,
        file: path.basename(outputPath),
        host: url.hostname,
        sizeBytes: fileStat.size,
        tool: "mysqldump",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  log(`backup completed: ${outputPath}`);
  log(`checksum: ${checksumSha256}`);
  log(`manifest: ${manifestPath}`);
  log(
    `retention: ${retentionDays} days, removed ${deleted} old backup(s), encrypted: ${Boolean(encryptionKey)}`,
  );

  if (!encryptionKey) {
    log(
      "WARNING: MYSQL_BACKUP_ENCRYPTION_KEY is not set, so this backup is plain text. Set it before storing backups outside a trusted machine.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
