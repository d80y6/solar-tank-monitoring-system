"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";

type HelpdeskMessage = {
  id: string;
  senderType: "visitor" | "user" | "admin" | "system";
  senderLabel: string;
  body: string;
  createdAt: string;
};

type HelpdeskSession = {
  sessionCode: string;
  status: "open" | "closed";
};

type HelpdeskBundle = {
  messages: HelpdeskMessage[];
  session: HelpdeskSession;
  sessionToken: string;
};

type HelpdeskApiResponse = {
  ok: boolean;
  data?: HelpdeskBundle;
  error?: string;
};

const SESSION_TOKEN_KEY = "solartank_helpdesk_session_token";
const POLL_INTERVAL_MS = 5000;
const openWidgetFrameClassName =
  "fixed inset-x-3 bottom-[calc(0.75rem_+_env(safe-area-inset-bottom))] top-[calc(0.75rem_+_env(safe-area-inset-top))] z-50 flex flex-col items-stretch sm:inset-auto sm:top-auto sm:bottom-[calc(1rem_+_env(safe-area-inset-bottom))] sm:right-[calc(1rem_+_env(safe-area-inset-right))] sm:max-w-[calc(100vw_-_2rem)] sm:items-end";
const closedWidgetFrameClassName =
  "fixed bottom-[calc(1rem_+_env(safe-area-inset-bottom))] right-[calc(1rem_+_env(safe-area-inset-right))] z-50 flex max-w-[calc(100vw_-_2rem)] flex-col items-end";

function getPagePath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function isOwnMessage(message: HelpdeskMessage): boolean {
  return message.senderType === "visitor" || message.senderType === "user";
}

function formatMessageTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

export function HelpdeskWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [session, setSession] = useState<HelpdeskSession | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<HelpdeskMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const applyBundle = useCallback((bundle: HelpdeskBundle) => {
    setSession(bundle.session);
    setSessionToken(bundle.sessionToken);
    setMessages(bundle.messages);
    localStorage.setItem(SESSION_TOKEN_KEY, bundle.sessionToken);
  }, []);

  const openSession = useCallback(async () => {
    const storedToken = localStorage.getItem(SESSION_TOKEN_KEY);
    const response = await fetch("/api/helpdesk/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pagePath: getPagePath(),
        sessionToken: storedToken,
      }),
    });
    const payload = (await response.json()) as HelpdeskApiResponse;

    if (!response.ok || !payload.ok || !payload.data) {
      throw new Error(payload.error || "Helpdesk is not available yet.");
    }

    applyBundle(payload.data);
  }, [applyBundle]);

  const refreshMessages = useCallback(async () => {
    const token = sessionToken || localStorage.getItem(SESSION_TOKEN_KEY);

    if (!token) {
      return;
    }

    const params = new URLSearchParams({
      pagePath: getPagePath(),
      sessionToken: token,
    });
    const response = await fetch(`/api/helpdesk/messages?${params}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as HelpdeskApiResponse;

    if (response.ok && payload.ok && payload.data) {
      applyBundle(payload.data);
    }
  }, [applyBundle, sessionToken]);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }

    const interval = window.setInterval(() => {
      refreshMessages().catch(() => undefined);
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [refreshMessages, sessionToken]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();

    if (!message || pending) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/helpdesk/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          pagePath: getPagePath(),
          sessionToken,
        }),
      });
      const payload = (await response.json()) as HelpdeskApiResponse;

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error || "Message could not be sent yet.");
      }

      setDraft("");
      applyBundle(payload.data);
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Message could not be sent yet.",
      );
    } finally {
      setPending(false);
    }
  }

  function toggleWidget() {
    setIsOpen((current) => {
      const next = !current;

      if (next && !sessionToken) {
        openSession().catch((openError: unknown) => {
          setError(
            openError instanceof Error
              ? openError.message
              : "Helpdesk is not available yet.",
          );
        });
      }

      return next;
    });
  }

  async function startNewSession() {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    setSession(null);
    setSessionToken(null);
    setMessages([]);
    setError(null);
    await openSession().catch((openError: unknown) => {
      setError(
        openError instanceof Error
          ? openError.message
          : "Helpdesk is not available yet.",
      );
    });
  }

  return (
    <div
      className={
        isOpen ? openWidgetFrameClassName : closedWidgetFrameClassName
      }
    >
      {isOpen ? (
        <section className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-950 shadow-2xl shadow-zinc-900/15 sm:h-[min(38rem,calc(100dvh_-_2rem))] sm:w-[min(24rem,calc(100vw_-_2rem))] sm:flex-none">
          <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-950 px-4 text-white">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full bg-emerald-400" />
                <p className="truncate text-sm font-semibold">
                  Customer Support
                </p>
              </div>
              <p className="mt-0.5 truncate text-xs text-zinc-300">
                {session?.sessionCode || "FTM Helpdesk"}
              </p>
            </div>
            <button
              aria-label="Close helpdesk"
              className="grid size-9 place-items-center rounded-lg text-zinc-300 transition hover:bg-white/10 hover:text-white"
              onClick={() => setIsOpen(false)}
              type="button"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-[#f7faf9] px-4 py-4">
            {messages.map((message) => {
              const ownMessage = isOwnMessage(message);

              return (
                <article
                  className={`flex ${ownMessage ? "justify-end" : "justify-start"}`}
                  key={message.id}
                >
                  <div
                    className={`max-w-[82%] rounded-lg px-3 py-2 text-sm leading-6 shadow-sm ring-1 ${
                      message.senderType === "system"
                        ? "bg-white text-zinc-500 ring-zinc-200"
                        : ownMessage
                          ? "bg-blue-600 text-white ring-blue-500"
                          : "bg-white text-zinc-800 ring-zinc-200"
                    }`}
                  >
                    {!ownMessage && message.senderType !== "system" ? (
                      <p className="mb-1 text-xs font-semibold text-zinc-500">
                        {message.senderLabel}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap break-words">
                      {message.body}
                    </p>
                    <p
                      className={`mt-1 text-right text-[0.68rem] ${
                        ownMessage ? "text-blue-100" : "text-zinc-400"
                      }`}
                    >
                      {formatMessageTime(message.createdAt)}
                    </p>
                  </div>
                </article>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {error ? (
            <div className="shrink-0 border-t border-red-100 bg-red-50 px-4 py-2 text-xs font-medium text-red-700">
              {error}
            </div>
          ) : null}

          {session?.status === "closed" ? (
            <div className="shrink-0 border-t border-zinc-200 bg-white p-3">
              <button
                className="h-11 w-full rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
                onClick={startNewSession}
                type="button"
              >
                New session
              </button>
            </div>
          ) : (
            <form
              className="grid shrink-0 grid-cols-[1fr_auto] gap-2 border-t border-zinc-200 bg-white p-3"
              onSubmit={handleSubmit}
            >
              <textarea
                className="max-h-28 min-h-11 resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none transition placeholder:text-zinc-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type a message..."
                rows={1}
                value={draft}
              />
              <button
                aria-label="Send message"
                className="grid size-11 place-items-center rounded-lg bg-blue-600 text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:shadow-none"
                disabled={pending || !draft.trim()}
                type="submit"
              >
                <Send className="size-4" aria-hidden="true" />
              </button>
            </form>
          )}
        </section>
      ) : null}

      {!isOpen ? (
        <button
          aria-label="Open helpdesk"
          className="grid size-14 place-items-center rounded-full bg-blue-600 text-white shadow-2xl shadow-blue-700/30 ring-1 ring-blue-400/50 transition hover:bg-blue-700"
          onClick={toggleWidget}
          type="button"
        >
          <MessageCircle className="size-6" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
