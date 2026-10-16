import { getAppBaseUrl } from "./auth-config";
import {
  sendTelegramMessage,
  type TelegramMessage,
} from "./auth-telegram";
import { findAuthUserByVerifiedTelegramChatId } from "./mysql-auth-repository";
import type { AuthSafeUser } from "../types";

type PrivateTelegramCommand = "dashboard" | "help" | "status";

function parsePrivateTelegramCommand(text: string): PrivateTelegramCommand | null {
  const match = /^\/(dashboard|help|status)(?:@\w+)?(?:\s|$)/i.exec(
    text.trim(),
  );
  const command = match?.[1]?.toLowerCase();

  if (
    command === "dashboard" ||
    command === "help" ||
    command === "status"
  ) {
    return command;
  }

  return null;
}

function formatRole(role: AuthSafeUser["role"]): string {
  return role === "admin" ? "Administrator" : "User";
}

function formatStatus(status: AuthSafeUser["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "disabled":
      return "Disabled";
    case "pending":
      return "Pending approval";
    case "suspended":
      return "Suspended";
  }
}

function formatTelegramDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Jakarta",
    year: "numeric",
  }).format(new Date(value));
}

function buildDashboardUrl(): string | null {
  try {
    return new URL("/dashboard", getAppBaseUrl()).toString();
  } catch {
    return null;
  }
}

function buildHelpMessage(): string {
  return [
    "FTM bot help",
    "",
    "Available commands:",
    "/help - list commands.",
    "/status - check the Telegram connection status of the FTM account.",
    "/dashboard - open the FTM dashboard link.",
    "",
    "Security note: the bot will never ask for your password, OTP, API key, or device token.",
  ].join("\n");
}

async function buildStatusMessage(chatId: string): Promise<string> {
  const user = await findAuthUserByVerifiedTelegramChatId(chatId);

  if (!user) {
    return [
      "This Telegram is not connected to an FTM account.",
      "",
      "Open dashboard > Account Security > Connect Telegram, then send the /start TOKEN command from that page to this bot.",
      "",
      "Use /dashboard to open the dashboard link.",
    ].join("\n");
  }

  return [
    "FTM Telegram status",
    "",
    "This Telegram is connected.",
    `Account: ${user.fullName || user.username}`,
    `Username: ${user.username}`,
    `Role: ${formatRole(user.role)}`,
    `Account status: ${formatStatus(user.status)}`,
    `Connected: ${formatTelegramDate(user.telegramVerifiedAt)}`,
    "",
    "Sensitive data such as password, OTP, session, email, phone number, API key, and device token is not displayed in Telegram.",
  ].join("\n");
}

function buildDashboardMessage(): string {
  const dashboardUrl = buildDashboardUrl();

  if (!dashboardUrl) {
    return [
      "FTM dashboard link could not be created.",
      "",
      "Ask an admin to set APP_BASE_URL in the server configuration.",
    ].join("\n");
  }

  return [
    "Dashboard FTM",
    "",
    dashboardUrl,
    "",
    "Sign in still happens via the browser. The bot does not accept passwords or login tokens.",
  ].join("\n");
}

export async function handlePrivateTelegramCommand(
  message: TelegramMessage,
): Promise<boolean> {
  if (message.chatType !== "private") {
    return false;
  }

  const command = parsePrivateTelegramCommand(message.text);

  if (!command) {
    return false;
  }

  const text =
    command === "help"
      ? buildHelpMessage()
      : command === "status"
        ? await buildStatusMessage(message.chatId)
        : buildDashboardMessage();

  await sendTelegramMessage({
    chatId: message.chatId,
    text,
  }).catch(() => undefined);

  return true;
}
