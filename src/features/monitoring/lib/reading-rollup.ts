export const MONITORING_ROLLUP_INTERVAL_MINUTES = 5;
export const MONITORING_ROLLUP_INTERVAL_MS =
  MONITORING_ROLLUP_INTERVAL_MINUTES * 60 * 1000;

export type MonitoringRollupWindow = {
  end: string;
  id: string;
  start: string;
};

export function buildMonitoringRollupWindow({
  deviceId,
  receivedAt,
}: {
  deviceId: string;
  receivedAt: string;
}): MonitoringRollupWindow {
  const receivedTime = Date.parse(receivedAt);

  if (!Number.isFinite(receivedTime)) {
    throw new Error("Reading timestamp is invalid for the aggregation bucket.");
  }

  const bucketStartTime =
    Math.floor(receivedTime / MONITORING_ROLLUP_INTERVAL_MS) *
    MONITORING_ROLLUP_INTERVAL_MS;

  return {
    end: new Date(
      bucketStartTime + MONITORING_ROLLUP_INTERVAL_MS,
    ).toISOString(),
    id: `rollup-5m-${deviceId}-${bucketStartTime}`,
    start: new Date(bucketStartTime).toISOString(),
  };
}
