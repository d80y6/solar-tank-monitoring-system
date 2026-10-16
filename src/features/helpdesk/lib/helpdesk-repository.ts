import { randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { AuthSessionUser } from "@/features/auth/types";
import {
  createAuthId,
  createRandomToken,
  hashOneTimeToken,
} from "@/features/auth/lib/auth-crypto";
import { getMysqlPool } from "@/features/monitoring/lib/mysql-connection";
import type {
  HelpdeskMessage,
  HelpdeskSenderType,
  HelpdeskSession,
  HelpdeskSessionBundle,
} from "../types";

const MAX_MESSAGE_LENGTH = 1500;
const MAX_SOURCE_PATH_LENGTH = 255;

type HelpdeskSessionRow = RowDataPacket & {
  id: string;
  session_code: string;
  requester_email: string | null;
  requester_name: string | null;
  source_path: string | null;
  status: string;
  last_message_at: Date;
  closed_at: Date | null;
  created_at: Date;
};

type HelpdeskMessageRow = RowDataPacket & {
  id: string;
  session_id: string;
  sender_type: string;
  sender_label: string;
  body: string;
  created_at: Date;
};

type AdminTelegramRow = RowDataPacket & {
  email: string;
  full_name: string;
  id: string;
  telegram_chat_id: string | null;
  username: string;
};

function toIso(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

function toRequiredIso(value: Date | string): string {
  const isoValue = toIso(value);

  if (!isoValue) {
    throw new Error("Helpdesk timestamp from MySQL is invalid.");
  }

  return isoValue;
}

function rowToSession(row: HelpdeskSessionRow): HelpdeskSession {
  return {
    id: row.id,
    sessionCode: row.session_code,
    requesterEmail: row.requester_email,
    requesterName: row.requester_name,
    sourcePath: row.source_path,
    status: row.status === "closed" ? "closed" : "open",
    lastMessageAt: toRequiredIso(row.last_message_at),
    closedAt: toIso(row.closed_at),
    createdAt: toRequiredIso(row.created_at),
  };
}

function rowToMessage(row: HelpdeskMessageRow): HelpdeskMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    senderType: parseSenderType(row.sender_type),
    senderLabel: row.sender_label,
    body: row.body,
    createdAt: toRequiredIso(row.created_at),
  };
}

function parseSenderType(value: string): HelpdeskSenderType {
  if (
    value === "visitor" ||
    value === "user" ||
    value === "admin" ||
    value === "system"
  ) {
    return value;
  }

  return "system";
}

function normalizeSourcePath(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();

  if (!text) {
    return null;
  }

  return text.slice(0, MAX_SOURCE_PATH_LENGTH);
}

export function normalizeHelpdeskMessage(value: unknown): string {
  const text = String(value ?? "")
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n");

  if (!text) {
    throw new Error("Helpdesk message must not be empty.");
  }

  return text.slice(0, MAX_MESSAGE_LENGTH);
}

function buildRequester(user: AuthSessionUser | null): {
  email: string | null;
  label: string;
  name: string | null;
  senderType: HelpdeskSenderType;
  userId: string | null;
} {
  if (!user) {
    return {
      email: null,
      label: "Visitor",
      name: null,
      senderType: "visitor",
      userId: null,
    };
  }

  return {
    email: user.email,
    label: user.fullName || user.email,
    name: user.fullName,
    senderType: "user",
    userId: user.id,
  };
}

function buildSessionCode(now = new Date()): string {
  const yyyymmdd = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = randomBytes(3).toString("hex").toUpperCase();

  return `HD-${yyyymmdd}-${suffix}`;
}

async function findSessionByTokenHash(
  tokenHash: string,
): Promise<HelpdeskSession | null> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<HelpdeskSessionRow[]>(
    `SELECT id, session_code, requester_email, requester_name, source_path,
            status, last_message_at, closed_at, created_at
       FROM helpdesk_sessions
      WHERE public_token_hash = ?
      LIMIT 1`,
    [tokenHash],
  );
  const row = rows[0];

  return row ? rowToSession(row) : null;
}

export async function findHelpdeskSessionByCode(
  sessionCode: string,
): Promise<HelpdeskSession | null> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<HelpdeskSessionRow[]>(
    `SELECT id, session_code, requester_email, requester_name, source_path,
            status, last_message_at, closed_at, created_at
       FROM helpdesk_sessions
      WHERE session_code = ?
      LIMIT 1`,
    [sessionCode.trim().toUpperCase()],
  );
  const row = rows[0];

  return row ? rowToSession(row) : null;
}

export async function listHelpdeskMessages(
  sessionId: string,
): Promise<HelpdeskMessage[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<HelpdeskMessageRow[]>(
    `SELECT id, session_id, sender_type, sender_label, body, created_at
       FROM helpdesk_messages
      WHERE session_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT 200`,
    [sessionId],
  );

  return rows.map(rowToMessage);
}

export async function getOrCreateHelpdeskSession({
  pagePath,
  sessionToken,
  user,
}: {
  pagePath: string | null;
  sessionToken: string | null;
  user: AuthSessionUser | null;
}): Promise<HelpdeskSessionBundle> {
  const token = sessionToken?.trim() || createRandomToken();
  const tokenHash = hashOneTimeToken(token);
  const existingSession = await findSessionByTokenHash(tokenHash);

  if (existingSession) {
    return {
      session: existingSession,
      messages: await listHelpdeskMessages(existingSession.id),
      sessionToken: token,
    };
  }

  const requester = buildRequester(user);
  const sessionId = createAuthId("hds");
  const sessionCode = buildSessionCode();
  const sourcePath = normalizeSourcePath(pagePath);
  const pool = getMysqlPool();

  await pool.execute(
    `INSERT INTO helpdesk_sessions
      (id, session_code, public_token_hash, requester_user_id,
       requester_email, requester_name, source_path, status, last_message_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', UTC_TIMESTAMP(3))`,
    [
      sessionId,
      sessionCode,
      tokenHash,
      requester.userId,
      requester.email,
      requester.name,
      sourcePath,
    ],
  );

  const session = await findSessionByTokenHash(tokenHash);

  if (!session) {
    throw new Error("Helpdesk session could not be created.");
  }

  await addHelpdeskMessage({
    body: "Helpdesk session created. An admin will reply in this chat.",
    senderLabel: "FTM",
    senderType: "system",
    sessionId,
  });

  return {
    session,
    messages: await listHelpdeskMessages(sessionId),
    sessionToken: token,
  };
}

export async function addHelpdeskMessage({
  body,
  senderLabel,
  senderType,
  sessionId,
  telegramChatId = null,
}: {
  body: string;
  senderLabel: string;
  senderType: HelpdeskSenderType;
  sessionId: string;
  telegramChatId?: string | null;
}): Promise<HelpdeskMessage> {
  const messageBody = normalizeHelpdeskMessage(body);
  const pool = getMysqlPool();
  const messageId = createAuthId("hdm");

  await pool.execute<ResultSetHeader>(
    `INSERT INTO helpdesk_messages
      (id, session_id, sender_type, sender_label, body, telegram_chat_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      messageId,
      sessionId,
      senderType,
      senderLabel.trim().slice(0, 160) || "FTM",
      messageBody,
      telegramChatId,
    ],
  );
  await pool.execute(
    `UPDATE helpdesk_sessions
        SET last_message_at = UTC_TIMESTAMP(3)
      WHERE id = ?`,
    [sessionId],
  );

  const [rows] = await pool.execute<HelpdeskMessageRow[]>(
    `SELECT id, session_id, sender_type, sender_label, body, created_at
       FROM helpdesk_messages
      WHERE id = ?
      LIMIT 1`,
    [messageId],
  );
  const row = rows[0];

  if (!row) {
    throw new Error("Helpdesk message could not be saved.");
  }

  return rowToMessage(row);
}

export async function addUserHelpdeskMessage({
  body,
  pagePath,
  sessionToken,
  user,
}: {
  body: string;
  pagePath: string | null;
  sessionToken: string | null;
  user: AuthSessionUser | null;
}): Promise<HelpdeskSessionBundle & { message: HelpdeskMessage }> {
  const bundle = await getOrCreateHelpdeskSession({
    pagePath,
    sessionToken,
    user,
  });

  if (bundle.session.status === "closed") {
    throw new Error("Helpdesk session is closed.");
  }

  const requester = buildRequester(user);
  const message = await addHelpdeskMessage({
    body,
    senderLabel: requester.label,
    senderType: requester.senderType,
    sessionId: bundle.session.id,
  });

  return {
    ...bundle,
    message,
    messages: await listHelpdeskMessages(bundle.session.id),
  };
}

export async function closeHelpdeskSession({
  closedByChatId,
  sessionId,
}: {
  closedByChatId: string;
  sessionId: string;
}): Promise<void> {
  const pool = getMysqlPool();

  await pool.execute(
    `UPDATE helpdesk_sessions
        SET status = 'closed',
            closed_at = UTC_TIMESTAMP(3),
            closed_by_chat_id = ?
      WHERE id = ?`,
    [closedByChatId, sessionId],
  );
}

export async function findActiveAdminByTelegramChatId(
  chatId: string,
): Promise<{
  email: string;
  fullName: string;
  id: string;
  username: string;
} | null> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AdminTelegramRow[]>(
    `SELECT id, email, username, full_name, telegram_chat_id
       FROM auth_users
      WHERE role = 'admin'
        AND status = 'active'
        AND telegram_chat_id = ?
        AND telegram_verified_at IS NOT NULL
      LIMIT 1`,
    [chatId],
  );
  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    email: row.email,
    fullName: row.full_name,
    id: row.id,
    username: row.username,
  };
}

export function summarizeHelpdeskSession(session: HelpdeskSession): string {
  const requester =
    session.requesterName && session.requesterEmail
      ? `${session.requesterName} <${session.requesterEmail}>`
      : (session.requesterName ?? session.requesterEmail ?? "Web visitor");

  return [
    `Session: ${session.sessionCode}`,
    `User: ${requester}`,
    `Page: ${session.sourcePath || "-"}`,
  ].join("\n");
}
