import type { Metadata } from "next";
import { MapPinned, ShieldAlert, Users } from "lucide-react";

import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { createAdminActionCsrfToken } from "@/features/auth/lib/auth-csrf";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import { listUserSiteScopeSummariesFromMysql } from "@/features/auth/lib/mysql-site-scope-repository";
import { isSiteScopeEnforcementEnabled } from "@/features/auth/lib/site-scope";
import { getMonitoringReferenceDataWithSource } from "@/features/monitoring/lib/monitoring-registry";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";

import { AccessScopeForm } from "./access-scope-controls";

export const metadata: Metadata = {
  title: "Location Access | FTM",
  description:
    "Per-location access scopes: which operator may read which sites and tanks.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminAccessScopesPage() {
  const admin = await requirePageAdmin();
  const csrfToken = createAdminActionCsrfToken(admin.sessionId);
  const storageDriver = getMonitoringStorageDriver();
  const enforcementEnabled = isSiteScopeEnforcementEnabled();

  const [scopeSummaries, referenceResult] = await Promise.all([
    storageDriver === "mysql"
      ? listUserSiteScopeSummariesFromMysql().catch(() => [])
      : Promise.resolve([]),
    getMonitoringReferenceDataWithSource().catch(() => null),
  ]);
  const sites = (referenceResult?.reference.sites ?? [])
    .map((site) => ({
      label: `${site.code} — ${site.name}`,
      siteId: site.id,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  return (
    <main className="min-h-screen bg-[#f5faf8] text-zinc-950">
      <DashboardHeader
        navItems={[
          { href: "/dashboard", label: "Tank Management" },
          { href: "/dashboard/admin/users", label: "User Management" },
          { href: "/dashboard/admin/alerts", label: "Alert Centre" },
          { href: "/dashboard/admin/devices", label: "Device Registry" },
          { href: "/dashboard/admin/hardware-registry", label: "Hardware Registry" },
          { current: true, label: "Location Access" },
        ]}
        user={admin}
      />

      <div className="mx-auto flex max-w-[1540px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
              <MapPinned aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase text-zinc-500">
                Per-location access
              </p>
              <h1 className="mt-1 text-xl font-semibold text-zinc-950">
                Which operator may read which location
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                Assign one or more locations to an operator account. Administrators
                always keep full access. Enforcement is opt-in through{" "}
                <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">
                  AUTH_ENFORCE_SITE_SCOPES
                </code>
                : with enforcement off the scopes are recorded but every account
                still sees every location, so you can prepare assignments before
                switching.
              </p>
              <p className="mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold">
                <span
                  className={
                    enforcementEnabled
                      ? "size-2 rounded-full bg-emerald-500"
                      : "size-2 rounded-full bg-amber-500"
                  }
                />
                {enforcementEnabled
                  ? "Enforcement is ON: non-admin accounts only see their assigned locations."
                  : "Enforcement is OFF: every signed-in account currently sees every location."}
              </p>
            </div>
          </div>
        </section>

        {storageDriver !== "mysql" ? (
          <section className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <p>
              Location scopes are stored in MySQL. The active storage driver is{" "}
              <strong>{storageDriver}</strong>, so scopes cannot be assigned here
              yet. Set{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">
                SOLAR_TANK_STORAGE_DRIVER=mysql
              </code>{" "}
              and run <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">pnpm db:migrate:site-access</code>.
            </p>
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <Users aria-hidden="true" className="size-4" />
            {scopeSummaries.length} account(s)
          </div>

          {scopeSummaries.length === 0 ? (
            <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600 shadow-sm">
              No accounts are available yet. Create an administrator account, then
              register operators — they will appear here for scoping.
            </p>
          ) : (
            <div className="grid gap-3">
              {scopeSummaries.map((summary) => (
                <AccessScopeForm
                  csrfToken={csrfToken}
                  key={summary.userId}
                  sites={sites}
                  user={{
                    assignedSiteIds: summary.scopes.map((scope) => scope.siteId),
                    fullName: summary.fullName,
                    role: summary.role,
                    scopeRole: summary.scopes[0]?.scopeRole ?? "viewer",
                    userId: summary.userId,
                    username: summary.username,
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
