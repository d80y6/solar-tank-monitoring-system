import Link from "next/link";

import { BrandLogo } from "@/components/brand-logo";

export function DashboardFooter() {
  return (
    <footer className="border-t border-zinc-200/70 bg-white/95 text-sm text-zinc-500">
      <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
          <BrandLogo
            className="gap-2"
            markClassName="size-7"
            textClassName="text-sm font-semibold text-zinc-950"
          />
          <span className="hidden h-5 w-px bg-zinc-200 sm:block" />
          <p className="leading-6">FTM Fuel Tank Management Service.</p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-zinc-500">
          <span>&copy; 2026 FTM</span>
          <Link
            className="transition hover:text-blue-700"
            href="/dashboard/contact"
          >
            Contact
          </Link>
          <Link
            className="transition hover:text-blue-700"
            href="/dashboard/account/security"
          >
            Account security
          </Link>
        </div>
      </div>
    </footer>
  );
}
