import type { AuthRole } from "../types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,40}$/;
const INDONESIAN_MOBILE_PHONE_PATTERN = /^\+628\d{7,11}$/;
const MAX_PASSWORD_LENGTH = 256;

export type LoginPayload = {
  identity: string;
  password: string;
};

export type RegisterAccessPayload = {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  requestedRole: AuthRole;
  accessReason: string | null;
};

export type ForgotPasswordPayload = {
  identity: string;
  captchaToken: string | null;
};

export type ResetPasswordPayload = {
  token: string;
  password: string;
  confirmPassword: string;
};

export type ChangePasswordPayload = {
  currentPassword: string;
  password: string;
  confirmPassword: string;
};

export type ResendVerificationPayload = {
  identity: string;
  captchaToken: string | null;
};

export type TelegramBindPayload = {
  token: string;
};

export function normalizeIdentity(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeUsername(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

export function normalizeOptionalText(
  value: unknown,
  maxLength: number,
): string | null {
  const normalized = normalizeText(value, maxLength);
  return normalized || null;
}

export function normalizeIndonesianMobilePhone(value: unknown): string {
  const rawValue = String(value ?? "").trim();

  if (!rawValue) {
    throw new Error("Phone number is required.");
  }

  if (/[a-zA-Z]/.test(rawValue)) {
    throw new Error(
      "Phone number must use digits, e.g. 081234567890 or +6281234567890.",
    );
  }

  const compactValue = rawValue.replace(/[\s().-]/g, "");
  const normalizedValue = compactValue.startsWith("0062")
    ? `+62${compactValue.slice(4)}`
    : compactValue.startsWith("+62")
      ? compactValue
      : compactValue.startsWith("62")
        ? `+${compactValue}`
        : compactValue.startsWith("0")
          ? `+62${compactValue.slice(1)}`
          : compactValue.startsWith("8")
            ? `+62${compactValue}`
            : compactValue;

  if (!INDONESIAN_MOBILE_PHONE_PATTERN.test(normalizedValue)) {
    throw new Error(
      "Phone number must be a valid Indonesian mobile number, e.g. 081234567890 or +6281234567890.",
    );
  }

  return normalizedValue;
}

export function parseLoginPayload(payload: unknown): LoginPayload {
  const record = (payload ?? {}) as Record<string, unknown>;
  const identity = normalizeIdentity(record.identity);
  const password = String(record.password ?? "");

  if (!identity || password.length < 1) {
    throw new Error("Sign-in data is incomplete.");
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error("Password is too long.");
  }

  return { identity, password };
}

function assertStrongPassword(password: string) {
  if (password.length < 10) {
    throw new Error("Password must be at least 10 characters.");
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error("Password can be at most 256 characters.");
  }

  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("Password must contain letters and numbers.");
  }
}

function parseOptionalCaptchaToken(value: unknown): string | null {
  const token = String(value ?? "").trim();
  return token || null;
}

export function parseRegisterAccessPayload(
  payload: unknown,
): RegisterAccessPayload {
  const record = (payload ?? {}) as Record<string, unknown>;
  const fullName = normalizeText(record.fullName, 160);
  const username = normalizeUsername(record.username);
  const email = normalizeIdentity(record.email);
  const phone = normalizeIndonesianMobilePhone(record.phone);
  const password = String(record.password ?? "");
  const confirmPassword = String(record.confirmPassword ?? "");
  const requestedRole = record.requestedRole === "admin" ? "admin" : "user";
  const accessReason = normalizeOptionalText(record.accessReason, 1000);

  if (fullName.length < 2) {
    throw new Error("Full name is required.");
  }

  if (!USERNAME_PATTERN.test(username)) {
    throw new Error(
      "Username may only contain letters, numbers, dots, underscores, or hyphens.",
    );
  }

  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("Work email is invalid.");
  }

  assertStrongPassword(password);

  if (password !== confirmPassword) {
    throw new Error("Password confirmation does not match yet.");
  }

  return {
    fullName,
    username,
    email,
    phone,
    password,
    confirmPassword,
    requestedRole,
    accessReason,
  };
}

export function parseForgotPasswordPayload(
  payload: unknown,
): ForgotPasswordPayload {
  const record = (payload ?? {}) as Record<string, unknown>;
  const identity = normalizeIdentity(record.identity);

  if (!identity) {
    throw new Error("Email or username is required.");
  }

  return {
    identity,
    captchaToken: parseOptionalCaptchaToken(record.captchaToken),
  };
}

export function parseResetPasswordPayload(
  payload: unknown,
): ResetPasswordPayload {
  const record = (payload ?? {}) as Record<string, unknown>;
  const token = String(record.token ?? "").trim();
  const password = String(record.password ?? "");
  const confirmPassword = String(record.confirmPassword ?? "");

  if (!token) {
    throw new Error("Reset token is invalid.");
  }

  assertStrongPassword(password);

  if (password !== confirmPassword) {
    throw new Error("Password confirmation does not match yet.");
  }

  return { token, password, confirmPassword };
}

export function parseChangePasswordPayload(
  payload: unknown,
): ChangePasswordPayload {
  const record = (payload ?? {}) as Record<string, unknown>;
  const currentPassword = String(record.currentPassword ?? "");
  const password = String(record.password ?? "");
  const confirmPassword = String(record.confirmPassword ?? "");

  if (!currentPassword) {
    throw new Error("Current password is required.");
  }

  assertStrongPassword(password);

  if (currentPassword === password) {
    throw new Error("New password must differ from the old password.");
  }

  if (password !== confirmPassword) {
    throw new Error("Password confirmation does not match yet.");
  }

  return { currentPassword, password, confirmPassword };
}

export function parseResendVerificationPayload(
  payload: unknown,
): ResendVerificationPayload {
  const record = (payload ?? {}) as Record<string, unknown>;
  const identity = normalizeIdentity(record.identity);

  if (!identity) {
    throw new Error("Email or username is required.");
  }

  return {
    identity,
    captchaToken: parseOptionalCaptchaToken(record.captchaToken),
  };
}

export function parseTelegramBindPayload(
  payload: unknown,
): TelegramBindPayload {
  const record = (payload ?? {}) as Record<string, unknown>;
  const token = String(record.token ?? "").trim();

  if (!token) {
    throw new Error("Telegram token is invalid.");
  }

  return { token };
}
