import { describe, expect, it } from "vitest";

import {
  buildPendingDeviceRequest,
  calculateDeviceRequestCapacityLiter,
  calculateOperationalConsumptionLiterPerHour,
  evaluateDeviceRequestCapacity,
  getDeviceRequestStatusLabel,
  validateDeviceRequestDraft,
} from "../lib/device-request";
import type {
  DeviceRequestDraft,
  MonitoringFirmwareTemplate,
  MonitoringHardwareProfile,
} from "../types/monitoring";

const firmwareTemplate: MonitoringFirmwareTemplate = {
  id: "firmware-template-esp8266-ultrasonic-v1",
  templateKey: "solartank-esp8266-ultrasonic",
  version: "v1",
  displayName: "SolarTank ESP8266 Ultrasonic",
  sourcePath: "firmware/templates/solartank-esp8266-ultrasonic-v1",
  checksumSha256: null,
  isActive: true,
};

const rectangularProfile: MonitoringHardwareProfile = {
  id: "hardware-profile-nodemcu-hcsr04-rectangular-v1",
  code: "nodemcu-hcsr04-rectangular-v1",
  name: "NodeMCU ESP8266 + HC-SR04 for rectangular tank",
  boardFamily: "esp8266",
  boardLabel: "NodeMCU 1.0 ESP-12E",
  sensorType: "HC-SR04",
  triggerPin: "D5",
  echoPin: "D6",
  supportedTankShape: "rectangular",
  firmwareTemplateId: firmwareTemplate.id,
  reportIntervalMs: 20000,
  isActive: true,
};

const baseDraft: DeviceRequestDraft = {
  siteName: "STO TPH",
  areaLabel: "Pasuruan",
  regionalLabel: "TREG 5",
  wilayahLabel: "TIF 3",
  deviceSensorType: "fuel",
  tankShape: "rectangular",
  lengthCm: 150,
  widthCm: 60,
  heightCm: 60,
  sensorMountHeightCm: 60,
  loadValue: 20,
  loadUnit: "kw",
  dieselEngineCapacityKva: 40,
  cosPhi: 0.8,
  hardwareProfileId: rectangularProfile.id,
};

describe("device request foundation", () => {
  it("calculates capacity from rectangular tank dimensions", () => {
    expect(
      calculateDeviceRequestCapacityLiter({
        tankShape: "rectangular",
        lengthCm: 150,
        widthCm: 60,
        heightCm: 60,
      }),
    ).toBe(540);
  });

  it("accepts a valid rectangular request and normalizes operational defaults", () => {
    const validation = validateDeviceRequestDraft(baseDraft, {
      firmwareTemplates: [firmwareTemplate],
      hardwareProfiles: [rectangularProfile],
    });

    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.normalized).toMatchObject({
      siteCode: "TPH",
      siteName: "STO TPH",
      areaLabel: "Pasuruan",
      regionalLabel: "TREG 5",
      wilayahLabel: "TIF 3",
      deviceSensorType: "fuel",
      sensorMountHeightCm: 60,
      loadValue: 20,
      loadUnit: "kw",
      dieselEngineCapacityKva: 40,
      cosPhi: 0.8,
      lowLevelPercent: 30,
      criticalLevelPercent: 15,
      capacityLiter: 540,
      consumptionLiterPerHour: 5.25,
    });
    expect(validation.normalized?.deviceCode).toMatch(/^device-tph-[a-f0-9]{6}$/);
    expect(validation.capacityCheck).toMatchObject({
      calculatedCapacityLiter: 540,
      declaredCapacityLiter: 540,
      isConsistent: true,
    });
  });

  it("normalizes compact location labels into the approved format", () => {
    const validation = validateDeviceRequestDraft(
      {
        ...baseDraft,
        regionalLabel: "treg5",
        wilayahLabel: "tif3",
      },
      {
        firmwareTemplates: [firmwareTemplate],
        hardwareProfiles: [rectangularProfile],
      },
    );

    expect(validation.ok).toBe(true);
    expect(validation.normalized).toMatchObject({
      regionalLabel: "TREG 5",
      wilayahLabel: "TIF 3",
    });
  });

  it("rejects requests without an approved regional and wilayah", () => {
    const validation = validateDeviceRequestDraft(
      {
        ...baseDraft,
        regionalLabel: "Unknown regional",
        wilayahLabel: "",
      },
      {
        firmwareTemplates: [firmwareTemplate],
        hardwareProfiles: [rectangularProfile],
      },
    );

    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "regionalLabel" }),
        expect.objectContaining({ field: "wilayahLabel" }),
      ]),
    );
  });

  it("preserves precise latitude and longitude values", () => {
    const validation = validateDeviceRequestDraft(
      {
        ...baseDraft,
        latitude: -7.7201234,
        longitude: 112.8809876,
      },
      {
        firmwareTemplates: [firmwareTemplate],
        hardwareProfiles: [rectangularProfile],
      },
    );

    expect(validation.ok).toBe(true);
    expect(validation.normalized).toMatchObject({
      latitude: -7.7201234,
      longitude: 112.8809876,
    });
  });

  it("calculates hourly diesel consumption from load, engine capacity, and cos phi", () => {
    expect(
      calculateOperationalConsumptionLiterPerHour({
        cosPhi: 0.8,
        dieselEngineCapacityKva: 40,
        loadUnit: "kw",
        loadValue: 20,
      }),
    ).toBe(5.25);
    expect(
      calculateOperationalConsumptionLiterPerHour({
        cosPhi: 0.8,
        dieselEngineCapacityKva: 40,
        loadUnit: "kva",
        loadValue: 25,
      }),
    ).toBe(5.25);
  });

  it("uses calculated tank capacity even when a legacy draft sends capacity", () => {
    const validation = validateDeviceRequestDraft(
      {
        ...baseDraft,
        capacityLiter: 700,
      },
      {
        firmwareTemplates: [firmwareTemplate],
        hardwareProfiles: [rectangularProfile],
      },
    );

    expect(validation.ok).toBe(true);
    expect(validation.warnings).toEqual([]);
    expect(validation.normalized?.capacityLiter).toBe(540);
    expect(validation.capacityCheck).toMatchObject({
      calculatedCapacityLiter: 540,
      declaredCapacityLiter: 540,
      isConsistent: true,
    });
  });

  it("rejects a hardware profile that does not support the selected tank shape", () => {
    const validation = validateDeviceRequestDraft(
      {
        ...baseDraft,
        tankShape: "horizontal-cylinder",
        diameterCm: 60,
      },
      {
        firmwareTemplates: [firmwareTemplate],
        hardwareProfiles: [rectangularProfile],
      },
    );

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContainEqual(
      expect.objectContaining({
        field: "hardwareProfileId",
      }),
    );
  });

  it("builds a pending request with audit-friendly identifiers", () => {
    const result = buildPendingDeviceRequest({
      draft: baseDraft,
      firmwareTemplates: [firmwareTemplate],
      hardwareProfiles: [rectangularProfile],
      now: new Date("2026-07-05T01:02:03.000Z"),
      requesterEmail: "USER@EXAMPLE.COM",
      requesterUserId: "user_demo",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.request.id).toMatch(/^device_request_/);
    expect(result.request.requestCode).toMatch(/^REQ-TPH-20260705-[A-F0-9]{6}$/);
    expect(result.request.deviceCode).toMatch(/^device-tph-[a-f0-9]{6}$/);
    expect(result.request.requesterEmail).toBe("user@example.com");
    expect(result.request.status).toBe("pending_admin_review");
    expect(result.request.firmwareTemplateId).toBe(firmwareTemplate.id);
  });

  it("keeps concise labels for request status", () => {
    expect(getDeviceRequestStatusLabel("pending_admin_review")).toBe(
      "Waiting for admin",
    );
    expect(getDeviceRequestStatusLabel("approved_waiting_package")).toBe(
      "Approved, waiting for firmware package",
    );
    expect(getDeviceRequestStatusLabel("waiting_first_valid_ping")).toBe(
      "Waiting for device online",
    );
  });

  it("evaluates capacity tolerance with liter and percent thresholds", () => {
    expect(
      evaluateDeviceRequestCapacity({
        calculatedCapacityLiter: 540,
        declaredCapacityLiter: 544,
      }).isConsistent,
    ).toBe(true);
    expect(
      evaluateDeviceRequestCapacity({
        calculatedCapacityLiter: 540,
        declaredCapacityLiter: 600,
      }).isConsistent,
    ).toBe(false);
  });
});
