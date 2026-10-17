import { describe, expect, it } from "vitest";

import {
  buildAuditCsv,
  buildAuditQueryFilters,
  csvCell,
  normalizeAuditBound,
} from "../lib/audit-query";

describe("normalizeAuditBound", () => {
  it("expands a plain day to its start or end", () => {
    expect(normalizeAuditBound("2026-10-16", "start")).toBe(
      "2026-10-16 00:00:00.000",
    );
    expect(normalizeAuditBound("2026-10-16", "end")).toBe(
      "2026-10-16 23:59:59.999",
    );
  });

  it("keeps a full timestamp and normalizes it to UTC", () => {
    expect(normalizeAuditBound("2026-10-16T07:30:00.000Z", "start")).toBe(
      "2026-10-16 07:30:00.000",
    );
  });

  it("returns null for empty or unparseable values", () => {
    expect(normalizeAuditBound("", "start")).toBeNull();
    expect(normalizeAuditBound("   ", "end")).toBeNull();
    expect(normalizeAuditBound("not-a-date", "start")).toBeNull();
  });
});

describe("buildAuditQueryFilters", () => {
  it("returns no clauses for an empty query", () => {
    expect(buildAuditQueryFilters({})).toEqual({ clauses: [], params: [] });
  });

  it("matches free text against event, actor, and target", () => {
    const { clauses, params } = buildAuditQueryFilters({ search: "usr_1" });

    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toContain("event_type LIKE ?");
    expect(params).toEqual(["%usr_1%", "%usr_1%", "%usr_1%"] );
  });

  it("builds an event type and date range filter", () => {
    const { clauses, params } = buildAuditQueryFilters({
      eventType: "device_key_rotated",
      from: "2026-10-01",
      to: "2026-10-16",
    });

    expect(clauses).toEqual([
      "event_type = ?",
      "created_at >= ?",
      "created_at <= ?",
    ]);
    expect(params).toEqual([
      "device_key_rotated",
      "2026-10-01 00:00:00.000",
      "2026-10-16 23:59:59.999",
    ]);
  });

  it("ignores blank filters instead of matching nothing", () => {
    const { clauses, params } = buildAuditQueryFilters({
      eventType: "   ",
      from: "",
      search: "  ",
      to: "garbage",
    });

    expect(clauses).toEqual([]);
    expect(params).toEqual([]);
  });
});

describe("audit CSV export", () => {
  it("escapes separators, quotes, and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("has;separator")).toBe('"has;separator"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe("line break");
  });

  it("always writes a header, even with no rows", () => {
    const csv = buildAuditCsv([]);

    expect(csv.startsWith("createdAt;eventType;actorUserId;targetUserId;metadata\r\n")).toBe(
      true,
    );
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(1);
  });

  it("renders null identifiers as empty cells", () => {
    const csv = buildAuditCsv([
      {
        actorUserId: null,
        createdAt: "2026-10-16T01:00:00.000Z",
        eventType: "login_succeeded",
        metadata: '{"ok":true}',
        targetUserId: null,
      },
    ]);
    const [, row] = csv.split("\r\n");

    expect(row).toBe(
      '2026-10-16T01:00:00.000Z;login_succeeded;;;"{""ok"":true}"',
    );
  });
});
