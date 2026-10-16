import { NextResponse, type NextRequest } from "next/server";

import { verifyCaptchaToken } from "@/features/auth/lib/auth-captcha";
import { isAccessRequestEnabled } from "@/features/auth/lib/auth-config";
import { submitAccessRequest } from "@/features/auth/lib/auth-service";
import { parseRegisterAccessPayload } from "@/features/auth/lib/auth-validation";
import { checkRateLimit } from "@/features/auth/lib/rate-limit";
import {
  getSafeErrorMessage,
  getSafeErrorStatus,
} from "@/lib/safe-error-message";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getClientKey(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown-ip"
  );
}

function getCaptchaToken(payload: unknown): string | null {
  const token = String(
    ((payload ?? {}) as Record<string, unknown>).captchaToken ?? "",
  ).trim();

  return token || null;
}

function getRegisterErrorResponse(error: unknown): {
  message: string;
  status: number;
} {
  return {
    message: getSafeErrorMessage(error, {
      fallbackMessage: "Access request could not be processed yet.",
      internalMessage:
        "Access request could not be processed because the service is being prepared. Try again later or contact the administrator.",
    }),
    status: getSafeErrorStatus(error),
  };
}

export async function POST(request: NextRequest) {
  if (!isAccessRequestEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Access requests are currently closed." },
      { status: 403 },
    );
  }

  try {
    const rateLimit = await checkRateLimit({
      key: `register:${getClientKey(request)}`,
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
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    const rawPayload = await request.json();
    const captcha = await verifyCaptchaToken({
      token: getCaptchaToken(rawPayload),
      remoteIp: getClientKey(request),
    });

    if (!captcha.ok) {
      return NextResponse.json(
        { ok: false, error: captcha.error },
        { status: 400 },
      );
    }

    const payload = {
      ...parseRegisterAccessPayload(rawPayload),
      requestedRole: "user" as const,
    };
    await submitAccessRequest(payload, request);

    return NextResponse.json({
      ok: true,
      data: {
        status: "pending",
        message:
          "Access request received. An administrator will review it before the account becomes active.",
      },
    });
  } catch (error) {
    const response = getRegisterErrorResponse(error);

    return NextResponse.json(
      {
        ok: false,
        error: response.message,
      },
      { status: response.status },
    );
  }
}
