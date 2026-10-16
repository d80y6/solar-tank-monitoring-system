import { randomBytes } from "node:crypto";
import process from "node:process";
import argon2 from "argon2";
import nextEnv from "@next/env";
import mysql from "mysql2/promise";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
};

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    console.error(`${name} is required.`);
    process.exit(1);
  }

  return value;
}

async function hashPassword(password) {
  return argon2.hash(password, ARGON2ID_OPTIONS);
}

function createId(prefix) {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

const databaseUrl = requiredEnv("MYSQL_DATABASE_URL");
const email = requiredEnv("AUTH_BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
const username = requiredEnv("AUTH_BOOTSTRAP_ADMIN_USERNAME").toLowerCase();
const fullName =
  process.env.AUTH_BOOTSTRAP_ADMIN_FULL_NAME?.trim() || "Administrator";
const password = requiredEnv("AUTH_BOOTSTRAP_ADMIN_PASSWORD");

if (password.length < 10) {
  console.error("AUTH_BOOTSTRAP_ADMIN_PASSWORD minimal 10 karakter.");
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

const connection = await mysql.createConnection({
  uri: databaseUrl,
  ...(ssl ? { ssl } : {}),
});

try {
  const [rows] = await connection.execute(
    "SELECT id FROM auth_users WHERE email = ? OR username = ? LIMIT 1",
    [email, username],
  );

  if (rows.length > 0) {
    console.log("Admin bootstrap skipped because the email/username already exists.");
  } else {
    const userId = createId("usr");
    await connection.execute(
      `INSERT INTO auth_users
        (id, email, username, full_name, role, status, password_hash, password_changed_at, email_verified_at)
       VALUES (?, ?, ?, ?, 'admin', 'active', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [userId, email, username, fullName, await hashPassword(password)],
    );

    console.log(`Admin bootstrap created for ${email}.`);
  }
} finally {
  await connection.end();
}
