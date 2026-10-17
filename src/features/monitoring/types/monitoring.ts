export type TankShape = "horizontal-cylinder" | "rectangular";

export type DeviceSensorType = "energy" | "fuel";

export type LoadPowerUnit = "kva" | "kw";

export type DeviceRequestStatus =
  | "pending_admin_review"
  | "rejected"
  | "approved_waiting_package"
  | "approved_package_ready"
  | "waiting_firmware_download"
  | "waiting_first_valid_ping"
  | "active"
  | "expired"
  | "revoked"
  | "package_generation_failed";

export type FirmwarePackageStatus =
  | "ready"
  | "downloaded"
  | "expired"
  | "revoked"
  | "activated"
  | "failed";

export type HardwareBoardFamily = "esp8266" | "esp32" | "unknown";

export type HardwareTankShapeSupport = TankShape | "any";

export type DeviceRequestValidationSeverity = "error" | "warning";

export type DeviceRequestValidationIssue = {
  field: string;
  message: string;
  severity: DeviceRequestValidationSeverity;
};

export type MonitoringFirmwareTemplate = {
  id: string;
  templateKey: string;
  version: string;
  displayName: string;
  sourcePath: string;
  checksumSha256?: string | null;
  isActive: boolean;
};

export type MonitoringHardwareProfile = {
  id: string;
  code: string;
  name: string;
  boardFamily: HardwareBoardFamily;
  boardLabel: string;
  sensorType: string;
  triggerPin: string;
  echoPin: string;
  supportedTankShape: HardwareTankShapeSupport;
  firmwareTemplateId: string;
  reportIntervalMs: number;
  isActive: boolean;
};

export type DeviceRequestDraft = {
  siteCode?: string | null;
  siteName: string;
  areaLabel: string;
  regionalLabel?: string | null;
  wilayahLabel?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  deviceCode?: string | null;
  deviceLabel?: string | null;
  deviceSensorType: DeviceSensorType;
  tankShape: TankShape;
  capacityLiter?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  diameterCm?: number | null;
  sensorMountHeightCm?: number | null;
  loadValue: number;
  loadUnit: LoadPowerUnit;
  dieselEngineCapacityKva: number;
  cosPhi: number;
  lowLevelPercent?: number | null;
  criticalLevelPercent?: number | null;
  consumptionLiterPerHour?: number | null;
  hardwareProfileId: string;
};

export type NormalizedDeviceRequestDraft = {
  siteCode: string;
  siteName: string;
  areaLabel: string;
  regionalLabel: string;
  wilayahLabel: string;
  deviceCode: string;
  deviceSensorType: DeviceSensorType;
  tankShape: TankShape;
  capacityLiter: number;
  sensorMountHeightCm: number;
  loadValue: number;
  loadUnit: LoadPowerUnit;
  dieselEngineCapacityKva: number;
  cosPhi: number;
  lowLevelPercent: number;
  criticalLevelPercent: number;
  consumptionLiterPerHour: number;
  hardwareProfileId: string;
  latitude?: number;
  longitude?: number;
  deviceLabel: string;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  diameterCm?: number;
};

export type DeviceRequestCapacityCheck = {
  calculatedCapacityLiter: number | null;
  declaredCapacityLiter: number;
  differenceLiter: number | null;
  differencePercent: number | null;
  isConsistent: boolean;
};

export type MonitoringDeviceRequest = NormalizedDeviceRequestDraft & {
  id: string;
  requestCode: string;
  requesterUserId: string;
  requesterEmail: string;
  status: DeviceRequestStatus;
  firmwareTemplateId: string;
  adminReviewedByUserId?: string | null;
  adminReviewedAt?: string | null;
  rejectionReason?: string | null;
  validationWarnings: DeviceRequestValidationIssue[];
  createdAt: string;
  updatedAt: string;
};

export type MonitoringFirmwarePackage = {
  id: string;
  requestId: string;
  deviceId?: string | null;
  packageStatus: FirmwarePackageStatus;
  deviceKeyHash: string;
  downloadTokenHash: string;
  downloadExpiresAt: string;
  downloadCount: number;
  maxDownloadCount: number;
  packageFilename: string;
  packageSizeBytes: number;
  packageChecksumSha256?: string | null;
  firmwareTemplateId: string;
  hardwareProfileId: string;
  generatedAt: string;
  firstDownloadedAt?: string | null;
  activatedAt?: string | null;
  revokedAt?: string | null;
};

export type RuntimeStatus =
  | "unknown"
  | "critical"
  | "warning"
  | "limited"
  | "safe";

export type LevelStatus = "critical" | "low" | "warning" | "safe";

export type DeviceStatus = "unknown" | "online" | "delayed" | "offline";

export type OperationalStatus = "critical" | "warning" | "safe";

export type ReadingValueSource = "device" | "backend" | "server" | "unknown";

export type ReadingResolution = "raw" | "5m" | "latest";

export type TankConfigSource = "registry" | "payload" | "mixed";

export type TankConfigStatus =
  | "normal"
  | "minor_config_difference"
  | "config_mismatch"
  | "invalid_config"
  | "needs_review";

export type TankConfigIssueSeverity = "info" | "warning" | "mismatch" | "invalid";

export type Site = {
  id: string;
  code: string;
  name: string;
  areaLabel: string;
  regionalLabel?: string;
  wilayahLabel?: string;
  latitude?: number;
  longitude?: number;
  isActive: boolean;
};

export type Tank = {
  id: string;
  siteId: string;
  name: string;
  shape: TankShape;
  capacityLiter: number;
  diameterCm?: number;
  lengthCm?: number;
  heightCm?: number;
  widthCm?: number;
  sensorMountHeightCm: number;
  lowLevelPercent: number;
  criticalLevelPercent: number;
  consumptionLiterPerHour: number;
  isActive: boolean;
};

export type TankConfigSnapshot = {
  shape?: TankShape;
  capacityLiter?: number;
  diameterCm?: number;
  lengthCm?: number;
  heightCm?: number;
  widthCm?: number;
  sensorMountHeightCm?: number;
  lowLevelPercent?: number;
  criticalLevelPercent?: number;
  consumptionLiterPerHour?: number;
};

export type TankConfigIssue = {
  field: keyof TankConfigSnapshot | "shape_raw";
  label: string;
  severity: TankConfigIssueSeverity;
  registryValue: string;
  payloadValue: string;
  message: string;
};

export type TankConfigReview = {
  status: TankConfigStatus;
  configSource: TankConfigSource;
  needsReview: boolean;
  summaryLabel: string;
  reasons: string[];
  issues: TankConfigIssue[];
  registryTankConfig: TankConfigSnapshot;
  payloadTankConfig: TankConfigSnapshot | null;
  appliedTankConfig: TankConfigSnapshot;
};

export type ReadingQuality = {
  measuredAtSource: ReadingValueSource;
  fuelHeightSource: ReadingValueSource;
  volumeSource: ReadingValueSource;
  fillPercentSource: ReadingValueSource;
  runtimeSource: ReadingValueSource;
  configSource: TankConfigSource;
  configStatus: TankConfigStatus;
  needsReview: boolean;
  warnings: string[];
  configMismatchReasons: string[];
};

export type Device = {
  id: string;
  siteId: string;
  tankId: string;
  code: string;
  label: string;
  expectedReportIntervalSec: number;
  apiKeyHash?: string | null;
  isActive: boolean;
  /** Monotonic key version, incremented on every rotation. */
  keyVersion?: number;
  /** Previous key hash, accepted only until the grace window closes. */
  previousApiKeyHash?: string | null;
  previousKeyValidUntil?: string | null;
  keyRotatedAt?: string | null;
  /** Last telemetry received, maintained by the ingest path. */
  lastSeenAt?: string | null;
};

export type Reading = {
  id: string;
  deviceId: string;
  tankId: string;
  measuredAt: string;
  receivedAt: string;
  sensorDistanceCm: number;
  fuelHeightCm: number;
  volumeLiter: number;
  fillPercent: number;
  runtimeHour: number;
  batteryVolt?: number;
  rssiDbm?: number;
  resolution?: ReadingResolution;
  bucketStart?: string;
  bucketEnd?: string;
  sampleCount?: number;
  volumeLiterMin?: number;
  volumeLiterMax?: number;
  fillPercentMin?: number;
  fillPercentMax?: number;
  rawPayload?: unknown;
  quality?: ReadingQuality;
};

export type CatTelemetryPayload = {
  [key: string]: unknown;
  device?: unknown;
  device_id?: unknown;
  measuredAt?: unknown;
  measured_at?: unknown;
  ts?: unknown;
  ts_iso?: unknown;
  tank_shape?: unknown;
  shape?: unknown;
  capacity_liter?: unknown;
  capacityLiter?: unknown;
  length_cm?: unknown;
  lengthCm?: unknown;
  width_cm?: unknown;
  widthCm?: unknown;
  height_cm?: unknown;
  heightCm?: unknown;
  diameter_cm?: unknown;
  diameterCm?: unknown;
  sensor_mount_height_cm?: unknown;
  sensorMountHeightCm?: unknown;
  low_level_percent?: unknown;
  lowLevelPercent?: unknown;
  critical_level_percent?: unknown;
  criticalLevelPercent?: unknown;
  consumption_liter_per_hour?: unknown;
  consumptionLiterPerHour?: unknown;
  distance?: unknown;
  distance_cm?: unknown;
  dist?: unknown;
  dist_cm?: unknown;
  voltage?: unknown;
  vbatt?: unknown;
  vbat?: unknown;
  h_cm?: unknown;
  H_cm?: unknown;
  local_H_cm?: unknown;
  volume?: unknown;
  volume_l?: unknown;
  volume_liter?: unknown;
  local_volume_l?: unknown;
  percent?: unknown;
  fill_percent?: unknown;
  local_percent?: unknown;
  rssi?: unknown;
  wifi_rssi?: unknown;
  ip?: unknown;
  lat?: unknown;
  lng?: unknown;
  site_code?: unknown;
  site_name?: unknown;
  area_label?: unknown;
  areaLabel?: unknown;
  regional_label?: unknown;
  regionalLabel?: unknown;
  wilayah_label?: unknown;
  wilayahLabel?: unknown;
  device_label?: unknown;
  expected_report_interval_sec?: unknown;
  tank?: Record<string, unknown> | null;
  site?: Record<string, unknown> | null;
  local_result?: Record<string, unknown> | null;
  raw?: Record<string, unknown> | null;
};

export type NormalizeReadingInput = {
  payload: CatTelemetryPayload;
  tank: Tank;
  fallbackDeviceId?: string;
  receivedAt?: Date;
  readingId?: string;
};
