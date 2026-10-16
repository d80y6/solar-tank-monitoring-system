import { NextResponse, type NextRequest } from "next/server";

import { getRequestSessionUser } from "@/features/auth/lib/auth-session";
import { checkRateLimit } from "@/features/auth/lib/rate-limit";
import { requireSameOrigin } from "@/features/auth/lib/request-origin";
import {
  addUserHelpdeskMessage,
  getOrCreateHelpdeskSession,
  normalizeHelpdeskMessage,
} from "@/features/helpdesk/lib/helpdesk-repository";
import { notifyAdminsHelpdeskMessageCreated } from "@/features/helpdesk/lib/helpdesk-notifications";
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

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionToken = searchParams.get("sessionToken");

    if (!sessionToken) {
      return NextResponse.json(
        { ok: false, error: "Helpdesk session token is unavailable." },
        { status: 400 },
      );
    }

    const bundle = await getOrCreateHelpdeskSession({
      pagePath: searchParams.get("pagePath"),
      sessionToken,
      user: await getRequestSessionUser(request),
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
          fallbackMessage: "Helpdesk messages could not be loaded yet.",
          internalMessage:
            "Helpdesk messages could not be loaded because the database service is not ready.",
        }),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const originBlock = requireSameOrigin(request);

  if (originBlock) {
    return originBlock;
  }

  try {
    const rateLimit = await checkRateLimit({
      key: `helpdesk-message:${getClientKey(request)}`,
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many helpdesk messages." },
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
    const result = await addUserHelpdeskMessage({
      body: normalizeHelpdeskMessage(getStringPayloadValue(payload, "message")),
      pagePath: getStringPayloadValue(payload, "pagePath"),
      sessionToken: getStringPayloadValue(payload, "sessionToken"),
      user,
    });

    await notifyAdminsHelpdeskMessageCreated({
      message: result.message,
      session: result.session,
    }).catch(() => undefined);

    return NextResponse.json({
      ok: true,
      data: result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: getSafeErrorMessage(error, {
          fallbackMessage: "Helpdesk message could not be sent yet.",
          internalMessage:
            "Helpdesk message could not be sent because the database service is not ready.",
        }),
      },
      { status: 500 },
    );
  }
}
