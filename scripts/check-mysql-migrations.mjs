import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import nextEnv from "@next/env";
import mysql from "mysql2/promise";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const MIGRATIONS_DIR = path.join(process.cwd(), "database", "migrations");
const SEEDS_DIR = path.join(process.cwd(), "database", "seeds");

function fail(message) {
  console.error(`[migrations] ${message}`);
  process.exit(1);
}

async function listSqlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

async function main() {
  const databaseUrl = process.env.MYSQL_DATABASE_URL?.trim();

  if (!databaseUrl) {
    fail("MYSQL_DATABASE_URL is required before checking migrations.");
  }

  const sslMode = process.env.MYSQL_SSL_MODE?.trim().toLowerCase();
  const ca = process.env.MYSQL_SSL_CA?.replaceAll("\\n", "\n").trim();
  const ssl =
    sslMode === "required"
      ? ca
        ? { ca }
        : { rejectUnauthorized: true }
      : undefined;

  const migrationFiles = await listSqlFiles(MIGRATIONS_DIR);
  const seedFiles = await listSqlFiles(SEEDS_DIR);
  const connection = await mysql.createConnection({
    uri: databaseUrl,
    ...(ssl ? { ssl } : {}),
  });

  try {
    const [ledgerExists] = await connection.query(
      `SELECT COUNT(*) AS count
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = 'schema_migrations'`,
    );

    if (Number(ledgerExists[0]?.count ?? 0) === 0) {
      console.log(
        "[migrations] schema_migrations does not exist yet. Run pnpm db:setup:mysql once to create it.",
      );
      console.log(
        `[migrations] ${migrationFiles.length} migration file(s) are available locally.`,
      );

      return;
    }

    const [rows] = await connection.query(
      "SELECT id, checksum_sha256, applied_at FROM schema_migrations",
    );
    const applied = new Map(rows.map((row) => [row.id, row]));
    let pendingCount = 0;
    let driftCount = 0;

    for (const filePath of [...migrationFiles, ...seedFiles]) {
      const relative = path
        .relative(process.cwd(), filePath)
        .replaceAll("\\", "/");
      const sql = await fs.readFile(filePath, "utf8");
      const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
      const record = applied.get(relative);

      if (!record) {
        pendingCount += 1;
        console.log(`[migrations] PENDING  ${relative}`);
        continue;
      }

      if (record.checksum_sha256 !== checksum) {
        driftCount += 1;
        console.log(
          `[migrations] DRIFT    ${relative} (applied ${new Date(record.applied_at).toISOString()}, file changed since)`,
        );
        continue;
      }

      console.log(
        `[migrations] ok       ${relative} (${new Date(record.applied_at).toISOString()})`,
      );
    }

    console.log(
      `[migrations] summary: ${migrationFiles.length + seedFiles.length} file(s) checked, ${pendingCount} pending, ${driftCount} drifted.`,
    );

    if (pendingCount > 0 || driftCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
