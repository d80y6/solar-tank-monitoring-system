"use client";

export type ClientErrorReport = {
  /** Where the failure happened, e.g. `dashboard.error-boundary`. */
  source: string;
  error: unknown;
  /** Next.js error digest, when the runtime provides one. */
  digest?: string;
  extra?: Record<string, string | number | boolean | null | undefined>;
};

const REPORT_ENDPOINT = "/api/telemetry/client-errors";
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 2_000;
const DEDUPE_WINDOW_MS = 30_000;

const recentlyReported = new Map<string, number>();

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function describeError(error: unknown): { message: string; name: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: truncate(error.message || "Unknown error", MAX_MESSAGE_LENGTH),
      name: error.name || "Error",
      ...(error.stack ? { stack: truncate(error.stack, MAX_STACK_LENGTH) } : {}),
    };
  }

  if (typeof error === "string") {
    return { message: truncate(error, MAX_MESSAGE_LENGTH), name: "Error" };
  }

  return { message: "Non-error value thrown", name: "Error" };
}

function shouldReport(key: string): boolean {
  const now = Date.now();
  const lastReportedAt = recentlyReported.get(key);

  if (lastReportedAt && now - lastReportedAt < DEDUPE_WINDOW_MS) {
    return false;
  }

  recentlyReported.set(key, now);

  // Keep the client-side dedupe map bounded; a broken render loop must not
  // grow memory while it spams reports.
  if (recentlyReported.size > 50) {
    for (const [entryKey, timestamp] of recentlyReported) {
      if (now - timestamp > DEDUPE_WINDOW_MS) {
        recentlyReported.delete(entryKey);
      }
    }
  }

  return true;
}

/**
 * Reports a browser-side failure to the server so it lands in the same
 * structured log and error metrics as server failures.
 *
 * The reporter is intentionally quiet: it never throws, never blocks the UI,
 * and de-duplicates identical failures inside a short window.
 */
export function reportClientError({
  source,
  error,
  digest,
  extra,
}: ClientErrorReport): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const described = describeError(error);
    const dedupeKey = `${source}:${described.name}:${described.message}`;

    if (!shouldReport(dedupeKey)) {
      return;
    }

    const payload = JSON.stringify({
      digest: digest ?? null,
      extra: extra ?? null,
      message: described.message,
      name: described.name,
      source: truncate(source, 120),
      stack: described.stack ?? null,
      url: truncate(window.location.pathname, 300),
      userAgent: truncate(navigator.userAgent ?? "", 300),
    });

    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });

      if (navigator.sendBeacon(REPORT_ENDPOINT, blob)) {
        return;
      }
    }

    void fetch(REPORT_ENDPOINT, {
      body: payload,
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
    }).catch(() => undefined);
  } catch {
    // Reporting must never break the error boundary it is called from.
  }
}
