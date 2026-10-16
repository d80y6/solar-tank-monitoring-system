import { NextResponse, type NextRequest } from "next/server";

import { requireApiUser } from "@/features/auth/lib/auth-guards";
import { requireSameOrigin } from "@/features/auth/lib/request-origin";
import { revokeCurrentUserSessionById } from "@/features/auth/lib/auth-service";
import {
  getSafeErrorMessage,
  getSafeErrorStatus,
} from "@/lib/safe-error-message";
import { readJsonBodyOrReject } from "@/lib/request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originBlock = requireSameOrigin(request);

  if (originBlock) {
    return originBlock;
  }

  const auth = await requireApiUser(request);

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { body: bodyValue, response: bodyBlock } =
      await readJsonBodyOrReject(request);

    if (bodyBlock) {
      return bodyBlock;
    }

    const body = (bodyValue ?? {}) as Record<string, unknown>;
    const sessionId = String(body.sessionId ?? "").trim();

    if (!sessionId) {
      throw new Error("Session is invalid.");
    }

    await revokeCurrentUserSessionById({
      user: auth.user,
      sessionId,
    });

    return NextResponse.json({
      ok: true,
      data: { message: "Session revoked successfully." },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: getSafeErrorMessage(error, {
          fallbackMessage: "Session could not be revoked yet.",
          internalMessage:
            "Session could not be revoked because the service is being prepared. Try again later.",
        }),
      },
      { status: getSafeErrorStatus(error) },
    );
  }
}
