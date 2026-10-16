import type {
  Device,
  Reading,
  Site,
  Tank,
} from "@/features/monitoring/types/monitoring";

import type { AlertCandidate, AlertSeverity } from "../types";
import type { OpsConfig } from "./ops-config";

export type AlertRuleInput = {
  now: Date;
  sites: Site[];
  tanks: Tank[];
  devices: Device[];
  latestReadings: Reading[];
  /** Successful ingest events observed inside the rejection window. */
  ingestRejections?: {
    count: number;
    windowMinutes: number;
    topDeviceIdentifiers?: string[];
  };
  /** Package download attempts rejected inside the anomaly window. */
  packageTokenAnomalies?: {
    count: number;
    windowMinutes: number;
  };
  /** Error message when the operational database could not be read. */
  storageError?: string | null;
  config: OpsConfig;
};

function hoursToMs(hours: number): number {
  return hours * 60 * 60 * 1_000;
}

function minutesToMs(minutes: number): number {
  return minutes * 60 * 1_000;
}

function ageSeconds(receivedAt: string, now: Date): number | null {
  const receivedMs = Date.parse(receivedAt);

  if (!Number.isFinite(receivedMs)) {
    return null;
  }

  return Math.max(0, (now.getTime() - receivedMs) / 1_000);
}

function findLatestReadingForDevice({
  device,
  latestReadings,
}: {
  device: Device;
  latestReadings: Reading[];
}): Reading | null {
  const candidates = latestReadings.filter(
    (reading) => reading.deviceId === device.id || reading.tankId === device.tankId,
  );

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((latest, reading) =>
    Date.parse(reading.receivedAt) > Date.parse(latest.receivedAt)
      ? reading
      : latest,
  );
}

function describeSite(site: Site | undefined): string {
  return site ? `${site.name} (${site.code})` : "unknown location";
}

export function getDeviceFreshnessSeverity({
  device,
  latestReading,
  now,
  config,
}: {
  device: Device;
  latestReading: Reading | null;
  now: Date;
  config: OpsConfig;
}): AlertSeverity | null {
  const expectedIntervalSec = Math.max(
    device.expectedReportIntervalSec > 0 ? device.expectedReportIntervalSec : 3600,
    60,
  );

  if (!latestReading) {
    return null;
  }

  const age = ageSeconds(latestReading.receivedAt, now);

  if (age === null) {
    return null;
  }

  if (age > expectedIntervalSec * config.offlineGraceMultiplier) {
    return "critical";
  }

  if (age > expectedIntervalSec * config.delayedGraceMultiplier) {
    return "warning";
  }

  return null;
}

export function buildDeviceAlertCandidates({
  config,
  devices,
  latestReadings,
  now,
  sites,
  tanks,
}: AlertRuleInput): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const tankById = new Map(tanks.map((tank) => [tank.id, tank]));

  for (const device of devices) {
    const tank = tankById.get(device.tankId);
    const site = tank ? siteById.get(tank.siteId) : undefined;
    const latestReading = findLatestReadingForDevice({ device, latestReadings });

    if (!device.isActive) {
      candidates.push({
        dedupeKey: `device_inactive:${device.id}`,
        detail: `Device ${device.code} at ${describeSite(site)} is disabled in the registry, so its telemetry is rejected.`,
        metadata: { deviceCode: device.code, siteCode: site?.code ?? null },
        ruleKey: "device_inactive",
        severity: "warning",
        subjectId: device.id,
        subjectType: "device",
        title: `Device ${device.code} is disabled`,
      });
      continue;
    }

    if (!latestReading) {
      candidates.push({
        dedupeKey: `device_never_reported:${device.id}`,
        detail: `Active device ${device.code} at ${describeSite(site)} has never delivered a reading. Check the firmware, the device key, and the network path.`,
        metadata: { deviceCode: device.code, siteCode: site?.code ?? null },
        ruleKey: "device_never_reported",
        severity: "warning",
        subjectId: device.id,
        subjectType: "device",
        title: `Device ${device.code} has never reported`,
      });
      continue;
    }

    const freshnessSeverity = getDeviceFreshnessSeverity({
      config,
      device,
      latestReading,
      now,
    });

    if (freshnessSeverity === "critical") {
      const age = ageSeconds(latestReading.receivedAt, now) ?? 0;

      candidates.push({
        dedupeKey: `device_offline:${device.id}`,
        detail: `No telemetry from ${device.code} at ${describeSite(site)} for ${Math.round(age / 60)} minutes (expected every ${Math.round(device.expectedReportIntervalSec / 60)} minutes).`,
        metadata: {
          ageMinutes: Math.round(age / 60),
          deviceCode: device.code,
          lastReceivedAt: latestReading.receivedAt,
          siteCode: site?.code ?? null,
        },
        ruleKey: "device_offline",
        severity: "critical",
        subjectId: device.id,
        subjectType: "device",
        title: `Device ${device.code} is offline`,
      });
    } else if (freshnessSeverity === "warning") {
      const age = ageSeconds(latestReading.receivedAt, now) ?? 0;

      candidates.push({
        dedupeKey: `device_delayed:${device.id}`,
        detail: `Telemetry from ${device.code} at ${describeSite(site)} is delayed by ${Math.round(age / 60)} minutes.`,
        metadata: {
          ageMinutes: Math.round(age / 60),
          deviceCode: device.code,
          lastReceivedAt: latestReading.receivedAt,
          siteCode: site?.code ?? null,
        },
        ruleKey: "device_delayed",
        severity: "warning",
        subjectId: device.id,
        subjectType: "device",
        title: `Device ${device.code} is delayed`,
      });
    }

    const configStatus = latestReading.quality?.configStatus;

    if (configStatus === "config_mismatch" || configStatus === "invalid_config") {
      candidates.push({
        dedupeKey: `device_config_mismatch:${device.id}`,
        detail: `Telemetry from ${device.code} conflicts with the registry configuration (${configStatus}). Review ${latestReading.quality?.configMismatchReasons?.join("; ") || "the reported parameters"}.`,
        metadata: {
          configStatus,
          deviceCode: device.code,
          reasons: latestReading.quality?.configMismatchReasons ?? [],
        },
        ruleKey: "device_config_mismatch",
        severity: "warning",
        subjectId: device.id,
        subjectType: "device",
        title: `Configuration mismatch on ${device.code}`,
      });
    }
  }

  return candidates;
}

export function buildLevelAlertCandidates({
  config,
  devices,
  latestReadings,
  now,
  sites,
  tanks,
}: AlertRuleInput): AlertCandidate[] {
  void config;
  void now;

  const candidates: AlertCandidate[] = [];
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const deviceByTankId = new Map(devices.map((device) => [device.tankId, device]));

  for (const tank of tanks) {
    const device = deviceByTankId.get(tank.id);
    const site = siteById.get(tank.siteId);
    const reading = latestReadings.find(
      (item) => item.tankId === tank.id && (!device || item.deviceId === device.id),
    );

    if (!reading || !Number.isFinite(reading.fillPercent)) {
      continue;
    }

    const fillPercent = reading.fillPercent;
    const baseMetadata = {
      capacityLiter: tank.capacityLiter,
      criticalLevelPercent: tank.criticalLevelPercent,
      deviceCode: device?.code ?? null,
      fillPercent,
      lowLevelPercent: tank.lowLevelPercent,
      siteCode: site?.code ?? null,
      volumeLiter: reading.volumeLiter,
    };

    if (fillPercent < tank.criticalLevelPercent) {
      candidates.push({
        dedupeKey: `fuel_critical_level:${tank.id}`,
        detail: `Tank ${tank.name} at ${describeSite(site)} is at ${fillPercent.toFixed(1)}% (critical threshold ${tank.criticalLevelPercent}%). Refuel before the load stops.`,
        metadata: baseMetadata,
        ruleKey: "fuel_critical_level",
        severity: "critical",
        subjectId: tank.id,
        subjectType: "tank",
        title: `Critical fuel level on ${tank.name}`,
      });
      continue;
    }

    if (fillPercent < tank.lowLevelPercent) {
      candidates.push({
        dedupeKey: `fuel_low_level:${tank.id}`,
        detail: `Tank ${tank.name} at ${describeSite(site)} is at ${fillPercent.toFixed(1)}% (low threshold ${tank.lowLevelPercent}%).`,
        metadata: baseMetadata,
        ruleKey: "fuel_low_level",
        severity: "warning",
        subjectId: tank.id,
        subjectType: "tank",
        title: `Low fuel level on ${tank.name}`,
      });
    }
  }

  return candidates;
}

export function buildSystemAlertCandidates({
  config,
  devices,
  ingestRejections,
  latestReadings,
  packageTokenAnomalies,
  sites,
  storageError,
  tanks,
}: AlertRuleInput): AlertCandidate[] {
  void devices;
  void latestReadings;

  const candidates: AlertCandidate[] = [];

  if (storageError) {
    candidates.push({
      dedupeKey: "storage_unavailable:mysql",
      detail: `The operational database could not be read: ${storageError}. Dashboards, ingest, and alerts are degraded until it recovers.`,
      metadata: { message: storageError },
      ruleKey: "storage_unavailable",
      severity: "critical",
      subjectId: "mysql",
      subjectType: "system",
      title: "Operational database is unavailable",
    });
  }

  if (sites.length === 0 || tanks.length === 0) {
    candidates.push({
      dedupeKey: "registry_incomplete:core",
      detail: `The registry resolved ${sites.length} locations and ${tanks.length} tanks. Telemetry cannot be attributed until the registry is restored.`,
      metadata: { siteCount: sites.length, tankCount: tanks.length },
      ruleKey: "registry_incomplete",
      severity: "critical",
      subjectId: "core",
      subjectType: "system",
      title: "Monitoring registry is incomplete",
    });
  }

  if (
    ingestRejections &&
    ingestRejections.count >= config.ingestRejectionWarningCount
  ) {
    candidates.push({
      dedupeKey: "ingest_rejection_spike:global",
      detail: `${ingestRejections.count} telemetry requests were rejected in the last ${ingestRejections.windowMinutes} minutes. Check device keys, firmware identity, and payload formats.`,
      metadata: {
        count: ingestRejections.count,
        topDeviceIdentifiers: ingestRejections.topDeviceIdentifiers ?? [],
        windowMinutes: ingestRejections.windowMinutes,
      },
      ruleKey: "ingest_rejection_spike",
      severity: "warning",
      subjectId: "ingest",
      subjectType: "system",
      title: "Telemetry rejections are unusually high",
    });
  }

  if (
    packageTokenAnomalies &&
    packageTokenAnomalies.count >= config.packageTokenAnomalyCount
  ) {
    candidates.push({
      dedupeKey: "package_token_anomaly:global",
      detail: `${packageTokenAnomalies.count} firmware package download attempts were rejected in the last ${packageTokenAnomalies.windowMinutes} minutes (expired, revoked, or exhausted tokens).`,
      metadata: {
        count: packageTokenAnomalies.count,
        windowMinutes: packageTokenAnomalies.windowMinutes,
      },
      ruleKey: "package_token_anomaly",
      severity: "warning",
      subjectId: "packages",
      subjectType: "system",
      title: "Firmware package downloads are being rejected",
    });
  }

  return candidates;
}

export function buildAlertCandidates(input: AlertRuleInput): AlertCandidate[] {
  const candidates = [
    ...buildDeviceAlertCandidates(input),
    ...buildLevelAlertCandidates(input),
    ...buildSystemAlertCandidates(input),
  ];

  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    if (seen.has(candidate.dedupeKey)) {
      return false;
    }

    seen.add(candidate.dedupeKey);

    return true;
  });
}

export function isAlertSilencedByHysteresis({
  config,
  lastDetectedAt,
  now,
}: {
  config: OpsConfig;
  lastDetectedAt: string;
  now: Date;
}): boolean {
  const lastDetectedMs = Date.parse(lastDetectedAt);

  if (!Number.isFinite(lastDetectedMs)) {
    return false;
  }

  return (
    now.getTime() - lastDetectedMs <
    minutesToMs(Math.min(config.renofifyCooldownMinutes, 5))
  );
}

export { hoursToMs, minutesToMs };
