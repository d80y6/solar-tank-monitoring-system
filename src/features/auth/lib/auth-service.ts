import type { NextRequest } from "next/server";

import { getSafeErrorMessage } from "@/lib/safe-error-message";

import type { AuthSafeUser, AuthSessionUser } from "../types";
import {
  createOtpCode,
  createRandomToken,
  hashOneTimeToken,
  hashPassword,
  hashOtpCode,
  hashRequestFingerprint,
  hashSessionToken,
  hmacSha256Hex,
  passwordNeedsRehash,
  verifyOtpHash,
  verifyPassword,
} from "./auth-crypto";
import {
  getAppBaseUrl,
  getEmailVerificationTtlSeconds,
  getOtpTtlSeconds,
  getPasswordResetTtlSeconds,
  getSessionTtlSeconds,
  getSessionLastSeenUpdateSeconds,
  getTelegramBindTtlSeconds,
  isPasswordResetEnabled,
  shouldRequireAdminOtp,
} from "./auth-config";
import {
  sendAdminLoginOtp,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
} from "./auth-email";
import {
  buildTelegramDeepLink,
  sendTelegramMessage,
} from "./auth-telegram";
import { notifyAdminsAccessRequestSubmitted } from "./admin-telegram-notifications";
import {
  createAuthSession,
  createEmailVerificationTokenRecord,
  createOtpCodeRecord,
  createPasswordResetTokenRecord,
  createPendingAccessRequest,
  createTelegramBindTokenRecord,
  completeTelegramBindingInMysql,
  findAuthSessionByTokenHash,
  findAuthUserByIdentity,
  findAuthUserById,
  findEmailVerificationTokenRecord,
  findOtpCodeRecord,
  findPasswordResetTokenRecord,
  listAuthSessionsForUser,
  markAuthUserEmailVerified,
  markEmailVerificationTokenUsed,
  markOtpAttempt,
  markOtpUsed,
  markPasswordResetTokenUsed,
  recordAuthAuditEvent,
  recordFailedLogin,
  resetFailedLogin,
  revokeAllUserSessions,
  revokeAuthSessionForUser,
  revokeAuthSession,
  revokeOtherUserSessions,
  touchAuthSessionIfStale,
  updateAuthUserPasswordHash,
} from "./mysql-auth-repository";
import type {
  ChangePasswordPayload,
  RegisterAccessPayload,
  ResetPasswordPayload,
} from "./auth-validation";
import type { AuthSessionSummary } from "../types";

type AuthRequestContext = Pick<NextRequest, "headers">;

export type LoginResult =
  | {
      ok: true;
      status: "authenticated";
      user: AuthSessionUser;
      sessionToken: string;
      expiresAt: Date;
    }
  | {
      ok: true;
      status: "otp_required";
      challengeId: string;
      delivery: "email" | "log";
    };

export type VerifyOtpResult = {
  user: AuthSessionUser;
  sessionToken: string;
  expiresAt: Date;
};

function getRequestIp(request: AuthRequestContext): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
}

function getRequestUserAgent(request: AuthRequestContext): string | null {
  return request.headers.get("user-agent");
}

function isLocked(lockedUntil: string | null): boolean {
  return Boolean(lockedUntil && new Date(lockedUntil).getTime() > Date.now());
}

function buildSessionExpiry(user: AuthSafeUser): Date {
  return new Date(Date.now() + getSessionTtlSeconds(user.role) * 1000);
}

function buildSessionUser(
  user: AuthSafeUser,
  sessionId: string,
): AuthSessionUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    telegramVerifiedAt: user.telegramVerifiedAt,
    passwordChangedAt: user.passwordChangedAt,
    lastLoginAt: user.lastLoginAt,
    sessionId,
  };
}

function buildAppUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(path, getAppBaseUrl());

  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function buildTokenExpiry(ttlSeconds: number): Date {
  return new Date(Date.now() + ttlSeconds * 1000);
}

function isTokenUsable(token: {
  used_at: Date | null;
  expires_at: Date;
}): boolean {
  return !token.used_at && token.expires_at.getTime() > Date.now();
}

async function createSessionForUser(
  user: AuthSafeUser,
  request: AuthRequestContext,
): Promise<VerifyOtpResult> {
  const sessionToken = createRandomToken();
  const expiresAt = buildSessionExpiry(user);
  const sessionId = await createAuthSession({
    user,
    sessionTokenHash: hashSessionToken(sessionToken),
    expiresAt,
    ipHash: hashRequestFingerprint(getRequestIp(request)),
    userAgentHash: hashRequestFingerprint(getRequestUserAgent(request)),
  });

  return {
    user: buildSessionUser(user, sessionId),
    sessionToken,
    expiresAt,
  };
}

export async function loginWithPassword({
  identity,
  password,
  request,
}: {
  identity: string;
  password: string;
  request: AuthRequestContext;
}): Promise<LoginResult> {
  const user = await findAuthUserByIdentity(identity);
  const ip = getRequestIp(request);
  const userAgent = getRequestUserAgent(request);

  if (!user) {
    await recordAuthAuditEvent({
      eventType: "login_failed_unknown_identity",
      ip,
      userAgent,
      metadata: { identityHash: `sha256:${hmacSha256Hex(identity)}` },
    }).catch(() => undefined);
    throw new Error("Sign-in failed. Please check your credentials again.");
  }

  if (isLocked(user.lockedUntil)) {
    await recordAuthAuditEvent({
      eventType: "login_failed_locked",
      targetUserId: user.id,
      ip,
      userAgent,
    }).catch(() => undefined);
    throw new Error("Account temporarily locked. Try again shortly.");
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);

  if (!passwordValid) {
    await recordFailedLogin(user.id);
    await recordAuthAuditEvent({
      eventType: "login_failed_invalid_password",
      targetUserId: user.id,
      ip,
      userAgent,
    }).catch(() => undefined);
    throw new Error("Sign-in failed. Please check your credentials again.");
  }

  if (user.status !== "active") {
    await recordAuthAuditEvent({
      eventType: "login_failed_inactive_user",
      targetUserId: user.id,
      ip,
      userAgent,
      metadata: { status: user.status },
    }).catch(() => undefined);
    throw new Error("Account is not active. Contact the administrator.");
  }

  if (passwordNeedsRehash(user.passwordHash)) {
    await updateAuthUserPasswordHash({
      userId: user.id,
      passwordHash: await hashPassword(password),
    });
    await recordAuthAuditEvent({
      eventType: "password_hash_upgraded",
      actorUserId: user.id,
      targetUserId: user.id,
      ip,
      userAgent,
    }).catch(() => undefined);
  }

  await resetFailedLogin(user.id);

  if (user.role === "admin" && shouldRequireAdminOtp()) {
    const code = createOtpCode();
    const expiresAt = new Date(Date.now() + getOtpTtlSeconds() * 1000);
    const delivery = await sendAdminLoginOtp({ email: user.email, code });

    if (!delivery.delivered) {
      throw new Error(delivery.reason);
    }

    const challengeId = await createOtpCodeRecord({
      userId: user.id,
      purpose: "login_admin_2fa",
      channel: "email",
      destinationHash: `hmac-sha256:${hmacSha256Hex(user.email)}`,
      codeHash: hashOtpCode(code),
      expiresAt,
    });

    await recordAuthAuditEvent({
      eventType: "login_admin_otp_sent",
      targetUserId: user.id,
      ip,
      userAgent,
      metadata: { delivery: delivery.delivery },
    }).catch(() => undefined);

    return {
      ok: true,
      status: "otp_required",
      challengeId,
      delivery: delivery.delivery,
    };
  }

  const session = await createSessionForUser(user, request);
  await recordAuthAuditEvent({
    eventType: "login_success",
    actorUserId: user.id,
    targetUserId: user.id,
    ip,
    userAgent,
  }).catch(() => undefined);

  return {
    ok: true,
    status: "authenticated",
    ...session,
  };
}

export async function verifyAdminOtpLogin({
  challengeId,
  code,
  request,
}: {
  challengeId: string;
  code: string;
  request: AuthRequestContext;
}): Promise<VerifyOtpResult> {
  const ip = getRequestIp(request);
  const userAgent = getRequestUserAgent(request);
  const otp = await findOtpCodeRecord(challengeId);

  if (
    !otp ||
    otp.purpose !== "login_admin_2fa" ||
    otp.used_at ||
    !otp.user_id
  ) {
    throw new Error("Sign-in code is invalid.");
  }

  if (otp.expires_at.getTime() <= Date.now()) {
    throw new Error("Sign-in code has expired.");
  }

  if (otp.attempt_count >= otp.max_attempts) {
    throw new Error("Too many code attempts.");
  }

  if (!verifyOtpHash(code, otp.code_hash)) {
    await markOtpAttempt(otp.id);
    await recordAuthAuditEvent({
      eventType: "login_admin_otp_failed",
      targetUserId: otp.user_id,
      ip,
      userAgent,
    }).catch(() => undefined);
    throw new Error("Sign-in code is invalid.");
  }

  const user = await findAuthUserById(otp.user_id);

  if (!user || user.role !== "admin" || user.status !== "active") {
    throw new Error("Admin account is unavailable.");
  }

  await markOtpUsed(otp.id);
  const session = await createSessionForUser(user, request);
  await recordAuthAuditEvent({
    eventType: "login_success_admin_otp",
    actorUserId: user.id,
    targetUserId: user.id,
    ip,
    userAgent,
  }).catch(() => undefined);

  return session;
}

export async function getSessionUserFromToken(
  sessionToken: string | undefined,
): Promise<AuthSessionUser | null> {
  if (!sessionToken) {
    return null;
  }

  const user = await findAuthSessionByTokenHash(hashSessionToken(sessionToken));

  if (user) {
    const staleBefore = new Date(
      Date.now() - getSessionLastSeenUpdateSeconds() * 1000,
    );
    await touchAuthSessionIfStale({
      sessionId: user.sessionId,
      staleBefore,
    }).catch(() => undefined);
  }

  return user;
}

export async function logoutSession(sessionId: string): Promise<void> {
  await revokeAuthSession(sessionId);
}

export async function submitAccessRequest(
  payload: RegisterAccessPayload,
  request: AuthRequestContext,
): Promise<void> {
  const result = await createPendingAccessRequest(payload);
  await recordAuthAuditEvent({
    eventType: result.created
      ? "access_request_submitted"
      : "access_request_duplicate",
    targetUserId: result.userId,
    ip: getRequestIp(request),
    userAgent: getRequestUserAgent(request),
    metadata: {
      requestedRole: payload.requestedRole,
      accessRequestId: result.accessRequestId || null,
    },
  }).catch(() => undefined);

  if (result.created) {
    await sendEmailVerificationForUserId({
      userId: result.userId,
      request,
    }).catch((error) =>
      recordAuthAuditEvent({
        eventType: "email_verification_send_failed",
        targetUserId: result.userId,
        ip: getRequestIp(request),
        userAgent: getRequestUserAgent(request),
        metadata: {
          reason: getSafeErrorMessage(error, {
            fallbackMessage: "unknown",
            internalMessage: "email_delivery_internal_error",
          }),
        },
      }).catch(() => undefined),
    );
    try {
      const telegramNotification = await notifyAdminsAccessRequestSubmitted({
        accessRequestId: result.accessRequestId,
        payload,
        userId: result.userId,
      });

      await recordAuthAuditEvent({
        eventType:
          telegramNotification.attempted > 0 &&
          telegramNotification.delivered === 0
            ? "access_request_telegram_notify_failed"
            : "access_request_telegram_notified",
        targetUserId: result.userId,
        ip: getRequestIp(request),
        userAgent: getRequestUserAgent(request),
        metadata: {
          accessRequestId: result.accessRequestId,
          attempted: telegramNotification.attempted,
          delivered: telegramNotification.delivered,
          failed: telegramNotification.failed,
        },
      }).catch(() => undefined);
    } catch (error) {
      await recordAuthAuditEvent({
        eventType: "access_request_telegram_notify_failed",
        targetUserId: result.userId,
        ip: getRequestIp(request),
        userAgent: getRequestUserAgent(request),
        metadata: {
          accessRequestId: result.accessRequestId,
          reason: getSafeErrorMessage(error, {
            fallbackMessage: "unknown",
            internalMessage: "telegram_delivery_internal_error",
          }),
        },
      }).catch(() => undefined);
    }
  }
}

export async function requestPasswordReset({
  identity,
  request,
}: {
  identity: string;
  request: AuthRequestContext;
}): Promise<void> {
  const ip = getRequestIp(request);
  const userAgent = getRequestUserAgent(request);

  if (!isPasswordResetEnabled()) {
    throw new Error("Password reset is currently disabled.");
  }

  const user = await findAuthUserByIdentity(identity);

  if (!user || user.status === "disabled" || user.status === "suspended") {
    await recordAuthAuditEvent({
      eventType: "password_reset_requested_no_delivery",
      targetUserId: user?.id ?? null,
      ip,
      userAgent,
      metadata: { identityHash: `sha256:${hmacSha256Hex(identity)}` },
    }).catch(() => undefined);
    return;
  }

  const token = createRandomToken();
  const tokenHash = hashOneTimeToken(token);
  const expiresAt = buildTokenExpiry(getPasswordResetTtlSeconds());

  await createPasswordResetTokenRecord({
    userId: user.id,
    tokenHash,
    destinationHash: `hmac-sha256:${hmacSha256Hex(user.email)}`,
    expiresAt,
    ipHash: hashRequestFingerprint(ip),
    userAgentHash: hashRequestFingerprint(userAgent),
  });

  const delivery = await sendPasswordResetEmail({
    email: user.email,
    resetUrl: buildAppUrl("/reset-password", { token }),
  });

  await recordAuthAuditEvent({
    eventType: delivery.delivered
      ? "password_reset_email_sent"
      : "password_reset_email_failed",
    targetUserId: user.id,
    ip,
    userAgent,
    metadata: {
      delivery: delivery.delivery,
      reason: delivery.delivered ? null : delivery.reason,
    },
  }).catch(() => undefined);

  if (!delivery.delivered) {
    throw new Error(delivery.reason);
  }
}

export async function sendPasswordResetForUserId({
  userId,
  request,
}: {
  userId: string;
  request: AuthRequestContext;
}): Promise<void> {
  const user = await findAuthUserById(userId);
  const ip = getRequestIp(request);
  const userAgent = getRequestUserAgent(request);

  if (!isPasswordResetEnabled()) {
    throw new Error("Password reset is currently disabled.");
  }

  if (!user || user.status === "disabled" || user.status === "suspended") {
    throw new Error("Account is unavailable for password reset.");
  }

  const token = createRandomToken();
  const expiresAt = buildTokenExpiry(getPasswordResetTtlSeconds());

  await createPasswordResetTokenRecord({
    userId: user.id,
    tokenHash: hashOneTimeToken(token),
    destinationHash: `hmac-sha256:${hmacSha256Hex(user.email)}`,
    expiresAt,
    ipHash: hashRequestFingerprint(ip),
    userAgentHash: hashRequestFingerprint(userAgent),
  });

  const delivery = await sendPasswordResetEmail({
    email: user.email,
    resetUrl: buildAppUrl("/reset-password", { token }),
  });

  await recordAuthAuditEvent({
    eventType: delivery.delivered
      ? "password_reset_admin_email_sent"
      : "password_reset_admin_email_failed",
    targetUserId: user.id,
    ip,
    userAgent,
    metadata: {
      delivery: delivery.delivery,
      reason: delivery.delivered ? null : delivery.reason,
    },
  }).catch(() => undefined);

  if (!delivery.delivered) {
    throw new Error(delivery.reason);
  }
}

export async function resetPasswordWithToken({
  payload,
  request,
}: {
  payload: ResetPasswordPayload;
  request: AuthRequestContext;
}): Promise<void> {
  const token = await findPasswordResetTokenRecord(
    hashOneTimeToken(payload.token),
  );
  const ip = getRequestIp(request);
  const userAgent = getRequestUserAgent(request);

  if (!token || !isTokenUsable(token)) {
    throw new Error("Reset link is invalid or has expired.");
  }

  const user = await findAuthUserById(token.user_id);

  if (!user || user.status === "disabled" || user.status === "suspended") {
    throw new Error("Account is unavailable for password reset.");
  }

  await updateAuthUserPasswordHash({
    userId: user.id,
    passwordHash: await hashPassword(payload.password),
  });
  await markPasswordResetTokenUsed(token.id);
  await revokeAllUserSessions(user.id);
  await recordAuthAuditEvent({
    eventType: "password_reset_completed",
    actorUserId: user.id,
    targetUserId: user.id,
    ip,
    userAgent,
  }).catch(() => undefined);
}

export async function changePasswordForSession({
  user,
  payload,
  request,
}: {
  user: AuthSessionUser;
  payload: ChangePasswordPayload;
  request: AuthRequestContext;
}): Promise<void> {
  const userWithPassword = await findAuthUserByIdentity(user.email);
  const ip = getRequestIp(request);
  const userAgent = getRequestUserAgent(request);

  if (!userWithPassword || userWithPassword.id !== user.id) {
    throw new Error("Account not found.");
  }

  const passwordValid = await verifyPassword(
    payload.currentPassword,
    userWithPassword.passwordHash,
  );

  if (!passwordValid) {
    await recordAuthAuditEvent({
      eventType: "password_change_failed",
      actorUserId: user.id,
      targetUserId: user.id,
      ip,
      userAgent,
    }).catch(() => undefined);
    throw new Error("Current password is incorrect.");
  }

  await updateAuthUserPasswordHash({
    userId: user.id,
    passwordHash: await hashPassword(payload.password),
  });
  await revokeOtherUserSessions({
    userId: user.id,
    currentSessionId: user.sessionId,
  });
  await recordAuthAuditEvent({
    eventType: "password_changed",
    actorUserId: user.id,
    targetUserId: user.id,
    ip,
    userAgent,
  }).catch(() => undefined);
}

export async function sendEmailVerificationForUserId({
  userId,
  request,
}: {
  userId: string;
  request: AuthRequestContext;
}): Promise<void> {
  const user = await findAuthUserById(userId);
  const ip = getRequestIp(request);
  const userAgent = getRequestUserAgent(request);

  if (!user || user.emailVerifiedAt) {
    return;
  }

  const token = createRandomToken();
  const tokenHash = hashOneTimeToken(token);

  await createEmailVerificationTokenRecord({
    userId: user.id,
    tokenHash,
    destinationHash: `hmac-sha256:${hmacSha256Hex(user.email)}`,
    expiresAt: buildTokenExpiry(getEmailVerificationTtlSeconds()),
    ipHash: hashRequestFingerprint(ip),
    userAgentHash: hashRequestFingerprint(userAgent),
  });

  const delivery = await sendEmailVerificationEmail({
    email: user.email,
    verificationUrl: buildAppUrl("/api/auth/email/verify", { token }),
  });

  await recordAuthAuditEvent({
    eventType: delivery.delivered
      ? "email_verification_sent"
      : "email_verification_failed",
    targetUserId: user.id,
    ip,
    userAgent,
    metadata: {
      delivery: delivery.delivery,
      reason: delivery.delivered ? null : delivery.reason,
    },
  }).catch(() => undefined);

  if (!delivery.delivered) {
    throw new Error(delivery.reason);
  }
}

export async function resendEmailVerification({
  identity,
  request,
}: {
  identity: string;
  request: AuthRequestContext;
}): Promise<void> {
  const user = await findAuthUserByIdentity(identity);

  if (!user || user.emailVerifiedAt) {
    return;
  }

  await sendEmailVerificationForUserId({ userId: user.id, request });
}

export async function verifyEmailToken({
  token,
  request,
}: {
  token: string;
  request: AuthRequestContext;
}): Promise<void> {
  const record = await findEmailVerificationTokenRecord(hashOneTimeToken(token));

  if (!record || !isTokenUsable(record)) {
    throw new Error("Email verification link is invalid.");
  }

  await markAuthUserEmailVerified(record.user_id);
  await markEmailVerificationTokenUsed(record.id);
  await recordAuthAuditEvent({
    eventType: "email_verified",
    actorUserId: record.user_id,
    targetUserId: record.user_id,
    ip: getRequestIp(request),
    userAgent: getRequestUserAgent(request),
  }).catch(() => undefined);
}

export async function listCurrentUserSessions({
  user,
}: {
  user: AuthSessionUser;
}): Promise<AuthSessionSummary[]> {
  return listAuthSessionsForUser({
    userId: user.id,
    currentSessionId: user.sessionId,
  });
}

export async function revokeCurrentUserSessionById({
  user,
  sessionId,
}: {
  user: AuthSessionUser;
  sessionId: string;
}): Promise<void> {
  if (sessionId === user.sessionId) {
    throw new Error("Active session was revoked via the sign-out button.");
  }

  await revokeAuthSessionForUser({
    userId: user.id,
    sessionId,
  });
  await recordAuthAuditEvent({
    eventType: "own_session_revoked",
    actorUserId: user.id,
    targetUserId: user.id,
    metadata: { sessionId },
  }).catch(() => undefined);
}

export async function startTelegramBinding({
  user,
  request,
}: {
  user: AuthSessionUser;
  request: AuthRequestContext;
}): Promise<{ token: string; deepLink: string | null; expiresAt: Date }> {
  const token = createRandomToken();
  const expiresAt = buildTokenExpiry(getTelegramBindTtlSeconds());

  await createTelegramBindTokenRecord({
    userId: user.id,
    tokenHash: hashOneTimeToken(token),
    expiresAt,
    ipHash: hashRequestFingerprint(getRequestIp(request)),
    userAgentHash: hashRequestFingerprint(getRequestUserAgent(request)),
  });
  await recordAuthAuditEvent({
    eventType: "telegram_bind_started",
    actorUserId: user.id,
    targetUserId: user.id,
    ip: getRequestIp(request),
    userAgent: getRequestUserAgent(request),
  }).catch(() => undefined);

  return {
    token,
    deepLink: buildTelegramDeepLink(token),
    expiresAt,
  };
}

export async function completeTelegramBinding({
  token,
  chatId,
  request,
}: {
  token: string;
  chatId: string;
  request: AuthRequestContext;
}): Promise<void> {
  const binding = await completeTelegramBindingInMysql({
    tokenHash: hashOneTimeToken(token),
    chatId,
  });

  if (!binding) {
    throw new Error("Telegram token is invalid.");
  }
  await sendTelegramMessage({
    chatId,
    text:
      "Your Telegram account is now connected to FTM. ✅\n\n" +
      "Type /help to see available help and features.",
  }).catch(() => undefined);
  await recordAuthAuditEvent({
    eventType: "telegram_bound",
    actorUserId: binding.userId,
    targetUserId: binding.userId,
    ip: getRequestIp(request),
    userAgent: getRequestUserAgent(request),
  }).catch(() => undefined);
}
