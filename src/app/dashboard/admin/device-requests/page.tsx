import Link from "next/link";
import type { Metadata } from "next";
import { Clock3, Database, Search, ShieldCheck } from "lucide-react";

import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { createAdminActionCsrfToken } from "@/features/auth/lib/auth-csrf";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import { getDeviceRequestStatusLabel } from "@/features/monitoring/lib/device-request";
import {
  listDeviceRequestsForAdminFromMysql,
  listHardwareProfilesFromMysql,
} from "@/features/monitoring/lib/mysql-device-request-repository";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";
import type {
  DeviceRequestStatus,
  MonitoringDeviceRequest,
} from "@/features/monitoring/types/monitoring";
import { AdminDeviceRequestsPanel } from "./admin-device-requests-panel";

const DEVICE_REQUEST_STATUS_OPTIONS: Array<{
  label: string;
  value: DeviceRequestStatus | "all";
}> = [
  { label: "All statuses", value: "all" },
  { label: "Waiting for review", value: "pending_admin_review" },
  { label: "Approved", value: "approved_package_ready" },
  { label: "Waiting for device", value: "waiting_first_valid_ping" },
  { label: "Active", value: "active" },
  { label: "Rejected", value: "rejected" },
  { label: "Revoked", value: "revoked" },
  { label: "Expired", value: "expired" },
];

type AdminDeviceRequestsPageProps = {
  searchParams: Promise<{
    q?: string;
    status?: string;
  }>;
};

export const metadata: Metadata = {
  title: "Review Device Requests | FTM",
  description:
    "Admin review for new device requests before the FTM firmware package is created.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeFilterValue(value: string) {
  return value.toLocaleLowerCase("en-US").trim();
}

function getRequestedStatus(value: string | undefined) {
  const cleanValue = String(value ?? "all").trim();
  const matchedOption = DEVICE_REQUEST_STATUS_OPTIONS.find(
    (option) => option.value === cleanValue,
  );

  return matchedOption?.value ?? "all";
}

function filterDeviceRequests({
  query,
  requests,
  status,
}: {
  query: string;
  requests: MonitoringDeviceRequest[];
  status: DeviceRequestStatus | "all";
}) {
  const cleanQuery = normalizeFilterValue(query);

  return requests.filter((request) => {
    if (status !== "all" && request.status !== status) {
      return false;
    }

    if (!cleanQuery) {
      return true;
    }

    const haystack = [
      request.requestCode,
      request.siteCode,
      request.siteName,
      request.areaLabel,
      request.regionalLabel,
      request.wilayahLabel,
      request.deviceCode,
      request.deviceLabel,
      request.requesterEmail,
      request.requesterUserId,
      getDeviceRequestStatusLabel(request.status),
    ]
      .map(normalizeFilterValue)
      .join(" ");

    return haystack.includes(cleanQuery);
  });
}

export default async function AdminDeviceRequestsPage({
  searchParams,
}: AdminDeviceRequestsPageProps) {
  const admin = await requirePageAdmin();
  const params = await searchParams;
  const query = String(params.q ?? "").trim();
  const statusFilter = getRequestedStatus(params.status);
  const csrfToken = createAdminActionCsrfToken(admin.sessionId);
  const isMysqlEnabled = getMonitoringStorageDriver() === "mysql";
  const [requests, hardwareProfiles] = isMysqlEnabled
    ? await Promise.all([
        listDeviceRequestsForAdminFromMysql(),
        listHardwareProfilesFromMysql(),
      ])
    : [[], []];
  const pendingCount = requests.filter(
    (request) => request.status === "pending_admin_review",
  ).length;
  const filteredRequests = filterDeviceRequests({
    query,
    requests,
    status: statusFilter,
  });

  return (
    <main className="flex min-h-screen flex-col overflow-x-hidden bg-[#f5faf8] text-zinc-950 lg:h-screen lg:overflow-hidden">
      <DashboardHeader
        navItems={[
          { href: "/dashboard", label: "Tank Management" },
          { current: true, label: "Review requests" },
          { href: "/dashboard/admin/users", label: "User Management" },
          { href: "/dashboard/admin/alerts", label: "Alert Centre" },
          { href: "/dashboard/admin/devices", label: "Device Registry" },
        ]}
        user={admin}
      />

      <div className="mx-auto flex w-full max-w-[1540px] flex-1 flex-col gap-3 px-4 py-3 sm:px-6 lg:min-h-0 lg:px-8">
        {/* Summary section */}
        <section className="shrink-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_520px] xl:items-center">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-600">
                New device review
              </p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
                Device requests before the firmware package is created
              </h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-zinc-500">
                Admins first see a compact list. Technical details, validation, and
                decision actions open from the review button to keep the page clean.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  icon: Clock3,
                  label: "Pending",
                  value: pendingCount,
                },
                {
                  icon: Database,
                  label: "Total",
                  value: requests.length,
                },
                {
                  icon: ShieldCheck,
                  label: "Admin",
                  value: admin.fullName,
                },
              ].map((item) => {
                const Icon = item.icon;

                return (
                  <div
                    className="rounded-lg border border-zinc-200 bg-zinc-50 p-3"
                    key={item.label}
                  >
                    <span className="grid size-9 place-items-center rounded-lg bg-white text-blue-700 ring-1 ring-zinc-200">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                      {item.label}
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-zinc-950">
                      {item.value}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {!isMysqlEnabled ? (
          <section className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
            Device request review requires MySQL storage. Enable the MySQL
            database and run the device provisioning migrations first.
          </section>
        ) : null}

        {/* Filter section */}
        <section className="shrink-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(18rem,1fr)_16rem_auto_auto] lg:items-end">
            <form
              action="/dashboard/admin/device-requests"
              className="contents"
            >
              <label className="grid gap-1.5 text-sm font-semibold text-zinc-950">
                Search requests
                <span className="relative block">
                  <Search
                    aria-hidden="true"
                    className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
                  />
                  <input
                    className="h-10 w-full rounded-lg border border-zinc-300 bg-white pl-10 pr-3 text-sm font-medium text-zinc-950 outline-none transition placeholder:text-zinc-400 hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
                    defaultValue={query}
                    name="q"
                    placeholder="Search STO, device, email, or code"
                    type="search"
                  />
                </span>
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-zinc-950">
                Status
                <select
                  className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 outline-none transition hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
                  defaultValue={statusFilter}
                  name="status"
                >
                  {DEVICE_REQUEST_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20"
                type="submit"
              >
                Apply
              </button>
              <Link
                className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-600/15"
                href="/dashboard/admin/device-requests"
              >
                Reset
              </Link>
            </form>
          </div>
        </section>

        <AdminDeviceRequestsPanel
          csrfToken={csrfToken}
          filteredRequests={filteredRequests}
          hardwareProfiles={hardwareProfiles}
          isMysqlEnabled={isMysqlEnabled}
          totalRequestCount={requests.length}
        />
      </div>
    </main>
  );
}
