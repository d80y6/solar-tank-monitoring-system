import type { RowDataPacket } from "mysql2/promise";

import {
  canLogOtpInDevelopment,
  getAppBaseUrl,
  getCaptchaProvider,
  getCaptchaSecretKey,
  getRequiredAuthSecret,
  getTelegramBotToken,
  getTelegramBotUsername,
  getTelegramWebhookSecret,
  isPasswordResetEnabled,
  isProductionLikeEnvironment,
  shouldRequireAdminOtp,
  shouldRequireEmailVerificationForApproval,
} from "../../auth/lib/auth-config";
import {
  getExpectedProvisioningKey,
  isDeviceAutoProvisioningEnabled,
} from "./device-provisioning";
import { isGlobalDeviceKeyFallbackAllowed } from "./device-key";
import { getDevicePackageEncryptionKey } from "./firmware-package";
import { checkMysqlConnection, getMysqlPool } from "./mysql-connection";
import {
  checkMonitoringLocationTaxonomySchemaFromMysql,
  countMonitoringReferenceRowsFromMysql,
} from "./mysql-reference-repository";
import { checkMonitoringReadingStorageSchemaFromMysql } from "./mysql-reading-repository";
import {
  getMonitoringStorageDriver,
  type MonitoringStorageDriver,
} from "./monitoring-storage";

const SERVICE_NAME = "solar-tank-monitoring-system";

export type DeploymentCheckStatus = "ok" | "degraded" | "error";
export type DeploymentReadinessStatus = "ready" | "degraded" | "not_ready";

export type DeploymentHealth = {
  status: "ok";
  service: string;
  timestamp: string;
};

export type DeploymentCheck = {
  name: string;
  ok: boolean;
  status: DeploymentCheckStatus;
  message: string;
  latencyMs?: number;
};

export type DeploymentReadiness = {
  ok: boolean;
  status: DeploymentReadinessStatus;
  service: string;
  timestamp: string;
  appEnv: string;
  nodeEnv: string;
  storageDriver: MonitoringStorageDriver;
  checks: DeploymentCheck[];
};

function getAppEnv(): string {
  return (
    process.env.NEXT_PUBLIC_APP_ENV?.trim() ||
    process.env.NODE_ENV ||
    "development"
  );
}

function getNodeEnv(): string {
  return process.env.NODE_ENV || "development";
}

function getElapsedMs(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs);
}

export function getDeploymentHealth(now = new Date()): DeploymentHealth {
  return {
    status: "ok",
    service: SERVICE_NAME,
    timestamp: now.toISOString(),
  };
}

async function checkStorageReadiness(
  storageDriver: MonitoringStorageDriver,
): Promise<DeploymentCheck> {
  if (storageDriver !== "mysql") {
    return {
      name: "memory-storage",
      ok: true,
      status: "degraded",
      message:
        "Memory storage is active. The app can run, but data is not permanent.",
    };
  }

  const startedAtMs = Date.now();

  try {
    await checkMysqlConnection();

    return {
      name: "mysql",
      ok: true,
      status: "ok",
      message: "MySQL connection active.",
      latencyMs: getElapsedMs(startedAtMs),
    };
  } catch {
    return {
      name: "mysql",
      ok: false,
      status: "error",
      message:
        "MySQL connection failed. Check MYSQL_DATABASE_URL, database status, SSL, network, and the provider allowlist.",
      latencyMs: getElapsedMs(startedAtMs),
    };
  }
}

async function checkReferenceRegistryReadiness(): Promise<DeploymentCheck> {
  const startedAtMs = Date.now();

  try {
    const counts = await countMonitoringReferenceRowsFromMysql();
    const ok = counts.sites > 0 && counts.tanks > 0 && counts.devices > 0;

    return {
      name: "mysql-reference-registry",
      ok,
      status: ok ? "ok" : "error",
      message: ok
        ? `MySQL registry active: ${counts.sites} sites, ${counts.tanks} tanks, ${counts.devices} devices.`
        : "MySQL registry is incomplete. Make sure the monitoring_sites, monitoring_tanks, and monitoring_devices seeds have been run.",
      latencyMs: getElapsedMs(startedAtMs),
    };
  } catch {
    return {
      name: "mysql-reference-registry",
      ok: false,
      status: "error",
      message:
        "MySQL registry check failed. Check migrations, reference tables, database user permissions, and MYSQL_DATABASE_URL.",
      latencyMs: getElapsedMs(startedAtMs),
    };
  }
}

async function checkReadingStorageSchemaReadiness(): Promise<DeploymentCheck> {
  const startedAtMs = Date.now();

  try {
    await checkMonitoringReadingStorageSchemaFromMysql();

    return {
      name: "mysql-reading-rollup",
      ok: true,
      status: "ok",
      message: "Live snapshots and 5-minute reading rollups are ready.",
      latencyMs: getElapsedMs(startedAtMs),
    };
  } catch {
    return {
      name: "mysql-reading-rollup",
      ok: false,
      status: "error",
      message:
        "Reading rollup schema is not ready. Run migration 007 before receiving MySQL telemetry.",
      latencyMs: getElapsedMs(startedAtMs),
    };
  }
}

async function checkLocationTaxonomySchemaReadiness(): Promise<DeploymentCheck> {
  const startedAtMs = Date.now();

  try {
    await checkMonitoringLocationTaxonomySchemaFromMysql();

    return {
      name: "mysql-location-taxonomy",
      ok: true,
      status: "ok",
      message: "Regional, territory, and area location taxonomy is ready.",
      latencyMs: getElapsedMs(startedAtMs),
    };
  } catch {
    return {
      name: "mysql-location-taxonomy",
      ok: false,
      status: "error",
      message:
        "Regional and territory structure is not ready. Run migration 009 before deploying the location dashboard.",
      latencyMs: getElapsedMs(startedAtMs),
    };
  }
}

async function checkAuthTelegramSchemaReadiness(): Promise<DeploymentCheck> {
  const startedAtMs = Date.now();

  try {
    const pool = getMysqlPool();
    const [rows] = await pool.execute<Array<RowDataPacket & { count: number }>>(
      `SELECT COUNT(*) AS count
         FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'auth_users'
          AND index_name = 'uniq_auth_users_telegram_chat_id'
          AND non_unique = 0
          AND column_name = 'telegram_chat_id'
          AND seq_in_index = 1`,
    );

    if (Number(rows[0]?.count ?? 0) !== 1) {
      throw new Error("Telegram binding unique index is not available.");
    }

    return {
      name: "mysql-auth-telegram",
      ok: true,
      status: "ok",
      message: "One-account-per-Telegram relation is ready.",
      latencyMs: getElapsedMs(startedAtMs),
    };
  } catch {
    return {
      name: "mysql-auth-telegram",
      ok: false,
      status: "error",
      message:
        "Telegram binding schema is not ready. Run migration 008 before enabling Telegram commands.",
      latencyMs: getElapsedMs(startedAtMs),
    };
  }
}

function hasSmtpConfig(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim() &&
      process.env.SMTP_FROM?.trim(),
  );
}

function checkAuthSecretReadiness(): DeploymentCheck {
  try {
    getRequiredAuthSecret();

    if (!process.env.AUTH_SECRET?.trim()) {
      return {
        name: "auth-secret",
        ok: true,
        status: "degraded",
        message:
          "AUTH_SECRET is not set. Development fallback is active and must not be used for production.",
      };
    }

    return {
      name: "auth-secret",
      ok: true,
      status: "ok",
      message: "AUTH_SECRET is active.",
    };
  } catch {
    return {
      name: "auth-secret",
      ok: false,
      status: "error",
      message: "AUTH_SECRET with at least 32 characters is required.",
    };
  }
}

function checkAppBaseUrlReadiness(): DeploymentCheck {
  try {
    const baseUrl = getAppBaseUrl();
    const url = new URL(baseUrl);
    const isLocalhost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1";

    if (isProductionLikeEnvironment() && isLocalhost) {
      return {
        name: "app-base-url",
        ok: false,
        status: "error",
        message:
          "Production APP_BASE_URL must not use localhost because it is used for email links.",
      };
    }

    return {
      name: "app-base-url",
      ok: true,
      status: isLocalhost ? "degraded" : "ok",
      message: isLocalhost
        ? "APP_BASE_URL still uses localhost. Fine for development, not for production."
        : "APP_BASE_URL is ready for email links.",
    };
  } catch {
    return {
      name: "app-base-url",
      ok: false,
      status: "error",
      message:
        "APP_BASE_URL must be set to a valid application URL for production.",
    };
  }
}

function checkAdminOtpReadiness(): DeploymentCheck {
  const productionLike = isProductionLikeEnvironment();

  if (!shouldRequireAdminOtp()) {
    return {
      name: "admin-otp",
      ok: !productionLike,
      status: productionLike ? "error" : "degraded",
      message: productionLike
        ? "Admin OTP must not be disabled in production."
        : "Admin OTP is disabled. Enable it before production.",
    };
  }

  if (hasSmtpConfig()) {
    return {
      name: "admin-otp",
      ok: true,
      status: "ok",
      message: "Admin OTP active with SMTP.",
    };
  }

  if (canLogOtpInDevelopment()) {
    return {
      name: "admin-otp",
      ok: true,
      status: "degraded",
      message:
        "SMTP is not set. Admin OTP is only printed to the development log.",
    };
  }

  return {
    name: "admin-otp",
    ok: false,
    status: "error",
    message: "SMTP must be set when admin OTP is enabled.",
  };
}

function checkAuthEmailFlowReadiness(): DeploymentCheck {
  const needsEmail =
    shouldRequireAdminOtp() ||
    isPasswordResetEnabled() ||
    shouldRequireEmailVerificationForApproval();

  if (!needsEmail) {
    return {
      name: "auth-email-flow",
      ok: !isProductionLikeEnvironment(),
      status: isProductionLikeEnvironment() ? "error" : "degraded",
      message:
        "All auth email flows are currently optional. This is not recommended for production.",
    };
  }

  if (hasSmtpConfig()) {
    return {
      name: "auth-email-flow",
      ok: true,
      status: "ok",
      message: "SMTP is ready for OTP, email verification, and password reset.",
    };
  }

  if (canLogOtpInDevelopment()) {
    return {
      name: "auth-email-flow",
      ok: true,
      status: "degraded",
      message:
        "SMTP is not set. Auth emails are only printed to the development log.",
    };
  }

  return {
    name: "auth-email-flow",
    ok: false,
    status: "error",
    message:
      "SMTP must be set for OTP, email verification, and password reset.",
  };
}

function checkCaptchaReadiness(): DeploymentCheck {
  const provider = getCaptchaProvider();

  if (provider === "invalid") {
    return {
      name: "auth-captcha",
      ok: false,
      status: "error",
      message:
        "AUTH_CAPTCHA_PROVIDER is not recognized. Use disabled or turnstile.",
    };
  }

  if (provider === "disabled") {
    return {
      name: "auth-captcha",
      ok: !isProductionLikeEnvironment(),
      status: isProductionLikeEnvironment() ? "error" : "degraded",
      message:
        "Public form CAPTCHA is disabled. Enable Turnstile before production.",
    };
  }

  if (!getCaptchaSecretKey() || !process.env.NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY) {
    return {
      name: "auth-captcha",
      ok: false,
      status: "error",
      message:
        "Turnstile is active but the CAPTCHA site key or secret key is incomplete.",
    };
  }

  return {
    name: "auth-captcha",
    ok: true,
    status: "ok",
    message: "Turnstile CAPTCHA active for public forms.",
  };
}

function checkTelegramReadiness(): DeploymentCheck {
  const hasTelegram =
    getTelegramBotToken() && getTelegramWebhookSecret() && getTelegramBotUsername();

  if (hasTelegram) {
    return {
      name: "auth-telegram",
      ok: true,
      status: "ok",
      message: "Telegram bot is ready for account binding.",
    };
  }

  return {
    name: "auth-telegram",
    ok: true,
    status: "degraded",
    message:
      "Telegram bot is incomplete. The system keeps running with email as the primary channel.",
  };
}

function checkDeviceKeyPolicyReadiness(): DeploymentCheck {
  const productionLike = isProductionLikeEnvironment();

  if (isGlobalDeviceKeyFallbackAllowed()) {
    return {
      name: "device-key-policy",
      ok: !productionLike,
      status: productionLike ? "error" : "degraded",
      message: productionLike
        ? "Global device key fallback must be disabled in production."
        : "Global device key fallback is active for development.",
    };
  }

  return {
    name: "device-key-policy",
    ok: true,
    status: "ok",
    message: "Global device key fallback is disabled.",
  };
}

function checkAutoProvisioningReadiness(): DeploymentCheck {
  if (!isDeviceAutoProvisioningEnabled()) {
    return {
      name: "device-auto-provisioning",
      ok: true,
      status: "ok",
      message: "Device auto provisioning is disabled.",
    };
  }

  if (!getExpectedProvisioningKey()) {
    return {
      name: "device-auto-provisioning",
      ok: false,
      status: "error",
      message:
        "Auto provisioning is active but SOLAR_TANK_DEVICE_PROVISIONING_KEY is not set.",
    };
  }

  return {
    name: "device-auto-provisioning",
    ok: true,
    status: "degraded",
    message:
      "Device auto provisioning is active. Use it only when onboarding new devices.",
  };
}

function checkDevicePackageEncryptionReadiness(): DeploymentCheck {
  try {
    getDevicePackageEncryptionKey();

    if (!process.env.DEVICE_PACKAGE_ENCRYPTION_KEY?.trim()) {
      return {
        name: "device-package-encryption",
        ok: true,
        status: "degraded",
        message:
          "DEVICE_PACKAGE_ENCRYPTION_KEY is not set. Development fallback is active and must not be used for production.",
      };
    }

    return {
      name: "device-package-encryption",
      ok: true,
      status: "ok",
      message: "DEVICE_PACKAGE_ENCRYPTION_KEY is active for firmware packages.",
    };
  } catch {
    return {
      name: "device-package-encryption",
      ok: false,
      status: "error",
      message:
        "DEVICE_PACKAGE_ENCRYPTION_KEY must be valid for production and must be a 32-byte base64/base64url/hex key.",
    };
  }
}

function checkDatabaseBackupReadiness(
  storageDriver: MonitoringStorageDriver,
): DeploymentCheck {
  if (storageDriver !== "mysql") {
    return {
      name: "database-backup",
      ok: true,
      status: "degraded",
      message:
        "MySQL backup is not relevant yet because memory storage is active. Use mysql storage for permanent data.",
    };
  }

  const outputDir = process.env.MYSQL_BACKUP_OUTPUT_DIR?.trim();
  const retentionDays = process.env.MYSQL_BACKUP_RETENTION_DAYS?.trim();

  if (!outputDir) {
    return {
      name: "database-backup",
      ok: !isProductionLikeEnvironment(),
      status: isProductionLikeEnvironment() ? "error" : "degraded",
      message:
        "MYSQL_BACKUP_OUTPUT_DIR is not set. Choose a backup folder before production.",
    };
  }

  if (
    retentionDays &&
    (!Number.isFinite(Number(retentionDays)) || Number(retentionDays) < 0)
  ) {
    return {
      name: "database-backup",
      ok: false,
      status: "error",
      message: "MYSQL_BACKUP_RETENTION_DAYS must be 0 or greater.",
    };
  }

  return {
    name: "database-backup",
    ok: true,
    status: "ok",
    message:
      "MySQL backup target is configured. Schedule pnpm db:backup:mysql and test restores regularly.",
  };
}

export async function getDeploymentReadiness(
  now = new Date(),
): Promise<DeploymentReadiness> {
  const storageDriver = getMonitoringStorageDriver();
  const storageCheck = await checkStorageReadiness(storageDriver);
  const checks = [
    storageCheck,
    checkAuthSecretReadiness(),
    checkAppBaseUrlReadiness(),
    checkAdminOtpReadiness(),
    checkAuthEmailFlowReadiness(),
    checkCaptchaReadiness(),
    checkTelegramReadiness(),
    checkDeviceKeyPolicyReadiness(),
    checkAutoProvisioningReadiness(),
    checkDevicePackageEncryptionReadiness(),
    checkDatabaseBackupReadiness(storageDriver),
  ];

  if (storageDriver === "mysql" && storageCheck.ok) {
    const [
      registryCheck,
      readingRollupCheck,
      authTelegramCheck,
      locationTaxonomyCheck,
    ] =
      await Promise.all([
        checkReferenceRegistryReadiness(),
        checkReadingStorageSchemaReadiness(),
        checkAuthTelegramSchemaReadiness(),
        checkLocationTaxonomySchemaReadiness(),
      ]);
    checks.push(
      registryCheck,
      readingRollupCheck,
      authTelegramCheck,
      locationTaxonomyCheck,
    );
  }

  const hasError = checks.some((check) => !check.ok);
  const hasDegraded = checks.some((check) => check.status === "degraded");

  return {
    ok: !hasError,
    status: hasError ? "not_ready" : hasDegraded ? "degraded" : "ready",
    service: SERVICE_NAME,
    timestamp: now.toISOString(),
    appEnv: getAppEnv(),
    nodeEnv: getNodeEnv(),
    storageDriver,
    checks,
  };
}
