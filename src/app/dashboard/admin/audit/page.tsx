import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Download, Filter, ShieldAlert } from "lucide-react";

import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import type { AuthAuditEventQuery } from "@/features/auth/lib/audit-query";
import { listAuthAuditEvents } from "@/features/auth/lib/mysql-auth-repository";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";

export const metadata: Metadata = {
  title: "Security Audit | FTM",
  description:
    "FTM account security audit log with filters, paging, and CSV export.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE_SIZE = 50;

type AuditSearchParams = {
  q?: string;
  eventType?: string;
  from?: string;
  to?: string;
  page?: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Jakarta",
    year: "numeric",
  }).format(new Date(value));
}

function formatMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "-";
  }

  return JSON.stringify(metadata);
}

function parsePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function buildQueryString(
  params: AuditSearchParams,
  overrides: Partial<AuditSearchParams>,
): string {
  const merged = new URLSearchParams();

  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) {
      merged.set(key, String(value));
    }
  }

  const query = merged.toString();

  return query ? `?${query}` : "";
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<AuditSearchParams>;
}) {
  const admin = await requirePageAdmin();
  const params = await searchParams;
  const storageDriver = getMonitoringStorageDriver();
  const isMysql = storageDriver === "mysql";
  const page = parsePage(params.page);
  const query: AuthAuditEventQuery = {
    eventType: params.eventType || null,
    from: params.from || null,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    search: params.q || null,
    to: params.to || null,
  };
  const audit = isMysql
    ? await listAuthAuditEvents(query).catch(() => ({
        eventTypes: [] as string[],
        events: [],
        limit: PAGE_SIZE,
        offset: query.offset ?? 0,
        total: 0,
      }))
    : { eventTypes: [] as string[], events: [], limit: PAGE_SIZE, offset: 0, total: 0 };
  const totalPages = Math.max(1, Math.ceil(audit.total / PAGE_SIZE));
  return (
    <main className="min-h-screen bg-[#f5faf8] text-zinc-950">
      <DashboardHeader
        navItems={[
          { href: "/dashboard", label: "Tank Management" },
          { href: "/dashboard/admin/users", label: "User Management" },
          { href: "/dashboard/admin/alerts", label: "Alert Centre" },
          { href: "/dashboard/admin/devices", label: "Device Registry" },
          { href: "/dashboard/admin/access-scopes", label: "Location Access" },
          { href: "/dashboard/admin/hardware-registry", label: "Hardware Registry" },
          { current: true, label: "Security Audit" },
        ]}
        user={admin}
      />

      <div className="mx-auto flex max-w-[1540px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                <ClipboardList className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold uppercase text-zinc-500">
                  Security audit
                </p>
                <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">
                  Security activity log
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                  Records of sign-ins, OTPs, password resets, role changes,
                  location scopes, device registry changes, and activations.
                  Export the filtered view for an incident review.
                </p>
              </div>
            </div>
            {isMysql ? (
              <Link
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-blue-50 hover:text-blue-700"
                href={`/api/admin/audit/export${buildQueryString(params, { page: undefined })}`}
              >
                <Download aria-hidden="true" className="size-4" />
                Export CSV
              </Link>
            ) : null}
          </div>
        </section>

        {!isMysql ? (
          <section className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <p>
              The audit log is stored in MySQL. The active storage driver is{" "}
              <strong>{storageDriver}</strong>, so there is nothing to show here.
            </p>
          </section>
        ) : null}

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <form className="flex flex-wrap items-end gap-3" method="get">
            <label className="flex min-w-52 flex-1 flex-col gap-1 text-[11px] font-semibold uppercase text-zinc-500">
              Search
              <input
                className="h-9 w-full rounded-lg border border-zinc-200 px-3 text-xs text-zinc-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10"
                defaultValue={params.q ?? ""}
                name="q"
                placeholder="event type, actor id, or target id"
              />
            </label>
            <label className="flex min-w-44 flex-col gap-1 text-[11px] font-semibold uppercase text-zinc-500">
              Event type
              <select
                className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-xs text-zinc-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10"
                defaultValue={params.eventType ?? ""}
                name="eventType"
              >
                <option value="">All events</option>
                {audit.eventTypes.map((eventType) => (
                  <option key={eventType} value={eventType}>
                    {eventType}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase text-zinc-500">
              From
              <input
                className="h-9 rounded-lg border border-zinc-200 px-3 text-xs text-zinc-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10"
                defaultValue={params.from ?? ""}
                name="from"
                type="date"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase text-zinc-500">
              To
              <input
                className="h-9 rounded-lg border border-zinc-200 px-3 text-xs text-zinc-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10"
                defaultValue={params.to ?? ""}
                name="to"
                type="date"
              />
            </label>
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700"
              type="submit"
            >
              <Filter aria-hidden="true" className="size-4" />
              Apply
            </button>
            <Link
              className="inline-flex h-9 items-center rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50"
              href="/dashboard/admin/audit"
            >
              Reset
            </Link>
          </form>

          <p className="mt-4 text-xs font-medium text-zinc-500">
            {audit.total} matching event(s) — page {page} of {totalPages}
          </p>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[980px] border-separate border-spacing-y-2 text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {audit.events.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-zinc-500" colSpan={5}>
                      No audit events match these filters.
                    </td>
                  </tr>
                ) : (
                  audit.events.map((event) => (
                    <tr className="bg-zinc-50" key={event.id}>
                      <td className="rounded-l-lg px-3 py-3 text-zinc-600">
                        {formatDate(event.createdAt)}
                      </td>
                      <td className="px-3 py-3 font-semibold text-zinc-950">
                        {event.eventType}
                      </td>
                      <td className="px-3 py-3 text-zinc-600">
                        {event.actorUserId ?? "-"}
                      </td>
                      <td className="px-3 py-3 text-zinc-600">
                        {event.targetUserId ?? "-"}
                      </td>
                      <td className="rounded-r-lg px-3 py-3 text-zinc-600">
                        <span className="block max-w-xl break-all">
                          {formatMetadata(event.metadata)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="mt-3 flex items-center gap-2 text-xs font-semibold">
              {page > 1 ? (
                <Link
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-zinc-700 transition hover:bg-zinc-50"
                  href={`/dashboard/admin/audit${buildQueryString(params, { page: String(page - 1) })}`}
                >
                  Previous
                </Link>
              ) : null}
              {page < totalPages ? (
                <Link
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-zinc-700 transition hover:bg-zinc-50"
                  href={`/dashboard/admin/audit${buildQueryString(params, { page: String(page + 1) })}`}
                >
                  Next
                </Link>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
