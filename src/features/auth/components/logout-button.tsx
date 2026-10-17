"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    if (pending) {
      return;
    }

    setPending(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-600/15 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      onClick={handleLogout}
      type="button"
    >
      <LogOut className="size-4" aria-hidden="true" />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
