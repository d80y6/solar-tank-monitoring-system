import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { createAdminActionCsrfToken } from "@/features/auth/lib/auth-csrf";
import { requirePageUser } from "@/features/auth/lib/auth-guards";
import { SimpleDashboardView } from "@/features/monitoring/components/simple-dashboard-view";
import { buildDashboardOverview } from "@/features/monitoring/lib/dashboard-view-model";
import { getMonitoringReferenceDataWithSource } from "@/features/monitoring/lib/monitoring-registry";
import { listLatestMonitoringReadingsByTankWithSource } from "@/features/monitoring/lib/monitoring-storage";
import {
  createSimpleDashboardSites,
  type SimpleDashboardSite,
} from "@/features/monitoring/lib/simple-dashboard-model";
import { ClipboardCheck, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "Fuel Tank Management | FTM",
  description:
    "Per-STO operational view for monitoring fuel tank volume, device status, and quick access to tank details.",
};

export const runtime = "nodejs";

export default async function SimpleDashboardPage() {
  await connection();
  const user = await requirePageUser();
  const isAdmin = user.role === "admin";
  const adminCleanupToken = isAdmin
    ? createAdminActionCsrfToken(user.sessionId)
    : undefined;

  const now = new Date();
  const [monitoringReadingsResult, monitoringReferenceResult] =
    await Promise.all([
      listLatestMonitoringReadingsByTankWithSource(),
      getMonitoringReferenceDataWithSource(),
    ]);

  const dashboardOverview = buildDashboardOverview({
    now,
    sites: monitoringReferenceResult.reference.sites,
    tanks: monitoringReferenceResult.reference.tanks,
    devices: monitoringReferenceResult.reference.devices,
    readings: monitoringReadingsResult.readings,
  });
  const capacityByTankId = new Map(
    monitoringReferenceResult.reference.tanks.map((tank) => [
      tank.id,
      tank.capacityLiter,
    ]),
  );
  const shapeByTankId = new Map(
    monitoringReferenceResult.reference.tanks.map((tank) => [
      tank.id,
      tank.shape,
    ]),
  );
  const simpleSites: SimpleDashboardSite[] = createSimpleDashboardSites(
    dashboardOverview.rows,
    capacityByTankId,
    shapeByTankId,
  );

  return (
    <main className="min-h-screen w-full min-w-0 overflow-x-hidden bg-[#f5faf8] text-zinc-950">
      <DashboardHeader
        navItems={[
          { current: true, label: "Tank Management" },
          ...(isAdmin
            ? [
                { href: "/dashboard/detail", label: "Technical Analysis" },
                {
                  href: "/dashboard/admin/users",
                  label: "User Management",
                },
                {
                  href: "/dashboard/admin/alerts",
                  label: "Alert Centre",
                },
                {
                  href: "/dashboard/admin/devices",
                  label: "Device Registry",
                },
              ]
            : []),
        ]}
        user={user}
      />

      <div className="mx-auto flex w-full max-w-[1540px] min-w-0 flex-col px-4 py-5 sm:px-6 lg:px-8">
        <section className="mb-4 flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase text-zinc-500">
              Device operations
            </p>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Request a new device or review requests awaiting approval.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/devices/request"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add device
            </Link>
            {isAdmin ? (
              <Link
                href="/dashboard/admin/device-requests"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15"
              >
                <ClipboardCheck className="size-4" aria-hidden="true" />
                Review requests
              </Link>
            ) : null}
          </div>
        </section>
        <SimpleDashboardView
          adminCleanupToken={adminCleanupToken}
          sites={simpleSites}
        />
      </div>
    </main>
  );
}
