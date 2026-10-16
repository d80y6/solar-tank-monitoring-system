import mysql, { type Pool } from "mysql2/promise";

type MysqlPoolGlobal = typeof globalThis & {
  __solarTankMysqlPool?: Pool;
};

type MysqlSslConfig = {
  rejectUnauthorized?: boolean;
  ca?: string;
};

const mysqlGlobal = globalThis as MysqlPoolGlobal;

const DEFAULT_MYSQL_CONNECTION_LIMIT = 3;
const MAX_MYSQL_CONNECTION_LIMIT = 10;

export function getMysqlDatabaseUrl(): string {
  const value = process.env.MYSQL_DATABASE_URL?.trim();

  if (!value) {
    throw new Error(
      "MYSQL_DATABASE_URL is required when SOLAR_TANK_STORAGE_DRIVER=mysql.",
    );
  }

  return value;
}

function getMysqlConnectionLimit(): number {
  const parsed = Number(process.env.MYSQL_CONNECTION_LIMIT);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_MYSQL_CONNECTION_LIMIT;
  }

  return Math.min(parsed, MAX_MYSQL_CONNECTION_LIMIT);
}

function getMysqlSslConfig(): MysqlSslConfig | undefined {
  const mode = process.env.MYSQL_SSL_MODE?.trim().toLowerCase();

  if (mode !== "required") {
    return undefined;
  }

  const ca = process.env.MYSQL_SSL_CA?.replaceAll("\\n", "\n").trim();

  if (ca) {
    return { ca };
  }

  return { rejectUnauthorized: true };
}

export function getMysqlPool(): Pool {
  const ssl = getMysqlSslConfig();

  mysqlGlobal.__solarTankMysqlPool ??= mysql.createPool({
    uri: getMysqlDatabaseUrl(),
    connectionLimit: getMysqlConnectionLimit(),
    timezone: "Z",
    ...(ssl ? { ssl } : {}),
  });

  return mysqlGlobal.__solarTankMysqlPool;
}

export async function checkMysqlConnection(): Promise<void> {
  const pool = getMysqlPool();
  await pool.query("SELECT 1 AS ok");
}
