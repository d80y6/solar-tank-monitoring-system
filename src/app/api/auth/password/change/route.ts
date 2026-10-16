import { NextResponse, type NextRequest } from "next/server";

import { requireApiUser } from "@/features/auth/lib/auth-guards";
import { changePasswordForSession } from "@/features/auth/lib/auth-service";
import { parseChangePasswordPayload } from "@/features/auth/lib/auth-validation";
import { checkRateLimit } from "@/features/auth/lib/rate-limit";
import {
  getSafeErrorMessage,
  getSafeErrorStatus,
} from "@/lib/safe-error-message";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireApiUser(request);

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const rateLimit = await checkRateLimit({
      key: `change-password:${auth.user.id}`,
      limit: 8,
      windowMs: 60 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "Too many attempts. Try again later.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    await changePasswordForSession({
      user: auth.user,
      payload: parseChangePasswordPayload(await request.json()),
      request,
    });

    return NextResponse.json({
      ok: true,
      data: {
        message: "Password changed successfully. Other sessions have been revoked.",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: getSafeErrorMessage(error, {
          fallbackMessage: "Password could not be changed yet.",
          internalMessage:
            "Password could not be changed because the service is being prepared. Try again later.",
        }),
      },
      { status: getSafeErrorStatus(error) },
    );
  }
}
