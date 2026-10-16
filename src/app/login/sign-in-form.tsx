"use client";

import type { FormEvent } from "react";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
} from "lucide-react";

export default function SignInForm({
  redirectTo = "/dashboard",
  verificationReason,
  verified,
}: {
  redirectTo?: string;
  verificationReason?: string;
  verified?: "0" | "1";
}) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [routePending, startRouteTransition] = useTransition();
  const busy = pending || navigating || routePending;

  useEffect(() => {
    router.prefetch(redirectTo || "/dashboard");
  }, [redirectTo, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNavigating(false);
    setError(null);
    setMessage(null);
    let shouldResetPending = true;

    const formData = new FormData(event.currentTarget);
    const body = challengeId
      ? {
          challengeId,
          code: String(formData.get("otp") ?? ""),
        }
      : {
          identity: String(formData.get("identity") ?? ""),
          password: String(formData.get("password") ?? ""),
        };

    try {
      const response = await fetch(
        challengeId ? "/api/auth/login/verify-otp" : "/api/auth/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            data?: {
              requiresOtp?: boolean;
              challengeId?: string;
              delivery?: "email" | "log";
              redirectTo?: string;
            };
          }
        | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error ?? "Sign-in failed.");
      }

      if (result.data?.requiresOtp && result.data.challengeId) {
        setChallengeId(result.data.challengeId);
        setMessage(
          result.data.delivery === "log"
            ? "The admin OTP code is printed in the development server log."
            : "The admin OTP code has been sent to your email.",
        );
        return;
      }

      const nextPath = redirectTo || result.data?.redirectTo || "/dashboard";

      setMessage("Signed in. Opening dashboard...");
      setNavigating(true);
      shouldResetPending = false;
      startRouteTransition(() => {
        router.replace(nextPath);
        router.refresh();
      });
    } catch (caughtError) {
      setNavigating(false);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Sign-in failed. Please check your credentials and try again.",
      );
    } finally {
      if (shouldResetPending) {
        setPending(false);
      }
    }
  }

  const notice = error
    ? {
        className: "border-red-100 bg-red-50 text-red-800",
        text: error,
      }
    : message
      ? {
          className: "border-blue-100 bg-blue-50 text-blue-800",
          text: message,
        }
      : verified === "1"
        ? {
            className: "border-emerald-100 bg-emerald-50 text-emerald-800",
            text: "Email verified successfully. If an admin has approved your access, you can sign in.",
          }
        : verified === "0"
          ? {
              className: "border-amber-100 bg-amber-50 text-amber-800",
              text: verificationReason || "Email verification was not successful.",
            }
          : null;

  return (
    <form
      className="mt-7 space-y-4"
      method="post"
      noValidate
      onSubmit={handleSubmit}
    >
      {challengeId ? null : (
        <div>
          <label
            className="mb-2 block text-sm font-semibold text-zinc-800"
            htmlFor="identity"
          >
            Email or username
          </label>
          <div className="relative">
            <Mail
              aria-hidden="true"
              className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            />
            <input
              autoComplete="username"
              autoFocus
              className="h-12 w-full rounded-lg border border-zinc-300 bg-white pl-11 pr-4 text-[0.95rem] text-zinc-950 outline-none transition placeholder:text-zinc-400 hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
              disabled={busy}
              id="identity"
              inputMode="email"
              name="identity"
              placeholder="name@company.co.id"
              required
              type="text"
            />
          </div>
        </div>
      )}

      {challengeId ? null : (
        <div>
          <div className="mb-2 flex items-center justify-between gap-4">
            <label
              className="text-sm font-semibold text-zinc-800"
              htmlFor="password"
            >
              Password
            </label>
            <Link
              className="text-xs font-semibold text-blue-600 transition hover:text-blue-700"
              href="/forgot-password"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <LockKeyhole
              aria-hidden="true"
              className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            />
            <input
              autoComplete="current-password"
              className="h-12 w-full rounded-lg border border-zinc-300 bg-white pl-11 pr-12 text-[0.95rem] text-zinc-950 outline-none transition placeholder:text-zinc-400 hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
              disabled={busy}
              id="password"
              name="password"
              placeholder="Enter your password"
              required
              type={showPassword ? "text" : "password"}
            />
            <button
              aria-label={
                showPassword ? "Hide password" : "Show password"
              }
              className="absolute inset-y-0 right-0 grid w-12 place-items-center text-zinc-400 transition hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
              disabled={busy}
              onClick={() => setShowPassword((visible) => !visible)}
              type="button"
            >
              {showPassword ? (
                <EyeOff aria-hidden="true" className="size-5" />
              ) : (
                <Eye aria-hidden="true" className="size-5" />
              )}
            </button>
          </div>
        </div>
      )}

      {challengeId ? (
        <div className="relative">
          <LockKeyhole
            aria-hidden="true"
            className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
          />
          <input
            autoComplete="one-time-code"
            className="h-12 w-full rounded-lg border border-zinc-300 bg-white pl-11 pr-4 text-center text-[1.05rem] font-semibold text-zinc-950 outline-none transition placeholder:text-zinc-400 hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
            disabled={busy}
            id="otp"
            inputMode="numeric"
            maxLength={6}
            name="otp"
            pattern="[0-9]{6}"
            placeholder="000000"
            required
            type="text"
          />
        </div>
      ) : null}

      {notice ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm leading-6 ${notice.className}`}
        >
          {notice.text}
        </div>
      ) : null}

      <button
        className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={busy}
        type="submit"
      >
        {navigating || routePending
          ? "Opening dashboard..."
          : pending
            ? "Processing..."
            : challengeId
              ? "Verify code"
              : "Sign in"}
        <ArrowRight
          aria-hidden="true"
          className="size-4 transition group-hover:translate-x-0.5"
        />
      </button>
    </form>
  );
}
