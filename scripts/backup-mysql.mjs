import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

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
  console.error(`MySQL backup failed: ${message}`);
  process.exit(1);
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
      !entry.name.startsWith("solar_tank_mysql_") ||
      !entry.name.endsWith(".sql")
    ) {
      continue;
    }

    const filePath = path.join(outputDir, entry.name);
    const fileStat = await stat(filePath);

    if (fileStat.mtimeMs < cutoffMs) {
      await rm(filePath);
      deleted += 1;
    }
  }

  return deleted;
}

async function runMysqlDump({ args, outputPath, password }) {
  const output = createWriteStream(outputPath, { flags: "wx" });
  const child = spawn("mysqldump", args, {
    env: {
      ...process.env,
      MYSQL_PWD: password,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  const outputFinished = new Promise((resolve, reject) => {
    output.on("finish", resolve);
    output.on("error", reject);
  });

  child.stdout.pipe(output);
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  }).catch(async (error) => {
    output.destroy();
    await rm(outputPath, { force: true });

    if (error.code === "ENOENT") {
      fail("mysqldump command not found. Install the MySQL client and make sure PATH is correct.");
    }

    throw error;
  });

  await outputFinished;

  if (exitCode !== 0) {
    await rm(outputPath, { force: true });
    fail(stderr.trim() || `mysqldump exited with code ${exitCode}.`);
  }
}

async function main() {
  const { database, url } = getDatabaseUrl();
  const outputDir = path.resolve(projectDir, getEnv("MYSQL_BACKUP_OUTPUT_DIR") || "backups/mysql");
  const retentionDays = parseRetentionDays();
  const outputPath = path.join(
    outputDir,
    `solar_tank_mysql_${getTimestamp()}.sql`,
  );

  await mkdir(outputDir, { recursive: true });
  await runMysqlDump({
    args: buildMysqlDumpArgs({ database, url }),
    outputPath,
    password: decodeURIComponent(url.password),
  });
  const deleted = await cleanupOldBackups({ outputDir, retentionDays });
  const fileStat = await stat(outputPath);

  console.log(`MySQL backup completed: ${outputPath}`);
  console.log(`Ukuran file: ${fileStat.size} bytes`);
  console.log(`Retention: ${retentionDays} days, old files deleted: ${deleted}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
