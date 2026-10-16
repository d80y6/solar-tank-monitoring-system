import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import { getMonitoringReferenceDataWithSource } from "@/features/monitoring/lib/monitoring-registry";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import {
  Activity,
  AlertTriangle,
  Clock,
  Database,
  Droplets,
  Gauge,
  MapPin,
  Wifi,
} from "lucide-react";

import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardMapOverview } from "@/features/monitoring/components/dashboard-map-overview";
import { LiveClock } from "@/features/monitoring/components/live-clock";
import { LiveRefreshControl } from "@/features/monitoring/components/live-refresh-control";
import {
  buildDashboardOverview,
  type DashboardOverview,
  type DashboardSiteStatus as SiteStatus,
} from "@/features/monitoring/lib/dashboard-view-model";

import { listLatestMonitoringReadingsByTankWithSource } from "@/features/monitoring/lib/monitoring-storage";
import { getMonitoringRefreshIntervalMs } from "@/features/monitoring/lib/refresh-interval";

export const metadata: Metadata = {
  title: "Fuel Tank Technical Analysis | FTM",
  description:
    "Technical analysis for monitoring fuel tank volume, generator runtime, device status, STO map, and operational data logs.",
};

export const runtime = "nodejs";

const statusMeta: Record<
  SiteStatus,
  {
    label: string;
    dot: string;
    badge: string;
    ring: string;
    text: string;
  }
> = {
  online: {
    label: "Online",
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    ring: "ring-emerald-200",
    text: "text-emerald-700",
  },
  warning: {
    label: "Warning",
    dot: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700 ring-amber-100",
    ring: "ring-amber-200",
    text: "text-amber-700",
  },
  critical: {
    label: "Critical",
    dot: "bg-red-600",
    badge: "bg-red-50 text-red-700 ring-red-100",
    ring: "ring-red-200",
    text: "text-red-700",
  },
  offline: {
    label: "Offline",
    dot: "bg-zinc-950",
    badge: "bg-zinc-100 text-zinc-700 ring-zinc-200",
    ring: "ring-zinc-300",
    text: "text-zinc-700",
  },
};

function buildSummaryCards(dashboardOverview: DashboardOverview) {
  return [
    {
      label: "Monitored STOs",
      value: String(dashboardOverview.summary.totalSites),
      note: `${dashboardOverview.summary.totalTanks} tanks monitored`,
      icon: MapPin,
      tone: "bg-cyan-50 text-cyan-700 ring-cyan-100",
    },
    {
      label: "Critical tanks",
      value: String(dashboardOverview.summary.criticalTanks),
      note: "based on runtime, level, and device",
      icon: AlertTriangle,
      tone: "bg-red-50 text-red-700 ring-red-100",
    },
    {
      label: "Online devices",
      value: String(dashboardOverview.summary.onlineDevices),
      note: `${dashboardOverview.summary.delayedDevices} delayed, ${dashboardOverview.summary.offlineDevices} offline`,
      icon: Wifi,
      tone: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    },
    {
      label: "Average update",
      value: dashboardOverview.summary.averageIntervalLabel,
      note: "target can be set per device",
      icon: Clock,
      tone: "bg-zinc-100 text-zinc-700 ring-zinc-200",
    },
  ];
}

const runtimeBands = [
  { label: "Critical", range: "< 13 hrs", width: "24%", tone: "bg-red-500" },
  {
    label: "Warning",
    range: "13 - 16 hrs",
    width: "24%",
    tone: "bg-amber-500",
  },
  {
    label: "Limited safe",
    range: "16 - 24 hrs",
    width: "24%",
    tone: "bg-cyan-500",
  },
  {
    label: "Long safe",
    range: "> 24 hrs",
    width: "28%",
    tone: "bg-emerald-500",
  },
];

function formatLiter(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatJakartaTime(value: Date) {
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  })
    .format(value)
    .replaceAll(".", ":");

  return `${time} WIB`;
}

function StatusBadge({ status }: { status: SiteStatus }) {
  const meta = statusMeta[status];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${meta.badge}`}
    >
      <span className={`size-2 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function SectionHeader({
  label,
  title,
  description,
}: {
  label: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-600">
        {label}
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-normal text-zinc-950">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-zinc-500">{description}</p>
    </div>
  );
}

export default async function DashboardPage() {
  await connection();
  const admin = await requirePageAdmin();

  const now = new Date();
  const refreshIntervalMs = getMonitoringRefreshIntervalMs();
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
  const storageSource = monitoringReadingsResult.source;
  const registrySource = monitoringReferenceResult.source;
  const storageBadgeLabel =
    storageSource.activeDriver === "mysql"
      ? "database MySQL"
      : "local memory";

  const monitoredSites = dashboardOverview.rows;
  const latestSite = dashboardOverview.latestRow;
  const prioritySites = dashboardOverview.priorityRows;
  const trendBars = dashboardOverview.trendBars;
  const summaryCards = buildSummaryCards(dashboardOverview);
  const localTimeLabel = formatJakartaTime(now);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f5faf8] text-zinc-950">
      <DashboardHeader
        navItems={[
          { href: "/dashboard", label: "Tank Management" },
          { current: true, label: "Technical Analysis" },
          { href: "#map", label: "STO Map" },
          { href: "#priority", label: "Priority" },
          { href: "#log", label: "Device Log" },
        ]}
        rightSlot={
          <LiveRefreshControl
            intervalMs={refreshIntervalMs}
            lastSyncedLabel={dashboardOverview.summary.syncLabel}
            className="hidden md:inline-flex"
          />
        }
        user={admin}
      />

      <div className="mx-auto max-w-[1540px] px-4 py-5 sm:px-6 lg:px-8">
        {/* Dashboard Toolbar */}
        <section
          id="summary"
          className="animate-soft-fade mb-5 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 ring-1 ring-red-100">
                  Data operasional
                </span>
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200">
                  {storageBadgeLabel}
                </span>
              </div>
              <h1 className="mt-3 max-w-full break-words text-[1.85rem] font-semibold leading-[1.08] tracking-normal text-zinc-950 sm:text-4xl">
                STO fuel tank management
              </h1>
              <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-zinc-500 sm:text-base">
                Initial view for reading volume, generator runtime estimates,
                device status, and manual location points from the active storage.
              </p>
            </div>

            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:w-[28rem]">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Local time
                </p>
                <p className="mt-1 text-lg font-semibold">
                  <LiveClock initialTimeLabel={localTimeLabel} />
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Data source
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {storageSource.label} / {registrySource.label}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Summary Cards */}
        <section className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => {
            const Icon = card.icon;

            return (
              <article
                key={card.label}
                className="animate-soft-fade rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-zinc-500">
                      {card.label}
                    </p>
                    <p className="mt-3 text-3xl font-semibold tracking-normal">
                      {card.value}
                    </p>
                  </div>
                  <span
                    className={`grid size-11 place-items-center rounded-lg ring-1 ${card.tone}`}
                  >
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                </div>
                <p className="mt-4 text-sm text-zinc-500">{card.note}</p>
              </article>
            );
          })}
        </section>

        <div className="grid gap-5 xl:grid-cols-[1.7fr_0.82fr]">
          <DashboardMapOverview
            sites={monitoredSites}
            initialSiteCode={latestSite.code}
            priorityCount={prioritySites.length}
          />

          <div className="space-y-5">
            {/* Lower Insights Section */}
            <section className="grid gap-5 lg:grid-cols-[0.72fr_1.28fr]">
              <article
                id="prioritas"
                className="animate-soft-fade rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <SectionHeader
                  label="Priority"
                  title="Today's follow-ups"
                  description="This list helps pick the locations that need checking first."
                />

                <div className="mt-5 space-y-3">
                  {prioritySites.map((site, index) => (
                    <div
                      key={site.code}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-red-50 text-sm font-semibold text-red-600">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-zinc-950">
                              {site.name}
                            </p>
                            <StatusBadge status={site.status} />
                          </div>
                          <p className="mt-2 text-sm leading-6 text-zinc-500">
                            {site.note}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="mt-5 w-full rounded-lg bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200"
                >
                  View all priorities
                </button>
              </article>

              <article className="animate-soft-fade rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <SectionHeader
                    label="Volume trend"
                    title="24-hour stock movement"
                    description="This chart reads the reading series from the active storage and is prepared for database history."
                  />
                  <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                    stable data
                  </span>
                </div>

                <div className="mt-8 flex h-64 items-end gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-5">
                  {trendBars.map((bar) => (
                    <div
                      key={bar.hour}
                      className="flex h-full flex-1 flex-col justify-end gap-2"
                    >
                      <div className="relative flex flex-1 items-end">
                        <span
                          className={`w-full rounded-t-lg ${
                            bar.value <= 38
                              ? "bg-red-500"
                              : bar.value <= 49
                                ? "bg-amber-500"
                                : "bg-cyan-500"
                          }`}
                          style={{ height: `${bar.value}%` }}
                        />
                      </div>
                      <span className="text-center text-[0.68rem] font-medium text-zinc-400">
                        {bar.hour}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-4">
                  {runtimeBands.map((band) => (
                    <div
                      key={band.label}
                      className="rounded-lg border border-zinc-200 bg-white p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`size-2.5 rounded-full ${band.tone}`}
                        />
                        <span className="text-sm font-semibold text-zinc-950">
                          {band.label}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">{band.range}</p>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </div>

          {/* Supporting Status Panels */}
          <aside className="space-y-5">
            <section className="animate-soft-fade rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <SectionHeader
                label="Data health"
                title="Device status"
                description="Status follows the age of the latest data compared with the expected report interval."
              />

              <div className="mt-6 grid grid-cols-2 gap-3">
                {dashboardOverview.healthCards.map(({ label, value, tone }) => (
                  <div key={label} className={`rounded-lg p-4 ${tone}`}>
                    <p className="text-sm font-medium opacity-80">{label}</p>
                    <p className="mt-2 text-3xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6 h-3 overflow-hidden rounded-full bg-zinc-100">
                <div className="flex h-full">
                  {dashboardOverview.healthSegments.map((segment) => (
                    <span
                      key={segment.label}
                      className={segment.tone}
                      style={{ width: segment.width }}
                    />
                  ))}
                </div>
              </div>
            </section>

            <section className="animate-soft-fade rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <SectionHeader
                label="Data flow"
                title="Ready to connect gradually"
                description="The dashboard reads the active storage and local API endpoints, with memory for development and MySQL as the long-term storage direction."
              />

              <div className="mt-6 space-y-3">
                {[
                  [Database, "Active storage", "local memory or MySQL"],
                  [Activity, "API /ingest", "receives device data"],
                  [Gauge, "Runtime", "status calculated from volume"],
                  [Droplets, "History", "history from the active storage"],
                ].map(([Icon, title, body]) => (
                  <div
                    key={title as string}
                    className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-red-600 ring-1 ring-zinc-200">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-zinc-950">
                        {title as string}
                      </p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {body as string}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>

        {/* Monitoring Table Section */}
        <section
          id="log"
          className="mt-5 animate-soft-fade rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <SectionHeader
              label="Device log"
              title="Tank management list"
              description="This table reads operational data from the active storage also used by API endpoints."
            />
            <Link
              href={`/dashboard/tanks/${latestSite.tankId}`}
              className="w-full rounded-lg bg-blue-600 px-5 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 sm:w-auto"
            >
              Open tank details
            </Link>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[920px] border-separate border-spacing-y-2 text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-[0.12em] text-zinc-400">
                  <th className="px-4 py-2 font-semibold">STO</th>
                  <th className="px-4 py-2 font-semibold">Tank</th>
                  <th className="px-4 py-2 font-semibold">Volume</th>
                  <th className="px-4 py-2 font-semibold">Level</th>
                  <th className="px-4 py-2 font-semibold">Runtime</th>
                <th className="px-4 py-2 font-semibold">Device</th>
                <th className="px-4 py-2 font-semibold">Update</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
                {monitoredSites.map((site) => (
                  <tr key={site.code} className="bg-zinc-50">
                    <td className="rounded-l-lg px-4 py-4">
                      <div className="flex items-center gap-3">
                        <span
                          className={`size-2.5 rounded-full ${statusMeta[site.status].dot}`}
                        />
                        <div>
                          <p className="font-semibold text-zinc-950">
                            <Link
                              href={`/dashboard/tanks/${site.tankId}`}
                              className="transition hover:text-red-600"
                            >
                              {site.name}
                            </Link>
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {site.regionalLabel ?? "-"} /{" "}
                            {site.wilayahLabel ?? "-"}
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-500">
                            Area {site.areaLabel}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-zinc-600">{site.tank}</td>
                    <td className="px-4 py-4 font-semibold">
                      {formatLiter(site.volumeLiter)} L
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-200">
                          <span
                            className={`block h-full rounded-full ${
                              site.fillPercent < 25
                                ? "bg-red-500"
                                : site.fillPercent < 45
                                  ? "bg-amber-500"
                                  : "bg-cyan-500"
                            }`}
                            style={{ width: `${site.fillPercent}%` }}
                          />
                        </div>
                        <span className="font-semibold">
                          {site.fillPercent}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4">{site.runtimeHour} hrs</td>
                    <td className="px-4 py-4 text-zinc-600">{site.deviceId}</td>
                    <td className="px-4 py-4 text-zinc-600">
                      {site.updateLabel}
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge status={site.status} />
                    </td>
                    <td className="rounded-r-lg px-4 py-4">
                      <Link
                        href={`/dashboard/tanks/${site.tankId}`}
                        className="inline-flex items-center rounded-lg bg-white px-3 py-2 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-blue-600 hover:text-white hover:ring-blue-600"
                      >
                        Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
