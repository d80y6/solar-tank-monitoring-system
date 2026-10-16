import type { AuthRole } from "../types";

const DEFAULT_SESSION_COOKIE_NAME = "solar_tank_session";
const DEFAULT_USER_SESSION_TTL_SECONDS = 60 * 60 * 12;
const DEFAULT_ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 4;
const DEFAULT_OTP_TTL_SECONDS = 60 * 10;
const DEFAULT_PASSWORD_RESET_TTL_SECONDS = 60 * 30;
const DEFAULT_EMAIL_VERIFICATION_TTL_SECONDS = 60 * 60 * 24;
const DEFAULT_TELEGRAM_BIND_TTL_SECONDS = 60 * 10;
const DEFAULT_SESSION_LAST_SEEN_UPDATE_SECONDS = 60 * 5;
const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;
const DEFAULT_LOGIN_LOCK_SECONDS = 60 * 15;

export function getAuthCookieName(): string {
  return (
    process.env.AUTH_SESSION_COOKIE_NAME?.trim() || DEFAULT_SESSION_COOKIE_NAME
  );
}

export function isProductionLikeEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase() === "production"
  );
}

export function shouldUseSecureCookies(): boolean {
  const override = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();

  if (override === "true") {
    return true;
  }

  if (override === "false") {
    return false;
  }

  return isProductionLikeEnvironment();
}

export function getSessionTtlSeconds(role: AuthRole): number {
  const envValue =
    role === "admin"
      ? process.env.AUTH_ADMIN_SESSION_TTL_SECONDS
      : process.env.AUTH_SESSION_TTL_SECONDS;
  const parsed = Number(envValue);

  if (Number.isInteger(parsed) && parsed >= 300) {
    return parsed;
  }

  return role === "admin"
    ? DEFAULT_ADMIN_SESSION_TTL_SECONDS
    : DEFAULT_USER_SESSION_TTL_SECONDS;
}

export function shouldRequireAdminOtp(): boolean {
  return process.env.AUTH_REQUIRE_ADMIN_OTP?.trim().toLowerCase() !== "false";
}

export function isAccessRequestEnabled(): boolean {
  return process.env.AUTH_ENABLE_REGISTER?.trim().toLowerCase() !== "false";
}

export function isPasswordResetEnabled(): boolean {
  return process.env.AUTH_ALLOW_PASSWORD_RESET?.trim().toLowerCase() !== "false";
}

export function shouldRequireEmailVerificationForApproval(): boolean {
  return (
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION_FOR_APPROVAL
      ?.trim()
      .toLowerCase() !== "false"
  );
}

export function getOtpTtlSeconds(): number {
  const parsed = Number(process.env.AUTH_OTP_TTL_SECONDS);

  if (Number.isInteger(parsed) && parsed >= 60 && parsed <= 1800) {
    return parsed;
  }

  return DEFAULT_OTP_TTL_SECONDS;
}

export function getPasswordResetTtlSeconds(): number {
  const parsed = Number(process.env.AUTH_PASSWORD_RESET_TTL_SECONDS);

  if (Number.isInteger(parsed) && parsed >= 300 && parsed <= 86_400) {
    return parsed;
  }

  return DEFAULT_PASSWORD_RESET_TTL_SECONDS;
}

export function getEmailVerificationTtlSeconds(): number {
  const parsed = Number(process.env.AUTH_EMAIL_VERIFICATION_TTL_SECONDS);

  if (Number.isInteger(parsed) && parsed >= 600 && parsed <= 604_800) {
    return parsed;
  }

  return DEFAULT_EMAIL_VERIFICATION_TTL_SECONDS;
}

export function getTelegramBindTtlSeconds(): number {
  const parsed = Number(process.env.AUTH_TELEGRAM_BIND_TTL_SECONDS);

  if (Number.isInteger(parsed) && parsed >= 300 && parsed <= 3600) {
    return parsed;
  }

  return DEFAULT_TELEGRAM_BIND_TTL_SECONDS;
}

export function getSessionLastSeenUpdateSeconds(): number {
  const parsed = Number(process.env.AUTH_SESSION_LAST_SEEN_UPDATE_SECONDS);

  if (Number.isInteger(parsed) && parsed >= 60 && parsed <= 3600) {
    return parsed;
  }

  return DEFAULT_SESSION_LAST_SEEN_UPDATE_SECONDS;
}

export function getLoginMaxAttempts(): number {
  const parsed = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS);

  if (Number.isInteger(parsed) && parsed >= 3 && parsed <= 20) {
    return parsed;
  }

  return DEFAULT_LOGIN_MAX_ATTEMPTS;
}

export function getLoginLockSeconds(): number {
  const parsed = Number(process.env.AUTH_LOGIN_LOCK_SECONDS);

  if (Number.isInteger(parsed) && parsed >= 60 && parsed <= 3600) {
    return parsed;
  }

  return DEFAULT_LOGIN_LOCK_SECONDS;
}

export function canLogOtpInDevelopment(): boolean {
  return (
    !isProductionLikeEnvironment() &&
    process.env.AUTH_ALLOW_DEV_OTP_LOG?.trim().toLowerCase() !== "false"
  );
}

export function getRequiredAuthSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();

  if (secret && secret.length >= 32) {
    return secret;
  }

  if (!isProductionLikeEnvironment()) {
    return "development-auth-secret-change-before-production";
  }

  throw new Error("AUTH_SECRET with at least 32 characters is required.");
}

export function getAppBaseUrl(): string {
  const baseUrl = process.env.APP_BASE_URL?.trim();

  if (baseUrl) {
    return baseUrl.replace(/\/+$/, "");
  }

  if (isProductionLikeEnvironment()) {
    throw new Error("APP_BASE_URL is required for production.");
  }

  return "http://localhost:3000";
}

export type CaptchaProvider = "disabled" | "turnstile" | "invalid";

export function getCaptchaProvider(): CaptchaProvider {
  const provider = process.env.AUTH_CAPTCHA_PROVIDER?.trim().toLowerCase();

  if (!provider || provider === "disabled") {
    return "disabled";
  }

  if (provider === "turnstile") {
    return "turnstile";
  }

  return "invalid";
}

export function getCaptchaSecretKey(): string | null {
  const secret = process.env.AUTH_CAPTCHA_SECRET_KEY?.trim();
  return secret || null;
}

export function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token || null;
}

export function getTelegramWebhookSecret(): string | null {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  return secret || null;
}

export function getTelegramBotUsername(): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  return username || null;
}

export function getReadinessCheckToken(): string | null {
  const token = process.env.READINESS_CHECK_TOKEN?.trim();
  return token || null;
}

export type TelegramAdminTopic =
  | "live-chat"
  | "new-account"
  | "new-device"
  | "system";

export function getTelegramAdminGroupChatId(): string | null {
  const chatId = process.env.TELEGRAM_ADMIN_GROUP_CHAT_ID?.trim();
  return chatId || null;
}

function getTelegramTopicThreadIdFromEnv(key: string): number | null {
  const rawValue = process.env[key]?.trim();
  const parsed = Number(rawValue);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function getTelegramAdminTopicThreadId(
  topic: TelegramAdminTopic,
): number | null {
  switch (topic) {
    case "live-chat":
      return getTelegramTopicThreadIdFromEnv(
        "TELEGRAM_TOPIC_LIVE_CHAT_THREAD_ID",
      );
    case "new-account":
      return getTelegramTopicThreadIdFromEnv(
        "TELEGRAM_TOPIC_NEW_ACCOUNT_THREAD_ID",
      );
    case "new-device":
      return getTelegramTopicThreadIdFromEnv(
        "TELEGRAM_TOPIC_NEW_DEVICE_THREAD_ID",
      );
    case "system":
      return getTelegramTopicThreadIdFromEnv("TELEGRAM_TOPIC_SYSTEM_THREAD_ID");
  }
}
