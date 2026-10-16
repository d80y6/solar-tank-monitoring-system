import type { NextRequest } from "next/server";

import {
  getReadinessCheckToken,
  isProductionLikeEnvironment,
} from "@/features/auth/lib/auth-config";
import { requireApiUser } from "@/features/auth/lib/auth-guards";
import { getDeploymentReadiness } from "@/features/monitoring/lib/deployment-probes";
import { hasValidReadinessToken } from "@/features/monitoring/lib/readiness-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authorizeReadiness(request: NextRequest) {
  const readinessToken = getReadinessCheckToken();

  if (
    hasValidReadinessToken({
      expectedToken: readinessToken,
      headers: request.headers,
    })
  ) {
    return null;
  }

  if (!isProductionLikeEnvironment() && !readinessToken) {
    return null;
  }

  const auth = await requireApiUser(request, ["admin"]);

  if (auth.ok) {
    return null;
  }

  return Response.json(
    {
      ok: false,
      error: "Operational readiness is only available for admins.",
    },
    {
      status: 401,
    },
  );
}

export async function GET(request: NextRequest) {
  const unauthorizedResponse = await authorizeReadiness(request);

  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const readiness = await getDeploymentReadiness();

  return Response.json(
    {
      ok: readiness.ok,
      data: readiness,
    },
    {
      status: readiness.ok ? 200 : 503,
    },
  );
}
