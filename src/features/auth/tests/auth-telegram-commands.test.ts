import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findAuthUserByVerifiedTelegramChatId: vi.fn(),
  sendTelegramMessage: vi.fn(),
}));

vi.mock("../lib/auth-telegram", () => ({
  sendTelegramMessage: mocks.sendTelegramMessage,
}));

vi.mock("../lib/mysql-auth-repository", () => ({
  findAuthUserByVerifiedTelegramChatId:
    mocks.findAuthUserByVerifiedTelegramChatId,
}));

import { handlePrivateTelegramCommand } from "../lib/auth-telegram-commands";
import type { TelegramMessage } from "../lib/auth-telegram";

function buildMessage(text: string): TelegramMessage {
  return {
    chatId: "123456789",
    chatType: "private",
    fromUserId: "123456789",
    messageThreadId: null,
    text,
    username: "telegram_user",
  };
}

describe("auth telegram private commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_BASE_URL = "https://ftm.example";
    mocks.sendTelegramMessage.mockResolvedValue({ delivered: true });
  });

  it("sends help without sensitive account data", async () => {
    const handled = await handlePrivateTelegramCommand(buildMessage("/help"));

    expect(handled).toBe(true);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "123456789",
        text: expect.stringContaining("/status"),
      }),
    );
    const text = mocks.sendTelegramMessage.mock.calls[0]?.[0].text as string;

    expect(text).toContain("/dashboard");
    expect(text.toLowerCase()).not.toContain("password:");
    expect(text.toLowerCase()).not.toContain("token:");
  });

  it("sends dashboard link without login token", async () => {
    const handled = await handlePrivateTelegramCommand(
      buildMessage("/dashboard"),
    );

    expect(handled).toBe(true);
    const text = mocks.sendTelegramMessage.mock.calls[0]?.[0].text as string;

    expect(text).toContain("https://ftm.example/dashboard");
    expect(text).toContain("The bot does not accept passwords or login tokens.");
  });

  it("reports bound account status without email, phone, chat id, or tokens", async () => {
    mocks.findAuthUserByVerifiedTelegramChatId.mockResolvedValue({
      email: "operator@example.com",
      emailVerifiedAt: "2026-07-12T10:00:00.000Z",
      fullName: "Operator STO",
      id: "usr_secret",
      lastLoginAt: "2026-07-12T11:00:00.000Z",
      passwordChangedAt: null,
      phone: "+6281234567890",
      role: "user",
      status: "active",
      telegramVerifiedAt: "2026-07-12T12:00:00.000Z",
      username: "operator.sto",
    });

    const handled = await handlePrivateTelegramCommand(buildMessage("/status"));

    expect(handled).toBe(true);
    expect(mocks.findAuthUserByVerifiedTelegramChatId).toHaveBeenCalledWith(
      "123456789",
    );
    const text = mocks.sendTelegramMessage.mock.calls[0]?.[0].text as string;

    expect(text).toContain("This Telegram is connected.");
    expect(text).toContain("Account: Operator STO");
    expect(text).toContain("Username: operator.sto");
    expect(text).toContain("Role: User");
    expect(text).not.toContain("operator@example.com");
    expect(text).not.toContain("+6281234567890");
    expect(text).not.toContain("123456789");
    expect(text).not.toContain("usr_secret");
  });

  it("guides unbound Telegram users to bind from dashboard", async () => {
    mocks.findAuthUserByVerifiedTelegramChatId.mockResolvedValue(null);

    const handled = await handlePrivateTelegramCommand(buildMessage("/status"));

    expect(handled).toBe(true);
    const text = mocks.sendTelegramMessage.mock.calls[0]?.[0].text as string;

    expect(text).toContain("This Telegram is not connected to an FTM account.");
    expect(text).toContain("/start TOKEN");
  });

  it("ignores commands outside private chat", async () => {
    const handled = await handlePrivateTelegramCommand({
      ...buildMessage("/help"),
      chatType: "supergroup",
    });

    expect(handled).toBe(false);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });
});
