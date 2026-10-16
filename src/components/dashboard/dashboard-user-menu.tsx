"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, KeyRound, LogOut, Send, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AuthSafeUser } from "@/features/auth/types";

type DashboardUserMenuProps = {
  user: Pick<
    AuthSafeUser,
    "email" | "fullName" | "role" | "telegramVerifiedAt" | "username"
  >;
};

function getAvatarLabel(user: DashboardUserMenuProps["user"]) {
  const nameParts = user.fullName
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);

  if (nameParts.length >= 2) {
    return `${nameParts[0][0] ?? ""}${nameParts[1][0] ?? ""}`.toUpperCase();
  }

  return (nameParts[0]?.slice(0, 2) || user.username.slice(0, 2) || "ST")
    .toUpperCase()
    .slice(0, 2);
}

function getRoleLabel(role: AuthSafeUser["role"]) {
  return role === "admin" ? "Administrator" : "User";
}

export function DashboardUserMenu({ user }: DashboardUserMenuProps) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const avatarLabel = getAvatarLabel(user);
  const needsTelegramBinding = !user.telegramVerifiedAt;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);

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
    <div className="relative shrink-0" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={
          needsTelegramBinding
            ? "Open account menu, Telegram not connected"
            : "Open account menu"
        }
        className="relative grid size-10 place-items-center rounded-full bg-zinc-950 text-sm font-semibold text-white shadow-sm ring-1 ring-zinc-950/10 transition hover:scale-[1.03] hover:bg-blue-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        {avatarLabel}
        {needsTelegramBinding ? (
          <span className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-red-600 text-[0.7rem] font-black leading-none text-white ring-2 ring-white">
            !
            <span className="sr-only">Telegram not connected</span>
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div
          className="absolute right-0 top-full z-50 mt-3 w-72 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-950/15"
          role="menu"
          style={{
            animation:
              "login-shell-enter 180ms cubic-bezier(0.22, 1, 0.36, 1) both",
          }}
        >
          {/* Account identity */}
          <div className="bg-[#f3ebe7] px-5 py-5 text-center">
            <div className="relative mx-auto grid size-16 place-items-center rounded-full bg-blue-600 text-xl font-semibold text-white shadow-sm ring-4 ring-white">
              {avatarLabel}
              {needsTelegramBinding ? (
                <span className="absolute -right-0.5 top-0 grid size-6 place-items-center rounded-full bg-red-600 text-xs font-black text-white ring-4 ring-white">
                  !
                </span>
              ) : null}
            </div>
            <p className="mt-3 truncate text-sm font-semibold text-zinc-950">
              {user.fullName}
            </p>
            <p className="mt-0.5 truncate text-xs text-zinc-600">{user.email}</p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {getRoleLabel(user.role)}
            </p>
          </div>

          {/* Account actions */}
          <div className="grid gap-1 p-2">
            {needsTelegramBinding ? (
              <Link
                className="mb-1 grid gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-left text-sm text-amber-950 transition hover:border-amber-300 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-500/20"
                href="/dashboard/account/security"
                onClick={() => setIsOpen(false)}
                role="menuitem"
              >
                <span className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white text-amber-700 ring-1 ring-amber-200">
                    <AlertTriangle className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      Telegram not connected
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-amber-800">
                      Connect your account so Telegram notifications and
                      features are ready to use.
                    </span>
                  </span>
                </span>
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-amber-800">
                  <Send className="size-3.5" aria-hidden="true" />
                  Connect Telegram
                </span>
              </Link>
            ) : null}

            <Link
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15"
              href="/dashboard/profile"
              onClick={() => setIsOpen(false)}
              role="menuitem"
            >
              <UserRound className="size-4" aria-hidden="true" />
              Profile
            </Link>
            <Link
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15"
              href="/dashboard/account/security"
              onClick={() => setIsOpen(false)}
              role="menuitem"
            >
              <KeyRound className="size-4" aria-hidden="true" />
              Account security
            </Link>
            <button
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-600/15 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isLoggingOut}
              onClick={handleLogout}
              role="menuitem"
              type="button"
            >
              <LogOut className="size-4" aria-hidden="true" />
              {isLoggingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
