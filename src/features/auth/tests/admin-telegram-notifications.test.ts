import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pool: {
    execute: vi.fn(),
  },
  sendTelegramMessage: vi.fn(),
}));

vi.mock("@/features/monitoring/lib/mysql-connection", () => ({
  getMysqlPool: () => mocks.pool,
}));

vi.mock("../lib/auth-telegram", () => ({
  sendTelegramMessage: mocks.sendTelegramMessage,
}));

import {
  notifyAdminsAccessRequestSubmitted,
  sendAdminTelegramNotification,
} from "../lib/admin-telegram-notifications";

describe("admin telegram notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_BASE_URL = "https://solar.example";
  });

  it("sends access request details to active bound admins", async () => {
    mocks.pool.execute.mockResolvedValueOnce([
      [
        { telegram_chat_id: " 111 " },
        { telegram_chat_id: null },
        { telegram_chat_id: "222" },
      ],
    ]);
    mocks.sendTelegramMessage
      .mockResolvedValueOnce({ delivered: true })
      .mockResolvedValueOnce({ delivered: false, reason: "blocked" });

    const result = await notifyAdminsAccessRequestSubmitted({
      accessRequestId: "req_demo",
      createdAt: new Date("2026-07-07T14:00:00.000Z"),
      payload: {
        accessReason: "Needs monitoring dashboard access.",
        email: "operator@example.com",
        fullName: "Operator STO",
        phone: "+6281234567890",
        requestedRole: "user",
        username: "operator.sto",
      },
      userId: "usr_demo",
    });

    expect(result).toEqual({
      attempted: 2,
      delivered: 1,
      failed: 1,
    });
    expect(mocks.pool.execute).toHaveBeenCalledWith(
      expect.stringContaining("FROM auth_users"),
    );
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(2);
    expect(mocks.sendTelegramMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chatId: "111",
        text: expect.stringContaining("New FTM access request"),
      }),
    );

    const message = mocks.sendTelegramMessage.mock.calls[0]?.[0]
      .text as string;

    expect(message).toContain("Name: Operator STO");
    expect(message).toContain("Email: operator@example.com");
    expect(message).toContain("Request code: req_demo");
    expect(message).toContain(
      "https://solar.example/dashboard/admin/users?request=req_demo",
    );
  });

  it("skips delivery when no active admin has a bound Telegram chat", async () => {
    mocks.pool.execute.mockResolvedValueOnce([[]]);

    const result = await sendAdminTelegramNotification("Halo admin");

    expect(result).toEqual({
      attempted: 0,
      delivered: 0,
      failed: 0,
    });
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });
});
