import { NextResponse, type NextRequest } from "next/server";

import { resetPasswordWithToken } from "@/features/auth/lib/auth-service";
import { parseResetPasswordPayload } from "@/features/auth/lib/auth-validation";
import { checkRateLimit } from "@/features/auth/lib/rate-limit";
import {
  getSafeErrorMessage,
  getSafeErrorStatus,
} from "@/lib/safe-error-message";
import { readJsonBodyOrReject } from "@/lib/request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown-ip"
  );
}

export async function POST(request: NextRequest) {
  try {
    const { body: payloadRaw, response: payloadBlock } =
      await readJsonBodyOrReject(request);

    if (payloadBlock) {
      return payloadBlock;
    }

    const payload = parseResetPasswordPayload(payloadRaw);
    const rateLimit = await checkRateLimit({
      key: `reset-password:${getClientIp(request)}`,
      limit: 8,
      windowMs: 60 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "Too many reset attempts. Try again later.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    await resetPasswordWithToken({ payload, request });

    return NextResponse.json({
      ok: true,
      data: {
        message:
          "Password changed successfully. Please sign in again with your new password.",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: getSafeErrorMessage(error, {
          fallbackMessage: "Password reset could not be processed yet.",
          internalMessage:
            "Password reset could not be processed because the service is being prepared. Try again later.",
        }),
      },
      { status: getSafeErrorStatus(error) },
    );
  }
}
