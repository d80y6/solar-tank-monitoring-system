import { describe, expect, it } from "vitest";

import type {
  Device,
  Reading,
  Site,
  Tank,
  TankConfigStatus,
} from "@/features/monitoring/types/monitoring";

import {
  buildAlertCandidates,
  buildDeviceAlertCandidates,
  getDeviceFreshnessSeverity,
} from "../lib/alert-rules";
import { getOpsConfig } from "../lib/ops-config";

const NOW = new Date("2026-10-16T12:00:00.000Z");
const config = getOpsConfig({
  OPS_ALERTS_ENABLED: "true",
  OPS_NEVER_REPORTED_HOURS: "24",
  OPS_INGEST_REJECTION_WARNING_COUNT: "25",
  OPS_PACKAGE_TOKEN_ANOMALY_COUNT: "5",
} as unknown as NodeJS.ProcessEnv);

const site: Site = {
  areaLabel: "Pasuruan",
  code: "STO-PSR",
  id: "site-1",
  isActive: true,
  name: "Pasuruan",
};

const tank: Tank = {
  capacityLiter: 1_000,
  consumptionLiterPerHour: 10,
  criticalLevelPercent: 15,
  id: "tank-1",
  isActive: true,
  lowLevelPercent: 30,
  name: "Tank A",
  sensorMountHeightCm: 150,
  shape: "horizontal-cylinder",
  siteId: site.id,
};

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    code: "DEV-01",
    expectedReportIntervalSec: 3_600,
    id: "device-1",
    isActive: true,
    label: "Device 1",
    siteId: site.id,
    tankId: tank.id,
    ...overrides,
  };
}

function makeReading({
  fillPercent = 60,
  receivedAt,
  status,
}: {
  fillPercent?: number;
  receivedAt: string;
  status?: string;
}): Reading {
  return {
    deviceId: "device-1",
    fillPercent,
    fuelHeightCm: 100,
    id: "reading-1",
    measuredAt: receivedAt,
    quality: status
      ? {
          configMismatchReasons: ["capacity_liter differs"],
          configSource: "mixed",
          configStatus: status as TankConfigStatus,
          fillPercentSource: "device",
          fuelHeightSource: "device",
          measuredAtSource: "device",
          needsReview: true,
          runtimeSource: "device",
          volumeSource: "device",
          warnings: [],
        }
      : undefined,
    receivedAt,
    runtimeHour: 20,
    sensorDistanceCm: 50,
    tankId: tank.id,
    volumeLiter: 600,
  };
}

describe("device freshness rules", () => {
  it("returns null while the device is inside the expected window", () => {
    expect(
      getDeviceFreshnessSeverity({
        config,
        device: makeDevice(),
        latestReading: makeReading({ receivedAt: "2026-10-16T11:30:00.000Z" }),
        now: NOW,
      }),
    ).toBeNull();
  });

  it("escalates to warning after two missed intervals and critical after four", () => {
    expect(
      getDeviceFreshnessSeverity({
        config,
        device: makeDevice(),
        latestReading: makeReading({ receivedAt: "2026-10-16T09:00:00.000Z" }),
        now: NOW,
      }),
    ).toBe("warning");

    expect(
      getDeviceFreshnessSeverity({
        config,
        device: makeDevice(),
        latestReading: makeReading({ receivedAt: "2026-10-16T05:00:00.000Z" }),
        now: NOW,
      }),
    ).toBe("critical");
  });
});

describe("device alert candidates", () => {
  const base = {
    config,
    devices: [makeDevice()],
    now: NOW,
    sites: [site],
    tanks: [tank],
  };

  it("reports a device that has never sent a reading", () => {
    const candidates = buildDeviceAlertCandidates({
      ...base,
      latestReadings: [],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].ruleKey).toBe("device_never_reported");
    expect(candidates[0].severity).toBe("warning");
  });

  it("reports an offline device with its age in the detail", () => {
    const candidates = buildDeviceAlertCandidates({
      ...base,
      latestReadings: [makeReading({ receivedAt: "2026-10-16T04:00:00.000Z" })],
    });

    const offline = candidates.find(
      (candidate) => candidate.ruleKey === "device_offline",
    );

    expect(offline).toBeDefined();
    expect(offline?.severity).toBe("critical");
    expect(offline?.detail).toContain("480 minutes");
    expect(offline?.dedupeKey).toBe("device_offline:device-1");
  });

  it("reports disabled devices instead of freshness problems", () => {
    const candidates = buildDeviceAlertCandidates({
      ...base,
      devices: [makeDevice({ isActive: false })],
      latestReadings: [makeReading({ receivedAt: "2026-10-16T04:00:00.000Z" })],
    });

    expect(candidates.map((candidate) => candidate.ruleKey)).toEqual([
      "device_inactive",
    ]);
  });

  it("reports configuration mismatches from the reading quality block", () => {
    const candidates = buildDeviceAlertCandidates({
      ...base,
      latestReadings: [
        makeReading({
          receivedAt: "2026-10-16T11:55:00.000Z",
          status: "config_mismatch",
        }),
      ],
    });

    const mismatch = candidates.find(
      (candidate) => candidate.ruleKey === "device_config_mismatch",
    );

    expect(mismatch?.detail).toContain("capacity_liter differs");
  });
});

describe("level and system rules", () => {
  const base = {
    config,
    devices: [makeDevice()],
    now: NOW,
    sites: [site],
    tanks: [tank],
  };

  it("raises critical before low level is reported", () => {
    const candidates = buildAlertCandidates({
      ...base,
      latestReadings: [
        makeReading({ fillPercent: 10, receivedAt: "2026-10-16T11:55:00.000Z" }),
      ],
    });

    expect(candidates.map((candidate) => candidate.ruleKey)).toContain(
      "fuel_critical_level",
    );
    expect(candidates.map((candidate) => candidate.ruleKey)).not.toContain(
      "fuel_low_level",
    );
  });

  it("raises a warning between the low and critical thresholds", () => {
    const candidates = buildAlertCandidates({
      ...base,
      latestReadings: [
        makeReading({ fillPercent: 22, receivedAt: "2026-10-16T11:55:00.000Z" }),
      ],
    });

    expect(candidates.map((candidate) => candidate.ruleKey)).toContain(
      "fuel_low_level",
    );
  });

  it("does not alert on a healthy reading", () => {
    expect(
      buildAlertCandidates({
        ...base,
        latestReadings: [
          makeReading({ fillPercent: 72, receivedAt: "2026-10-16T11:55:00.000Z" }),
        ],
      }),
    ).toEqual([]);
  });

  it("reports storage failures and an incomplete registry", () => {
    const candidates = buildAlertCandidates({
      ...base,
      latestReadings: [],
      sites: [],
      storageError: "connect ETIMEDOUT",
      tanks: [],
    });

    const keys = candidates.map((candidate) => candidate.ruleKey);

    expect(keys).toContain("storage_unavailable");
    expect(keys).toContain("registry_incomplete");
  });

  it("reports rejection spikes and package token anomalies above threshold", () => {
    const candidates = buildAlertCandidates({
      ...base,
      ingestRejections: {
        count: 25,
        topDeviceIdentifiers: ["unknown-device"],
        windowMinutes: 60,
      },
      latestReadings: [
        makeReading({ fillPercent: 60, receivedAt: "2026-10-16T11:55:00.000Z" }),
      ],
      packageTokenAnomalies: { count: 5, windowMinutes: 60 },
    });

    const keys = candidates.map((candidate) => candidate.ruleKey);

    expect(keys).toContain("ingest_rejection_spike");
    expect(keys).toContain("package_token_anomaly");
    expect(candidates).toHaveLength(2);
  });

  it("stays quiet below the configured thresholds", () => {
    const candidates = buildAlertCandidates({
      ...base,
      ingestRejections: {
        count: 24,
        topDeviceIdentifiers: [],
        windowMinutes: 60,
      },
      latestReadings: [
        makeReading({ fillPercent: 60, receivedAt: "2026-10-16T11:55:00.000Z" }),
      ],
      packageTokenAnomalies: { count: 4, windowMinutes: 60 },
    });

    expect(candidates).toEqual([]);
  });
});

describe("ops configuration", () => {
  it("falls back to safe defaults for malformed values", () => {
    const parsed = getOpsConfig({
      OPS_ALERT_ESCALATION_MINUTES: "-5",
      OPS_ALERT_RENOTIFY_COOLDOWN_MINUTES: "abc",
      OPS_INGEST_REJECTION_WINDOW_MINUTES: "99999",
      OPS_ALERTS_ENABLED: "no",
      MONITORING_READING_RETENTION_DAYS: "0",
    } as unknown as NodeJS.ProcessEnv);

    expect(parsed.enabled).toBe(false);
    expect(parsed.escalationAfterMinutes).toBe(5);
    expect(parsed.renofifyCooldownMinutes).toBe(60);
    expect(parsed.ingestRejectionWindowMinutes).toBe(1_440);
    expect(parsed.retention.readingDays).toBe(0);
    expect(parsed.resolveAfterMissingEvaluations).toBe(3);
  });
});
