import { NextResponse, type NextRequest } from "next/server";

import { getRequestSessionUser } from "@/features/auth/lib/auth-session";
import { checkRateLimit } from "@/features/auth/lib/rate-limit";
import { requireSameOrigin } from "@/features/auth/lib/request-origin";
import { getOrCreateHelpdeskSession } from "@/features/helpdesk/lib/helpdesk-repository";
import { getSafeErrorMessage } from "@/lib/safe-error-message";
import { readJsonBodyOrReject } from "@/lib/request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getClientKey(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown-ip"
  );
}

function getStringPayloadValue(payload: unknown, key: string): string | null {
  const value = String(((payload ?? {}) as Record<string, unknown>)[key] ?? "")
    .trim();

  return value || null;
}

export async function POST(request: NextRequest) {
  const originBlock = requireSameOrigin(request);

  if (originBlock) {
    return originBlock;
  }

  try {
    const rateLimit = await checkRateLimit({
      key: `helpdesk-session:${getClientKey(request)}`,
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many helpdesk requests." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const { body: payloadValue, response: bodyBlock } =
      await readJsonBodyOrReject(request);

    if (bodyBlock) {
      return bodyBlock;
    }

    const payload = (payloadValue ?? {}) as Record<string, unknown>;
    const user = await getRequestSessionUser(request);
    const bundle = await getOrCreateHelpdeskSession({
      pagePath: getStringPayloadValue(payload, "pagePath"),
      sessionToken: getStringPayloadValue(payload, "sessionToken"),
      user,
    });

    return NextResponse.json({
      ok: true,
      data: bundle,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: getSafeErrorMessage(error, {
          fallbackMessage: "Helpdesk session could not be opened yet.",
          internalMessage:
            "Helpdesk session could not be opened because the database service is not ready.",
        }),
      },
      { status: 500 },
    );
  }
}
