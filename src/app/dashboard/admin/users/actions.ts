"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { isAuthRole } from "@/features/auth/types";
import { verifyAdminActionCsrfToken } from "@/features/auth/lib/auth-csrf";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import {
  sendEmailVerificationForUserId,
  sendPasswordResetForUserId,
} from "@/features/auth/lib/auth-service";
import {
  approveAccessRequest,
  deleteAuthUser,
  recordAuthAuditEvent,
  rejectAccessRequest,
  revokeAllUserSessions,
  setAuthUserStatus,
  updateAuthUserRole,
} from "@/features/auth/lib/mysql-auth-repository";
import { getSafeErrorMessage } from "@/lib/safe-error-message";

const ADMIN_USERS_PATH = "/dashboard/admin/users";

export type AdminActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

function getRequiredFormValue(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();

  if (!value) {
    throw new Error("Admin action data is incomplete.");
  }

  return value;
}

function getAdminActionError(error: unknown): AdminActionState {
  return {
    status: "error",
    message: getSafeErrorMessage(error, {
      fallbackMessage: "Admin action could not be processed yet.",
      internalMessage:
        "Admin action could not be processed because the service is being prepared. Check the database connection and email configuration.",
    }),
  };
}

function getAdminActionSuccess(message: string): AdminActionState {
  return {
    status: "success",
    message,
  };
}

function assertValidAdminActionCsrf({
  sessionId,
  formData,
}: {
  sessionId: string;
  formData: FormData;
}) {
  const csrfToken = String(formData.get("csrfToken") ?? "");

  if (
    !verifyAdminActionCsrfToken({
      sessionId,
      token: csrfToken,
    })
  ) {
    throw new Error("Admin session is invalid. Reload the page and try again.");
  }
}

export async function approveAccessRequestAction(
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ sessionId: admin.sessionId, formData });
    const accessRequestId = getRequiredFormValue(formData, "accessRequestId");

    await approveAccessRequest({
      accessRequestId,
      adminUserId: admin.id,
    });
    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "access_request_approved",
      metadata: { accessRequestId },
    }).catch(() => undefined);

    revalidatePath(ADMIN_USERS_PATH);

    return getAdminActionSuccess("Access request approved successfully.");
  } catch (error) {
    return getAdminActionError(error);
  }
}

export async function rejectAccessRequestAction(
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ sessionId: admin.sessionId, formData });
    const accessRequestId = getRequiredFormValue(formData, "accessRequestId");

    await rejectAccessRequest({
      accessRequestId,
      adminUserId: admin.id,
    });
    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "access_request_rejected",
      metadata: { accessRequestId },
    }).catch(() => undefined);

    revalidatePath(ADMIN_USERS_PATH);

    return getAdminActionSuccess("Access request rejected successfully.");
  } catch (error) {
    return getAdminActionError(error);
  }
}

export async function changeAuthUserRoleAction(
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ sessionId: admin.sessionId, formData });
    const targetUserId = getRequiredFormValue(formData, "targetUserId");
    const roleValue = getRequiredFormValue(formData, "role");

    if (!isAuthRole(roleValue)) {
      throw new Error("User role is invalid.");
    }

    if (targetUserId === admin.id && roleValue !== "admin") {
      throw new Error("Admin cannot downgrade their own account role.");
    }

    await updateAuthUserRole({
      targetUserId,
      role: roleValue,
    });
    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "auth_user_role_changed",
      targetUserId,
      metadata: { role: roleValue },
    }).catch(() => undefined);

    revalidatePath(ADMIN_USERS_PATH);

    return getAdminActionSuccess("User role updated successfully.");
  } catch (error) {
    return getAdminActionError(error);
  }
}

export async function activateAuthUserAction(
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ sessionId: admin.sessionId, formData });
    const targetUserId = getRequiredFormValue(formData, "targetUserId");

    await setAuthUserStatus({
      targetUserId,
      status: "active",
    });
    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "auth_user_activated",
      targetUserId,
    }).catch(() => undefined);

    revalidatePath(ADMIN_USERS_PATH);

    return getAdminActionSuccess("User activated successfully.");
  } catch (error) {
    return getAdminActionError(error);
  }
}

export async function disableAuthUserAction(
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ sessionId: admin.sessionId, formData });
    const targetUserId = getRequiredFormValue(formData, "targetUserId");

    if (targetUserId === admin.id) {
      throw new Error("Admin cannot disable their own account.");
    }

    await setAuthUserStatus({
      targetUserId,
      status: "disabled",
    });
    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "auth_user_disabled",
      targetUserId,
    }).catch(() => undefined);

    revalidatePath(ADMIN_USERS_PATH);

    return getAdminActionSuccess("User disabled successfully.");
  } catch (error) {
    return getAdminActionError(error);
  }
}

export async function revokeAuthUserSessionsAction(
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ sessionId: admin.sessionId, formData });
    const targetUserId = getRequiredFormValue(formData, "targetUserId");

    if (targetUserId === admin.id) {
      throw new Error("Revoke your own account sessions via the sign-out button.");
    }

    await revokeAllUserSessions(targetUserId);
    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "auth_user_sessions_revoked",
      targetUserId,
    }).catch(() => undefined);

    revalidatePath(ADMIN_USERS_PATH);

    return getAdminActionSuccess("All user sessions revoked successfully.");
  } catch (error) {
    return getAdminActionError(error);
  }
}

export async function resendUserVerificationEmailAction(
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ sessionId: admin.sessionId, formData });
    const targetUserId = getRequiredFormValue(formData, "targetUserId");

    await sendEmailVerificationForUserId({
      userId: targetUserId,
      request: { headers: await headers() },
    });
    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "auth_user_verification_email_resent",
      targetUserId,
    }).catch(() => undefined);

    revalidatePath(ADMIN_USERS_PATH);

    return getAdminActionSuccess("Verification email sent successfully.");
  } catch (error) {
    return getAdminActionError(error);
  }
}

export async function sendUserPasswordResetAction(
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ sessionId: admin.sessionId, formData });
    const targetUserId = getRequiredFormValue(formData, "targetUserId");

    if (targetUserId === admin.id) {
      throw new Error("Reset your own account password from account security.");
    }

    await sendPasswordResetForUserId({
      userId: targetUserId,
      request: { headers: await headers() },
    });
    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "auth_user_password_reset_sent",
      targetUserId,
    }).catch(() => undefined);

    revalidatePath(ADMIN_USERS_PATH);

    return getAdminActionSuccess("Password reset link sent successfully.");
  } catch (error) {
    return getAdminActionError(error);
  }
}

export async function deleteAuthUserAction(
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requirePageAdmin();

  try {
    assertValidAdminActionCsrf({ sessionId: admin.sessionId, formData });
    const targetUserId = getRequiredFormValue(formData, "targetUserId");

    if (targetUserId === admin.id) {
      throw new Error("Admin cannot delete their own account.");
    }

    const deletedUser = await deleteAuthUser({ targetUserId });

    await recordAuthAuditEvent({
      actorUserId: admin.id,
      eventType: "auth_user_deleted",
      metadata: {
        deletedUserEmail: deletedUser.email,
        deletedUserId: deletedUser.id,
        deletedUserRole: deletedUser.role,
        deletedUserStatus: deletedUser.status,
        deletedUsername: deletedUser.username,
      },
    }).catch(() => undefined);

    revalidatePath(ADMIN_USERS_PATH);

    return getAdminActionSuccess("User deleted successfully.");
  } catch (error) {
    return getAdminActionError(error);
  }
}
