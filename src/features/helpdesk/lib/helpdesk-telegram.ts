import {
  sendTelegramMessage,
  type TelegramMessage,
} from "@/features/auth/lib/auth-telegram";
import {
  addHelpdeskMessage,
  closeHelpdeskSession,
  findActiveAdminByTelegramChatId,
  findHelpdeskSessionByCode,
  normalizeHelpdeskMessage,
  summarizeHelpdeskSession,
} from "./helpdesk-repository";

type ParsedHelpdeskCommand =
  | {
      body: string;
      sessionCode: string;
      type: "reply";
    }
  | {
      sessionCode: string;
      type: "close";
    };

function parseHelpdeskCommand(text: string): ParsedHelpdeskCommand | null {
  const replyMatch =
    /^\/(?:reply|r)(?:@\w+)?\s+(HD-\d{8}-[A-F0-9]{6})\s+([\s\S]+)$/i.exec(
      text.trim(),
    );

  if (replyMatch?.[1] && replyMatch[2]) {
    return {
      body: normalizeHelpdeskMessage(replyMatch[2]),
      sessionCode: replyMatch[1].toUpperCase(),
      type: "reply",
    };
  }

  const closeMatch =
    /^\/close(?:@\w+)?\s+(HD-\d{8}-[A-F0-9]{6})\s*$/i.exec(text.trim());

  if (closeMatch?.[1]) {
    return {
      sessionCode: closeMatch[1].toUpperCase(),
      type: "close",
    };
  }

  return null;
}

async function sendHelpdeskCommandReply({
  chatId,
  messageThreadId,
  text,
}: {
  chatId: string;
  messageThreadId: number | null;
  text: string;
}) {
  await sendTelegramMessage({ chatId, messageThreadId, text }).catch(
    () => undefined,
  );
}

function getAdminTelegramIdentity(message: TelegramMessage): string {
  return message.chatType === "private"
    ? message.chatId
    : (message.fromUserId ?? "");
}

export async function handleTelegramTopicInfoCommand(
  message: TelegramMessage,
): Promise<boolean> {
  if (!/^\/topicid(?:@\w+)?\s*$/i.test(message.text.trim())) {
    return false;
  }

  const admin = await findActiveAdminByTelegramChatId(
    getAdminTelegramIdentity(message),
  );

  if (!admin) {
    await sendHelpdeskCommandReply({
      chatId: message.chatId,
      messageThreadId: message.messageThreadId,
      text: "This command is only available to FTM admins who have connected Telegram.",
    });
    return true;
  }

  await sendHelpdeskCommandReply({
    chatId: message.chatId,
    messageThreadId: message.messageThreadId,
    text: [
      "Telegram topic detected.",
      "",
      `TELEGRAM_ADMIN_GROUP_CHAT_ID=\"${message.chatId}\"`,
      message.messageThreadId
        ? `MESSAGE_THREAD_ID=\"${message.messageThreadId}\"`
        : "MESSAGE_THREAD_ID is unavailable. Make sure the command is sent inside a topic.",
    ].join("\n"),
  });

  return true;
}

export async function handleTelegramHelpdeskCommand(
  message: TelegramMessage,
): Promise<boolean> {
  const command = parseHelpdeskCommand(message.text);

  if (!command) {
    return false;
  }

  const adminChatId = getAdminTelegramIdentity(message);
  const admin = await findActiveAdminByTelegramChatId(adminChatId);

  if (!admin) {
    await sendHelpdeskCommandReply({
      chatId: message.chatId,
      messageThreadId: message.messageThreadId,
      text: "The helpdesk command is only available to FTM admins who have connected Telegram.",
    });
    return true;
  }

  const session = await findHelpdeskSessionByCode(command.sessionCode);

  if (!session) {
    await sendHelpdeskCommandReply({
      chatId: message.chatId,
      messageThreadId: message.messageThreadId,
      text: `Helpdesk session ${command.sessionCode} not found.`,
    });
    return true;
  }

  if (command.type === "close") {
    await closeHelpdeskSession({
      closedByChatId: adminChatId,
      sessionId: session.id,
    });
    await addHelpdeskMessage({
      body: "Helpdesk session closed by admin.",
      senderLabel: "FTM",
      senderType: "system",
      sessionId: session.id,
      telegramChatId: adminChatId,
    });
    await sendHelpdeskCommandReply({
      chatId: message.chatId,
      messageThreadId: message.messageThreadId,
      text: `Session ${session.sessionCode} is closed.`,
    });
    return true;
  }

  if (session.status === "closed") {
    await sendHelpdeskCommandReply({
      chatId: message.chatId,
      messageThreadId: message.messageThreadId,
      text: `Session ${session.sessionCode} is closed. Reply not sent.`,
    });
    return true;
  }

  await addHelpdeskMessage({
    body: command.body,
    senderLabel: admin.fullName || admin.username,
    senderType: "admin",
    sessionId: session.id,
    telegramChatId: adminChatId,
  });
  await sendHelpdeskCommandReply({
    chatId: message.chatId,
    messageThreadId: message.messageThreadId,
    text: [
      "Helpdesk reply sent.",
      "",
      summarizeHelpdeskSession(session),
    ].join("\n"),
  });

  return true;
}
