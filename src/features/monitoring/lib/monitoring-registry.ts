import { mockDevices } from "../data/mock-devices";
import { mockSites } from "../data/mock-sites";
import { mockTanks } from "../data/mock-tanks";
import type { Device, Site, Tank } from "../types/monitoring";
import { listMonitoringReferenceFromMysql } from "./mysql-reference-repository";
import {
  getMonitoringStorageDriver,
  type MonitoringStorageDriver,
} from "./monitoring-storage";

export type MonitoringReferenceData = {
  sites: Site[];
  tanks: Tank[];
  devices: Device[];
};

export type MonitoringRegistrySource = {
  configuredDriver: MonitoringStorageDriver;
  activeDriver: MonitoringStorageDriver;
  isFallback: boolean;
  label: string;
};

export type MonitoringReferenceResult = {
  reference: MonitoringReferenceData;
  source: MonitoringRegistrySource;
};

export type MonitoringDeviceBundle = {
  site: Site;
  tank: Tank;
  device: Device;
};

function cloneReferenceData(
  reference: MonitoringReferenceData,
): MonitoringReferenceData {
  return {
    sites: reference.sites.map((site) => ({ ...site })),
    tanks: reference.tanks.map((tank) => ({ ...tank })),
    devices: reference.devices.map((device) => ({ ...device })),
  };
}

function getMemoryReferenceData(): MonitoringReferenceData {
  return cloneReferenceData({
    sites: mockSites,
    tanks: mockTanks,
    devices: mockDevices,
  });
}

function createRegistrySource(
  driver: MonitoringStorageDriver,
): MonitoringRegistrySource {
  if (driver === "mysql") {
    return {
      configuredDriver: "mysql",
      activeDriver: "mysql",
      isFallback: false,
      label: "Registry MySQL",
    };
  }

  return {
    configuredDriver: "memory",
    activeDriver: "memory",
    isFallback: false,
    label: "Local memory registry",
  };
}

function assertCompleteReferenceData(reference: MonitoringReferenceData): void {
  if (
    reference.sites.length === 0 ||
    reference.tanks.length === 0 ||
    reference.devices.length === 0
  ) {
    throw new Error(
      "MySQL site/tank/device registry is incomplete. Run the migrations and reference data seeds first.",
    );
  }
}

export async function getMonitoringReferenceDataWithSource(): Promise<MonitoringReferenceResult> {
  const configuredDriver = getMonitoringStorageDriver();

  if (configuredDriver !== "mysql") {
    return {
      reference: getMemoryReferenceData(),
      source: createRegistrySource("memory"),
    };
  }

  const reference = await listMonitoringReferenceFromMysql();
  assertCompleteReferenceData(reference);

  return {
    reference,
    source: createRegistrySource("mysql"),
  };
}

export async function getMonitoringReferenceData(): Promise<MonitoringReferenceData> {
  const result = await getMonitoringReferenceDataWithSource();
  return result.reference;
}

export async function findMonitoringDeviceBundleByIdentifier(
  identifier: string,
): Promise<MonitoringDeviceBundle | null> {
  const reference = await getMonitoringReferenceData();
  const device =
    reference.devices.find(
      (item) => item.id === identifier || item.code === identifier,
    ) ?? null;

  if (!device) {
    return null;
  }

  const tank =
    reference.tanks.find((item) => item.id === device.tankId) ?? null;
  const site =
    reference.sites.find((item) => item.id === device.siteId) ?? null;

  if (!tank || !site) {
    return null;
  }

  return {
    site,
    tank,
    device,
  };
}
