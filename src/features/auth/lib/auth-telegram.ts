import {
  getTelegramBotToken,
  getTelegramBotUsername,
  getTelegramWebhookSecret,
} from "./auth-config";

type TelegramSendResult =
  | { delivered: true }
  | { delivered: false; reason: string };

export type TelegramMessage = {
  chatId: string;
  chatType: string;
  fromUserId: string | null;
  messageThreadId: number | null;
  text: string;
  username: string | null;
};

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: {
      id?: number | string;
      type?: string;
      username?: string;
    };
    from?: {
      id?: number | string;
      username?: string;
    };
    message_thread_id?: number;
  };
};

export function isTelegramConfigured(): boolean {
  return Boolean(getTelegramBotToken());
}

export function buildTelegramDeepLink(token: string): string | null {
  const username = getTelegramBotUsername();

  if (!username) {
    return null;
  }

  return `https://t.me/${username}?start=${encodeURIComponent(token)}`;
}

export function verifyTelegramWebhookSecret(headers: Headers): boolean {
  const expected = getTelegramWebhookSecret();

  if (!expected) {
    return false;
  }

  return headers.get("x-telegram-bot-api-secret-token") === expected;
}

export function parseTelegramPrivateMessage(
  payload: unknown,
): TelegramMessage | null {
  const message = parseTelegramMessage(payload);

  if (!message || message.chatType !== "private") {
    return null;
  }

  return message;
}

export function parseTelegramMessage(payload: unknown): TelegramMessage | null {
  const update = payload as TelegramUpdate;
  const message = update.message;
  const chatId = message?.chat?.id;
  const text = message?.text?.trim();
  const chatType = message?.chat?.type?.trim();

  if (!chatId || !text || !chatType) {
    return null;
  }

  return {
    chatId: String(chatId),
    chatType,
    fromUserId: message.from?.id ? String(message.from.id) : null,
    messageThreadId: message.message_thread_id ?? null,
    text,
    username: message.chat?.username ?? message.from?.username ?? null,
  };
}

export function extractTelegramStartToken(text: string): string | null {
  const match = /^\/start\s+(.+)$/i.exec(text.trim());
  return match?.[1]?.trim() || null;
}

export async function sendTelegramMessage({
  chatId,
  messageThreadId,
  text,
}: {
  chatId: string;
  messageThreadId?: number | null;
  text: string;
}): Promise<TelegramSendResult> {
  const token = getTelegramBotToken();

  if (!token) {
    return { delivered: false, reason: "Telegram bot is not configured." };
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
        text,
        disable_web_page_preview: true,
      }),
    },
  );

  if (!response.ok) {
    return {
      delivered: false,
      reason: "Telegram message could not be sent yet.",
    };
  }

  return { delivered: true };
}
