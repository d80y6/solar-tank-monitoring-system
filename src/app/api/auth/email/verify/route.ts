import { NextResponse, type NextRequest } from "next/server";

import { verifyEmailToken } from "@/features/auth/lib/auth-service";
import { getSafeErrorMessage } from "@/lib/safe-error-message";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  const redirectUrl = new URL("/login", request.url);

  try {
    if (!token) {
      throw new Error("Verification token not found.");
    }

    await verifyEmailToken({ token, request });
    redirectUrl.searchParams.set("verified", "1");
  } catch (error) {
    redirectUrl.searchParams.set("verified", "0");
    redirectUrl.searchParams.set(
      "reason",
      getSafeErrorMessage(error, {
        fallbackMessage: "Email verification failed.",
        internalMessage:
          "Email verification could not be processed because the service is being prepared. Try again later.",
      }),
    );
  }

  return NextResponse.redirect(redirectUrl);
}
