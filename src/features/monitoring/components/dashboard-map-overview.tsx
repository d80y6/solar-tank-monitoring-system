"use client";

import Link from "next/link";
import { Fuel } from "lucide-react";
import { useMemo, useState } from "react";

import {
  OperationalMap,
  type OperationalMapSite,
} from "@/features/monitoring/components/operational-map";
import type {
  DashboardMonitoringSite,
  DashboardSiteStatus,
} from "@/features/monitoring/lib/dashboard-view-model";

type DashboardMapOverviewProps = {
  sites: DashboardMonitoringSite[];
  initialSiteCode: string;
  priorityCount: number;
};

const statusMeta: Record<
  DashboardSiteStatus,
  {
    label: string;
    dot: string;
    badge: string;
  }
> = {
  online: {
    label: "Online",
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  },
  warning: {
    label: "Warning",
    dot: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700 ring-amber-100",
  },
  critical: {
    label: "Critical",
    dot: "bg-red-600",
    badge: "bg-red-50 text-red-700 ring-red-100",
  },
  offline: {
    label: "Offline",
    dot: "bg-zinc-950",
    badge: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  },
};

function formatLiter(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function StatusBadge({ status }: { status: DashboardSiteStatus }) {
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

export function DashboardMapOverview({
  sites,
  initialSiteCode,
  priorityCount,
}: DashboardMapOverviewProps) {
  const [selectedCode, setSelectedCode] = useState(initialSiteCode);
  const selectedSite = useMemo(
    () =>
      sites.find((site) => site.code === selectedCode) ??
      sites.find((site) => site.code === initialSiteCode) ??
      sites[0],
    [initialSiteCode, selectedCode, sites],
  );

  function handleSiteChange(site: OperationalMapSite) {
    setSelectedCode(site.code);
  }

  return (
    <>
      {/* Map Monitoring Section */}
      <section
        id="map"
        className="animate-soft-fade overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm"
      >
        <div className="flex flex-col gap-4 border-b border-zinc-200 p-5 lg:flex-row lg:items-center lg:justify-between">
          <SectionHeader
            label="Monitoring map"
            title="STO locations from manual input"
            description="Map pins are projected from manual latitude and longitude because devices do not use a GPS module."
          />

          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-zinc-600">
            {(["online", "warning", "critical", "offline"] as const).map(
              (status) => (
                <span
                  key={status}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-2"
                >
                  <span
                    className={`size-2 rounded-full ${statusMeta[status].dot}`}
                  />
                  {statusMeta[status].label}
                </span>
              ),
            )}
          </div>
        </div>

        <div className="p-3 sm:p-5">
          <OperationalMap
            sites={sites}
            selectedCode={selectedSite?.code}
            priorityCount={priorityCount}
            onSitePreview={handleSiteChange}
            onSiteSelect={handleSiteChange}
          />
        </div>
      </section>

      {/* Right Detail Overview */}
      <section className="animate-soft-fade rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        {selectedSite ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-zinc-500">
                  Overview detail
                </p>
                <h2
                  data-site-detail-title
                  className="mt-2 text-2xl font-semibold"
                >
                  {selectedSite.name}
                </h2>
                <p className="mt-1 text-sm font-medium text-zinc-500">
                  {selectedSite.regionalLabel ?? "-"} /{" "}
                  {selectedSite.wilayahLabel ?? "-"} / Area{" "}
                  {selectedSite.areaLabel}
                </p>
              </div>
              <StatusBadge status={selectedSite.status} />
            </div>

            <div className="mt-6 flex items-start gap-4">
              <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
                <Fuel className="size-8" aria-hidden="true" />
              </span>
              <div>
                <div className="flex items-end gap-2">
                  <p className="text-5xl font-semibold tracking-normal">
                    {selectedSite.fillPercent}
                  </p>
                  <span className="pb-2 text-xl font-semibold text-zinc-400">
                    %
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  {formatLiter(selectedSite.volumeLiter)} liters available.
                  Estimated runtime {selectedSite.runtimeHour} hrs assuming
                  configured consumption of {selectedSite.consumptionLiterPerHour}{" "}
                  L/h.
                </p>
              </div>
            </div>

            <div className="mt-6 h-3 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-cyan-500 transition-[width] duration-500"
                style={{ width: `${selectedSite.fillPercent}%` }}
              />
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                ["Volume", `${formatLiter(selectedSite.volumeLiter)} L`],
                ["Runtime", `${selectedSite.runtimeHour} hrs`],
                ["RSSI", selectedSite.signal],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-xs font-medium text-zinc-400">{label}</p>
                  <p className="mt-2 text-sm font-semibold text-zinc-950">
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <Link
              href={`/dashboard/tanks/${selectedSite.tankId}`}
              className="mt-6 block w-full rounded-lg bg-zinc-100 px-4 py-3 text-center text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200"
            >
              Open tank details
            </Link>
          </>
        ) : (
          <p className="text-sm leading-6 text-zinc-500">
            No STO available to display.
          </p>
        )}
      </section>
    </>
  );
}
