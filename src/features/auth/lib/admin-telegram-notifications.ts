import type { RowDataPacket } from "mysql2/promise";

import { getMysqlPool } from "@/features/monitoring/lib/mysql-connection";

import type { RegisterAccessPayload } from "./auth-validation";
import {
  getAppBaseUrl,
  getTelegramAdminGroupChatId,
  getTelegramAdminTopicThreadId,
  type TelegramAdminTopic,
} from "./auth-config";
import { sendTelegramMessage } from "./auth-telegram";

type AdminTelegramRow = RowDataPacket & {
  telegram_chat_id: string | null;
};

export type AdminTelegramNotifyResult = {
  attempted: number;
  delivered: number;
  failed: number;
};

type AccessRequestNotificationInput = {
  accessRequestId: string;
  createdAt?: Date;
  payload: Pick<
    RegisterAccessPayload,
    | "accessReason"
    | "email"
    | "fullName"
    | "phone"
    | "requestedRole"
    | "username"
  >;
  userId: string;
};

function formatJakartaDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Jakarta",
    year: "numeric",
  }).format(value);
}

function formatOptionalText(value: string | null | undefined): string {
  const text = value?.trim();

  if (!text) {
    return "-";
  }

  return text.length > 360 ? `${text.slice(0, 357)}...` : text;
}

export function buildAdminTelegramUrl(
  path: string,
  params?: Record<string, string>,
): string {
  const url = new URL(path, getAppBaseUrl());

  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

export async function listActiveAdminTelegramChatIds(): Promise<string[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute<AdminTelegramRow[]>(
    `
      SELECT telegram_chat_id
      FROM auth_users
      WHERE role = 'admin'
        AND status = 'active'
        AND telegram_chat_id IS NOT NULL
        AND telegram_verified_at IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 20
    `,
  );

  return rows
    .map((row) => row.telegram_chat_id?.trim())
    .filter((chatId): chatId is string => Boolean(chatId));
}

export async function sendAdminTelegramNotification(
  text: string,
  options?: {
    topic?: TelegramAdminTopic;
  },
): Promise<AdminTelegramNotifyResult> {
  let attempted = 0;
  let delivered = 0;
  const groupChatId = getTelegramAdminGroupChatId();
  const topicThreadId = options?.topic
    ? getTelegramAdminTopicThreadId(options.topic)
    : null;

  if (groupChatId && topicThreadId) {
    attempted += 1;
    const groupDelivery = await sendTelegramMessage({
      chatId: groupChatId,
      messageThreadId: topicThreadId,
      text,
    });

    if (groupDelivery.delivered) {
      return {
        attempted,
        delivered: 1,
        failed: 0,
      };
    }
  }

  const chatIds = await listActiveAdminTelegramChatIds();

  if (chatIds.length === 0) {
    return {
      attempted,
      delivered,
      failed: attempted - delivered,
    };
  }

  const deliveries = await Promise.all(
    chatIds.map((chatId) => sendTelegramMessage({ chatId, text })),
  );
  const privateDelivered = deliveries.filter(
    (delivery) => delivery.delivered,
  ).length;
  attempted += chatIds.length;
  delivered += privateDelivered;

  return {
    attempted,
    delivered,
    failed: attempted - delivered,
  };
}

export async function notifyAdminsAccessRequestSubmitted({
  accessRequestId,
  createdAt = new Date(),
  payload,
  userId,
}: AccessRequestNotificationInput): Promise<AdminTelegramNotifyResult> {
  const adminUrl = buildAdminTelegramUrl("/dashboard/admin/users", {
    request: accessRequestId,
  });
  const text = [
    "New FTM access request",
    "",
    `Name: ${payload.fullName}`,
    `Username: ${payload.username}`,
    `Email: ${payload.email}`,
    `Phone: ${payload.phone}`,
    `Requested role: ${payload.requestedRole}`,
    `User ID: ${userId}`,
    `Request code: ${accessRequestId}`,
    `Time: ${formatJakartaDate(createdAt)}`,
    `Reason: ${formatOptionalText(payload.accessReason)}`,
    "",
    "Admin needs to review user access via the dashboard.",
    adminUrl,
  ].join("\n");

  return sendAdminTelegramNotification(text, { topic: "new-account" });
}
