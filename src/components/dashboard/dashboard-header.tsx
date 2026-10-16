import Link from "next/link";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/brand-logo";
import type { AuthSafeUser } from "@/features/auth/types";
import { DashboardMobileNav } from "./dashboard-mobile-nav";
import { DashboardUserMenu } from "./dashboard-user-menu";

export type DashboardNavItem = {
  current?: boolean;
  href?: string;
  label: string;
};

type DashboardHeaderProps = {
  navItems: DashboardNavItem[];
  rightSlot?: ReactNode;
  user: Pick<
    AuthSafeUser,
    "email" | "fullName" | "role" | "telegramVerifiedAt" | "username"
  >;
};

const dashboardContactItem: DashboardNavItem = {
  href: "/dashboard/contact",
  label: "Contact",
};

function withDashboardContact(navItems: DashboardNavItem[]) {
  if (
    navItems.some(
      (item) =>
        item.href === dashboardContactItem.href ||
        item.label.toLowerCase() === dashboardContactItem.label.toLowerCase(),
    )
  ) {
    return navItems;
  }

  return [...navItems, dashboardContactItem];
}

function DashboardNavLink({ item }: { item: DashboardNavItem }) {
  const className = item.current
    ? "shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-center text-white shadow-lg shadow-blue-600/15"
    : "shrink-0 rounded-lg px-3 py-2 text-center transition hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15";

  if (item.current || !item.href) {
    return <span className={className}>{item.label}</span>;
  }

  if (item.href.startsWith("#")) {
    return (
      <a className={className} href={item.href}>
        {item.label}
      </a>
    );
  }

  return (
    <Link className={className} href={item.href}>
      {item.label}
    </Link>
  );
}

export function DashboardHeader({
  navItems,
  rightSlot,
  user,
}: DashboardHeaderProps) {
  const resolvedNavItems = withDashboardContact(navItems);

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/70 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1540px] min-w-0 items-center justify-between gap-3 px-4 sm:px-6 lg:gap-4 lg:px-8">
        {/* Brand */}
        <div className="flex min-w-0 items-center gap-3">
          <Link
            aria-label="Back to the FTM dashboard"
            className="min-w-0"
            href="/dashboard"
          >
            <BrandLogo
              markClassName="size-9"
              textClassName="text-lg font-semibold"
            />
          </Link>
        </div>

        {/* Desktop navigation */}
        <div className="hidden min-w-0 flex-1 items-center justify-end gap-3 lg:flex">
          <nav className="flex min-w-0 flex-none items-center gap-2 whitespace-nowrap py-1 text-sm font-semibold text-zinc-600">
            {resolvedNavItems.map((item) => (
              <DashboardNavLink
                item={item}
                key={`${item.label}-${item.href ?? "current"}`}
              />
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-3">
            {rightSlot}
            <DashboardUserMenu user={user} />
          </div>
        </div>

        {/* Mobile actions */}
        <div className="flex shrink-0 items-center gap-2 lg:hidden">
          <DashboardUserMenu user={user} />
          <DashboardMobileNav navItems={resolvedNavItems} />
        </div>
      </div>
    </header>
  );
}
