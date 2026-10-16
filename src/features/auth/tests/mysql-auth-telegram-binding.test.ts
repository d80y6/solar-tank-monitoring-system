import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  connectionExecute: vi.fn(),
  execute: vi.fn(),
  getConnection: vi.fn(),
  release: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock("../../monitoring/lib/mysql-connection", () => ({
  getMysqlPool: () => ({
    execute: mocks.execute,
    getConnection: mocks.getConnection,
  }),
}));

import {
  completeTelegramBindingInMysql,
  findAuthUserByVerifiedTelegramChatId,
} from "../lib/mysql-auth-repository";

describe("mysql auth Telegram binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnection.mockResolvedValue({
      beginTransaction: mocks.beginTransaction,
      commit: mocks.commit,
      execute: mocks.connectionExecute,
      release: mocks.release,
      rollback: mocks.rollback,
    });
  });

  it("reads only the account fields required by the Telegram status command", async () => {
    mocks.execute.mockResolvedValue([
      [
        {
          full_name: "Operator STO",
          role: "user",
          status: "active",
          telegram_verified_at: new Date("2026-07-12T12:00:00.000Z"),
          username: "operator.sto",
        },
      ],
    ]);

    const user = await findAuthUserByVerifiedTelegramChatId("123456789");
    const sql = String(mocks.execute.mock.calls[0]?.[0]);

    expect(user).toEqual({
      fullName: "Operator STO",
      role: "user",
      status: "active",
      telegramVerifiedAt: "2026-07-12T12:00:00.000Z",
      username: "operator.sto",
    });
    expect(sql).toContain(
      "SELECT username, full_name, role, status, telegram_verified_at",
    );
    expect(sql).not.toContain("password_hash");
    expect(sql).not.toContain("email");
    expect(sql).not.toContain("phone");
  });

  it("binds the account and consumes the token in one transaction", async () => {
    mocks.connectionExecute
      .mockResolvedValueOnce([
        [
          {
            chat_id: null,
            expires_at: new Date("2026-07-13T12:00:00.000Z"),
            id: "tbt_1",
            token_hash: "hash",
            used_at: null,
            user_id: "usr_1",
          },
        ],
      ])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await completeTelegramBindingInMysql({
      chatId: "123456789",
      tokenHash: "hash",
    });

    expect(result).toEqual({ userId: "usr_1" });
    expect(mocks.beginTransaction).toHaveBeenCalledOnce();
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.rollback).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("rolls back when the Telegram chat belongs to another account", async () => {
    mocks.connectionExecute
      .mockResolvedValueOnce([
        [
          {
            chat_id: null,
            expires_at: new Date("2026-07-13T12:00:00.000Z"),
            id: "tbt_1",
            token_hash: "hash",
            used_at: null,
            user_id: "usr_1",
          },
        ],
      ])
      .mockResolvedValueOnce([[{ id: "usr_2" }]]);

    await expect(
      completeTelegramBindingInMysql({
        chatId: "123456789",
        tokenHash: "hash",
      }),
    ).rejects.toThrow("This Telegram is already connected to another FTM account.");

    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
