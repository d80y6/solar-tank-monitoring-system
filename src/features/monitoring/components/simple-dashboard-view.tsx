"use client";

import { ChevronDown, LayoutGrid, MapPinned, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  filterSimpleDashboardSites,
  getSimpleDashboardAreas,
  getSimpleDashboardRegionals,
  getSimpleDashboardSummary,
  getSimpleDashboardWilayahs,
  SIMPLE_DASHBOARD_ALL_AREAS,
  SIMPLE_DASHBOARD_ALL_REGIONALS,
  SIMPLE_DASHBOARD_ALL_WILAYAHS,
  sortSimpleDashboardSites,
  type SimpleDashboardSite,
  type SimpleDashboardStatusFilter,
} from "@/features/monitoring/lib/simple-dashboard-model";
import { SimpleDashboardCards } from "./simple-dashboard-cards";
import { SimpleDashboardMap } from "./simple-dashboard-map";

type SimpleDashboardViewProps = {
  adminCleanupToken?: string;
  sites: SimpleDashboardSite[];
};

type StatusFilterOption = {
  value: SimpleDashboardStatusFilter;
  label: string;
};

type DashboardViewMode = "cards" | "map";

const SIMPLE_DASHBOARD_ALL_STOS = "all";

const STATUS_FILTERS: StatusFilterOption[] = [
  { value: "all", label: "All" },
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
];

type SummaryTone = "blue" | "emerald" | "red";

const SUMMARY_TONES: Record<
  SummaryTone,
  { border: string; line: string; text: string }
> = {
  blue: {
    border: "border-blue-100",
    line: "bg-blue-500",
    text: "text-blue-700",
  },
  emerald: {
    border: "border-emerald-100",
    line: "bg-emerald-500",
    text: "text-emerald-700",
  },
  red: {
    border: "border-red-100",
    line: "bg-red-500",
    text: "text-red-700",
  },
};

function SummaryValue({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: SummaryTone;
}) {
  const toneClass = SUMMARY_TONES[tone];

  return (
    <div
      className={`relative min-w-0 overflow-hidden rounded-lg border bg-white px-4 py-3 shadow-sm ${toneClass.border}`}
    >
      <span className={`absolute inset-x-0 top-0 h-1 ${toneClass.line}`} />
      <p className="text-xs font-semibold uppercase text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass.text}`}>
        {value}
      </p>
    </div>
  );
}

export function SimpleDashboardView({
  adminCleanupToken,
  sites,
}: SimpleDashboardViewProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<SimpleDashboardStatusFilter>("all");
  const [areaFilter, setAreaFilter] = useState(SIMPLE_DASHBOARD_ALL_AREAS);
  const [regionalFilter, setRegionalFilter] = useState(
    SIMPLE_DASHBOARD_ALL_REGIONALS,
  );
  const [wilayahFilter, setWilayahFilter] = useState(
    SIMPLE_DASHBOARD_ALL_WILAYAHS,
  );
  const [selectedSto, setSelectedSto] = useState(SIMPLE_DASHBOARD_ALL_STOS);
  const [viewMode, setViewMode] = useState<DashboardViewMode>("cards");

  const summary = useMemo(() => getSimpleDashboardSummary(sites), [sites]);
  const areas = useMemo(() => getSimpleDashboardAreas(sites), [sites]);
  const regionals = useMemo(() => getSimpleDashboardRegionals(sites), [sites]);
  const wilayahs = useMemo(() => getSimpleDashboardWilayahs(sites), [sites]);
  const stoOptions = useMemo(
    () =>
      [...sites].sort(
        (first, second) =>
          first.name.localeCompare(second.name, "en-US") ||
          first.code.localeCompare(second.code, "en-US"),
      ),
    [sites],
  );
  const visibleSites = useMemo(
    () =>
      selectedSto === SIMPLE_DASHBOARD_ALL_STOS
        ? sortSimpleDashboardSites(
            filterSimpleDashboardSites(sites, {
              query,
              status: statusFilter,
              area: areaFilter,
              regional: regionalFilter,
              wilayah: wilayahFilter,
            }),
          )
        : sortSimpleDashboardSites(
            sites.filter((site) => site.tankId === selectedSto),
          ),
    [
      areaFilter,
      query,
      regionalFilter,
      selectedSto,
      sites,
      statusFilter,
      wilayahFilter,
    ],
  );
  const mapViewKey = useMemo(
    () => visibleSites.map((site) => site.tankId).join("|"),
    [visibleSites],
  );

  return (
    <section className="flex min-h-0 w-[calc(100vw-2rem)] max-w-full min-w-0 flex-1 flex-col gap-4 sm:w-full">
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <SummaryValue label="Total STOs" tone="blue" value={summary.total} />
        <SummaryValue label="Online" tone="emerald" value={summary.online} />
        <SummaryValue label="Offline" tone="red" value={summary.offline} />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 2xl:items-end">
        <label className="block min-w-0">
          <span className="mb-2 block text-xs font-semibold uppercase text-zinc-500">
            Search STO
          </span>
          <span className="relative block">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            />
            <input
              className="h-12 w-full rounded-lg border border-zinc-300 bg-white pl-10 pr-3 text-sm font-medium text-zinc-950 outline-none transition placeholder:text-zinc-400 hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search code, name, area, regional, territory, or device"
              type="search"
              value={query}
            />
          </span>
        </label>

        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase text-zinc-500">
            Status
          </p>
          <div className="grid h-12 min-w-0 grid-cols-3 rounded-lg border border-zinc-300 bg-zinc-50 p-1">
            {STATUS_FILTERS.map((filter) => (
              <button
                aria-pressed={statusFilter === filter.value}
                className={`h-full rounded-md px-2 text-sm font-semibold transition ${
                  statusFilter === filter.value
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-zinc-600 hover:bg-white hover:text-blue-700"
                }`}
                key={filter.value}
                onClick={() => setStatusFilter(filter.value)}
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block min-w-0">
          <span className="mb-2 block text-xs font-semibold uppercase text-zinc-500">
            Regional
          </span>
          <span className="relative block">
            <select
              className="h-12 w-full appearance-none rounded-lg border border-zinc-300 bg-white pl-3 pr-11 text-sm font-semibold text-zinc-800 outline-none transition hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
              onChange={(event) => setRegionalFilter(event.target.value)}
              value={regionalFilter}
            >
              <option value={SIMPLE_DASHBOARD_ALL_REGIONALS}>
                All regionals
              </option>
              {regionals.map((regional) => (
                <option key={regional} value={regional}>
                  {regional}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-zinc-700"
            />
          </span>
        </label>

        <label className="block min-w-0">
          <span className="mb-2 block text-xs font-semibold uppercase text-zinc-500">
            Territory
          </span>
          <span className="relative block">
            <select
              className="h-12 w-full appearance-none rounded-lg border border-zinc-300 bg-white pl-3 pr-11 text-sm font-semibold text-zinc-800 outline-none transition hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
              onChange={(event) => setWilayahFilter(event.target.value)}
              value={wilayahFilter}
            >
              <option value={SIMPLE_DASHBOARD_ALL_WILAYAHS}>
                All territories
              </option>
              {wilayahs.map((wilayah) => (
                <option key={wilayah} value={wilayah}>
                  {wilayah}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-zinc-700"
            />
          </span>
        </label>

        <label className="block min-w-0">
          <span className="mb-2 block text-xs font-semibold uppercase text-zinc-500">
            Area
          </span>
          <span className="relative block">
            <select
              className="h-12 w-full appearance-none rounded-lg border border-zinc-300 bg-white pl-3 pr-11 text-sm font-semibold text-zinc-800 outline-none transition hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
              onChange={(event) => setAreaFilter(event.target.value)}
              value={areaFilter}
            >
              <option value={SIMPLE_DASHBOARD_ALL_AREAS}>All areas</option>
              {areas.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-zinc-700"
            />
          </span>
        </label>

        <label className="block min-w-0">
          <span className="mb-2 block text-xs font-semibold uppercase text-zinc-500">
            Select STO
          </span>
          <span className="relative block">
            <select
              className="h-12 w-full appearance-none truncate rounded-lg border border-zinc-300 bg-white pl-3 pr-11 text-sm font-semibold text-zinc-800 outline-none transition hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
              onChange={(event) => setSelectedSto(event.target.value)}
              value={selectedSto}
            >
              <option value={SIMPLE_DASHBOARD_ALL_STOS}>All STOs</option>
              {stoOptions.map((site) => (
                <option key={site.tankId} value={site.tankId}>
                  {site.name} ({site.code})
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-zinc-700"
            />
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-normal text-zinc-950">
            STO Tank Monitoring
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Showing {visibleSites.length} of {sites.length} STOs
          </p>
        </div>

        <div
          className="grid w-full grid-cols-2 rounded-lg border border-zinc-300 bg-zinc-50 p-1 sm:w-auto"
          aria-label="Choose dashboard view"
        >
          <button
            aria-pressed={viewMode === "cards"}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15 ${
              viewMode === "cards"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-zinc-600 hover:bg-white hover:text-blue-700"
            }`}
            onClick={() => setViewMode("cards")}
            type="button"
          >
            <LayoutGrid className="size-4" aria-hidden="true" />
            Cards
          </button>
          <button
            aria-pressed={viewMode === "map"}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15 ${
              viewMode === "map"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-zinc-600 hover:bg-white hover:text-blue-700"
            }`}
            onClick={() => setViewMode("map")}
            type="button"
          >
            <MapPinned className="size-4" aria-hidden="true" />
            Map
          </button>
        </div>
      </div>

      {viewMode === "cards" ? (
        <SimpleDashboardCards
          adminCleanupToken={adminCleanupToken}
          sites={visibleSites}
        />
      ) : (
        <SimpleDashboardMap key={mapViewKey} sites={visibleSites} />
      )}
    </section>
  );
}
