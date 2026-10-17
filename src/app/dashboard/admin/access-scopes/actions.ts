"use server";

import { revalidatePath } from "next/cache";

import { verifyAdminActionCsrfToken } from "@/features/auth/lib/auth-csrf";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import { recordAuthAuditEvent } from "@/features/auth/lib/mysql-auth-repository";
import { replaceUserSiteScopesInMysql } from "@/features/auth/lib/mysql-site-scope-repository";
import { getSafeErrorMessage } from "@/lib/safe-error-message";

const ACCESS_SCOPES_PATH = "/dashboard/admin/access-scopes";

export type AccessScopeActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

function failure(error: unknown): AccessScopeActionState {
  return {
    message: getSafeErrorMessage(error, {
      fallbackMessage: "The access scope could not be saved yet.",
      internalMessage:
        "The access scope could not be saved. Check the database connection and try again.",
    }),
    status: "error",
  };
}

export async function saveUserSiteScopesAction(
  _state: AccessScopeActionState,
  formData: FormData,
): Promise<AccessScopeActionState> {
  const admin = await requirePageAdmin();

  try {
    const csrfToken = String(formData.get("csrfToken") ?? "");
    const userId = String(formData.get("userId") ?? "").trim();
    const scopeRole = String(formData.get("scopeRole") ?? "viewer").trim();
    const note = String(formData.get("note") ?? "").trim();

    if (
      !verifyAdminActionCsrfToken({
        sessionId: admin.sessionId,
        token: csrfToken,
      })
    ) {
      throw new Error("Admin session is invalid. Reload the page and try again.");
    }

    if (!userId) {
      throw new Error("Select an account first.");
    }

    if (scopeRole !== "viewer" && scopeRole !== "operator") {
      throw new Error("Scope role must be viewer or operator.");
    }

    const siteIds = formData
      .getAll("siteIds")
      .map((value) => String(value).trim())
      .filter(Boolean);
    const result = await replaceUserSiteScopesInMysql({
      grantedByUserId: admin.id,
      note: note || null,
      scopeRole,
      siteIds,
      userId,
    });

    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "user_site_scopes_updated",
      metadata: {
        granted: result.granted,
        revoked: result.revoked,
        scopeRole,
        siteIds,
      },
      targetUserId: userId,
    }).catch(() => undefined);

    revalidatePath(ACCESS_SCOPES_PATH);

    return {
      message:
        siteIds.length === 0
          ? `All location access removed from this account (${result.revoked} scope(s) revoked). The account will not see any location while enforcement is on.`
          : `Access updated: ${siteIds.length} location(s) with the ${scopeRole} role.`,
      status: "success",
    };
  } catch (error) {
    return failure(error);
  }
}
