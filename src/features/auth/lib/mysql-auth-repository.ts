import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { getMysqlPool } from "../../monitoring/lib/mysql-connection";
import type {
  AuthAccessRequest,
  AuthAuditEvent,
  AuthRole,
  AuthSafeUser,
  AuthSessionSummary,
  AuthSessionUser,
  AuthUserStatus,
} from "../types";
import { isAuthRole, isAuthUserStatus } from "../types";
import {
  createAuthId,
  hashPassword,
  hashRequestFingerprint,
} from "./auth-crypto";
import {
  getLoginLockSeconds,
  getLoginMaxAttempts,
  shouldRequireEmailVerificationForApproval,
} from "./auth-config";

type AuthUserRow = RowDataPacket & {
  id: string;
  email: string;
  username: string;
  full_name: string;
  phone: string | null;
  role: string;
  status: string;
  password_hash: string;
  password_changed_at: Date | null;
  password_reset_required_at: Date | null;
  email_verified_at: Date | null;
  failed_login_count: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  telegram_chat_id: string | null;
  telegram_verified_at: Date | null;
};

type AuthSessionRow = AuthUserRow & {
  session_id: string;
  session_expires_at: Date;
  session_revoked_at: Date | null;
};

type AuthAccessRequestRow = RowDataPacket & {
  request_id: string;
  requested_role: string;
  request_status: string;
  access_reason: string | null;
  review_note: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  user_id: string;
  email: string;
  username: string;
  full_name: string;
  phone: string | null;
  role: string;
  user_status: string;
  email_verified_at: Date | null;
  telegram_verified_at: Date | null;
  password_changed_at: Date | null;
  last_login_at: Date | null;
};

type AuthOtpRow = RowDataPacket & {
  id: string;
  user_id: string | null;
  access_request_id: string | null;
  purpose: string;
  channel: string;
  destination_hash: string;
  code_hash: string;
  expires_at: Date;
  attempt_count: number;
  max_attempts: number;
  used_at: Date | null;
};

type AuthTokenRow = RowDataPacket & {
  id: string;
  user_id: string;
  token_hash: string;
  destination_hash?: string;
  expires_at: Date;
  used_at: Date | null;
  chat_id?: string | null;
};

type AuthSessionSummaryRow = RowDataPacket & {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  last_seen_at: Date;
  created_at: Date;
};

type AuthAuditEventRow = RowDataPacket & {
  id: string;
  actor_user_id: string | null;
  event_type: string;
  target_user_id: string | null;
  metadata_json: string | Record<string, unknown> | null;
  created_at: Date;
};

type AuthUserLifecycleRow = RowDataPacket & {
  id: string;
  role: string;
  status: string;
  email_verified_at: Date | null;
};

type AuthUserDirectoryRow = AuthUserRow & {
  created_at: Date;
};

type VerifiedTelegramUserSummaryRow = RowDataPacket & {
  full_name: string;
  role: string;
  status: string;
  telegram_verified_at: Date;
  username: string;
};

export type VerifiedTelegramUserSummary = Pick<
  AuthSafeUser,
  "fullName" | "role" | "status" | "telegramVerifiedAt" | "username"
>;

type AuthUserCountRow = RowDataPacket & {
  count: number;
};

type AuthUserSummaryRow = RowDataPacket & {
  total_count: number;
  active_count: number;
  pending_count: number;
  suspended_count: number;
  disabled_count: number;
  admin_count: number;
  unverified_count: number;
};

type AuthUserDeleteRow = RowDataPacket & {
  id: string;
  email: string;
  username: string;
  full_name: string;
  role: string;
  status: string;
  email_verified_at: Date | null;
};

export type AuthUserDirectoryItem = AuthSafeUser & {
  createdAt: string;
};

export type AuthUserDirectoryFilters = {
  page?: number;
  pageSize?: number;
  query?: string;
  role?: AuthRole | "all";
  sort?: "created_desc" | "last_login_desc" | "name_asc";
  status?: AuthUserStatus | "all";
  verification?: "all" | "unverified" | "verified";
};

export type AuthUserDirectoryResult = {
  counts: {
    active: number;
    admin: number;
    disabled: number;
    pending: number;
    suspended: number;
    total: number;
    unverified: number;
  };
  filteredCount: number;
  page: number;
  pageCount: number;
  pageSize: number;
  users: AuthUserDirectoryItem[];
};

export type DeletedAuthUserSummary = {
  email: string;
  fullName: string;
  id: string;
  role: AuthRole;
  status: AuthUserStatus;
  username: string;
};

const DEFAULT_AUTH_USER_PAGE_SIZE = 10;
const MAX_AUTH_USER_PAGE_SIZE = 50;

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsedTime = Date.parse(value);

  if (!Number.isFinite(parsedTime)) {
    return null;
  }

  return new Date(parsedTime).toISOString();
}

function toRequiredIso(value: Date | string): string {
  const isoValue = toIso(value);

  if (!isoValue) {
    throw new Error("Auth timestamp from MySQL is invalid.");
  }

  return isoValue;
}

function rowToSafeUser(row: AuthUserRow): AuthSafeUser {
  const role = isAuthRole(row.role) ? row.role : "user";
  const status: AuthUserStatus = isAuthUserStatus(row.status)
    ? row.status
    : "pending";

  return {
    id: row.id,
    email: row.email,
    username: row.username,
    fullName: row.full_name,
    phone: row.phone,
    role,
    status,
    emailVerifiedAt: toIso(row.email_verified_at),
    telegramVerifiedAt: toIso(row.telegram_verified_at),
    passwordChangedAt: toIso(row.password_changed_at),
    lastLoginAt: toIso(row.last_login_at),
  };
}

function rowToDirectoryUser(row: AuthUserDirectoryRow): AuthUserDirectoryItem {
  return {
    ...rowToSafeUser(row),
    createdAt: toRequiredIso(row.created_at),
  };
}

function rowToSessionUser(row: AuthSessionRow): AuthSessionUser {
  return {
    ...rowToSafeUser(row),
    sessionId: row.session_id,
  };
}

function rowToAccessRequest(row: AuthAccessRequestRow): AuthAccessRequest {
  return {
    id: row.request_id,
    user: {
      id: row.user_id,
      email: row.email,
      username: row.username,
      fullName: row.full_name,
      phone: row.phone,
      role: isAuthRole(row.role) ? row.role : "user",
      status: isAuthUserStatus(row.user_status) ? row.user_status : "pending",
      emailVerifiedAt: toIso(row.email_verified_at),
      telegramVerifiedAt: toIso(row.telegram_verified_at),
      passwordChangedAt: toIso(row.password_changed_at),
      lastLoginAt: toIso(row.last_login_at),
    },
    requestedRole: isAuthRole(row.requested_role)
      ? row.requested_role
      : "user",
    accessReason: row.access_reason,
    status:
      row.request_status === "approved" ||
      row.request_status === "rejected" ||
      row.request_status === "cancelled"
        ? row.request_status
        : "pending",
    reviewNote: row.review_note,
    reviewedAt: toIso(row.reviewed_at),
    createdAt: toRequiredIso(row.created_at),
  };
}

function rowToAuditEvent(row: AuthAuditEventRow): AuthAuditEvent {
  const metadata =
    typeof row.metadata_json === "string"
      ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
      : row.metadata_json;

  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    eventType: row.event_type,
    targetUserId: row.target_user_id,
    metadata,
    createdAt: toRequiredIso(row.created_at),
  };
}

function rowToSessionSummary(
  row: AuthSessionSummaryRow,
  currentSessionId: string | null,
): AuthSessionSummary {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: toRequiredIso(row.created_at),
    lastSeenAt: toRequiredIso(row.last_seen_at),
    expiresAt: toRequiredIso(row.expires_at),
    revokedAt: toIso(row.revoked_at),
    current: row.id === currentSessionId,
  };
}

export async function findAuthUserByIdentity(
  identity: string,
): Promise<(AuthSafeUser & { passwordHash: string; lockedUntil: string | null; failedLoginCount: number }) | null> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AuthUserRow[]>(
    `SELECT id, email, username, full_name, phone, role, status, password_hash,
            password_changed_at, password_reset_required_at, email_verified_at,
            telegram_chat_id, telegram_verified_at, failed_login_count,
            locked_until, last_login_at
       FROM auth_users
      WHERE email = ? OR username = ?
      LIMIT 1`,
    [identity, identity],
  );
  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    ...rowToSafeUser(row),
    passwordHash: row.password_hash,
    lockedUntil: toIso(row.locked_until),
    failedLoginCount: row.failed_login_count,
  };
}

export async function findAuthUserById(
  userId: string,
): Promise<AuthSafeUser | null> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AuthUserRow[]>(
    `SELECT id, email, username, full_name, phone, role, status, password_hash,
            password_changed_at, password_reset_required_at, email_verified_at,
            telegram_chat_id, telegram_verified_at, failed_login_count,
            locked_until, last_login_at
       FROM auth_users
      WHERE id = ?
      LIMIT 1`,
    [userId],
  );
  const row = rows[0];

  return row ? rowToSafeUser(row) : null;
}

export async function findAuthUserByVerifiedTelegramChatId(
  chatId: string,
): Promise<VerifiedTelegramUserSummary | null> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<VerifiedTelegramUserSummaryRow[]>(
    `SELECT username, full_name, role, status, telegram_verified_at
       FROM auth_users
      WHERE telegram_chat_id = ?
        AND telegram_verified_at IS NOT NULL
      LIMIT 1`,
    [chatId],
  );
  const row = rows[0];

  if (!row || !isAuthRole(row.role) || !isAuthUserStatus(row.status)) {
    return null;
  }

  return {
    fullName: row.full_name,
    role: row.role,
    status: row.status,
    telegramVerifiedAt: toIso(row.telegram_verified_at),
    username: row.username,
  };
}

export async function findAuthSessionByTokenHash(
  sessionTokenHash: string,
): Promise<AuthSessionUser | null> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AuthSessionRow[]>(
    `SELECT s.id AS session_id, s.expires_at AS session_expires_at,
            s.revoked_at AS session_revoked_at,
            u.id, u.email, u.username, u.full_name, u.phone, u.role, u.status,
            u.password_hash, u.password_changed_at, u.password_reset_required_at,
            u.email_verified_at, u.telegram_chat_id, u.telegram_verified_at,
            u.failed_login_count, u.locked_until, u.last_login_at
       FROM auth_sessions s
       JOIN auth_users u ON u.id = s.user_id
      WHERE s.session_token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > UTC_TIMESTAMP(3)
      LIMIT 1`,
    [sessionTokenHash],
  );
  const row = rows[0];

  if (!row || row.status !== "active") {
    return null;
  }

  return rowToSessionUser(row);
}

export async function createAuthSession({
  user,
  sessionTokenHash,
  expiresAt,
  ipHash,
  userAgentHash,
}: {
  user: AuthSafeUser;
  sessionTokenHash: string;
  expiresAt: Date;
  ipHash: string | null;
  userAgentHash: string | null;
}): Promise<string> {
  const pool = getMysqlPool();
  const sessionId = createAuthId("sess");
  const now = new Date();

  await pool.execute(
    `INSERT INTO auth_sessions
      (id, user_id, session_token_hash, expires_at, last_seen_at, ip_hash, user_agent_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      user.id,
      sessionTokenHash,
      expiresAt,
      now,
      ipHash,
      userAgentHash,
    ],
  );

  await pool.execute(
    `UPDATE auth_users
        SET last_login_at = UTC_TIMESTAMP(3),
            failed_login_count = 0,
            locked_until = NULL
      WHERE id = ?`,
    [user.id],
  );

  return sessionId;
}

export async function revokeAuthSession(sessionId: string): Promise<void> {
  const pool = getMysqlPool();
  await pool.execute(
    `UPDATE auth_sessions
        SET revoked_at = UTC_TIMESTAMP(3)
      WHERE id = ? AND revoked_at IS NULL`,
    [sessionId],
  );
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  const pool = getMysqlPool();
  await pool.execute(
    `UPDATE auth_sessions
        SET revoked_at = UTC_TIMESTAMP(3)
      WHERE user_id = ? AND revoked_at IS NULL`,
    [userId],
  );
}

export async function revokeOtherUserSessions({
  userId,
  currentSessionId,
}: {
  userId: string;
  currentSessionId: string;
}): Promise<void> {
  const pool = getMysqlPool();
  await pool.execute(
    `UPDATE auth_sessions
        SET revoked_at = UTC_TIMESTAMP(3)
      WHERE user_id = ?
        AND id <> ?
        AND revoked_at IS NULL`,
    [userId, currentSessionId],
  );
}

export async function revokeAuthSessionForUser({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string;
}): Promise<void> {
  const pool = getMysqlPool();
  await pool.execute(
    `UPDATE auth_sessions
        SET revoked_at = UTC_TIMESTAMP(3)
      WHERE id = ?
        AND user_id = ?
        AND revoked_at IS NULL`,
    [sessionId, userId],
  );
}

export async function listAuthSessionsForUser({
  userId,
  currentSessionId,
}: {
  userId: string;
  currentSessionId: string | null;
}): Promise<AuthSessionSummary[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AuthSessionSummaryRow[]>(
    `SELECT id, user_id, expires_at, revoked_at, last_seen_at, created_at
       FROM auth_sessions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50`,
    [userId],
  );

  return rows.map((row) => rowToSessionSummary(row, currentSessionId));
}

export async function touchAuthSessionIfStale({
  sessionId,
  staleBefore,
}: {
  sessionId: string;
  staleBefore: Date;
}): Promise<void> {
  const pool = getMysqlPool();
  await pool.execute(
    `UPDATE auth_sessions
        SET last_seen_at = UTC_TIMESTAMP(3)
      WHERE id = ?
        AND revoked_at IS NULL
        AND expires_at > UTC_TIMESTAMP(3)
        AND last_seen_at < ?`,
    [sessionId, staleBefore],
  );
}

export async function recordFailedLogin(userId: string): Promise<void> {
  const pool = getMysqlPool();
  const maxAttempts = getLoginMaxAttempts();
  const lockSeconds = getLoginLockSeconds();

  await pool.execute(
    `UPDATE auth_users
        SET failed_login_count = failed_login_count + 1,
            locked_until = CASE
              WHEN failed_login_count + 1 >= ? THEN DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND)
              ELSE locked_until
            END
      WHERE id = ?`,
    [maxAttempts, lockSeconds, userId],
  );
}

export async function resetFailedLogin(userId: string): Promise<void> {
  const pool = getMysqlPool();
  await pool.execute(
    `UPDATE auth_users
        SET failed_login_count = 0,
            locked_until = NULL
      WHERE id = ?`,
    [userId],
  );
}

export async function updateAuthUserPasswordHash({
  userId,
  passwordHash,
}: {
  userId: string;
  passwordHash: string;
}): Promise<void> {
  const pool = getMysqlPool();
  await pool.execute(
    `UPDATE auth_users
        SET password_hash = ?,
            password_changed_at = UTC_TIMESTAMP(3),
            password_reset_required_at = NULL
      WHERE id = ?`,
    [passwordHash, userId],
  );
}

async function findAuthUserLifecycleForUpdate(
  connection: PoolConnection,
  userId: string,
): Promise<{
  id: string;
  role: AuthRole;
  status: AuthUserStatus;
  emailVerifiedAt: Date | null;
}> {
  const [rows] = await connection.execute<AuthUserLifecycleRow[]>(
    `SELECT id, role, status, email_verified_at
       FROM auth_users
      WHERE id = ?
      LIMIT 1
      FOR UPDATE`,
    [userId],
  );
  const row = rows[0];

  if (!row || !isAuthRole(row.role) || !isAuthUserStatus(row.status)) {
    throw new Error("User not found.");
  }

  return {
    id: row.id,
    role: row.role,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
  };
}

async function assertActiveAdminCanChange({
  connection,
  target,
  nextRole,
  nextStatus,
}: {
  connection: PoolConnection;
  target: { id: string; role: AuthRole; status: AuthUserStatus };
  nextRole: AuthRole;
  nextStatus: AuthUserStatus;
}): Promise<void> {
  const targetKeepsActiveAdmin =
    target.role !== "admin" ||
    target.status !== "active" ||
    (nextRole === "admin" && nextStatus === "active");

  if (targetKeepsActiveAdmin) {
    return;
  }

  const [rows] = await connection.execute<AuthUserLifecycleRow[]>(
    `SELECT id, role, status
       FROM auth_users
      WHERE role = 'admin'
        AND status = 'active'
      FOR UPDATE`,
  );
  const remainingActiveAdmins = rows.filter((row) => row.id !== target.id);

  if (remainingActiveAdmins.length < 1) {
    throw new Error("There must be at least one active admin.");
  }
}

async function revokeAllUserSessionsWithConnection(
  connection: PoolConnection,
  userId: string,
): Promise<void> {
  await connection.execute(
    `UPDATE auth_sessions
        SET revoked_at = UTC_TIMESTAMP(3)
      WHERE user_id = ? AND revoked_at IS NULL`,
    [userId],
  );
}

export async function updateAuthUserRole({
  targetUserId,
  role,
}: {
  targetUserId: string;
  role: AuthRole;
}): Promise<void> {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const target = await findAuthUserLifecycleForUpdate(
      connection,
      targetUserId,
    );

    if (target.status === "pending") {
      throw new Error("Pending users must be processed from access requests.");
    }

    if (
      target.status === "active" &&
      shouldRequireEmailVerificationForApproval() &&
      !target.emailVerifiedAt
    ) {
      throw new Error("User email is not verified.");
    }

    await assertActiveAdminCanChange({
      connection,
      target,
      nextRole: role,
      nextStatus: target.status,
    });

    await connection.execute(
      `UPDATE auth_users
          SET role = ?
        WHERE id = ?`,
      [role, targetUserId],
    );

    if (target.role !== role) {
      await revokeAllUserSessionsWithConnection(connection, targetUserId);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function setAuthUserStatus({
  targetUserId,
  status,
}: {
  targetUserId: string;
  status: AuthUserStatus;
}): Promise<void> {
  if (status === "pending") {
    throw new Error("Pending status is only for new access requests.");
  }

  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const target = await findAuthUserLifecycleForUpdate(
      connection,
      targetUserId,
    );

    if (target.status === "pending") {
      throw new Error("Pending users must be processed from access requests.");
    }

    await assertActiveAdminCanChange({
      connection,
      target,
      nextRole: target.role,
      nextStatus: status,
    });

    await connection.execute(
      `UPDATE auth_users
          SET status = ?,
              email_verified_at = CASE
                WHEN ? = 'active' THEN COALESCE(email_verified_at, UTC_TIMESTAMP(3))
                ELSE email_verified_at
              END,
              failed_login_count = CASE
                WHEN ? = 'active' THEN 0
                ELSE failed_login_count
              END,
              locked_until = CASE
                WHEN ? = 'active' THEN NULL
                ELSE locked_until
              END
        WHERE id = ?`,
      [status, status, status, status, targetUserId],
    );

    if (status !== "active") {
      await revokeAllUserSessionsWithConnection(connection, targetUserId);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function deleteAuthUser({
  targetUserId,
}: {
  targetUserId: string;
}): Promise<DeletedAuthUserSummary> {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute<AuthUserDeleteRow[]>(
      `SELECT id, email, username, full_name, role, status, email_verified_at
         FROM auth_users
        WHERE id = ?
        LIMIT 1
        FOR UPDATE`,
      [targetUserId],
    );
    const row = rows[0];

    if (!row || !isAuthRole(row.role) || !isAuthUserStatus(row.status)) {
      throw new Error("User not found.");
    }

    await assertActiveAdminCanChange({
      connection,
      target: {
        id: row.id,
        role: row.role,
        status: row.status,
      },
      nextRole: "user",
      nextStatus: "disabled",
    });

    const [deviceRequestRows] = await connection.execute<AuthUserCountRow[]>(
      `SELECT COUNT(*) AS count
         FROM monitoring_device_requests
        WHERE requester_user_id = ?`,
      [targetUserId],
    );

    if (toCount(deviceRequestRows[0]?.count) > 0) {
      throw new Error(
        "This user has device requests. Disable the account to keep the operational trail safe.",
      );
    }

    await connection.execute(
      `DELETE FROM auth_access_requests
        WHERE user_id = ?`,
      [targetUserId],
    );

    await connection.execute(
      `DELETE FROM auth_users
        WHERE id = ?`,
      [targetUserId],
    );

    await connection.commit();

    return {
      email: row.email,
      fullName: row.full_name,
      id: row.id,
      role: row.role,
      status: row.status,
      username: row.username,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createPendingAccessRequest({
  fullName,
  username,
  email,
  phone,
  password,
  requestedRole,
  accessReason,
}: {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  requestedRole: AuthRole;
  accessReason: string | null;
}): Promise<{
  userId: string;
  accessRequestId: string;
  created: boolean;
  email: string;
}> {
  const pool = getMysqlPool();
  const [existingRows] = await pool.execute<AuthUserRow[]>(
    `SELECT id, email, username, full_name, phone, role, status, password_hash,
            password_changed_at, password_reset_required_at, email_verified_at,
            telegram_chat_id, telegram_verified_at, failed_login_count,
            locked_until, last_login_at
       FROM auth_users
      WHERE email = ? OR username = ?
      LIMIT 1`,
    [email, username],
  );
  const existing = existingRows[0];

  if (existing) {
    const [requestRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id
         FROM auth_access_requests
        WHERE user_id = ? AND status = 'pending'
        LIMIT 1`,
      [existing.id],
    );

    return {
      userId: existing.id,
      accessRequestId: String(requestRows[0]?.id ?? ""),
      created: false,
      email: existing.email,
    };
  }

  const userId = createAuthId("usr");
  const accessRequestId = createAuthId("req");
  const passwordHash = await hashPassword(password);

  await pool.execute(
    `INSERT INTO auth_users
      (id, email, username, full_name, phone, role, status, password_hash, password_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, UTC_TIMESTAMP(3))`,
    [userId, email, username, fullName, phone, requestedRole, passwordHash],
  );

  await pool.execute(
    `INSERT INTO auth_access_requests
      (id, user_id, requested_role, access_reason, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [accessRequestId, userId, requestedRole, accessReason],
  );

  return { userId, accessRequestId, created: true, email };
}

export async function listPendingAccessRequests(): Promise<AuthAccessRequest[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AuthAccessRequestRow[]>(
    `SELECT r.id AS request_id, r.requested_role, r.status AS request_status,
            r.access_reason, r.review_note, r.reviewed_at, r.created_at,
            u.id AS user_id, u.email, u.username, u.full_name, u.phone,
            u.role, u.status AS user_status, u.email_verified_at,
            u.telegram_verified_at, u.password_changed_at, u.last_login_at
       FROM auth_access_requests r
       JOIN auth_users u ON u.id = r.user_id
      WHERE r.status = 'pending'
      ORDER BY r.created_at ASC
      LIMIT 100`,
  );

  return rows.map(rowToAccessRequest);
}

export async function listAuthUsers(): Promise<AuthSafeUser[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AuthUserRow[]>(
    `SELECT id, email, username, full_name, phone, role, status, password_hash,
            password_changed_at, password_reset_required_at, email_verified_at,
            telegram_chat_id, telegram_verified_at, failed_login_count,
            locked_until, last_login_at
       FROM auth_users
      ORDER BY created_at DESC
      LIMIT 200`,
  );

  return rows.map(rowToSafeUser);
}

function getAuthUserDirectoryPageSize(pageSize: number | undefined): number {
  if (!Number.isInteger(pageSize) || !pageSize) {
    return DEFAULT_AUTH_USER_PAGE_SIZE;
  }

  return Math.min(Math.max(pageSize, 1), MAX_AUTH_USER_PAGE_SIZE);
}

function getAuthUserDirectoryPage(page: number | undefined): number {
  if (!Number.isInteger(page) || !page || page < 1) {
    return 1;
  }

  return page;
}

function getAuthUserDirectoryWhere({
  query,
  role,
  status,
  verification,
}: AuthUserDirectoryFilters): {
  values: string[];
  whereSql: string;
} {
  const clauses: string[] = [];
  const values: string[] = [];
  const cleanQuery = String(query ?? "").trim().slice(0, 120);

  if (cleanQuery) {
    const likeQuery = `%${cleanQuery}%`;
    clauses.push(
      `(full_name LIKE ? OR username LIKE ? OR email LIKE ? OR phone LIKE ?)`,
    );
    values.push(likeQuery, likeQuery, likeQuery, likeQuery);
  }

  if (role && role !== "all") {
    clauses.push("role = ?");
    values.push(role);
  }

  if (status && status !== "all") {
    clauses.push("status = ?");
    values.push(status);
  }

  if (verification === "verified") {
    clauses.push("email_verified_at IS NOT NULL");
  } else if (verification === "unverified") {
    clauses.push("email_verified_at IS NULL");
  }

  return {
    values,
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
  };
}

function getAuthUserDirectoryOrder(sort: AuthUserDirectoryFilters["sort"]) {
  switch (sort) {
    case "last_login_desc":
      return "last_login_at IS NULL ASC, last_login_at DESC, created_at DESC";
    case "name_asc":
      return "full_name ASC, email ASC";
    case "created_desc":
    default:
      return "created_at DESC";
  }
}

function toCount(value: unknown): number {
  const count = Number(value);

  return Number.isFinite(count) ? count : 0;
}

export async function listAuthUsersForAdmin(
  filters: AuthUserDirectoryFilters = {},
): Promise<AuthUserDirectoryResult> {
  const pool = getMysqlPool();
  const pageSize = getAuthUserDirectoryPageSize(filters.pageSize);
  const requestedPage = getAuthUserDirectoryPage(filters.page);
  const { values, whereSql } = getAuthUserDirectoryWhere(filters);
  const [summaryRows, countRows] = await Promise.all([
    pool.execute<AuthUserSummaryRow[]>(
      `SELECT
          COUNT(*) AS total_count,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
          SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended_count,
          SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) AS disabled_count,
          SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admin_count,
          SUM(CASE WHEN email_verified_at IS NULL THEN 1 ELSE 0 END) AS unverified_count
         FROM auth_users`,
    ),
    pool.execute<AuthUserCountRow[]>(
      `SELECT COUNT(*) AS count
         FROM auth_users
        ${whereSql}`,
      values,
    ),
  ]);
  const summary = summaryRows[0][0];
  const filteredCount = toCount(countRows[0][0]?.count);
  const pageCount = Math.max(1, Math.ceil(filteredCount / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * pageSize;
  const limitSql = String(pageSize);
  const offsetSql = String(offset);
  const [userRows] = await pool.execute<AuthUserDirectoryRow[]>(
    `SELECT id, email, username, full_name, phone, role, status, password_hash,
            password_changed_at, password_reset_required_at, email_verified_at,
            telegram_chat_id, telegram_verified_at, failed_login_count,
            locked_until, last_login_at, created_at
       FROM auth_users
      ${whereSql}
      ORDER BY ${getAuthUserDirectoryOrder(filters.sort)}
      LIMIT ${limitSql} OFFSET ${offsetSql}`,
    values,
  );

  return {
    counts: {
      active: toCount(summary?.active_count),
      admin: toCount(summary?.admin_count),
      disabled: toCount(summary?.disabled_count),
      pending: toCount(summary?.pending_count),
      suspended: toCount(summary?.suspended_count),
      total: toCount(summary?.total_count),
      unverified: toCount(summary?.unverified_count),
    },
    filteredCount,
    page,
    pageCount,
    pageSize,
    users: userRows.map(rowToDirectoryUser),
  };
}

export async function approveAccessRequest({
  accessRequestId,
  adminUserId,
}: {
  accessRequestId: string;
  adminUserId: string;
}): Promise<void> {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT user_id, requested_role, u.email_verified_at
         FROM auth_access_requests
         JOIN auth_users u ON u.id = auth_access_requests.user_id
        WHERE auth_access_requests.id = ?
          AND auth_access_requests.status = 'pending'
        FOR UPDATE`,
      [accessRequestId],
    );
    const row = rows[0] as
      | {
          user_id: string;
          requested_role: string;
          email_verified_at: Date | null;
        }
      | undefined;

    if (!row || !isAuthRole(row.requested_role)) {
      throw new Error("Access request not found.");
    }

    if (
      shouldRequireEmailVerificationForApproval() &&
      !row.email_verified_at
    ) {
      throw new Error(
        "User email is not verified. Resend the verification link if needed.",
      );
    }

    await connection.execute(
      `UPDATE auth_users
          SET status = 'active',
              role = ?,
              email_verified_at = CASE
                WHEN ? = TRUE THEN email_verified_at
                ELSE COALESCE(email_verified_at, UTC_TIMESTAMP(3))
              END
        WHERE id = ?`,
      [
        row.requested_role,
        shouldRequireEmailVerificationForApproval(),
        row.user_id,
      ],
    );

    await connection.execute(
      `UPDATE auth_access_requests
          SET status = 'approved',
              reviewed_by_user_id = ?,
              reviewed_at = UTC_TIMESTAMP(3)
        WHERE id = ?`,
      [adminUserId, accessRequestId],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function rejectAccessRequest({
  accessRequestId,
  adminUserId,
}: {
  accessRequestId: string;
  adminUserId: string;
}): Promise<void> {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT user_id
         FROM auth_access_requests
        WHERE id = ? AND status = 'pending'
        FOR UPDATE`,
      [accessRequestId],
    );
    const row = rows[0] as { user_id: string } | undefined;

    if (!row) {
      throw new Error("Access request not found.");
    }

    await connection.execute(
      `UPDATE auth_users
          SET status = 'disabled'
        WHERE id = ?`,
      [row.user_id],
    );

    await connection.execute(
      `UPDATE auth_access_requests
          SET status = 'rejected',
              reviewed_by_user_id = ?,
              reviewed_at = UTC_TIMESTAMP(3)
        WHERE id = ?`,
      [adminUserId, accessRequestId],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createOtpCodeRecord({
  userId,
  purpose,
  channel,
  destinationHash,
  codeHash,
  expiresAt,
}: {
  userId: string;
  purpose: "login_admin_2fa";
  channel: "email";
  destinationHash: string;
  codeHash: string;
  expiresAt: Date;
}): Promise<string> {
  const pool = getMysqlPool();
  const otpId = createAuthId("otp");

  await pool.execute(
    `UPDATE auth_otp_codes
        SET used_at = UTC_TIMESTAMP(3)
      WHERE user_id = ?
        AND purpose = ?
        AND used_at IS NULL`,
    [userId, purpose],
  );

  await pool.execute(
    `INSERT INTO auth_otp_codes
      (id, user_id, purpose, channel, destination_hash, code_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [otpId, userId, purpose, channel, destinationHash, codeHash, expiresAt],
  );

  return otpId;
}

export async function findOtpCodeRecord(
  otpId: string,
): Promise<AuthOtpRow | null> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AuthOtpRow[]>(
    `SELECT id, user_id, access_request_id, purpose, channel, destination_hash,
            code_hash, expires_at, attempt_count, max_attempts, used_at
       FROM auth_otp_codes
      WHERE id = ?
      LIMIT 1`,
    [otpId],
  );

  return rows[0] ?? null;
}

export async function markOtpAttempt(otpId: string): Promise<void> {
  const pool = getMysqlPool();
  await pool.execute(
    `UPDATE auth_otp_codes
        SET attempt_count = attempt_count + 1
      WHERE id = ?`,
    [otpId],
  );
}

export async function markOtpUsed(otpId: string): Promise<void> {
  const pool = getMysqlPool();
  await pool.execute(
    `UPDATE auth_otp_codes
        SET used_at = UTC_TIMESTAMP(3)
      WHERE id = ? AND used_at IS NULL`,
    [otpId],
  );
}

export async function createPasswordResetTokenRecord({
  userId,
  tokenHash,
  destinationHash,
  expiresAt,
  ipHash,
  userAgentHash,
}: {
  userId: string;
  tokenHash: string;
  destinationHash: string;
  expiresAt: Date;
  ipHash: string | null;
  userAgentHash: string | null;
}): Promise<string> {
  const pool = getMysqlPool();
  const tokenId = createAuthId("prt");

  await pool.execute(
    `UPDATE auth_password_reset_tokens
        SET used_at = UTC_TIMESTAMP(3)
      WHERE user_id = ?
        AND used_at IS NULL`,
    [userId],
  );

  await pool.execute(
    `INSERT INTO auth_password_reset_tokens
      (id, user_id, token_hash, destination_hash, expires_at, ip_hash, user_agent_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tokenId, userId, tokenHash, destinationHash, expiresAt, ipHash, userAgentHash],
  );

  return tokenId;
}

export async function findPasswordResetTokenRecord(
  tokenHash: string,
): Promise<AuthTokenRow | null> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AuthTokenRow[]>(
    `SELECT id, user_id, token_hash, destination_hash, expires_at, used_at
       FROM auth_password_reset_tokens
      WHERE token_hash = ?
      LIMIT 1`,
    [tokenHash],
  );

  return rows[0] ?? null;
}

export async function markPasswordResetTokenUsed(tokenId: string): Promise<void> {
  const pool = getMysqlPool();
  await pool.execute(
    `UPDATE auth_password_reset_tokens
        SET used_at = UTC_TIMESTAMP(3)
      WHERE id = ? AND used_at IS NULL`,
    [tokenId],
  );
}

export async function createEmailVerificationTokenRecord({
  userId,
  tokenHash,
  destinationHash,
  expiresAt,
  ipHash,
  userAgentHash,
}: {
  userId: string;
  tokenHash: string;
  destinationHash: string;
  expiresAt: Date;
  ipHash: string | null;
  userAgentHash: string | null;
}): Promise<string> {
  const pool = getMysqlPool();
  const tokenId = createAuthId("evt");

  await pool.execute(
    `UPDATE auth_email_verification_tokens
        SET used_at = UTC_TIMESTAMP(3)
      WHERE user_id = ?
        AND used_at IS NULL`,
    [userId],
  );

  await pool.execute(
    `INSERT INTO auth_email_verification_tokens
      (id, user_id, token_hash, destination_hash, expires_at, ip_hash, user_agent_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tokenId, userId, tokenHash, destinationHash, expiresAt, ipHash, userAgentHash],
  );

  return tokenId;
}

export async function findEmailVerificationTokenRecord(
  tokenHash: string,
): Promise<AuthTokenRow | null> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AuthTokenRow[]>(
    `SELECT id, user_id, token_hash, destination_hash, expires_at, used_at
       FROM auth_email_verification_tokens
      WHERE token_hash = ?
      LIMIT 1`,
    [tokenHash],
  );

  return rows[0] ?? null;
}

export async function markEmailVerificationTokenUsed(
  tokenId: string,
): Promise<void> {
  const pool = getMysqlPool();
  await pool.execute(
    `UPDATE auth_email_verification_tokens
        SET used_at = UTC_TIMESTAMP(3)
      WHERE id = ? AND used_at IS NULL`,
    [tokenId],
  );
}

export async function markAuthUserEmailVerified(userId: string): Promise<void> {
  const pool = getMysqlPool();
  await pool.execute(
    `UPDATE auth_users
        SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP(3))
      WHERE id = ?`,
    [userId],
  );
}

export async function createTelegramBindTokenRecord({
  userId,
  tokenHash,
  expiresAt,
  ipHash,
  userAgentHash,
}: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  ipHash: string | null;
  userAgentHash: string | null;
}): Promise<string> {
  const pool = getMysqlPool();
  const tokenId = createAuthId("tbt");

  await pool.execute(
    `UPDATE auth_telegram_bind_tokens
        SET used_at = UTC_TIMESTAMP(3)
      WHERE user_id = ?
        AND used_at IS NULL`,
    [userId],
  );

  await pool.execute(
    `INSERT INTO auth_telegram_bind_tokens
      (id, user_id, token_hash, expires_at, ip_hash, user_agent_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tokenId, userId, tokenHash, expiresAt, ipHash, userAgentHash],
  );

  return tokenId;
}

export async function completeTelegramBindingInMysql({
  tokenHash,
  chatId,
}: {
  tokenHash: string;
  chatId: string;
}): Promise<{ userId: string } | null> {
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [tokens] = await connection.execute<AuthTokenRow[]>(
      `SELECT id, user_id, token_hash, expires_at, used_at, chat_id
         FROM auth_telegram_bind_tokens
        WHERE token_hash = ?
          AND used_at IS NULL
          AND expires_at > UTC_TIMESTAMP(3)
        LIMIT 1
        FOR UPDATE`,
      [tokenHash],
    );
    const token = tokens[0];

    if (!token) {
      await connection.rollback();
      return null;
    }

    const [conflictingUsers] = await connection.execute<
      Array<RowDataPacket & { id: string }>
    >(
      `SELECT id
         FROM auth_users
        WHERE telegram_chat_id = ?
          AND id <> ?
        LIMIT 1
        FOR UPDATE`,
      [chatId, token.user_id],
    );

    if (conflictingUsers[0]) {
      throw new Error("This Telegram is already connected to another FTM account.");
    }

    const [userUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE auth_users
          SET telegram_chat_id = ?,
              telegram_verified_at = UTC_TIMESTAMP(3)
        WHERE id = ?`,
      [chatId, token.user_id],
    );

    if (userUpdate.affectedRows !== 1) {
      throw new Error("Account for Telegram binding not found.");
    }

    const [tokenUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE auth_telegram_bind_tokens
          SET used_at = UTC_TIMESTAMP(3),
              chat_id = ?
        WHERE id = ?
          AND used_at IS NULL`,
      [chatId, token.id],
    );

    if (tokenUpdate.affectedRows !== 1) {
      throw new Error("Telegram token is invalid.");
    }

    await connection.commit();

    return { userId: token.user_id };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateAuthUserProfile({
  fullName,
  phone,
  userId,
}: {
  fullName: string;
  phone: string | null;
  userId: string;
}): Promise<void> {
  const pool = getMysqlPool();
  await pool.execute(
    `UPDATE auth_users
        SET full_name = ?,
            phone = ?
      WHERE id = ?`,
    [fullName, phone, userId],
  );
}

export async function recordAuthAuditEvent({
  actorUserId,
  eventType,
  targetUserId,
  ip,
  userAgent,
  metadata,
}: {
  actorUserId?: string | null;
  eventType: string;
  targetUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const pool = getMysqlPool();
  const auditId = createAuthId("aud");

  await pool.execute(
    `INSERT INTO auth_audit_events
      (id, actor_user_id, event_type, target_user_id, ip_hash, user_agent_hash, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      auditId,
      actorUserId ?? null,
      eventType,
      targetUserId ?? null,
      hashRequestFingerprint(ip ?? null),
      hashRequestFingerprint(userAgent ?? null),
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
}

export async function listAuthAuditEvents(): Promise<AuthAuditEvent[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AuthAuditEventRow[]>(
    `SELECT id, actor_user_id, event_type, target_user_id, metadata_json, created_at
       FROM auth_audit_events
      ORDER BY created_at DESC
      LIMIT 100`,
  );

  return rows.map(rowToAuditEvent);
}

export async function createAdminUserIfMissing({
  email,
  username,
  fullName,
  password,
}: {
  email: string;
  username: string;
  fullName: string;
  password: string;
}): Promise<{ created: boolean; userId: string }> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AuthUserRow[]>(
    `SELECT id, email, username, full_name, phone, role, status, password_hash,
            password_changed_at, password_reset_required_at, email_verified_at,
            telegram_chat_id, telegram_verified_at, failed_login_count,
            locked_until, last_login_at
       FROM auth_users
      WHERE email = ? OR username = ?
      LIMIT 1`,
    [email, username],
  );
  const existing = rows[0];

  if (existing) {
    return { created: false, userId: existing.id };
  }

  const userId = createAuthId("usr");
  const passwordHash = await hashPassword(password);

  await pool.execute<ResultSetHeader>(
    `INSERT INTO auth_users
      (id, email, username, full_name, role, status, password_hash, password_changed_at, email_verified_at)
     VALUES (?, ?, ?, ?, 'admin', 'active', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [userId, email, username, fullName, passwordHash],
  );

  return { created: true, userId };
}
