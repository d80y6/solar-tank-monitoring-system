"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Pause, Play, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  DEFAULT_MONITORING_REFRESH_INTERVAL_MS,
  formatMonitoringRefreshInterval,
  normalizeMonitoringRefreshInterval,
} from "../lib/refresh-interval";

type LiveRefreshControlProps = {
  intervalMs?: number;
  lastSyncedLabel: string;
  className?: string;
};

export function LiveRefreshControl({
  intervalMs = DEFAULT_MONITORING_REFRESH_INTERVAL_MS,
  lastSyncedLabel,
  className = "",
}: LiveRefreshControlProps) {
  const router = useRouter();
  const [isPaused, setIsPaused] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [isPending, startTransition] = useTransition();

  const normalizedIntervalMs = useMemo(
    () => normalizeMonitoringRefreshInterval(intervalMs),
    [intervalMs],
  );
  const intervalLabel = useMemo(
    () => formatMonitoringRefreshInterval(normalizedIntervalMs),
    [normalizedIntervalMs],
  );
  const isAutoRefreshActive = !isPaused && isPageVisible;

  const refreshNow = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router, startTransition]);

  useEffect(() => {
    function handleVisibilityChange() {
      setIsPageVisible(document.visibilityState === "visible");
    }

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!isAutoRefreshActive) {
      return;
    }

    const intervalId = window.setInterval(refreshNow, normalizedIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAutoRefreshActive, normalizedIntervalMs, refreshNow]);

  const stateLabel = isPaused
    ? "Auto-refresh paused"
    : !isPageVisible
      ? "Tab inactive"
      : isPending
        ? "Refreshing data"
        : `Auto-refresh ${intervalLabel}`;

  return (
    <div
      className={`items-center gap-2 rounded-full border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-600 shadow-sm ${className}`}
      aria-live="polite"
    >
      <span
        className={`size-2.5 shrink-0 rounded-full ${
          isAutoRefreshActive ? "bg-emerald-500" : "bg-zinc-300"
        }`}
        aria-hidden="true"
      />

      <div className="hidden min-w-0 text-left lg:block">
        <p className="truncate text-xs font-semibold text-zinc-950">
          {stateLabel}
        </p>
        <p className="truncate text-[0.68rem] text-zinc-400">
          {lastSyncedLabel}
        </p>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className="grid size-8 place-items-center rounded-full text-zinc-600 transition hover:bg-zinc-100 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-100"
          onClick={refreshNow}
          title="Refresh data now"
          aria-label="Refresh data now"
        >
          <RefreshCw
            className={`size-4 ${isPending ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </button>

        <button
          type="button"
          className="grid size-8 place-items-center rounded-full text-zinc-600 transition hover:bg-zinc-100 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-100"
          onClick={() => setIsPaused((current) => !current)}
          title={isPaused ? "Resume auto-refresh" : "Pause auto-refresh"}
          aria-label={isPaused ? "Resume auto-refresh" : "Pause auto-refresh"}
        >
          {isPaused ? (
            <Play className="size-4" aria-hidden="true" />
          ) : (
            <Pause className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
