import AuthShell from "@/components/auth/auth-shell";
import { getCurrentSessionUser } from "@/features/auth/lib/auth-session";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import SignUpForm from "./sign-up-form";

export const metadata: Metadata = {
  title: "Request Access | FTM",
  description:
    "The FTM access request view for field operators and operational reviewers.",
};

export default async function RegisterPage() {
  const user = await getCurrentSessionUser().catch(() => null);

  if (user) {
    redirect("/dashboard");
  }

  return (
    <AuthShell
      contentWidth="wide"
      contextNote={{
        title: "Access request",
        description:
          "New accounts are submitted as requests and must be approved by an administrator before the dashboard can be opened.",
      }}
      description="Complete your work identity to request access to the tank management system."
      footerPrompt={
        <>
          Already have an account?{" "}
          <Link
            className="font-semibold text-blue-600 transition hover:text-blue-700"
            href="/login"
          >
            Sign in here
          </Link>
          .
        </>
      }
      heading="Request user access"
    >
      <SignUpForm />
    </AuthShell>
  );
}
