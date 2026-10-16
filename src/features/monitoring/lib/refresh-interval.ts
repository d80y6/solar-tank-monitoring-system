export const DEFAULT_MONITORING_REFRESH_INTERVAL_MS = 20_000;
export const MIN_MONITORING_REFRESH_INTERVAL_MS = 5_000;

export function normalizeMonitoringRefreshInterval(
  intervalMs = DEFAULT_MONITORING_REFRESH_INTERVAL_MS,
): number {
  if (!Number.isFinite(intervalMs)) {
    return DEFAULT_MONITORING_REFRESH_INTERVAL_MS;
  }

  return Math.max(MIN_MONITORING_REFRESH_INTERVAL_MS, Math.round(intervalMs));
}

export function getMonitoringRefreshIntervalMs(
  envValue = process.env.NEXT_PUBLIC_MONITORING_REFRESH_INTERVAL_MS,
): number {
  if (!envValue?.trim()) {
    return DEFAULT_MONITORING_REFRESH_INTERVAL_MS;
  }

  return normalizeMonitoringRefreshInterval(Number(envValue));
}

export function formatMonitoringRefreshInterval(intervalMs: number): string {
  const normalizedIntervalMs = normalizeMonitoringRefreshInterval(intervalMs);
  const totalSeconds = Math.round(normalizedIntervalMs / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds} sec`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return seconds > 0 ? `${minutes} min ${seconds} sec` : `${minutes} min`;
}
