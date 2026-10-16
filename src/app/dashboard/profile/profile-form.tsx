"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import type { AuthSafeUser } from "@/features/auth/types";
import {
  updateCurrentUserProfileAction,
  type ProfileActionState,
} from "./actions";

type ProfileFormProps = {
  user: AuthSafeUser;
};

const INITIAL_STATE: ProfileActionState = {
  status: "idle",
  message: "",
};

function splitFullName(fullName: string) {
  const parts = fullName
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
  const firstName = parts.shift() ?? fullName;
  const lastName = parts.join(" ");

  return { firstName, lastName };
}

function getRoleLabel(role: AuthSafeUser["role"]) {
  return role === "admin" ? "Admin" : "User";
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="inline-flex h-10 items-center justify-center rounded-full bg-blue-600 px-5 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:shadow-none"
      disabled={pending}
      type="submit"
    >
      {pending ? "Saving..." : "Save"}
    </button>
  );
}

function EditButton({
  isEditing,
  onClick,
}: {
  isEditing: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-9 items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15"
      onClick={onClick}
      type="button"
    >
      {isEditing ? "Cancel" : "Edit"}
      {!isEditing ? <Pencil className="size-4" aria-hidden="true" /> : null}
    </button>
  );
}

function InfoValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-zinc-400">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-zinc-950 sm:text-base">
        {value || "-"}
      </dd>
    </div>
  );
}

function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor: string;
}) {
  return (
    <label className="text-sm font-semibold text-zinc-400" htmlFor={htmlFor}>
      {children}
    </label>
  );
}

const inputClassName =
  "mt-2 h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-950 outline-none transition placeholder:text-zinc-400 hover:border-zinc-300 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-zinc-50 disabled:text-zinc-500";

export function ProfileForm({ user }: ProfileFormProps) {
  const router = useRouter();
  const initialName = useMemo(() => splitFullName(user.fullName), [user.fullName]);
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction] = useActionState(
    updateCurrentUserProfileAction,
    INITIAL_STATE,
  );

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status]);

  return (
    <section
      className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6"
      id="personal-information"
    >
      {/* Personal information card header */}
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">
          Personal Information
        </h2>
        <EditButton
          isEditing={isEditing}
          onClick={() => setIsEditing((current) => !current)}
        />
      </div>

      {isEditing ? (
        <form action={formAction} className="mt-6 grid gap-4">
          {/* Editable session-backed fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="firstName">First name</FieldLabel>
              <input
                autoComplete="given-name"
                className={inputClassName}
                defaultValue={initialName.firstName}
                id="firstName"
                maxLength={80}
                name="firstName"
                required
                type="text"
              />
            </div>
            <div>
              <FieldLabel htmlFor="lastName">Last name</FieldLabel>
              <input
                autoComplete="family-name"
                className={inputClassName}
                defaultValue={initialName.lastName}
                id="lastName"
                maxLength={80}
                name="lastName"
                placeholder="Optional"
                type="text"
              />
            </div>
            <div>
              <FieldLabel htmlFor="phone">Phone</FieldLabel>
              <input
                autoComplete="tel"
                className={inputClassName}
                defaultValue={user.phone ?? ""}
                id="phone"
                name="phone"
                placeholder="Example: 081234567890"
                type="tel"
              />
            </div>
            <div>
              <FieldLabel htmlFor="role">Role</FieldLabel>
              <input
                className={inputClassName}
                disabled
                id="role"
                type="text"
                value={getRoleLabel(user.role)}
              />
            </div>
          </div>

          <input name="fullName" type="hidden" value={user.fullName} />

          {state.message ? (
            <p
              aria-live="polite"
              className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
                state.status === "success"
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                  : "bg-red-50 text-red-700 ring-1 ring-red-100"
              }`}
            >
              {state.message}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-600/15"
              onClick={() => setIsEditing(false)}
              type="button"
            >
              Batal
            </button>
            <SubmitButton />
          </div>
        </form>
      ) : (
        <dl className="mt-7 grid gap-x-12 gap-y-7 sm:grid-cols-2">
          {/* Session-backed profile details */}
          <InfoValue label="First name" value={initialName.firstName} />
          <InfoValue label="Last name" value={initialName.lastName} />
          <InfoValue label="Email Address" value={user.email} />
          <InfoValue label="Phone" value={user.phone ?? "-"} />
          <InfoValue label="Role" value={getRoleLabel(user.role)} />
        </dl>
      )}
    </section>
  );
}
