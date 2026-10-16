import type { Reading } from "../types/monitoring";
import {
  getMonitoringReadings,
  saveMonitoringReadingToMemory,
} from "./telemetry-store";
import {
  listLatestMonitoringReadingsByTankFromMysql,
  listMonitoringReadingsForTankInRangeFromMysql,
  listMonitoringReadingsForTankFromMysql,
  listMonitoringReadingsFromMysql,
  saveMonitoringReadingToMysql,
} from "./mysql-reading-repository";
import { selectLatestReadingPerTank } from "./latest-reading";

export type MonitoringStorageDriver = "memory" | "mysql";

export type MonitoringStorageSource = {
  configuredDriver: MonitoringStorageDriver;
  activeDriver: MonitoringStorageDriver;
  isFallback: boolean;
  label: string;
};

export type SaveMonitoringReadingResult = {
  reading: Reading;
  storage: MonitoringStorageDriver;
};

export type ListMonitoringReadingsResult = {
  readings: Reading[];
  source: MonitoringStorageSource;
};

export function getMonitoringStorageDriver(
  envValue = process.env.SOLAR_TANK_STORAGE_DRIVER,
): MonitoringStorageDriver {
  return envValue?.trim().toLowerCase() === "mysql" ? "mysql" : "memory";
}

function createStorageSource({
  configuredDriver,
  activeDriver,
  isFallback = false,
}: {
  configuredDriver: MonitoringStorageDriver;
  activeDriver: MonitoringStorageDriver;
  isFallback?: boolean;
}): MonitoringStorageSource {
  if (configuredDriver === "mysql" && activeDriver === "mysql") {
    return {
      configuredDriver,
      activeDriver,
      isFallback,
      label: "Database MySQL",
    };
  }

  if (configuredDriver === "mysql" && activeDriver === "memory") {
    return {
      configuredDriver,
      activeDriver,
      isFallback: true,
      label: "Memory fallback",
    };
  }

  return {
    configuredDriver,
    activeDriver,
    isFallback,
    label: "Local memory",
  };
}

export async function listMonitoringReadingsWithSource(): Promise<ListMonitoringReadingsResult> {
  const configuredDriver = getMonitoringStorageDriver();

  if (configuredDriver !== "mysql") {
    return {
      readings: getMonitoringReadings(),
      source: createStorageSource({
        configuredDriver,
        activeDriver: "memory",
      }),
    };
  }

  const mysqlReadings = await listMonitoringReadingsFromMysql();

  return {
    readings: mysqlReadings,
    source: createStorageSource({
      configuredDriver,
      activeDriver: "mysql",
    }),
  };
}

export async function listLatestMonitoringReadingsByTankWithSource(): Promise<ListMonitoringReadingsResult> {
  const configuredDriver = getMonitoringStorageDriver();

  if (configuredDriver !== "mysql") {
    return {
      readings: selectLatestReadingPerTank(getMonitoringReadings()),
      source: createStorageSource({
        configuredDriver,
        activeDriver: "memory",
      }),
    };
  }

  return {
    readings: await listLatestMonitoringReadingsByTankFromMysql(),
    source: createStorageSource({
      configuredDriver,
      activeDriver: "mysql",
    }),
  };
}

export async function listMonitoringReadings(): Promise<Reading[]> {
  const result = await listMonitoringReadingsWithSource();
  return result.readings;
}

export async function listMonitoringReadingsForTank(
  tankId: string,
  limit?: number,
): Promise<Reading[]> {
  if (getMonitoringStorageDriver() === "mysql") {
    return listMonitoringReadingsForTankFromMysql(tankId, limit);
  }

  return getMonitoringReadings()
    .filter((reading) => reading.tankId === tankId)
    .sort((first, second) => {
      return (
        new Date(first.receivedAt).getTime() -
        new Date(second.receivedAt).getTime()
      );
    });
}

export async function listMonitoringReadingsForTankInRange({
  end,
  start,
  tankId,
}: {
  end: string;
  start: string;
  tankId: string;
}): Promise<Reading[]> {
  if (getMonitoringStorageDriver() === "mysql") {
    return listMonitoringReadingsForTankInRangeFromMysql({
      end,
      start,
      tankId,
    });
  }

  const startTime = Date.parse(start);
  const endTime = Date.parse(end);

  return getMonitoringReadings()
    .filter((reading) => {
      const receivedTime = Date.parse(reading.receivedAt);

      return (
        reading.tankId === tankId &&
        Number.isFinite(receivedTime) &&
        receivedTime >= startTime &&
        receivedTime < endTime
      );
    })
    .sort((first, second) => {
      return (
        new Date(first.receivedAt).getTime() -
        new Date(second.receivedAt).getTime()
      );
    });
}

export async function saveMonitoringReading(
  reading: Reading,
): Promise<SaveMonitoringReadingResult> {
  if (getMonitoringStorageDriver() === "mysql") {
    return {
      reading: await saveMonitoringReadingToMysql(reading),
      storage: "mysql",
    };
  }

  return {
    reading: saveMonitoringReadingToMemory(reading),
    storage: "memory",
  };
}
