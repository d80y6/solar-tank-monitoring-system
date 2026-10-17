import { describe, expect, it } from "vitest";

import {
  compareCounts,
  comparedTables,
  DRILL_CONFIRMATION_STEPS,
  formatCountTable,
  formatDrillRecord,
  selectLatestBackup,
} from "../lib/restore-drill.mjs";

describe("selectLatestBackup", () => {
  it("picks the newest backup and ignores manifests and unrelated files", () => {
    const latest = selectLatestBackup([
      "solar-tank-backup-2026-10-01-020000.sql.gz.enc",
      "solar-tank-backup-2026-10-15-020000.sql.gz.enc",
      "solar-tank-backup-2026-10-15-020000.sql.gz.enc.json",
      "notes.txt",
      "solar-tank-backup-partial.tmp",
    ]);

    expect(latest).toBe("solar-tank-backup-2026-10-15-020000.sql.gz.enc");
  });

  it("returns null when the directory has no backup", () => {
    expect(selectLatestBackup(["readme.md"])).toBeNull();
  });

  it("accepts plain, compressed, and encrypted backup names", () => {
    expect(selectLatestBackup(["solar-tank-backup-2026-10-15-020000.sql"])).toBe(
      "solar-tank-backup-2026-10-15-020000.sql",
    );
    expect(selectLatestBackup(["solar-tank-backup-2026-10-15-020000.sql.gz"])).toBe(
      "solar-tank-backup-2026-10-15-020000.sql.gz",
    );
  });
});

describe("compareCounts", () => {
  const source = {
    auth_users: 3,
    monitoring_devices: 5,
    monitoring_readings: 1000,
    monitoring_sites: 5,
    monitoring_tanks: 5,
    schema_migrations: 13,
  };

  it("passes when the restored copy matches", () => {
    const comparison = compareCounts({ source, target: { ...source } });

    expect(comparison.ok).toBe(true);
    expect(comparison.rows).toHaveLength(6);
    expect(comparison.rows.every((row) => row.passed)).toBe(true);
  });

  it("fails on a registry mismatch", () => {
    const comparison = compareCounts({
      source,
      target: { ...source, monitoring_devices: 4 },
    });

    expect(comparison.ok).toBe(false);
    expect(
      comparison.rows.find((row) => row.table === "monitoring_devices")?.passed,
    ).toBe(false);
  });

  it("tolerates readings written while the drill was running", () => {
    const withinTolerance = compareCounts({
      source,
      target: { ...source, monitoring_readings: 1000 - 30 },
    });
    const beyondTolerance = compareCounts({
      source,
      target: { ...source, monitoring_readings: 1000 - 500 },
    });

    expect(withinTolerance.ok).toBe(true);
    expect(beyondTolerance.ok).toBe(false);
  });

  it("treats a missing table in the restored copy as a failure", () => {
    const target = { ...source };

    delete target.schema_migrations;

    const comparison = compareCounts({ source, target });

    expect(comparison.ok).toBe(false);
    expect(
      comparison.rows.find((row) => row.table === "schema_migrations")?.targetCount,
    ).toBe(0);
  });
});

describe("formatCountTable", () => {
  it("renders a fixed-width table with the mismatch visible", () => {
    const comparison = compareCounts({
      source: { monitoring_devices: 5 },
      target: { monitoring_devices: 4 },
    });
    const text = formatCountTable(comparison.rows);

    expect(text).toContain("monitoring_devices");
    expect(text).toContain("MISMATCH");
  });
});

describe("formatDrillRecord", () => {
  it("records date, backup, target, duration, operator, and every table", () => {
    const record = formatDrillRecord({
      backupFile: "solar-tank-backup-2026-10-15-020000.sql.gz.enc",
      durationMs: 12_300,
      ok: true,
      operator: "operator-a",
      ranAt: new Date("2026-10-17T05:30:00.000Z"),
      rows: [
        {
          difference: 0,
          passed: true,
          sourceCount: 5,
          table: "monitoring_devices",
          targetCount: 5,
          tolerance: 0,
        },
      ],
      targetDatabase: "solar_tank_drill",
    });

    expect(record).toContain("### Drill 2026-10-17");
    expect(record).toContain("solar-tank-backup-2026-10-15-020000.sql.gz.enc");
    expect(record).toContain("solar_tank_drill");
    expect(record).toContain("12.3 s");
    expect(record).toContain("**passed**");
    expect(record).toContain("operator-a");
    expect(record).toContain("| `monitoring_devices` | 5 | 5 | 0 | ok |");
  });

  it("marks a failed drill clearly", () => {
    const record = formatDrillRecord({
      backupFile: "backup.sql",
      durationMs: 500,
      ok: false,
      rows: [
        {
          difference: 3,
          passed: false,
          sourceCount: 5,
          table: "monitoring_devices",
          targetCount: 2,
          tolerance: 0,
        },
      ],
      targetDatabase: "solar_tank_drill",
    });

    expect(record).toContain("**failed**");
    expect(record).toContain("| mismatch |");
  });
});

describe("drill confirmation steps", () => {
  it("covers registry, ledger, readings, accounts, and credential cleanup", () => {
    const text = DRILL_CONFIRMATION_STEPS.join(" ");

    expect(text).toMatch(/monitoring_devices/);
    expect(text).toMatch(/schema_migrations/);
    expect(text).toMatch(/monitoring_readings/);
    expect(text).toMatch(/auth_users/);
    expect(text).toMatch(/credentials/);
    expect(comparedTables()).toContain("schema_migrations");
  });
});
