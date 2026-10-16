export type AuthAuditEventQuery = {
  /** Free-text match on event type, actor id, or target id. */
  search?: string | null;
  /** Inclusive lower bound (ISO timestamp or UTC day). */
  from?: string | null;
  /** Inclusive upper bound (ISO timestamp or UTC day). */
  to?: string | null;
  eventType?: string | null;
  limit?: number;
  offset?: number;
};

export type AuthAuditQueryFilter = {
  clauses: string[];
  params: Array<string | number>;
};

/**
 * Accepts either a full ISO timestamp or a plain day (`YYYY-MM-DD`). A plain
 * day is expanded to its start or end so an operator can filter "this day"
 * without knowing the exact time.
 *
 * Returns `null` for values that cannot be parsed, so a malformed filter is
 * ignored instead of silently matching nothing.
 */
export function normalizeAuditBound(
  value: string,
  edge: "start" | "end",
): string | null {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return edge === "start"
      ? `${trimmed} 00:00:00.000`
      : `${trimmed} 23:59:59.999`;
  }

  const parsed = Date.parse(trimmed);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString().slice(0, 23).replace("T", " ");
}

export function buildAuditQueryFilters(
  query: AuthAuditEventQuery,
): AuthAuditQueryFilter {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const search = query.search?.trim();

  if (search) {
    clauses.push(
      "(event_type LIKE ? OR actor_user_id LIKE ? OR target_user_id LIKE ?)",
    );
    const pattern = `%${search}%`;

    params.push(pattern, pattern, pattern);
  }

  if (query.eventType?.trim()) {
    clauses.push("event_type = ?");
    params.push(query.eventType.trim());
  }

  if (query.from?.trim()) {
    const from = normalizeAuditBound(query.from, "start");

    if (from) {
      clauses.push("created_at >= ?");
      params.push(from);
    }
  }

  if (query.to?.trim()) {
    const to = normalizeAuditBound(query.to, "end");

    if (to) {
      clauses.push("created_at <= ?");
      params.push(to);
    }
  }

  return { clauses, params };
}

export type AuditCsvRow = {
  actorUserId: string | null;
  createdAt: string;
  eventType: string;
  metadata: string;
  targetUserId: string | null;
};

export function csvCell(value: string): string {
  const normalized = value.replace(/\r?\n/g, " ");

  return /[",;]/.test(normalized)
    ? `"${normalized.replaceAll('"', '""')}"`
    : normalized;
}

/**
 * Semicolon-separated so Excel in a comma-decimal locale opens it directly.
 * Values containing separators or quotes are escaped; embedded newlines are
 * collapsed because the export is meant for spreadsheet review.
 */
export function buildAuditCsv(rows: AuditCsvRow[]): string {
  const header = "createdAt;eventType;actorUserId;targetUserId;metadata";
  const lines = rows.map((row) =>
    [
      row.createdAt,
      row.eventType,
      row.actorUserId ?? "",
      row.targetUserId ?? "",
      row.metadata,
    ]
      .map(csvCell)
      .join(";"),
  );

  return `${header}\r\n${lines.join("\r\n")}\r\n`;
}
