import AuthShell from "@/components/auth/auth-shell";
import type { Metadata } from "next";
import Link from "next/link";
import ForgotPasswordForm from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot Password | FTM",
  description:
    "FTM account password reset request via your registered email.",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      description="Enter your email or username. If the account is found, a reset link will be sent to the registered email."
      footerPrompt={
        <>
          Remember your access?{" "}
          <Link
            className="font-semibold text-blue-600 transition hover:text-blue-700"
            href="/login"
          >
            Sign back in
          </Link>
          .
        </>
      }
      heading="Reset password"
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
