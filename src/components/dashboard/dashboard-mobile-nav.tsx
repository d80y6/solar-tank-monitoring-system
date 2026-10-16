"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { DashboardNavItem } from "./dashboard-header";

type DashboardMobileNavProps = {
  navItems: DashboardNavItem[];
};

function MobileNavItem({
  item,
  onNavigate,
}: {
  item: DashboardNavItem;
  onNavigate: () => void;
}) {
  const className = item.current
    ? "flex w-full items-center justify-between rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/15"
    : "flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15";

  if (item.current || !item.href) {
    return (
      <span className={className}>
        {item.label}
        <span className="text-xs font-semibold text-white/80">Active</span>
      </span>
    );
  }

  if (item.href.startsWith("#")) {
    return (
      <a className={className} href={item.href} onClick={onNavigate}>
        {item.label}
      </a>
    );
  }

  return (
    <Link className={className} href={item.href} onClick={onNavigate}>
      {item.label}
    </Link>
  );
}

export function DashboardMobileNav({ navItems }: DashboardMobileNavProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

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

  return (
    <div className="relative lg:hidden" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
        className="grid size-10 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-800 shadow-sm transition hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        {isOpen ? (
          <X className="size-5" aria-hidden="true" />
        ) : (
          <Menu className="size-5" aria-hidden="true" />
        )}
      </button>

      {isOpen ? (
        <div
          className="absolute right-0 top-full z-50 mt-3 w-[min(calc(100vw-2rem),22rem)] overflow-hidden rounded-2xl border border-zinc-200 bg-white p-2 shadow-2xl shadow-zinc-950/15"
          role="menu"
          style={{
            animation:
              "login-shell-enter 180ms cubic-bezier(0.22, 1, 0.36, 1) both",
          }}
        >
          <div className="border-b border-zinc-100 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
              Navigation
            </p>
            <p className="mt-1 text-sm font-semibold text-zinc-950">
              FTM
            </p>
          </div>
          <nav className="mt-2 grid gap-1" aria-label="Mobile navigation">
            {navItems.map((item) => (
              <MobileNavItem
                item={item}
                key={`${item.label}-${item.href ?? "current"}`}
                onNavigate={() => setIsOpen(false)}
              />
            ))}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
