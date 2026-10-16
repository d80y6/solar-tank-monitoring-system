import { NextResponse, type NextRequest } from "next/server";

import {
  clearSessionCookie,
  getRequestSessionUser,
} from "@/features/auth/lib/auth-session";
import { requireSameOrigin } from "@/features/auth/lib/request-origin";
import { logoutSession } from "@/features/auth/lib/auth-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originBlock = requireSameOrigin(request);

  if (originBlock) {
    return originBlock;
  }

  const user = await getRequestSessionUser(request);

  if (user) {
    await logoutSession(user.sessionId);
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);

  return response;
}
