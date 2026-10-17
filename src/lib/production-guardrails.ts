import { isGlobalDeviceKeyFallbackAllowed } from "@/features/monitoring/lib/device-key";
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
  AUTH_CAPTCHA_PROVIDER?: string;
  AUTH_CAPTCHA_SECRET_KEY?: string;
  AUTH_REQUIRE_ADMIN_OTP?: string;
  AUTH_SECRET?: string;
  AUTH_COOKIE_SECURE?: string;
  DEVICE_PACKAGE_ENCRYPTION_KEY?: string;
  INGEST_SIGNATURE_MODE?: string;
  MYSQL_BACKUP_ENCRYPTION_KEY?: string;
  MYSQL_SSL_MODE?: string;
  NODE_ENV?: string;
  OPS_CRON_SECRET?: string;
  SMTP_FROM?: string;
  SMTP_HOST?: string;
  SMTP_PASS?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
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

  // The runtime treats an unset variable as "fallback allowed", so the guardrail
  // must too: a deployment that simply forgets to set it is the dangerous case.
  if (isGlobalDeviceKeyFallbackAllowed(env.SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK)) {
    findings.push({
      key: "global-device-key-fallback",
      message:
        "The shared development device key is still accepted because SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK is not set to \"false\". Any device that knows it can post telemetry as any device id.",
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

  // Same reasoning: the connection code only enables TLS for exactly "required",
  // so an unset or misspelled value silently downgrades to plaintext.
  const sslMode = env.MYSQL_SSL_MODE?.trim().toLowerCase();

  if (sslMode !== "required") {
    findings.push({
      key: "mysql-ssl",
      message: sslMode
        ? `MYSQL_SSL_MODE is "${env.MYSQL_SSL_MODE}": only "required" enables TLS, so database traffic is currently sent unencrypted.`
        : 'MYSQL_SSL_MODE is not set: database traffic is sent unencrypted. Set it to "required" in production.',
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

  // Environments that contradict each other. An OTP factor without a mail
  // transport locks administrators out, and a CAPTCHA provider without a secret
  // rejects every public registration.
  if (isEnabled(env.AUTH_REQUIRE_ADMIN_OTP) && !isSmtpConfigured(env)) {
    findings.push({
      key: "smtp-for-admin-otp",
      message:
        "AUTH_REQUIRE_ADMIN_OTP is enabled but SMTP_HOST and SMTP_FROM are not both set: the OTP e-mail cannot be delivered, so administrators cannot sign in.",
      severity: "fatal",
    });
  }

  const captchaProvider = env.AUTH_CAPTCHA_PROVIDER?.trim().toLowerCase();

  if (captchaProvider === "turnstile" && !env.AUTH_CAPTCHA_SECRET_KEY?.trim()) {
    findings.push({
      key: "captcha-secret",
      message:
        "AUTH_CAPTCHA_PROVIDER is \"turnstile\" but AUTH_CAPTCHA_SECRET_KEY is empty: every public account request would be rejected because the challenge cannot be verified.",
      severity: "fatal",
    });
  }

  if (
    captchaProvider &&
    captchaProvider !== "disabled" &&
    captchaProvider !== "turnstile"
  ) {
    findings.push({
      key: "captcha-provider",
      message: `AUTH_CAPTCHA_PROVIDER is "${env.AUTH_CAPTCHA_PROVIDER}": only "disabled" and "turnstile" are supported, so account protection would fail closed.`,
      severity: "fatal",
    });
  }

  const cookieSecure = env.AUTH_COOKIE_SECURE?.trim().toLowerCase();

  if (cookieSecure === "false") {
    findings.push({
      key: "cookie-secure",
      message:
        "AUTH_COOKIE_SECURE is explicitly \"false\": session cookies would be sent over plain HTTP. Remove the variable or set it to \"true\" behind HTTPS.",
      severity: "fatal",
    });
  }

  return findings;
}

export function isSmtpConfigured(
  env: Pick<GuardrailEnvironment, "SMTP_FROM" | "SMTP_HOST"> = process.env as Pick<
    GuardrailEnvironment,
    "SMTP_FROM" | "SMTP_HOST"
  >,
): boolean {
  return Boolean(env.SMTP_HOST?.trim() && env.SMTP_FROM?.trim());
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
