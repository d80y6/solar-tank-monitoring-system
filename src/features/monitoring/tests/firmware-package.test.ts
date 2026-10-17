import { describe, expect, it } from "vitest";

import {
  createFirmwarePackageBundle,
  createFirmwarePackageFilename,
  decryptFirmwarePackage,
  encryptFirmwarePackage,
  findUnresolvedTemplatePlaceholders,
  hashDownloadToken,
  renderDeviceConfigHeader,
  sanitizeFirmwareFileSegment,
} from "../lib/firmware-package";
import type {
  MonitoringDeviceRequest,
  MonitoringFirmwareTemplate,
  MonitoringHardwareProfile,
} from "../types/monitoring";

const FIRMWARE_TEMPLATE: MonitoringFirmwareTemplate = {
  displayName: "SolarTank ESP8266 Ultrasonic",
  id: "firmware-template-esp8266-ultrasonic-v1",
  isActive: true,
  sourcePath: "firmware/templates/solartank-esp8266-ultrasonic-v1",
  templateKey: "solartank-esp8266-ultrasonic",
  version: "v1",
};

const HARDWARE_PROFILE: MonitoringHardwareProfile = {
  boardFamily: "esp8266",
  boardLabel: "NodeMCU 1.0 ESP-12E",
  code: "nodemcu-hcsr04-rectangular-v1",
  echoPin: "D6",
  firmwareTemplateId: FIRMWARE_TEMPLATE.id,
  id: "hardware-profile-nodemcu-hcsr04-rectangular-v1",
  isActive: true,
  name: "NodeMCU ESP8266 + HC-SR04 for rectangular tank",
  reportIntervalMs: 20000,
  sensorType: "HC-SR04",
  supportedTankShape: "rectangular",
  triggerPin: "D5",
};

const DEVICE_REQUEST: MonitoringDeviceRequest = {
  adminReviewedAt: null,
  adminReviewedByUserId: null,
  areaLabel: "Pasuruan",
  regionalLabel: "TREG 5",
  wilayahLabel: "TIF 3",
  capacityLiter: 540,
  consumptionLiterPerHour: 5.25,
  createdAt: "2026-07-05T00:00:00.000Z",
  criticalLevelPercent: 15,
  deviceCode: "device-tph-main",
  deviceLabel: "NodeMCU main STO TPH",
  deviceSensorType: "fuel",
  dieselEngineCapacityKva: 40,
  firmwareTemplateId: FIRMWARE_TEMPLATE.id,
  hardwareProfileId: HARDWARE_PROFILE.id,
  heightCm: 60,
  id: "device-request-1",
  latitude: -7.72,
  lengthCm: 150,
  longitude: 112.88,
  loadUnit: "kw",
  loadValue: 20,
  lowLevelPercent: 30,
  cosPhi: 0.8,
  rejectionReason: null,
  requesterEmail: "operator@example.com",
  requesterUserId: "user-1",
  requestCode: "REQ-TPH-20260705-ABC123",
  sensorMountHeightCm: 60,
  siteCode: "TPH",
  siteName: "STO TPH",
  status: "pending_admin_review",
  tankShape: "rectangular",
  updatedAt: "2026-07-05T00:00:00.000Z",
  validationWarnings: [],
  widthCm: 60,
};

describe("firmware package helpers", () => {
  it("creates safe zip filenames from device code", () => {
    expect(
      createFirmwarePackageFilename({
        deviceCode: "Device TPH/Main",
        generatedAt: new Date("2026-07-05T00:00:00.000Z"),
      }),
    ).toBe("solartank-device-tph-main-20260705.zip");
  });

  it("falls back when a filename segment is empty after sanitizing", () => {
    expect(sanitizeFirmwareFileSegment("!!!", "device")).toBe("device");
  });

  it("finds unresolved firmware template placeholders", () => {
    expect(
      findUnresolvedTemplatePlaceholders(`
        #define DEVICE "{{DEVICE_CODE}}"
        #define KEY "{{ DEVICE_KEY }}"
        #define DEVICE_AGAIN "{{DEVICE_CODE}}"
      `),
    ).toEqual(["DEVICE_CODE", "DEVICE_KEY"]);
  });

  it("renders device config with the generated key and normalized tank data", () => {
    const header = renderDeviceConfigHeader({
      appBaseUrl: "https://solartank.example.com",
      deviceKey: "stk_test_device_key",
      request: DEVICE_REQUEST,
    });

    expect(header).toContain('#define SOLARTANK_DEVICE_CODE "device-tph-main"');
    expect(header).toContain('#define SOLARTANK_DEVICE_SENSOR_TYPE "fuel"');
    expect(header).toContain('#define SOLARTANK_DEVICE_KEY "stk_test_device_key"');
    expect(header).toContain("#define SOLARTANK_TANK_CAPACITY_LITER 540");
    expect(header).toContain("#define SOLARTANK_SITE_LATITUDE -7.7200000");
    expect(header).toContain("#define SOLARTANK_SITE_LONGITUDE 112.8800000");
    expect(header).toContain('#define SOLARTANK_REGIONAL_LABEL "TREG 5"');
    expect(header).toContain('#define SOLARTANK_WILAYAH_LABEL "TIF 3"');
    expect(header).toContain("#define SOLARTANK_CONSUMPTION_LITER_PER_HOUR 5.25");
    expect(header).toContain("#define SOLARTANK_COS_PHI 0.80");
    expect(header).not.toContain("{{");
  });

  it("carries the transport-security settings into the generated header", () => {
    const header = renderDeviceConfigHeader({
      appBaseUrl: "https://solartank.example.com",
      deviceKey: "stk_test_device_key",
      request: DEVICE_REQUEST,
      signingEnabled: true,
      tlsCaCertificate: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
      tlsCertificateFingerprint: "",
    });

    expect(header).toContain("#define SOLARTANK_ENABLE_REQUEST_SIGNING 1");
    expect(header).toContain(
      '#define SOLARTANK_TLS_CA_CERT "-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----"',
    );
    expect(header).toContain('#define SOLARTANK_TLS_CERT_FINGERPRINT ""');

    const unsignedHeader = renderDeviceConfigHeader({
      appBaseUrl: "https://solartank.example.com",
      deviceKey: "stk_test_device_key",
      request: DEVICE_REQUEST,
      signingEnabled: false,
    });

    expect(unsignedHeader).toContain("#define SOLARTANK_ENABLE_REQUEST_SIGNING 0");
  });

  it("creates a firmware zip bundle with config, readme, and manifest files", async () => {
    const bundle = await createFirmwarePackageBundle({
      appBaseUrl: "https://solartank.example.com",
      deviceKey: "stk_test_device_key",
      firmwareTemplate: FIRMWARE_TEMPLATE,
      hardwareProfile: HARDWARE_PROFILE,
      request: DEVICE_REQUEST,
    });

    expect(bundle.filename).toMatch(/^solartank-device-tph-main-\d{8}\.zip$/);
    expect(bundle.zipBuffer.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(bundle.files.map((file) => file.path)).toEqual([
      "solar_tank_firmware.ino",
      "device_config.h",
      "hardware_profile.h",
      "README_UPLOAD_STEPS.md",
      "manifest.json",
    ]);
    expect(bundle.files.every((file) => file.content.length > 0)).toBe(true);
    const manifestFile = bundle.files.find(
      (file) => file.path === "manifest.json",
    );
    const manifest = JSON.parse(
      manifestFile?.content.toString("utf8") ?? "{}",
    ) as {
      siteRegional?: string;
      siteWilayah?: string;
      siteLocation?: { area?: string };
    };
    expect(manifest).toMatchObject({
      siteRegional: "TREG 5",
      siteWilayah: "TIF 3",
      siteLocation: { area: "Pasuruan" },
    });
    expect(
      bundle.files
        .find((file) => file.path === "solar_tank_firmware.ino")
        ?.content.toString("utf8"),
    ).toContain("POST OK");
    expect(
      bundle.files
        .find((file) => file.path === "README_UPLOAD_STEPS.md")
        ?.content.toString("utf8"),
    ).toContain("SOLARTANK_WIFI_SSID");
  });

  it("encrypts and decrypts firmware package buffers with AES-GCM", () => {
    const payload = Buffer.from("firmware-package");
    const encrypted = encryptFirmwarePackage(payload);

    expect(encrypted.ciphertext.equals(payload)).toBe(false);
    expect(decryptFirmwarePackage(encrypted).equals(payload)).toBe(true);
  });

  it("hashes download tokens before persistence", () => {
    const hash = hashDownloadToken("dpt_example");

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hash).not.toContain("dpt_example");
  });
});
