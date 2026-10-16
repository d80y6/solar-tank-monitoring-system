import { NextResponse, type NextRequest } from "next/server";

import { checkRateLimit } from "@/features/auth/lib/rate-limit";
import { loginWithPassword } from "@/features/auth/lib/auth-service";
import { parseLoginPayload } from "@/features/auth/lib/auth-validation";
import { setSessionCookie } from "@/features/auth/lib/auth-session";
import {
  getSafeErrorMessage,
  getSafeErrorStatus,
} from "@/lib/safe-error-message";
import { readJsonBodyOrReject } from "@/lib/request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getClientKey(request: NextRequest, identity: string) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown-ip";

  return `login:${ip}:${identity}`;
}

export async function POST(request: NextRequest) {
  try {
    const { body: payloadRaw, response: payloadBlock } =
      await readJsonBodyOrReject(request);

    if (payloadBlock) {
      return payloadBlock;
    }

    const payload = parseLoginPayload(payloadRaw);
    const rateLimit = await checkRateLimit({
      key: getClientKey(request, payload.identity),
      limit: 8,
      windowMs: 15 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "Too many sign-in attempts. Try again in a moment.",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    const loginResult = await loginWithPassword({
      identity: payload.identity,
      password: payload.password,
      request,
    });

    if (loginResult.status === "otp_required") {
      return NextResponse.json({
        ok: true,
        data: {
          requiresOtp: true,
          challengeId: loginResult.challengeId,
          delivery: loginResult.delivery,
        },
      });
    }

    const response = NextResponse.json({
      ok: true,
      data: {
        requiresOtp: false,
        redirectTo: "/dashboard",
      },
    });

    setSessionCookie({
      response,
      sessionToken: loginResult.sessionToken,
      expiresAt: loginResult.expiresAt,
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: getSafeErrorMessage(error, {
          fallbackMessage: "Sign-in failed. Please check your credentials again.",
          internalMessage:
            "Sign-in could not be processed because the service is being prepared. Try again later.",
        }),
      },
      { status: getSafeErrorStatus(error, { defaultStatus: 401 }) },
    );
  }
}
