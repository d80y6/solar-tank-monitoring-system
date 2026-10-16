import { describe, expect, it } from "vitest";

import {
  rowToDeviceRequest,
  rowToFirmwarePackage,
  rowToFirmwareTemplate,
  rowToHardwareProfile,
} from "../lib/mysql-device-request-repository";

describe("mysql device request repository mappers", () => {
  it("maps firmware template rows into safe domain objects", () => {
    const template = rowToFirmwareTemplate({
      id: "firmware-template-1",
      template_key: "solartank-template",
      version: "v1",
      display_name: "SolarTank Template",
      source_path: "firmware/templates/solartank-template",
      checksum_sha256: null,
      is_active: 1,
    } as Parameters<typeof rowToFirmwareTemplate>[0]);

    expect(template).toMatchObject({
      id: "firmware-template-1",
      templateKey: "solartank-template",
      isActive: true,
    });
  });

  it("maps hardware profile rows and keeps unknown board families explicit", () => {
    const profile = rowToHardwareProfile({
      id: "hardware-profile-1",
      code: "nodemcu-hcsr04",
      name: "NodeMCU HC-SR04",
      board_family: "custom-board",
      board_label: "Custom Board",
      sensor_type: "HC-SR04",
      trigger_pin: "D5",
      echo_pin: "D6",
      supported_tank_shape: "rectangular",
      firmware_template_id: "firmware-template-1",
      report_interval_ms: "20000",
      is_active: true,
    } as Parameters<typeof rowToHardwareProfile>[0]);

    expect(profile).toMatchObject({
      boardFamily: "unknown",
      reportIntervalMs: 20000,
      supportedTankShape: "rectangular",
    });
  });

  it("maps device request rows with JSON validation warnings and UTC timestamps", () => {
    const request = rowToDeviceRequest({
      id: "device-request-1",
      request_code: "REQ-TPH-20260705-ABC123",
      requester_user_id: "user-1",
      requester_email: "user@example.com",
      status: "approved_waiting_package",
      site_code: "TPH",
      site_name: "STO TPH",
      regional_label: "TREG 5",
      wilayah_label: "TIF 3",
      area_label: "Pasuruan",
      latitude: "-7.7200",
      longitude: "112.8800",
      device_code: "device-tph-main",
      device_label: "NodeMCU TPH",
      device_sensor_type: "fuel",
      tank_shape: "rectangular",
      capacity_liter: "540.00",
      length_cm: "150.00",
      width_cm: "60.00",
      height_cm: "60.00",
      diameter_cm: null,
      sensor_mount_height_cm: "60.00",
      load_value: "20.00",
      load_unit: "kw",
      diesel_engine_capacity_kva: "40.00",
      cos_phi: "0.800",
      low_level_percent: "30.00",
      critical_level_percent: "15.00",
      consumption_liter_per_hour: "25.00",
      hardware_profile_id: "hardware-profile-1",
      firmware_template_id: "firmware-template-1",
      admin_reviewed_by_user_id: "admin-1",
      admin_reviewed_at: "2026-07-05 03:20:00.000",
      rejection_reason: null,
      validation_warnings_json: JSON.stringify([
        {
          field: "capacityLiter",
          message: "Capacity needs review.",
          severity: "warning",
        },
      ]),
      created_at: "2026-07-05 03:10:00.000",
      updated_at: "2026-07-05 03:20:00.000",
    } as Parameters<typeof rowToDeviceRequest>[0]);

    expect(request).toMatchObject({
      requestCode: "REQ-TPH-20260705-ABC123",
      status: "approved_waiting_package",
      regionalLabel: "TREG 5",
      wilayahLabel: "TIF 3",
      latitude: -7.72,
      longitude: 112.88,
      capacityLiter: 540,
      deviceSensorType: "fuel",
      loadValue: 20,
      loadUnit: "kw",
      dieselEngineCapacityKva: 40,
      cosPhi: 0.8,
      validationWarnings: [
        {
          field: "capacityLiter",
          message: "Capacity needs review.",
          severity: "warning",
        },
      ],
      createdAt: "2026-07-05T03:10:00.000Z",
    });
  });

  it("maps firmware package rows without exposing encrypted content", () => {
    const firmwarePackage = rowToFirmwarePackage({
      activated_at: null,
      content_type: "application/zip",
      device_id: "device-device-tph-main",
      device_key_hash: "sha256:device-key-hash",
      download_count: "1",
      download_expires_at: "2026-07-12 03:20:00.000",
      download_token_hash: "sha256:download-token-hash",
      firmware_template_id: "firmware-template-1",
      first_downloaded_at: "2026-07-05 04:20:00.000",
      generated_at: "2026-07-05 03:20:00.000",
      hardware_profile_id: "hardware-profile-1",
      id: "device-package-1",
      max_download_count: "3",
      package_auth_tag: Buffer.from("tag"),
      package_checksum_sha256: "checksum",
      package_ciphertext: Buffer.from("ciphertext"),
      package_filename: "solartank-device-tph-main-20260705.zip",
      package_iv: Buffer.from("iv"),
      package_size_bytes: "2048",
      package_status: "downloaded",
      request_id: "device-request-1",
      revoked_at: null,
    } as Parameters<typeof rowToFirmwarePackage>[0]);

    expect(firmwarePackage).toMatchObject({
      deviceId: "device-device-tph-main",
      downloadCount: 1,
      downloadExpiresAt: "2026-07-12T03:20:00.000Z",
      firstDownloadedAt: "2026-07-05T04:20:00.000Z",
      packageFilename: "solartank-device-tph-main-20260705.zip",
      packageSizeBytes: 2048,
      packageStatus: "downloaded",
    });
  });
});
