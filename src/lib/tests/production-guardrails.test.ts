import { describe, expect, it } from "vitest";

import {
  evaluateProductionGuardrails,
  formatGuardrailFinding,
  isProductionLikeDeployment,
  ProductionGuardrailError,
  assertProductionGuardrails,
  type GuardrailEnvironment,
} from "@/lib/production-guardrails";

const safeProductionEnv: GuardrailEnvironment = {
  APP_ENV: "production",
  AUTH_REQUIRE_ADMIN_OTP: "true",
  AUTH_SECRET: "a-secret-of-at-least-32-characters-long",
  DEVICE_PACKAGE_ENCRYPTION_KEY: "package-key",
  INGEST_SIGNATURE_MODE: "required",
  MYSQL_BACKUP_ENCRYPTION_KEY: "backup-key",
  MYSQL_SSL_MODE: "required",
  NODE_ENV: "production",
  OPS_CRON_SECRET: "cron-secret",
  SMTP_FROM: "FTM <noreply@example.com>",
  SMTP_HOST: "smtp.example.com",
  SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK: "false",
  SOLAR_TANK_STORAGE_DRIVER: "mysql",
};

function keys(findings: ReturnType<typeof evaluateProductionGuardrails>) {
  return findings.map((finding) => finding.key).sort();
}

describe("isProductionLikeDeployment", () => {
  it("detects production from NODE_ENV, APP_ENV, or Vercel", () => {
    expect(isProductionLikeDeployment({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionLikeDeployment({ APP_ENV: "production" })).toBe(true);
    expect(isProductionLikeDeployment({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("treats development, test, and preview as non-production", () => {
    expect(isProductionLikeDeployment({ NODE_ENV: "development" })).toBe(false);
    expect(isProductionLikeDeployment({ NODE_ENV: "test" })).toBe(false);
    expect(isProductionLikeDeployment({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isProductionLikeDeployment({ APP_ENV: "development" })).toBe(false);
    expect(isProductionLikeDeployment({})).toBe(false);
  });

  it("lets an explicit development APP_ENV override NODE_ENV", () => {
    expect(
      isProductionLikeDeployment({ APP_ENV: "development", NODE_ENV: "production" }),
    ).toBe(false);
  });
});

describe("evaluateProductionGuardrails", () => {
  it("reports nothing for a non-production environment", () => {
    expect(evaluateProductionGuardrails({ NODE_ENV: "development" })).toEqual([]);
  });

  it("accepts a fully configured production environment", () => {
    expect(evaluateProductionGuardrails(safeProductionEnv)).toEqual([]);
  });

  it("treats an unset or unspelled device-key fallback as fatal", () => {
    // An unset variable means the fallback is ACTIVE at runtime, so this is the
    // most likely way a deployment ends up accepting the shared dev key.
    const unset = evaluateProductionGuardrails({
      ...safeProductionEnv,
      SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK: undefined,
    });
    const misspelled = evaluateProductionGuardrails({
      ...safeProductionEnv,
      SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK: "flase",
    });
    const disabled = evaluateProductionGuardrails({
      ...safeProductionEnv,
      SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK: "false",
    });

    expect(keys(unset)).toContain("global-device-key-fallback");
    expect(keys(misspelled)).toContain("global-device-key-fallback");
    expect(keys(disabled)).not.toContain("global-device-key-fallback");
  });

  it("warns about unencrypted database traffic when TLS is not required", () => {
    expect(
      keys(
        evaluateProductionGuardrails({
          ...safeProductionEnv,
          MYSQL_SSL_MODE: undefined,
        }),
      ),
    ).toContain("mysql-ssl");
    expect(
      keys(
        evaluateProductionGuardrails({
          ...safeProductionEnv,
          MYSQL_SSL_MODE: "preferred",
        }),
      ),
    ).toContain("mysql-ssl");
    expect(keys(evaluateProductionGuardrails(safeProductionEnv))).not.toContain(
      "mysql-ssl",
    );
  });

  it("treats memory storage and the shared device key as fatal", () => {
    const findings = evaluateProductionGuardrails({
      ...safeProductionEnv,
      SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK: "true",
      SOLAR_TANK_STORAGE_DRIVER: "memory",
    });

    expect(keys(findings)).toEqual([
      "global-device-key-fallback",
      "storage-driver",
    ]);
    expect(findings.every((finding) => finding.severity === "fatal")).toBe(true);
  });

  it("refuses an OTP factor without a mail transport", () => {
    const findings = evaluateProductionGuardrails({
      ...safeProductionEnv,
      SMTP_FROM: undefined,
      SMTP_HOST: undefined,
    });

    expect(keys(findings)).toEqual(["smtp-for-admin-otp"]);
    expect(findings[0]?.severity).toBe("fatal");
  });

  it("refuses a CAPTCHA provider that cannot verify challenges", () => {
    expect(
      keys(
        evaluateProductionGuardrails({
          ...safeProductionEnv,
          AUTH_CAPTCHA_PROVIDER: "turnstile",
        }),
      ),
    ).toEqual(["captcha-secret"]);

    expect(
      keys(
        evaluateProductionGuardrails({
          ...safeProductionEnv,
          AUTH_CAPTCHA_PROVIDER: "recaptcha",
        }),
      ),
    ).toEqual(["captcha-provider"]);
  });

  it("accepts Turnstile and a disabled CAPTCHA when configured", () => {
    expect(
      evaluateProductionGuardrails({
        ...safeProductionEnv,
        AUTH_CAPTCHA_PROVIDER: "turnstile",
        AUTH_CAPTCHA_SECRET_KEY: "turnstile-secret",
      }),
    ).toEqual([]);
    expect(
      evaluateProductionGuardrails({
        ...safeProductionEnv,
        AUTH_CAPTCHA_PROVIDER: "disabled",
      }),
    ).toEqual([]);
  });

  it("refuses an explicitly insecure session cookie", () => {
    const findings = evaluateProductionGuardrails({
      ...safeProductionEnv,
      AUTH_COOKIE_SECURE: "false",
    });

    expect(keys(findings)).toEqual(["cookie-secure"]);
    expect(findings[0]?.severity).toBe("fatal");
  });

  it("treats a short or missing auth secret as fatal", () => {
    expect(keys(evaluateProductionGuardrails({ ...safeProductionEnv, AUTH_SECRET: "" }))).toContain(
      "auth-secret",
    );
    expect(
      keys(evaluateProductionGuardrails({ ...safeProductionEnv, AUTH_SECRET: "short" })),
    ).toContain("auth-secret");
  });

  it("requires the firmware package key", () => {
    const findings = evaluateProductionGuardrails({
      ...safeProductionEnv,
      DEVICE_PACKAGE_ENCRYPTION_KEY: "  ",
    });

    expect(keys(findings)).toEqual(["device-package-key"]);
  });

  it("warns about unsigned ingest, weak database TLS, and missing operational secrets", () => {
    const findings = evaluateProductionGuardrails({
      ...safeProductionEnv,
      AUTH_REQUIRE_ADMIN_OTP: "false",
      INGEST_SIGNATURE_MODE: "off",
      MYSQL_BACKUP_ENCRYPTION_KEY: "",
      MYSQL_SSL_MODE: "disabled",
      OPS_CRON_SECRET: "",
    });

    expect(keys(findings)).toEqual([
      "admin-otp",
      "backup-encryption",
      "ingest-signature",
      "mysql-ssl",
      "ops-cron-secret",
    ]);
    expect(findings.every((finding) => finding.severity === "warning")).toBe(true);
  });

  it("still warns when the signature mode is unset", () => {
    const findings = evaluateProductionGuardrails({
      ...safeProductionEnv,
      INGEST_SIGNATURE_MODE: undefined,
    });

    expect(keys(findings)).toEqual(["ingest-signature"]);
  });
});

describe("assertProductionGuardrails", () => {
  it("throws a describing error when a fatal finding exists", () => {
    let thrown: unknown;

    try {
      assertProductionGuardrails({
        ...safeProductionEnv,
        SOLAR_TANK_STORAGE_DRIVER: "memory",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProductionGuardrailError);
    expect((thrown as Error).message).toContain("SOLAR_TANK_STORAGE_DRIVER");
    expect((thrown as ProductionGuardrailError).findings).toHaveLength(1);
  });

  it("does not throw for warnings alone", () => {
    const findings = assertProductionGuardrails(
      { ...safeProductionEnv, INGEST_SIGNATURE_MODE: "off" },
      { skip: false },
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
  });

  it("allows a deliberate override during an incident", () => {
    const findings = assertProductionGuardrails(
      { ...safeProductionEnv, SOLAR_TANK_ALLOW_GLOBAL_DEVICE_KEY_FALLBACK: "true" },
      { skip: true },
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.key).toBe("global-device-key-fallback");
  });

  it("returns an empty list when the environment is safe", () => {
    expect(assertProductionGuardrails(safeProductionEnv, { skip: false })).toEqual([]);
  });
});

describe("formatGuardrailFinding", () => {
  it("includes the severity and key so a log line is actionable", () => {
    expect(
      formatGuardrailFinding({
        key: "auth-secret",
        message: "must be set",
        severity: "fatal",
      }),
    ).toBe("[fatal] auth-secret: must be set");
  });
});
