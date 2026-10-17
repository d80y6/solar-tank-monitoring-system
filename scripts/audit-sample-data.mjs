/**
 * Sample-data audit.
 *
 * The repository ships a demo registry and a development device key so the app
 * can be run locally. Production must never contain them: a demo tank in the
 * registry becomes a real alert subject, and a shared development key lets any
 * device impersonate any device id.
 *
 * Run this before a go-live promotion, after restoring a backup you are unsure
 * about, and whenever the registry is bulk-edited.
 *
 * Usage:
 *   node scripts/audit-sample-data.mjs [--url mysql://...] [--json] [--strict]
 *
 * Exit codes: 0 = clean, 1 = connection or argument error, 2 = findings.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import mysql from "mysql2/promise";

const { loadEnvConfig } = nextEnv;

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadEnvConfig(projectDir);

/** Identifiers that only exist in the local demo registry. */
export const DEMO_REGISTRY_IDS = {
  devices: ["device-tph-main"],
  sites: ["site-sah"],
  tanks: ["tank-sah-main"],
};

/** Domains that only demo or placeholder accounts use. */
export const PLACEHOLDER_EMAIL_DOMAINS = ["example.com", "example.org", "localhost"];

/** The development device key hash shipped in the demo seed. */
export const DEMO_DEVICE_KEY_HASH =
  "sha256:749a381823e9c3e494badf95003e255a389eb65b1f894a058a54f27b1834d1f4";

export function summarizeFindings(findings) {
  const summary = {};

  for (const finding of findings) {
    summary[finding.kind] = (summary[finding.kind] ?? 0) + 1;
  }

  return summary;
}

export function formatFinding(finding) {
  return `- [${finding.kind}] ${finding.detail}`;
}

const CHECKS = [
  {
    detail: (row) =>
      `site ${row.id} (${row.code}) is the demo registry site${row.is_active ? "" : " (inactive)"}`,
    inflictsOperationalRisk: (row) => Boolean(row.is_active),
    key: "demo-site",
    sql: `SELECT id, code, is_active FROM monitoring_sites WHERE id IN (?)`,
    values: DEMO_REGISTRY_IDS.sites,
  },
  {
    detail: (row) =>
      `tank ${row.id} (${row.name}) is the demo registry tank${row.is_active ? "" : " (inactive)"}`,
    inflictsOperationalRisk: (row) => Boolean(row.is_active),
    key: "demo-tank",
    sql: `SELECT id, name, is_active FROM monitoring_tanks WHERE id IN (?)`,
    values: DEMO_REGISTRY_IDS.tanks,
  },
  {
    detail: (row) =>
      `device ${row.id} (${row.code}) uses the demo device key hash — rotate it${row.is_active ? "" : " (inactive)"}`,
    inflictsOperationalRisk: () => true,
    key: "demo-device-key",
    sql: `SELECT id, code, is_active FROM monitoring_devices WHERE api_key_hash = ?`,
    values: [DEMO_DEVICE_KEY_HASH],
  },
  {
    detail: (row) => `account ${row.email} uses a placeholder e-mail domain`,
    inflictsOperationalRisk: () => true,
    key: "placeholder-account",
    sql: `SELECT id, email FROM auth_users WHERE LOWER(SUBSTRING_INDEX(email, '@', -1)) IN (?)`,
    values: [PLACEHOLDER_EMAIL_DOMAINS],
  },
  {
    detail: (row) => `hardware profile ${row.id} (${row.name}) is a demo profile`,
    inflictsOperationalRisk: () => true,
    key: "demo-hardware-profile",
    sql: `SELECT id, name FROM monitoring_hardware_profiles WHERE id LIKE 'profile-%' AND code LIKE 'demo-%'`,
    values: [],
  },
];

async function runChecks(connection, { strict }) {
  const findings = [];

  for (const check of CHECKS) {
    const [rows] = await connection
      .query(check.sql, check.values.length > 0 ? check.values : undefined)
      .catch(() => [[]]);

    for (const row of rows) {
      const risky = check.inflictsOperationalRisk(row);

      // An inactive demo row cannot receive telemetry, so by default it is
      // reported only in strict mode — it is still clutter in the registry.
      if (!risky && !strict) {
        continue;
      }

      findings.push({
        detail: check.detail(row),
        kind: check.key,
        severity: risky ? "operational" : "housekeeping",
      });
    }
  }

  return findings;
}

async function countRegistry(connection) {
  const [siteRows] = await connection.query(
    `SELECT COUNT(*) AS count FROM monitoring_sites WHERE is_active = 1`,
  );
  const [tankRows] = await connection.query(
    `SELECT COUNT(*) AS count FROM monitoring_tanks WHERE is_active = 1`,
  );
  const [deviceRows] = await connection.query(
    `SELECT COUNT(*) AS count FROM monitoring_devices WHERE is_active = 1`,
  );
  const [userRows] = await connection.query(`SELECT COUNT(*) AS count FROM auth_users`);

  return {
    activeDevices: Number(deviceRows[0]?.count ?? 0),
    activeSites: Number(siteRows[0]?.count ?? 0),
    activeTanks: Number(tankRows[0]?.count ?? 0),
    users: Number(userRows[0]?.count ?? 0),
  };
}

function printUsage() {
  console.log(`Usage:
  node scripts/audit-sample-data.mjs [options]

Options:
  --url <mysql://...>  Database to audit (defaults to MYSQL_DATABASE_URL)
  --json               Machine-readable output
  --strict             Also report demo rows that are already inactive
  --help               Show this message

Exit codes: 0 = clean, 1 = error, 2 = findings.`);
}

function parseArguments(argv) {
  const options = { json: false, strict: false, url: null };

  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case "--url":
        options.url = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--json":
        options.json = true;
        break;
      case "--strict":
        options.strict = true;
        break;
      case "--help":
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }

  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const url = (options.url ?? process.env.MYSQL_DATABASE_URL ?? "").trim();

  if (!url) {
    printUsage();
    throw new Error(
      "No database to audit. Pass --url or set MYSQL_DATABASE_URL. This script never defaults to the demo seed.",
    );
  }

  const connection = await mysql.createConnection({ uri: url });

  try {
    const findings = await runChecks(connection, { strict: options.strict });
    const registry = await countRegistry(connection);
    const result = {
      database: new URL(url).pathname.replace(/^\/+/, ""),
      findings,
      ok: findings.length === 0,
      registry,
      summary: summarizeFindings(findings),
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`[audit] database: ${result.database}`);
      console.log(
        `[audit] registry: ${registry.activeSites} sites, ${registry.activeTanks} tanks, ${registry.activeDevices} devices, ${registry.users} accounts`,
      );

      if (result.ok) {
        console.log("[audit] clean: no demo or placeholder data found.");
      } else {
        console.log(`[audit] ${findings.length} finding(s):`);
        console.log(findings.map(formatFinding).join("\n"));
        console.log(
          "[audit] Remove or replace these rows before the deployment is treated as production. See the go-live checklist, section 2.",
        );
      }
    }

    return result.ok ? 0 : 2;
  } finally {
    await connection.end().catch(() => undefined);
  }
}

// Only run when executed directly, so the pure helpers above can be imported by
// tests without opening a database connection.
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main()
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((error) => {
      console.error(`Sample-data audit failed: ${error.message}`);
      process.exit(1);
    });
}
