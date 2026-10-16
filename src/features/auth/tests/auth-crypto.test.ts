import { describe, expect, it } from "vitest";

import {
  createLegacyPbkdf2PasswordHashForTest,
  createOtpCode,
  createRandomToken,
  hashOneTimeToken,
  hashOtpCode,
  hashPassword,
  passwordNeedsRehash,
  verifyOtpHash,
  verifyPassword,
} from "../lib/auth-crypto";
import {
  createAdminActionCsrfToken,
  verifyAdminActionCsrfToken,
} from "../lib/auth-csrf";
import {
  parseLoginPayload,
  parseChangePasswordPayload,
  parseForgotPasswordPayload,
  normalizeIndonesianMobilePhone,
  parseRegisterAccessPayload,
  parseResetPasswordPayload,
} from "../lib/auth-validation";

describe("auth crypto", () => {
  it("verifies password only for correct input", async () => {
    const hash = await hashPassword("password-operator-kuat");

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(passwordNeedsRehash(hash)).toBe(false);
    await expect(verifyPassword("password-operator-kuat", hash)).resolves.toBe(
      true,
    );
    await expect(verifyPassword("password-wrong", hash)).resolves.toBe(false);
  });

  it("still reads legacy PBKDF2 hashes and flags them for upgrade", async () => {
    const legacyHash = await createLegacyPbkdf2PasswordHashForTest(
      "password-legacy-strong",
    );

    expect(legacyHash).toMatch(/^pbkdf2-sha256\$/);
    expect(passwordNeedsRehash(legacyHash)).toBe(true);
    await expect(verifyPassword("password-legacy-strong", legacyHash)).resolves.toBe(
      true,
    );
    await expect(verifyPassword("password-wrong", legacyHash)).resolves.toBe(
      false,
    );
  });

  it("verifies OTP only for correct codes", () => {
    const code = createOtpCode();
    const hash = hashOtpCode(code);

    expect(code).toMatch(/^\d{6}$/);
    expect(verifyOtpHash(code, hash)).toBe(true);
    expect(verifyOtpHash("000000" === code ? "111111" : "000000", hash)).toBe(
      false,
    );
  });

  it("binds admin action token to the correct session", () => {
    const token = createAdminActionCsrfToken("sess_admin_utama");

    expect(
      verifyAdminActionCsrfToken({
        sessionId: "sess_admin_utama",
        token,
      }),
    ).toBe(true);
    expect(
      verifyAdminActionCsrfToken({
        sessionId: "sess_admin_lain",
        token,
      }),
    ).toBe(false);
    expect(
      verifyAdminActionCsrfToken({
        sessionId: "sess_admin_utama",
        token: null,
      }),
    ).toBe(false);
  });

  it("produces one-time token hash without storing the raw token", () => {
    const token = createRandomToken();
    const hash = hashOneTimeToken(token);

    expect(hash).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashOneTimeToken(token)).toBe(hash);
  });
});

describe("auth validation", () => {
  it("normalizes login payload", () => {
    expect(
      parseLoginPayload({
        identity: " ADMIN@EXAMPLE.CO.ID ",
        password: "secret",
      }),
    ).toEqual({
      identity: "admin@example.co.id",
      password: "secret",
    });
  });

  it("rejects access request with weak password", () => {
    expect(() =>
      parseRegisterAccessPayload({
        fullName: "Operator",
        username: "operator",
        email: "operator@example.com",
        phone: "081234567890",
        password: "short",
        confirmPassword: "short",
      }),
    ).toThrow("Password must be at least 10 characters.");
  });

  it("normalizes Indonesian mobile numbers to +62 format", () => {
    expect(normalizeIndonesianMobilePhone("0812 3456 7890")).toBe(
      "+6281234567890",
    );
    expect(normalizeIndonesianMobilePhone("6281234567890")).toBe(
      "+6281234567890",
    );
    expect(normalizeIndonesianMobilePhone("+62 812-3456-7890")).toBe(
      "+6281234567890",
    );
    expect(normalizeIndonesianMobilePhone("81234567890")).toBe(
      "+6281234567890",
    );
  });

  it("rejects phone numbers that cannot be stored consistently", () => {
    expect(() => normalizeIndonesianMobilePhone("")).toThrow("Phone number is required.");
    expect(() => normalizeIndonesianMobilePhone("my phone number")).toThrow(
      "Phone number must use digits",
    );
    expect(() => normalizeIndonesianMobilePhone("+621234")).toThrow(
      "valid Indonesian mobile number",
    );
  });

  it("stores register payload with normalized phone number", () => {
    expect(
      parseRegisterAccessPayload({
        fullName: "Operator Monitoring",
        username: "operator_1",
        email: "Operator@Example.com",
        phone: "0822-3163-9644",
        password: "Password12345",
        confirmPassword: "Password12345",
      }),
    ).toMatchObject({
      email: "operator@example.com",
      phone: "+6282231639644",
      username: "operator_1",
    });
  });

  it("rejects too-long password before hashing", () => {
    expect(() =>
      parseLoginPayload({
        identity: "operator",
        password: "x".repeat(257),
      }),
    ).toThrow("Password is too long.");
  });

  it("validates forgot-password payload generically", () => {
    expect(
      parseForgotPasswordPayload({
        identity: " OPERATOR@EXAMPLE.CO.ID ",
        captchaToken: " token ",
      }),
    ).toEqual({
      identity: "operator@example.co.id",
      captchaToken: "token",
    });
  });

  it("validates reset password with token and strong password", () => {
    expect(
      parseResetPasswordPayload({
        token: "reset-token",
        password: "Password12345",
        confirmPassword: "Password12345",
      }),
    ).toEqual({
      token: "reset-token",
      password: "Password12345",
      confirmPassword: "Password12345",
    });
    expect(() =>
      parseResetPasswordPayload({
        token: "reset-token",
        password: "passwordwithoutnumbers",
        confirmPassword: "passwordwithoutnumbers",
      }),
    ).toThrow("Password must contain letters and numbers.");
  });

  it("rejects change password when new password equals the old one", () => {
    expect(() =>
      parseChangePasswordPayload({
        currentPassword: "Password12345",
        password: "Password12345",
        confirmPassword: "Password12345",
      }),
    ).toThrow("New password must differ from the old password.");
  });
});
