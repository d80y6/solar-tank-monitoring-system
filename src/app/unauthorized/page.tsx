import Link from "next/link";
import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

export const metadata: Metadata = {
  title: "Access Unavailable | FTM",
  description:
    "Notice page shown when the account does not have permission to open a specific FTM area.",
};

export default function UnauthorizedPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f5faf8] px-4 text-zinc-950">
      <section className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 text-center shadow-sm">
        <span className="mx-auto grid size-12 place-items-center rounded-lg bg-red-50 text-red-600 ring-1 ring-red-100">
          <ShieldAlert className="size-6" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold">Access unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          Your account role does not yet have permission to open this page.
          Contact an administrator if you need additional access.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20"
        >
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}
