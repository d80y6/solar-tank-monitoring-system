"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";

function PasswordInput({
  id,
  label,
  name,
}: {
  id: string;
  label: string;
  name: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label
        className="mb-2 block text-sm font-semibold text-zinc-800"
        htmlFor={id}
      >
        {label}
      </label>
      <div className="relative">
        <LockKeyhole
          aria-hidden="true"
          className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
        />
        <input
          autoComplete="new-password"
          className="h-12 w-full rounded-lg border border-zinc-300 bg-white pl-11 pr-12 text-[0.95rem] text-zinc-950 outline-none transition placeholder:text-zinc-400 hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
          id={id}
          name={name}
          placeholder="Minimum 10 characters, letters and numbers"
          required
          type={visible ? "text" : "password"}
        />
        <button
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 grid w-12 place-items-center text-zinc-400 transition hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="size-5" />
          ) : (
            <Eye aria-hidden="true" className="size-5" />
          )}
        </button>
      </div>
    </div>
  );
}

export default function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    token ? null : "The reset link is incomplete.",
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);

    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password: formData.get("password"),
          confirmPassword: formData.get("confirmPassword"),
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; data?: { message?: string } }
        | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error ?? "Password reset failed.");
      }

      setMessage(result.data?.message ?? "Password changed successfully.");
      setTimeout(() => {
        router.replace("/login");
      }, 1200);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The password reset could not be processed yet.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="mt-7 space-y-4" noValidate onSubmit={handleSubmit}>
      <input name="token" type="hidden" value={token} />

      <PasswordInput id="password" label="New password" name="password" />
      <PasswordInput
        id="confirmPassword"
        label="Confirm new password"
        name="confirmPassword"
      />

      {message ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
          {error}
        </div>
      ) : null}

      <button
        className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={pending || !token}
        type="submit"
      >
        {pending ? "Saving..." : "Save new password"}
        <ArrowRight
          aria-hidden="true"
          className="size-4 transition group-hover:translate-x-0.5"
        />
      </button>
    </form>
  );
}
