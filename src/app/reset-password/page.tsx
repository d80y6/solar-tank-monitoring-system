import AuthShell from "@/components/auth/auth-shell";
import type { Metadata } from "next";
import Link from "next/link";
import ResetPasswordForm from "./reset-password-form";

export const metadata: Metadata = {
  title: "Create New Password | FTM",
  description: "Create a new password from the FTM account reset link.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token ?? "";

  return (
    <AuthShell
      description="Create a new password. Once successful, all previous sessions will be revoked and you will need to sign in again."
      footerPrompt={
        <>
          Back to the{" "}
          <Link
            className="font-semibold text-blue-600 transition hover:text-blue-700"
            href="/login"
          >
            sign-in page
          </Link>
          .
        </>
      }
      heading="Create a new password"
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
