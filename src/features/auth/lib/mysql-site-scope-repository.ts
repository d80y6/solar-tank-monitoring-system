import { randomUUID } from "node:crypto";

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { getMysqlPool } from "@/features/monitoring/lib/mysql-connection";

import type { SiteScope, SiteScopeRole } from "./site-scope";

type SiteScopeRow = RowDataPacket & {
  created_at: Date;
  granted_by_user_id: string | null;
  id: string;
  note: string | null;
  scope_role: string;
  site_id: string;
  user_id: string;
};

export type SiteScopeOverviewRow = {
  areaLabel: string | null;
  scopeRole: SiteScopeRole;
  siteCode: string;
  siteId: string;
  siteName: string;
};

export type UserSiteScopeSummary = {
  email: string;
  fullName: string;
  role: string;
  scopes: SiteScopeOverviewRow[];
  status: string;
  userId: string;
  username: string;
};

function mapScope(row: SiteScopeRow): SiteScope {
  return {
    createdAt: row.created_at.toISOString(),
    grantedByUserId: row.granted_by_user_id,
    id: row.id,
    note: row.note,
    scopeRole: row.scope_role === "operator" ? "operator" : "viewer",
    siteId: row.site_id,
    userId: row.user_id,
  };
}

export async function listSiteScopesForUserFromMysql(
  userId: string,
): Promise<SiteScope[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<SiteScopeRow[]>(
    `SELECT id, user_id, site_id, scope_role, note, granted_by_user_id, created_at
       FROM auth_user_site_scopes
      WHERE user_id = ?
      ORDER BY created_at ASC`,
    [userId],
  );

  return rows.map(mapScope);
}

export async function listSiteScopesForUsersFromMysql(
  userIds: string[],
): Promise<Map<string, SiteScope[]>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const pool = getMysqlPool();
  const placeholders = userIds.map(() => "?").join(", ");
  const [rows] = await pool.execute<SiteScopeRow[]>(
    `SELECT id, user_id, site_id, scope_role, note, granted_by_user_id, created_at
       FROM auth_user_site_scopes
      WHERE user_id IN (${placeholders})`,
    userIds,
  );
  const grouped = new Map<string, SiteScope[]>();

  for (const row of rows) {
    const scope = mapScope(row);
    const list = grouped.get(scope.userId) ?? [];

    list.push(scope);
    grouped.set(scope.userId, list);
  }

  return grouped;
}

export async function listUserSiteScopeSummariesFromMysql(): Promise<
  UserSiteScopeSummary[]
> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<
    Array<
      RowDataPacket & {
        area_label: string | null;
        email: string;
        full_name: string;
        role: string;
        scope_role: string | null;
        site_code: string | null;
        site_id: string | null;
        site_name: string | null;
        status: string;
        user_id: string;
        username: string;
      }
    >
  >(
    `SELECT users.id AS user_id,
            users.email,
            users.username,
            users.full_name,
            users.role,
            users.status,
            scopes.site_id,
            scopes.scope_role,
            sites.code AS site_code,
            sites.name AS site_name,
            sites.area_label
       FROM auth_users AS users
       LEFT JOIN auth_user_site_scopes AS scopes ON scopes.user_id = users.id
       LEFT JOIN monitoring_sites AS sites ON sites.id = scopes.site_id
      ORDER BY users.role DESC, users.username ASC, sites.code ASC
      LIMIT 1000`,
  );
  const grouped = new Map<string, UserSiteScopeSummary>();

  for (const row of rows) {
    const existing = grouped.get(row.user_id) ?? {
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      scopes: [],
      status: row.status,
      userId: row.user_id,
      username: row.username,
    };

    if (row.site_id && row.site_code) {
      existing.scopes.push({
        areaLabel: row.area_label,
        scopeRole: row.scope_role === "operator" ? "operator" : "viewer",
        siteCode: row.site_code,
        siteId: row.site_id,
        siteName: row.site_name ?? row.site_code,
      });
    }

    grouped.set(row.user_id, existing);
  }

  return Array.from(grouped.values());
}

export async function replaceUserSiteScopesInMysql({
  grantedByUserId,
  note,
  scopeRole,
  siteIds,
  userId,
}: {
  grantedByUserId: string;
  note?: string | null;
  scopeRole: SiteScopeRole;
  siteIds: string[];
  userId: string;
}): Promise<{ granted: number; revoked: number }> {
  const pool = getMysqlPool();
  const cleanSiteIds = Array.from(
    new Set(siteIds.map((siteId) => siteId.trim()).filter(Boolean)),
  );
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let revoked = 0;

    if (cleanSiteIds.length === 0) {
      const [deleteResult] = await connection.execute<ResultSetHeader>(
        `DELETE FROM auth_user_site_scopes WHERE user_id = ?`,
        [userId],
      );

      revoked = deleteResult.affectedRows;
    } else {
      const placeholders = cleanSiteIds.map(() => "?").join(", ");
      const [deleteResult] = await connection.execute<ResultSetHeader>(
        `DELETE FROM auth_user_site_scopes
          WHERE user_id = ?
            AND site_id NOT IN (${placeholders})`,
        [userId, ...cleanSiteIds],
      );

      revoked = deleteResult.affectedRows;
    }

    let granted = 0;

    for (const siteId of cleanSiteIds) {
      const [insertResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO auth_user_site_scopes
           (id, user_id, site_id, scope_role, note, granted_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           scope_role = VALUES(scope_role),
           note = VALUES(note),
           granted_by_user_id = VALUES(granted_by_user_id)`,
        [
          `site_scope_${randomUUID()}`,
          userId,
          siteId,
          scopeRole,
          note ?? null,
          grantedByUserId,
        ],
      );

      granted += insertResult.affectedRows;
    }

    await connection.commit();

    return { granted, revoked };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
