import { NextResponse, type NextRequest } from "next/server";

import { requireApiUser } from "@/features/auth/lib/auth-guards";
import { startTelegramBinding } from "@/features/auth/lib/auth-service";
import { isTelegramConfigured } from "@/features/auth/lib/auth-telegram";
import { checkRateLimit } from "@/features/auth/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireApiUser(request);

  if (!auth.ok) {
    return auth.response;
  }

  if (!isTelegramConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Telegram bot is not configured." },
      { status: 503 },
    );
  }

  const rateLimit = await checkRateLimit({
    key: `telegram-bind:${auth.user.id}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many Telegram binding requests." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const result = await startTelegramBinding({
    user: auth.user,
    request,
  });

  return NextResponse.json({
    ok: true,
    data: {
      token: result.token,
      deepLink: result.deepLink,
      expiresAt: result.expiresAt.toISOString(),
    },
  });
}
