import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { AuthRole, AuthSessionUser } from "../types";
import { getCurrentSessionUser, getRequestSessionUser } from "./auth-session";
import {
  buildDashboardNextPath,
  buildLoginRedirectPath,
} from "./auth-redirect";

async function getCurrentDashboardNextPath(): Promise<string> {
  try {
    const headerStore = await headers();

    return buildDashboardNextPath(
      headerStore.get("x-solar-tank-pathname"),
      headerStore.get("x-solar-tank-search") ?? "",
    );
  } catch {
    return "/dashboard";
  }
}

export async function requirePageUser(): Promise<AuthSessionUser> {
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect(buildLoginRedirectPath(await getCurrentDashboardNextPath()));
  }

  return user;
}

export async function requirePageAdmin(): Promise<AuthSessionUser> {
  const user = await requirePageUser();

  if (user.role !== "admin") {
    redirect("/unauthorized");
  }

  return user;
}

export async function requireApiUser(
  request: NextRequest,
  allowedRoles?: AuthRole[],
): Promise<
  | { ok: true; user: AuthSessionUser }
  | { ok: false; response: NextResponse }
> {
  const user = await getRequestSessionUser(request);

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Authentication required." },
        { status: 401 },
      ),
    };
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Access is not available for this account role." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, user };
}
