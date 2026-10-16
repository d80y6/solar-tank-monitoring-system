"use client";

import { useState } from "react";
import { Check, Copy, Send } from "lucide-react";

type ContactMessageTemplateProps = {
  message: string;
  telegramHref: string;
};

export function ContactMessageTemplate({
  message,
  telegramHref,
}: ContactMessageTemplateProps) {
  const [copied, setCopied] = useState(false);

  async function copyMessage() {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-left">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-950">
            Help message format
          </p>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            Copy this format before contacting Telegram so the account identity,
            page, and help request are immediately clear.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-blue-200 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15"
            onClick={copyMessage}
            type="button"
          >
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20"
            href={telegramHref}
            rel="noreferrer"
            target="_blank"
          >
            <Send className="size-4" aria-hidden="true" />
            Open Telegram
          </a>
        </div>
      </div>

      <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-4 text-sm leading-6 text-zinc-700">
        {message}
      </pre>
    </div>
  );
}
