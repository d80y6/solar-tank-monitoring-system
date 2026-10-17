import { NextResponse, type NextRequest } from "next/server";

import { verifyCaptchaToken } from "@/features/auth/lib/auth-captcha";
import { resendEmailVerification } from "@/features/auth/lib/auth-service";
import { parseResendVerificationPayload } from "@/features/auth/lib/auth-validation";
import { checkRateLimit } from "@/features/auth/lib/rate-limit";
import { requireSameOrigin } from "@/features/auth/lib/request-origin";
import {
  getSafeErrorMessage,
  getSafeErrorStatus,
} from "@/lib/safe-error-message";
import { readJsonBodyOrReject } from "@/lib/request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getClientIp(request: NextRequest): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
}

export async function POST(request: NextRequest) {
  const originBlock = requireSameOrigin(request);

  if (originBlock) {
    return originBlock;
  }

  try {
    const { body: payloadRaw, response: payloadBlock } =
      await readJsonBodyOrReject(request);

    if (payloadBlock) {
      return payloadBlock;
    }

    const payload = parseResendVerificationPayload(payloadRaw);
    const ip = getClientIp(request) ?? "unknown-ip";
    const rateLimit = await checkRateLimit({
      key: `resend-email-verification:${ip}:${payload.identity}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "Too many requests. Try again later.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const captcha = await verifyCaptchaToken({
      token: payload.captchaToken,
      remoteIp: getClientIp(request),
    });

    if (!captcha.ok) {
      return NextResponse.json(
        { ok: false, error: captcha.error },
        { status: 400 },
      );
    }

    await resendEmailVerification({
      identity: payload.identity,
      request,
    });

    return NextResponse.json({
      ok: true,
      data: {
        message:
          "If the account is found and unverified, the verification link will be resent.",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: getSafeErrorMessage(error, {
          fallbackMessage: "Verification request could not be processed yet.",
          internalMessage:
            "Verification request could not be processed because the service is being prepared. Try again later.",
        }),
      },
      { status: getSafeErrorStatus(error) },
    );
  }
}
