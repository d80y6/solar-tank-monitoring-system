/**
 * Pure helpers for the restore drill so they can be unit tested without a
 * database or the mysql client.
 */

export const BACKUP_FILE_NAME_PATTERN = /^solar-tank-backup-.*\.sql(\.gz)?(\.enc)?$/;

/**
 * Picks the newest backup archive from a list of directory entries. Manifests
 * (".json") and unrelated files are ignored, and the newest is chosen by name
 * because backup file names start with a sortable timestamp.
 */
export function selectLatestBackup(entryNames, prefix = "solar-tank-backup-") {
  const candidates = entryNames
    .filter(
      (name) =>
        typeof name === "string" &&
        name.startsWith(prefix) &&
        !name.endsWith(".json") &&
        BACKUP_FILE_NAME_PATTERN.test(name),
    )
    .sort();

  return candidates.at(-1) ?? null;
}

const COMPARED_TABLES = [
  "auth_users",
  "monitoring_devices",
  "monitoring_readings",
  "monitoring_sites",
  "monitoring_tanks",
  "schema_migrations",
];

export function comparedTables() {
  return [...COMPARED_TABLES];
}

/**
 * Compares source and restored table counts. `monitoring_readings` is expected
 * to drift because the source keeps writing during a drill, so a tolerance is
 * applied to that table only; the rest must match exactly.
 */
export function compareCounts({ source, target, readingTolerance = 50 }) {
  const rows = [];
  let ok = true;

  for (const table of Object.keys(source).sort()) {
    const sourceCount = source[table] ?? 0;
    const targetCount = target[table] ?? 0;
    const tolerance = table === "monitoring_readings" ? readingTolerance : 0;
    const difference = Math.abs(sourceCount - targetCount);
    const passed = difference <= tolerance;

    if (!passed) {
      ok = false;
    }

    rows.push({ difference, passed, sourceCount, table, targetCount, tolerance });
  }

  return { ok, rows };
}

export function formatCountTable(comparisonRows) {
  const header = [
    "table".padEnd(22),
    "source".padStart(10),
    "restored".padStart(10),
    "delta".padStart(8),
    "result".padStart(8),
  ].join(" ");

  const lines = comparisonRows.map((row) =>
    [
      row.table.padEnd(22),
      String(row.sourceCount).padStart(10),
      String(row.targetCount).padStart(10),
      String(row.difference).padStart(8),
      (row.passed ? "ok" : "MISMATCH").padStart(8),
    ].join(" "),
  );

  return [header, "-".repeat(header.length), ...lines].join("\n");
}

/**
 * Renders the Markdown block that gets appended to the drill log. Keeping this
 * deterministic makes the operator's record the same shape every time, which is
 * what makes drill history comparable.
 */
export function formatDrillRecord({
  backupFile,
  durationMs,
  ok,
  operator = "unnamed operator",
  ranAt = new Date(),
  rows,
  targetDatabase,
}) {
  const lines = [
    "",
    `### Drill ${ranAt.toISOString().slice(0, 10)} — ${backupFile}`,
    "",
    `- Run at: ${ranAt.toISOString()}`,
    `- Backup file: \`${backupFile}\``,
    `- Restored into: \`${targetDatabase}\``,
    `- Duration: ${(durationMs / 1000).toFixed(1)} s`,
    `- Result: **${ok ? "passed" : "failed"}**`,
    `- Run by: ${operator}`,
    "",
    "| Table | Source rows | Restored rows | Delta | Result |",
    "|---|---:|---:|---:|---|",
  ];

  for (const row of rows) {
    lines.push(
      `| \`${row.table}\` | ${row.sourceCount} | ${row.targetCount} | ${row.difference} | ${row.passed ? "ok" : "mismatch"} |`,
    );
  }

  lines.push("");

  return lines.join("\n");
}

/**
 * A drill only proves something if the operator looked at the data, not just at
 * row counts. These are the checks the record must state explicitly.
 */
export const DRILL_CONFIRMATION_STEPS = [
  "Open the restored database and confirm monitoring_sites, monitoring_tanks, and monitoring_devices match the operational registry.",
  "Confirm schema_migrations in the restored copy lists the same migration files as the operational database.",
  "Confirm the newest monitoring_readings row is no newer than the backup timestamp, as expected for a restored copy.",
  "Confirm auth_users contains every administrator account that can sign in.",
  "Delete or rotate the scratch database credentials used for the drill.",
];
