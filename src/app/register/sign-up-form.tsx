"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Eye,
  EyeOff,
  Mail,
  Phone,
  UserRound,
} from "lucide-react";

import { TurnstileWidget } from "@/features/auth/components/turnstile-widget";

const inputClassName =
  "h-11 w-full rounded-lg border border-zinc-300 bg-white px-3.5 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10";
const labelClassName =
  "mb-1.5 block text-[0.82rem] font-semibold text-zinc-800";
const captchaRequiredMessage =
  "Please complete the security verification first.";
const isCaptchaEnabled = Boolean(
  process.env.NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY?.trim(),
);

function PasswordField({
  id,
  label,
  name,
  placeholder,
}: {
  id: string;
  label: string;
  name: string;
  placeholder: string;
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div>
      <label className={labelClassName} htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          autoComplete="new-password"
          className={`${inputClassName} pr-11`}
          id={id}
          name={name}
          placeholder={placeholder}
          required
          type={showPassword ? "text" : "password"}
        />
        <button
          aria-label={
            showPassword ? `Hide ${label}` : `Show ${label}`
          }
          className="absolute inset-y-0 right-0 grid w-11 place-items-center text-zinc-400 transition hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
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
  );
}

function buildAccessReason(formData: FormData): string {
  const position = String(formData.get("position") ?? "").trim();
  const note = String(formData.get("accessReason") ?? "").trim();

  return [`Work role: ${position || "-"}`, note]
    .filter(Boolean)
    .join("\n\n");
}

export default function SignUpForm() {
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaRenderKey, setCaptchaRenderKey] = useState(0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError(null);
    setSubmitted(false);

    const formData = new FormData(form);
    const captchaToken = String(formData.get("captchaToken") ?? "").trim();

    if (isCaptchaEnabled && !captchaToken) {
      setError(captchaRequiredMessage);
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/auth/register-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName: formData.get("fullName"),
          username: formData.get("username"),
          email: formData.get("email"),
          phone: formData.get("phone"),
          requestedRole: "user",
          password: formData.get("password"),
          confirmPassword: formData.get("confirmPassword"),
          accessReason: buildAccessReason(formData),
          captchaToken,
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !result?.ok) {
        throw new Error(
          result?.error ?? "The access request could not be processed yet.",
        );
      }

      setSubmitted(true);
      form.reset();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The access request could not be processed yet.",
      );
    } finally {
      if (isCaptchaEnabled) {
        setCaptchaRenderKey((currentKey) => currentKey + 1);
      }
      setPending(false);
    }
  }

  return (
    <form className="mt-5 space-y-3.5" noValidate onSubmit={handleSubmit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClassName} htmlFor="fullName">
            Full name
          </label>
          <div className="relative">
            <UserRound
              aria-hidden="true"
              className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            />
            <input
              autoComplete="name"
              autoFocus
              className={`${inputClassName} pl-10`}
              id="fullName"
              name="fullName"
              placeholder="Name as shown on your ID"
              required
              type="text"
            />
          </div>
        </div>
        <div>
          <label className={labelClassName} htmlFor="username">
            Username
          </label>
          <input
            autoComplete="username"
            className={inputClassName}
            id="username"
            name="username"
            placeholder="Example: operator.pasuruan"
            required
            type="text"
          />
        </div>
      </div>

      <div>
        <label className={labelClassName} htmlFor="email">
          Work email
        </label>
        <div className="relative">
          <Mail
            aria-hidden="true"
            className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
          />
          <input
            autoComplete="email"
            className={`${inputClassName} pl-10`}
            id="email"
            inputMode="email"
            name="email"
            placeholder="name@company.co.id"
            required
            type="email"
          />
        </div>
        <p className="mt-1 text-[0.72rem] leading-5 text-zinc-500">
          Admins use this email to review and activate access.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClassName} htmlFor="phone">
            Phone number
          </label>
          <div className="relative">
            <Phone
              aria-hidden="true"
              className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            />
            <input
              autoComplete="tel"
              className={`${inputClassName} pl-10`}
              id="phone"
              inputMode="tel"
              pattern="(?:[+]?62|0|8)[0-9 .()-]{7,16}"
              name="phone"
              placeholder="08xxxxxxxxxx or +628xxxxxxxxxx"
              required
              title="Use an Indonesian mobile number, e.g. 081234567890 or +6281234567890."
              type="tel"
            />
          </div>
          <p className="mt-1 text-[0.72rem] leading-5 text-zinc-500">
            The number is stored consistently in +62 format.
          </p>
        </div>
        <div>
          <label className={labelClassName} htmlFor="position">
            Work role
          </label>
          <div className="relative">
            <BriefcaseBusiness
              aria-hidden="true"
              className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            />
            <select
              className={`${inputClassName} pl-10`}
              defaultValue=""
              id="position"
              name="position"
              required
            >
              <option disabled value="">
                Select a role
              </option>
              <option>Operations operator</option>
              <option>Field technician</option>
              <option>Operations reviewer</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PasswordField
          id="password"
          label="Password"
          name="password"
          placeholder="Minimum 10 characters"
        />
        <PasswordField
          id="confirmPassword"
          label="Confirm password"
          name="confirmPassword"
          placeholder="Repeat your password"
        />
      </div>

      <div>
        <label className={labelClassName} htmlFor="accessReason">
          Access note
        </label>
        <textarea
          className="min-h-24 w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-3 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
          id="accessReason"
          name="accessReason"
          placeholder="Example: need to monitor tank status for the Pasuruan STO area."
        />
      </div>

      <TurnstileWidget key={captchaRenderKey} />

      {submitted ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-800">
          Access request received. Check your work email for verification,
          then an administrator will review it before the account becomes
          active.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
          {error}
        </div>
      ) : null}

      <button
        className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={pending}
        type="submit"
      >
        {pending ? "Submitting..." : "Request access"}
        <ArrowRight
          aria-hidden="true"
          className="size-4 transition group-hover:translate-x-0.5"
        />
      </button>
    </form>
  );
}
