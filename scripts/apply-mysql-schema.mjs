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

const connection = await mysql.createConnection({
  uri: databaseUrl,
  multipleStatements: false,
  ...(ssl ? { ssl } : {}),
});

try {
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

  const skippedInfo =
    skippedStatements > 0
      ? `, ${skippedStatements} statements skipped because the object already exists`
      : "";

  console.log(
    `Executed ${appliedStatements} statements from ${sqlFile}${skippedInfo}`,
  );
} finally {
  await connection.end();
}
