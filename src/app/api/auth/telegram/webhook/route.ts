import { NextResponse, type NextRequest } from "next/server";

import { completeTelegramBinding } from "@/features/auth/lib/auth-service";
import {
  extractTelegramStartToken,
  parseTelegramMessage,
  sendTelegramMessage,
  verifyTelegramWebhookSecret,
} from "@/features/auth/lib/auth-telegram";
import { handlePrivateTelegramCommand } from "@/features/auth/lib/auth-telegram-commands";
import {
  handleTelegramHelpdeskCommand,
  handleTelegramTopicInfoCommand,
} from "@/features/helpdesk/lib/helpdesk-telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!verifyTelegramWebhookSecret(request.headers)) {
    return NextResponse.json(
      { ok: false, error: "Invalid Telegram webhook." },
      { status: 401 },
    );
  }

  const message = parseTelegramMessage(await request.json());

  if (!message) {
    return NextResponse.json({ ok: true });
  }

  const topicInfoHandled = await handleTelegramTopicInfoCommand(message).catch(
    async () => {
      await sendTelegramMessage({
        chatId: message.chatId,
        messageThreadId: message.messageThreadId,
        text: "Telegram topic could not be read yet. Try again shortly.",
      }).catch(() => undefined);
      return true;
    },
  );

  if (topicInfoHandled) {
    return NextResponse.json({ ok: true });
  }

  const helpdeskHandled = await handleTelegramHelpdeskCommand(message).catch(
    async () => {
      await sendTelegramMessage({
        chatId: message.chatId,
        messageThreadId: message.messageThreadId,
        text: "Helpdesk command could not be processed yet. Try again shortly.",
      }).catch(() => undefined);
      return true;
    },
  );

  if (helpdeskHandled) {
    return NextResponse.json({ ok: true });
  }

  if (message.chatType !== "private") {
    return NextResponse.json({ ok: true });
  }

  const privateCommandHandled = await handlePrivateTelegramCommand(
    message,
  ).catch(async () => {
    await sendTelegramMessage({
      chatId: message.chatId,
      text: "Telegram command could not be processed yet. Try again shortly.",
    }).catch(() => undefined);
    return true;
  });

  if (privateCommandHandled) {
    return NextResponse.json({ ok: true });
  }

  const token = extractTelegramStartToken(message.text);

  if (!token) {
    await sendTelegramMessage({
      chatId: message.chatId,
      text: "Open the binding link from the FTM Account Security page.",
    }).catch(() => undefined);
    return NextResponse.json({ ok: true });
  }

  try {
    await completeTelegramBinding({
      token,
      chatId: message.chatId,
      request,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error &&
      error.message === "This Telegram is already connected to another FTM account."
        ? error.message
        : "FTM binding token is invalid or has expired.";

    await sendTelegramMessage({
      chatId: message.chatId,
      text: errorMessage,
    }).catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}
