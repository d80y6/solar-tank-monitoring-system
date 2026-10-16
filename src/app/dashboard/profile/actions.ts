"use server";

import { revalidatePath } from "next/cache";

import { requirePageUser } from "@/features/auth/lib/auth-guards";
import {
  normalizeIndonesianMobilePhone,
  normalizeText,
} from "@/features/auth/lib/auth-validation";
import {
  recordAuthAuditEvent,
  updateAuthUserProfile,
} from "@/features/auth/lib/mysql-auth-repository";
import { getSafeErrorMessage } from "@/lib/safe-error-message";

export type ProfileActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const PROFILE_PATHS_TO_REVALIDATE = [
  "/dashboard",
  "/dashboard/profile",
  "/dashboard/account/security",
] as const;

function parseProfilePayload(formData: FormData) {
  const firstName = normalizeText(formData.get("firstName"), 80);
  const lastName = normalizeText(formData.get("lastName"), 80);
  const fallbackFullName = normalizeText(formData.get("fullName"), 160);
  const fullName = normalizeText(
    [firstName, lastName].filter(Boolean).join(" ") || fallbackFullName,
    160,
  );
  const phoneInput = String(formData.get("phone") ?? "").trim();
  const phone = phoneInput ? normalizeIndonesianMobilePhone(phoneInput) : null;

  if (fullName.length < 2) {
    throw new Error("Full name must be at least 2 characters.");
  }

  return { fullName, phone };
}

export async function updateCurrentUserProfileAction(
  _state: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requirePageUser();

  try {
    const payload = parseProfilePayload(formData);

    await updateAuthUserProfile({
      userId: user.id,
      fullName: payload.fullName,
      phone: payload.phone,
    });
    await recordAuthAuditEvent({
      actorUserId: user.id,
      eventType: "auth_user_profile_updated",
      targetUserId: user.id,
      metadata: { changedFields: ["fullName", "phone"] },
    }).catch(() => undefined);

    for (const path of PROFILE_PATHS_TO_REVALIDATE) {
      revalidatePath(path);
    }

    return {
      status: "success",
      message: "Profile updated successfully.",
    };
  } catch (error) {
    return {
      status: "error",
      message: getSafeErrorMessage(error, {
        fallbackMessage: "Profile could not be updated yet.",
        internalMessage:
          "Profile could not be updated because the auth service is not ready.",
      }),
    };
  }
}
