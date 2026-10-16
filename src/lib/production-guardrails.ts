import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";

import { createLogger } from "./logger";

/**
 * Production guardrails.
 *
 * A misconfigured production deployment must fail loudly at boot instead of
 * quietly running in an unsafe mode. The checks below are the ones where a
 * wrong value removes a security control rather than merely degrading a
 * feature: memory storage instead of MySQL, the shared development device key,
 * a missing auth secret, unencrypted firmware packages, and unsigned telemetry.
 *
 * Readiness (`/api/ready`) still reports the same facts for operators; these
 * guardrails are the last line of defence that stops the process from starting.
 */

const log = createLogger({ module: "guardrails" });

export type GuardrailSeverity = "fatal" | "warning";

export type GuardrailFinding = {
  key: string;
  severity: GuardrailSeverity;
  message: string;
};

export type GuardrailEnvironment = {
  APP_ENV?: string;
  AUTH_REQUIRE_ADMIN_OTP?: string;
  AUTH_SECRET?: string;
  DEVICE_PACKAGE_ENCRYPTION_KEY?: string;
  INGEST_SIGNATURE_MODE?: string;
  MYSQL_BACKUP_ENCRYPTION_KEY?: string;
  MYSQL_SSL_MODE?: string;
  NODE_ENV?: string;
  OPS_CRON_SECRET?: string;
  READINESS_CHECK_TOKEN?: string;
  SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK?: string;
  SOLAR_TANK_STORAGE_DRIVER?: string;
  VERCEL_ENV?: string;
};

function isEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  return normalized === "true" || normalized === "1" || normalized === "on";
}

/**
 * Production-like means "a real deployment": either NODE_ENV=production, or a
 * Vercel production deployment, or an explicit APP_ENV. Local development and
 * preview deployments keep their lenient behaviour on purpose.
 */
export function isProductionLikeDeployment(
  env: GuardrailEnvironment = process.env,
): boolean {
  const appEnv = env.APP_ENV?.trim().toLowerCase();
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();

  if (appEnv === "production" || vercelEnv === "production") {
    return true;
  }

  if (appEnv === "development" || vercelEnv === "preview") {
    return false;
  }

  return env.NODE_ENV?.trim().toLowerCase() === "production";
}

export function evaluateProductionGuardrails(
  env: GuardrailEnvironment = process.env,
): GuardrailFinding[] {
  if (!isProductionLikeDeployment(env)) {
    return [];
  }

  const findings: GuardrailFinding[] = [];
  const storageDriver = getMonitoringStorageDriver(env.SOLAR_TANK_STORAGE_DRIVER);

  if (storageDriver !== "mysql") {
    findings.push({
      key: "storage-driver",
      message:
        "SOLAR_TANK_STORAGE_DRIVER must be \"mysql\" in production. Memory storage loses every reading on restart and must never be used for operational data.",
      severity: "fatal",
    });
  }

  if (isEnabled(env.SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK)) {
    findings.push({
      key: "global-device-key-fallback",
      message:
        "SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK must be disabled in production, otherwise any device that knows the shared development key can post telemetry as any device id.",
      severity: "fatal",
    });
  }

  const authSecret = env.AUTH_SECRET?.trim() ?? "";

  if (authSecret.length < 32) {
    findings.push({
      key: "auth-secret",
      message:
        "AUTH_SECRET must be set to at least 32 characters in production; it derives session and CSRF tokens.",
      severity: "fatal",
    });
  }

  if (!env.DEVICE_PACKAGE_ENCRYPTION_KEY?.trim()) {
    findings.push({
      key: "device-package-key",
      message:
        "DEVICE_PACKAGE_ENCRYPTION_KEY must be set in production; without it firmware packages cannot be created for approved device requests.",
      severity: "fatal",
    });
  }

  const signatureMode = env.INGEST_SIGNATURE_MODE?.trim().toLowerCase() ?? "off";

  if (signatureMode === "off") {
    findings.push({
      key: "ingest-signature",
      message:
        "INGEST_SIGNATURE_MODE is \"off\": telemetry is accepted on the device key alone, so a captured payload can be replayed. Deploy signed firmware, run in \"optional\" while the fleet migrates, then set \"required\".",
      severity: "warning",
    });
  }

  const sslMode = env.MYSQL_SSL_MODE?.trim().toLowerCase();

  if (sslMode && sslMode !== "required") {
    findings.push({
      key: "mysql-ssl",
      message:
        "MYSQL_SSL_MODE is not \"required\": database traffic is not forced over TLS. Use a TLS-enforcing provider setting in production.",
      severity: "warning",
    });
  }

  if (!isEnabled(env.AUTH_REQUIRE_ADMIN_OTP)) {
    findings.push({
      key: "admin-otp",
      message:
        "AUTH_REQUIRE_ADMIN_OTP is not enabled: an administrator password alone grants full access. Enable the e-mail OTP factor in production.",
      severity: "warning",
    });
  }

  if (!env.OPS_CRON_SECRET?.trim()) {
    findings.push({
      key: "ops-cron-secret",
      message:
        "OPS_CRON_SECRET is not set: the scheduled alert and housekeeping job cannot be triggered in production, so operational alerts would never run.",
      severity: "warning",
    });
  }

  if (!env.MYSQL_BACKUP_ENCRYPTION_KEY?.trim()) {
    findings.push({
      key: "backup-encryption",
      message:
        "MYSQL_BACKUP_ENCRYPTION_KEY is not set: database backups would be written as plain text.",
      severity: "warning",
    });
  }

  return findings;
}

export function formatGuardrailFinding(finding: GuardrailFinding): string {
  return `[${finding.severity}] ${finding.key}: ${finding.message}`;
}

export class ProductionGuardrailError extends Error {
  readonly findings: GuardrailFinding[];

  constructor(findings: GuardrailFinding[]) {
    super(
      [
        "Unsafe production configuration detected. The application refused to start:",
        ...findings.map((finding) => `- ${formatGuardrailFinding(finding)}`),
      ].join("\n"),
    );
    this.name = "ProductionGuardrailError";
    this.findings = findings;
  }
}

/**
 * Called once at boot from `instrumentation.ts`. Warnings are logged; fatal
 * findings throw so the deployment fails visibly instead of running unsafely.
 * Set `SOLAR_TANK_SKIP_BOOT_GUARDRAILS=true` only for a deliberate, temporary
 * override during an incident, and record why.
 */
export function assertProductionGuardrails(
  env: GuardrailEnvironment = process.env,
  { skip = isEnabled(process.env.SOLAR_TANK_SKIP_BOOT_GUARDRAILS) } = {},
): GuardrailFinding[] {
  const findings = evaluateProductionGuardrails(env);

  if (findings.length === 0) {
    return findings;
  }

  for (const finding of findings) {
    if (finding.severity === "fatal") {
      log.error("guardrails.fatal", { ...finding });
    } else {
      log.warn("guardrails.warning", { ...finding });
    }
  }

  const fatal = findings.filter((finding) => finding.severity === "fatal");

  if (fatal.length > 0 && !skip) {
    throw new ProductionGuardrailError(fatal);
  }

  if (fatal.length > 0 && skip) {
    log.error("guardrails.override", {
      findingKeys: fatal.map((finding) => finding.key).join(","),
    });
  }

  return findings;
}
