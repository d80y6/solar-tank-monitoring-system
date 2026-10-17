import { NextResponse, type NextRequest } from "next/server";

import { verifyCaptchaToken } from "@/features/auth/lib/auth-captcha";
import { requestPasswordReset } from "@/features/auth/lib/auth-service";
import { parseForgotPasswordPayload } from "@/features/auth/lib/auth-validation";
import { checkRateLimit } from "@/features/auth/lib/rate-limit";
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
  try {
    const { body: payloadRaw, response: payloadBlock } =
      await readJsonBodyOrReject(request);

    if (payloadBlock) {
      return payloadBlock;
    }

    const payload = parseForgotPasswordPayload(payloadRaw);
    const ip = getClientIp(request) ?? "unknown-ip";
    const rateLimit = await checkRateLimit({
      key: `forgot-password:${ip}:${payload.identity}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "Too many reset requests. Try again later.",
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

    await requestPasswordReset({
      identity: payload.identity,
      request,
    });

    return NextResponse.json({
      ok: true,
      data: {
        message:
          "If the account is found, a reset link will be sent to the registered email.",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: getSafeErrorMessage(error, {
          fallbackMessage: "Reset request could not be processed yet.",
          internalMessage:
            "Reset request could not be processed because the service is being prepared. Try again later.",
        }),
      },
      { status: getSafeErrorStatus(error) },
    );
  }
}
