"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Link2, LogOut, RefreshCcw, Send } from "lucide-react";

import type { AuthSessionSummary, AuthSessionUser } from "@/features/auth/types";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

async function readJson(response: Response) {
  return (await response.json().catch(() => null)) as
    | { ok?: boolean; error?: string; data?: Record<string, unknown> }
    | null;
}

export default function AccountSecurityPanel({
  initialSessions,
  user,
}: {
  initialSessions: AuthSessionSummary[];
  user: AuthSessionUser;
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initialSessions);
  const [passwordPending, setPasswordPending] = useState(false);
  const [telegramPending, setTelegramPending] = useState(false);
  const [telegramStatusPending, setTelegramStatusPending] = useState(false);
  const [telegramVerifiedAt, setTelegramVerifiedAt] = useState(
    user.telegramVerifiedAt,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const [telegramToken, setTelegramToken] = useState<string | null>(null);
  const telegramConnected = Boolean(telegramVerifiedAt);

  async function refreshSessions() {
    const response = await fetch("/api/auth/sessions", { cache: "no-store" });
    const result = (await readJson(response)) as
      | {
          ok?: boolean;
          data?: { sessions?: AuthSessionSummary[] };
        }
      | null;

    if (response.ok && result?.ok && Array.isArray(result.data?.sessions)) {
      setSessions(result.data.sessions);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPasswordPending(true);
    setMessage(null);
    setError(null);

    const formData = new FormData(form);

    try {
      const response = await fetch("/api/auth/password/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: formData.get("currentPassword"),
          password: formData.get("password"),
          confirmPassword: formData.get("confirmPassword"),
        }),
      });
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error ?? "Password could not be changed yet.");
      }

      setMessage(String(result.data?.message ?? "Password changed successfully."));
      form.reset();
      await refreshSessions();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Password could not be changed yet.",
      );
    } finally {
      setPasswordPending(false);
    }
  }

  async function revokeSession(sessionId: string) {
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/auth/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const result = await readJson(response);

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error ?? "Session could not be revoked yet.");
      }

      setMessage(String(result.data?.message ?? "Session revoked successfully."));
      await refreshSessions();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Session could not be revoked yet.",
      );
    }
  }

  async function startTelegramBinding() {
    if (telegramConnected) {
      setMessage("Telegram is connected to this account.");
      return;
    }

    setTelegramPending(true);
    setMessage(null);
    setError(null);
    setTelegramLink(null);
    setTelegramToken(null);

    try {
      const response = await fetch("/api/auth/telegram/bind/start", {
        method: "POST",
      });
      const result = (await readJson(response)) as
        | {
            ok?: boolean;
            error?: string;
            data?: { deepLink?: string | null; token?: string };
          }
        | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error ?? "Telegram binding could not be started yet.");
      }

      setTelegramLink(result.data?.deepLink ?? null);
      setTelegramToken(result.data?.token ?? null);
      setMessage(
        "Telegram token created. Open the Telegram bot or send the /start TOKEN command to the bot.",
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Telegram binding could not be started yet.",
      );
    } finally {
      setTelegramPending(false);
    }
  }

  async function refreshTelegramStatus() {
    setTelegramStatusPending(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const result = (await readJson(response)) as
        | {
            ok?: boolean;
            error?: string;
            data?: { user?: AuthSessionUser };
          }
        | null;

      if (!response.ok || !result?.ok || !result.data?.user) {
        throw new Error(result?.error ?? "Telegram status could not be checked yet.");
      }

      const nextVerifiedAt = result.data.user.telegramVerifiedAt;
      setTelegramVerifiedAt(nextVerifiedAt);

      if (nextVerifiedAt) {
        setTelegramLink(null);
        setTelegramToken(null);
        setMessage("Telegram is connected to this account.");
        router.refresh();
      } else {
        setMessage(
          "Telegram is not connected. Complete the bot instructions, then check the status again.",
        );
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Telegram status could not be checked yet.",
      );
    } finally {
      setTelegramStatusPending(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-100">
            <KeyRound className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold uppercase text-zinc-500">
              Password
            </p>
            <h2 className="text-xl font-semibold">Change password</h2>
          </div>
        </div>

        <form className="mt-5 grid gap-3" onSubmit={handlePasswordSubmit}>
          <input
            autoComplete="current-password"
            className="h-11 rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
            name="currentPassword"
            placeholder="Current password"
            required
            type="password"
          />
          <input
            autoComplete="new-password"
            className="h-11 rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
            name="password"
            placeholder="New password"
            required
            type="password"
          />
          <input
            autoComplete="new-password"
            className="h-11 rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
            name="confirmPassword"
            placeholder="Repeat new password"
            required
            type="password"
          />
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-70"
            disabled={passwordPending}
            type="submit"
          >
            <KeyRound className="size-4" aria-hidden="true" />
            {passwordPending ? "Saving..." : "Save password"}
          </button>
        </form>

        <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-white text-blue-700 ring-1 ring-zinc-200">
              <Link2 className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-semibold">Telegram</h3>
              <p className="text-sm text-zinc-500">
                Status: {telegramConnected ? "connected" : "not connected"}
              </p>
              {telegramVerifiedAt ? (
                <p className="mt-0.5 text-xs text-zinc-500">
                  Connected {formatDate(telegramVerifiedAt)}.
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {!telegramConnected ? (
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-70"
                disabled={telegramPending || telegramStatusPending}
                onClick={startTelegramBinding}
                type="button"
              >
                <Send className="size-4" aria-hidden="true" />
                {telegramPending ? "Creating token..." : "Connect Telegram"}
              </button>
            ) : null}
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-70"
              disabled={telegramPending || telegramStatusPending}
              onClick={refreshTelegramStatus}
              type="button"
            >
              <RefreshCcw className="size-4" aria-hidden="true" />
              {telegramStatusPending ? "Checking..." : "Check Telegram status"}
            </button>
          </div>
          {telegramLink || telegramToken ? (
            <div className="mt-3 rounded-lg bg-white p-3 text-sm leading-6 text-zinc-700 ring-1 ring-zinc-200">
              {telegramLink ? (
                <a
                  className="font-semibold text-blue-600 transition hover:text-blue-700"
                  href={telegramLink}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open Telegram bot
                </a>
              ) : null}
              {telegramToken ? (
                <p className="mt-2 break-all">
                  Send to bot:{" "}
                  <code className="rounded bg-zinc-100 px-1.5 py-1 font-semibold text-zinc-950">
                    /start {telegramToken}
                  </code>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase text-zinc-500">
              Active sessions
            </p>
            <h2 className="text-xl font-semibold">Signed-in devices</h2>
          </div>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100"
            onClick={refreshSessions}
            type="button"
          >
            <RefreshCcw className="size-4" aria-hidden="true" />
            Reload
          </button>
        </div>

        <div className="mt-5 grid gap-3">
          {sessions.map((session) => {
            const active = !session.revokedAt && new Date(session.expiresAt) > new Date();

            return (
              <article
                className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-[1fr_auto]"
                key={session.id}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">
                      {session.current ? "Current session" : "Other session"}
                    </h3>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                        active
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                          : "bg-zinc-100 text-zinc-600 ring-zinc-200"
                      }`}
                    >
                      {active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    Last seen {formatDate(session.lastSeenAt)}.
                    Expires {formatDate(session.expiresAt)}.
                  </p>
                </div>
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                  disabled={session.current || !active}
                  onClick={() => revokeSession(session.id)}
                  type="button"
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Revoke
                </button>
              </article>
            );
          })}
        </div>

        {message ? (
          <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
            {error}
          </div>
        ) : null}
      </section>
    </div>
  );
}
