import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import nextEnv from "@next/env";
import mysql from "mysql2/promise";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const sqlFile = process.argv[2];

if (!sqlFile) {
  console.error(
    "Usage: node scripts/apply-mysql-schema.mjs <path-to-sql-file>",
  );
  process.exit(1);
}

const databaseUrl = process.env.MYSQL_DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error(
    "MYSQL_DATABASE_URL is required before running this script.",
  );
  process.exit(1);
}

const sslMode = process.env.MYSQL_SSL_MODE?.trim().toLowerCase();
const ca = process.env.MYSQL_SSL_CA?.replaceAll("\\n", "\n").trim();

const ssl =
  sslMode === "required"
    ? ca
      ? { ca }
      : { rejectUnauthorized: true }
    : undefined;

const absolutePath = path.resolve(sqlFile);
const sql = await fs.readFile(absolutePath, "utf8");
const migrationId = path.relative(process.cwd(), absolutePath).replaceAll("\\", "/");
const checksumSha256 = createHash("sha256").update(sql, "utf8").digest("hex");

const statements = sql
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);

function summarizeStatement(statement) {
  return statement.replace(/\s+/g, " ").slice(0, 140);
}

function isDuplicateSchemaObjectError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message : "";

  if (
    [
      "ER_DUP_FIELDNAME",
      "ER_DUP_KEYNAME",
      "ER_CHECK_CONSTRAINT_DUP_NAME",
      "ER_FK_DUP_NAME",
    ].includes(code)
  ) {
    return true;
  }

  return /duplicate (?:column|key|check constraint|constraint name|foreign key constraint name)/i.test(
    message,
  );
}

const LEDGER_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id VARCHAR(191) NOT NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    statements_applied INT UNSIGNED NOT NULL DEFAULT 0,
    statements_skipped INT UNSIGNED NOT NULL DEFAULT 0,
    duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
    applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const connection = await mysql.createConnection({
  uri: databaseUrl,
  multipleStatements: false,
  ...(ssl ? { ssl } : {}),
});

try {
  // The ledger answers "which migrations has this environment applied, and has
  // anyone edited a migration that was already applied?". It is created here so
  // the very first migration run bootstraps it automatically.
  await connection.query(LEDGER_TABLE_SQL);

  const [existingRows] = await connection.query(
    "SELECT checksum_sha256 FROM schema_migrations WHERE id = ? LIMIT 1",
    [migrationId],
  );
  const previousChecksum = existingRows[0]?.checksum_sha256 ?? null;
  const startedAtMs = Date.now();
  let appliedStatements = 0;
  let skippedStatements = 0;

  for (const statement of statements) {
    try {
      await connection.query(statement);
      appliedStatements += 1;
    } catch (error) {
      if (isDuplicateSchemaObjectError(error)) {
        skippedStatements += 1;
        console.log(
          `[schema] object already exists, statement skipped: ${summarizeStatement(statement)}...`,
        );
        continue;
      }

      throw error;
    }
  }

  const durationMs = Date.now() - startedAtMs;

  await connection.query(
    `INSERT INTO schema_migrations
       (id, checksum_sha256, statements_applied, statements_skipped, duration_ms)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       checksum_sha256 = VALUES(checksum_sha256),
       statements_applied = statements_applied + VALUES(statements_applied),
       statements_skipped = statements_skipped + VALUES(statements_skipped),
       duration_ms = VALUES(duration_ms)`,
    [
      migrationId,
      checksumSha256,
      appliedStatements,
      skippedStatements,
      durationMs,
    ],
  );

  if (previousChecksum && previousChecksum !== checksumSha256) {
    console.warn(
      `[schema] WARNING: ${migrationId} was already applied with a different checksum (${previousChecksum.slice(0, 12)} -> ${checksumSha256.slice(0, 12)}). Never edit an applied migration; add a new one instead.`,
    );
  }

  const skippedInfo =
    skippedStatements > 0
      ? `, ${skippedStatements} statements skipped because the object already exists`
      : "";

  console.log(
    `Executed ${appliedStatements} statements from ${sqlFile}${skippedInfo} in ${durationMs} ms`,
  );
  console.log(`[schema] recorded ${migrationId} in schema_migrations`);
} finally {
  await connection.end();
}
