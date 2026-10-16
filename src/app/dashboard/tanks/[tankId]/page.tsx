import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Battery,
  Clock,
  Database,
  Droplets,
  Fuel,
  Gauge,
  History,
  Radio,
  Ruler,
  Settings,
  Wifi,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { LiveRefreshControl } from "@/features/monitoring/components/live-refresh-control";
import { TankLocationMap } from "@/features/monitoring/components/tank-location-map";
import {
  TankHorizontalCylinderScene3D,
  TankRectangularScene3D,
} from "@/features/monitoring/components/tank-rectangular-scene-3d";
import { SimpleTankVolumeChart } from "@/features/monitoring/components/simple-tank-volume-chart";
import { getMonitoringReferenceData } from "@/features/monitoring/lib/monitoring-registry";
import {
  buildTankDetail,
  type NearbyTankSite,
  type TankDetailStatus,
  type TankDetailView,
  type TankReadingPoint,
} from "@/features/monitoring/lib/tank-detail-view-model";
import {
  listLatestMonitoringReadingsByTankWithSource,
  listMonitoringReadingsForTank,
} from "@/features/monitoring/lib/monitoring-storage";
import { getMonitoringRefreshIntervalMs } from "@/features/monitoring/lib/refresh-interval";
import {
  buildSimpleTankDetail,
  type SimpleTankTrendByRange,
} from "@/features/monitoring/lib/simple-tank-detail-model";
import { mergeMonitoringReadingsById } from "@/features/monitoring/lib/latest-reading";
import type {
  ReadingQuality,
  ReadingValueSource,
  TankConfigReview,
  TankConfigStatus,
  TankShape,
} from "@/features/monitoring/types/monitoring";

export const metadata: Metadata = {
  title: "Fuel Tank Details | FTM",
  description:
    "Detail page for reading the condition of one fuel tank, tank level visuals, device parameters, and reading history.",
};

export const runtime = "nodejs";

type TankStatus = TankDetailStatus;

type ReadingPoint = {
  time: string;
  percent: number;
  volumeLiter: number;
  distanceCm: number;
};

type TimelineItem = {
  label: string;
  value: string;
  detail: string;
};

type ParameterItem = {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
};

type RuntimeLevelParameter = {
  label: string;
  range: string;
  description: string;
  badge: string;
  card: string;
  dot: string;
};

type NearbySite = {
  tankId: string;
  code: string;
  name: string;
  status: TankStatus;
  left: string;
  top: string;
  runtimeHour: number;
  fillPercent: number;
  updateLabel: string;
};

type TankDetail = {
  id: string;
  hasReading: boolean;
  siteCode: string;
  siteName: string;
  areaLabel: string;
  regionalLabel?: string;
  wilayahLabel?: string;
  tankName: string;
  status: TankStatus;
  statusNote: string;
  fillPercent: number;
  volumeLiter: number;
  capacityLiter: number;
  shape: TankShape;
  shapeLabel: string;
  runtimeHour: number;
  consumptionLiterPerHour: number;
  sensorDistanceCm: number;
  fuelHeightCm: number;
  diameterCm: number | null;
  lengthCm: number | null;
  heightCm: number | null;
  widthCm: number | null;
  sensorMountHeightCm: number;
  lowLevelPercent: number;
  criticalLevelPercent: number;
  deviceId: string;
  deviceLabel: string;
  expectedIntervalMin: number;
  lastUpdateLabel: string;
  measuredAtLabel: string;
  receivedAtLabel: string;
  rssiDbm: number | null;
  batteryVolt: number | null;
  coordinateLabel: string;
  markerLeft: string;
  markerTop: string;
  rawPayload: {
    distance: number;
    H_cm: number;
    volume: number;
    percent: number;
    wifi_rssi: number | null;
  };
  dataSources: ReadingQuality;
  configReview: TankConfigReview;
  readings: ReadingPoint[];
  chartTrends: SimpleTankTrendByRange;
  nearbySites: NearbySite[];
};

const statusMeta: Record<
  TankStatus,
  {
    label: string;
    dot: string;
    badge: string;
    ring: string;
    text: string;
    soft: string;
  }
> = {
  online: {
    label: "Online",
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    ring: "ring-emerald-200",
    text: "text-emerald-700",
    soft: "bg-emerald-50",
  },
  warning: {
    label: "Warning",
    dot: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700 ring-amber-100",
    ring: "ring-amber-200",
    text: "text-amber-700",
    soft: "bg-amber-50",
  },
  critical: {
    label: "Critical",
    dot: "bg-red-600",
    badge: "bg-red-50 text-red-700 ring-red-100",
    ring: "ring-red-200",
    text: "text-red-700",
    soft: "bg-red-50",
  },
  offline: {
    label: "Offline",
    dot: "bg-zinc-950",
    badge: "bg-zinc-100 text-zinc-700 ring-zinc-200",
    ring: "ring-zinc-300",
    text: "text-zinc-700",
    soft: "bg-zinc-100",
  },
};

const runtimeLevelParameters: RuntimeLevelParameter[] = [
  {
    label: "Critical",
    range: "< 13 hrs",
    description: "Remaining runtime is already a fast-action priority.",
    badge: "bg-red-50 text-red-700 ring-red-100",
    card: "border-red-200 bg-red-50",
    dot: "bg-red-600",
  },
  {
    label: "Threshold Under",
    range: "13 - <14 hrs",
    description: "Approaching the lower bound and needs closer monitoring.",
    badge: "bg-orange-50 text-orange-700 ring-orange-100",
    card: "border-orange-200 bg-orange-50",
    dot: "bg-orange-500",
  },
  {
    label: "Under",
    range: "14 - <16 hrs",
    description: "Still below the ideal operational zone.",
    badge: "bg-amber-50 text-amber-700 ring-amber-100",
    card: "border-amber-200 bg-amber-50",
    dot: "bg-amber-500",
  },
  {
    label: "Threshold Upper",
    range: "16 - <19 hrs",
    description: "Past the lower bound and moving toward the upper zone.",
    badge: "bg-cyan-50 text-cyan-700 ring-cyan-100",
    card: "border-cyan-200 bg-cyan-50",
    dot: "bg-cyan-500",
  },
  {
    label: "Upper",
    range: "19 - <24 hrs",
    description: "Runtime is in the upper zone, still normal.",
    badge: "bg-blue-50 text-blue-700 ring-blue-100",
    card: "border-blue-200 bg-blue-50",
    dot: "bg-blue-600",
  },
  {
    label: "Overstock",
    range: ">= 24 hrs",
    description: "Runtime reserve is very long compared to the parameter bounds.",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    card: "border-emerald-200 bg-emerald-50",
    dot: "bg-emerald-600",
  },
];

const unknownRuntimeLevel: RuntimeLevelParameter = {
  label: "No data",
  range: "-",
  description: "Remaining-hours parameter is waiting for valid volume and consumption data.",
  badge: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  card: "border-zinc-200 bg-zinc-50",
  dot: "bg-zinc-400",
};

function formatLiter(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMeasurement(value: number | null, unit: string) {
  return value === null ? "-" : `${value} ${unit}`;
}

function formatPercent(value: number) {
  return `${value}%`;
}

function formatSourceLabel(source: ReadingValueSource) {
  const labels: Record<ReadingValueSource, string> = {
    device: "device",
    backend: "backend",
    server: "server",
    unknown: "unknown",
  };

  return labels[source];
}

function formatConfigStatusLabel(status: TankConfigStatus) {
  const labels: Record<TankConfigStatus, string> = {
    normal: "normal",
    minor_config_difference: "minor difference",
    config_mismatch: "mismatch",
    invalid_config: "invalid",
    needs_review: "needs review",
  };

  return labels[status];
}

function formatRuntimeHour(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value)} hrs`;
}

function clampPercent(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

function getRuntimeLevelParameter(
  runtimeHour: number | null,
): RuntimeLevelParameter {
  if (runtimeHour === null || !Number.isFinite(runtimeHour)) {
    return unknownRuntimeLevel;
  }

  if (runtimeHour < 13) {
    return runtimeLevelParameters[0];
  }

  if (runtimeHour < 14) {
    return runtimeLevelParameters[1];
  }

  if (runtimeHour < 16) {
    return runtimeLevelParameters[2];
  }

  if (runtimeHour < 19) {
    return runtimeLevelParameters[3];
  }

  if (runtimeHour < 24) {
    return runtimeLevelParameters[4];
  }

  return runtimeLevelParameters[5];
}

function toReadingPoint(reading: TankReadingPoint): ReadingPoint {
  return {
    time: reading.timeLabel,
    percent: reading.fillPercent,
    volumeLiter: reading.volumeLiter,
    distanceCm: reading.sensorDistanceCm,
  };
}

function toNearbySite(site: NearbyTankSite): NearbySite {
  return {
    tankId: site.tankId,
    code: site.code,
    name: site.name,
    status: site.status,
    left: site.left,
    top: site.top,
    runtimeHour: site.runtimeHour,
    fillPercent: site.fillPercent,
    updateLabel: site.updateLabel,
  };
}

function toTankDetail(
  view: TankDetailView,
  chartTrends: SimpleTankTrendByRange,
): TankDetail {
  return {
    id: view.id,
    hasReading: view.hasReading,
    siteCode: view.siteCode,
    siteName: view.siteName,
    areaLabel: view.areaLabel,
    regionalLabel: view.regionalLabel,
    wilayahLabel: view.wilayahLabel,
    tankName: view.tankName,
    status: view.status,
    statusNote: view.statusNote,
    fillPercent: view.fillPercent,
    volumeLiter: view.volumeLiter,
    capacityLiter: view.capacityLiter,
    shape: view.shape,
    shapeLabel: view.shapeLabel,
    runtimeHour: view.runtimeHour,
    consumptionLiterPerHour: view.consumptionLiterPerHour,
    sensorDistanceCm: view.sensorDistanceCm,
    fuelHeightCm: view.fuelHeightCm,
    diameterCm: view.diameterCm,
    lengthCm: view.lengthCm,
    heightCm: view.heightCm,
    widthCm: view.widthCm,
    sensorMountHeightCm: view.sensorMountHeightCm,
    lowLevelPercent: view.lowLevelPercent,
    criticalLevelPercent: view.criticalLevelPercent,
    deviceId: view.deviceCode,
    deviceLabel: view.deviceLabel,
    expectedIntervalMin: view.expectedIntervalMin,
    lastUpdateLabel: view.lastUpdateLabel,
    measuredAtLabel: view.measuredAtLabel,
    receivedAtLabel: view.receivedAtLabel,
    rssiDbm: view.rssiDbm,
    batteryVolt: view.batteryVolt,
    coordinateLabel: view.coordinate.label,
    markerLeft: view.coordinate.markerLeft,
    markerTop: view.coordinate.markerTop,
    rawPayload: {
      distance: view.rawPayloadPreview.distance,
      H_cm: view.rawPayloadPreview.H_cm,
      volume: view.rawPayloadPreview.volume,
      percent: view.rawPayloadPreview.percent,
      wifi_rssi: view.rawPayloadPreview.wifi_rssi,
    },
    dataSources: view.dataSources,
    configReview: view.configReview,
    readings: view.readings.map(toReadingPoint),
    chartTrends,
    nearbySites: view.nearbySites.map(toNearbySite),
  };
}

function StatusBadge({ status }: { status: TankStatus }) {
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

function SectionHeading({
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
      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
        {description}
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  tone: string;
}) {
  return (
    <article className="animate-soft-fade rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-zinc-500">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-normal text-zinc-950">
            {value}
          </p>
        </div>
        <span
          className={`grid size-11 place-items-center rounded-lg ring-1 ${tone}`}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-4 text-sm text-zinc-500">{note}</p>
    </article>
  );
}

function TankVisual({ tank }: { tank: TankDetail }) {
  const isRectangular = tank.shape === "rectangular";
  const fillPercent = tank.hasReading ? clampPercent(tank.fillPercent) : 0;
  const visualDescription = isRectangular
    ? "The display model follows a rectangular tank. The sensor sits on top, so level changes are read vertically."
    : "The display model follows a horizontal cylinder tank. The sensor sits on top, so the fuel surface rises and falls vertically.";
  const dimensionItems: ParameterItem[] = [
    {
      label: "Empty space height",
      value: tank.hasReading ? `${tank.sensorDistanceCm} cm` : "-",
      note: tank.hasReading
        ? "empty space from the top of the tank to the liquid surface"
        : "waiting for device data",
      icon: Ruler,
    },
    {
      label: "Fuel height",
      value: tank.hasReading ? `${tank.fuelHeightCm} cm` : "-",
      note: tank.hasReading
        ? "raw.H_cm after normalization"
        : "waiting for sensor reading",
      icon: Droplets,
    },
    {
      label: "Tank capacity",
      value: `${formatLiter(tank.capacityLiter)} L`,
      note: "device configuration capacity",
      icon: Fuel,
    },
    {
      label: "Sensor height",
      value: formatMeasurement(tank.sensorMountHeightCm, "cm"),
      note: "sensor_mount_height_cm",
      icon: Radio,
    },
    {
      label: "Tank length",
      value: formatMeasurement(tank.lengthCm, "cm"),
      note: "physical tank configuration",
      icon: Settings,
    },
    ...(isRectangular
      ? [
          {
            label: "Tank width",
            value: formatMeasurement(tank.widthCm, "cm"),
            note: "rectangular tank configuration",
            icon: Ruler,
          },
          {
            label: "Tank height",
            value: formatMeasurement(tank.heightCm, "cm"),
            note: "fuel height limit",
            icon: Gauge,
          },
        ]
      : [
          {
            label: "Tank diameter",
            value: formatMeasurement(tank.diameterCm, "cm"),
            note: "cylinder tank configuration",
            icon: Gauge,
          },
        ]),
    {
      label: "Consumption per hour",
      value: `${tank.consumptionLiterPerHour} L/h`,
      note: "runtime estimation parameter",
      icon: Activity,
    },
    {
      label: "Low level",
      value: formatPercent(tank.lowLevelPercent),
      note: "warning status threshold",
      icon: AlertTriangle,
    },
    {
      label: "Critical level",
      value: formatPercent(tank.criticalLevelPercent),
      note: "critical priority threshold",
      icon: Zap,
    },
  ];

  return (
    <div className="relative overflow-hidden rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <SectionHeading
          label="Tank visual"
          title={tank.shapeLabel}
          description={visualDescription}
        />
        <StatusBadge status={tank.status} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold text-zinc-600 shadow-sm ring-1 ring-zinc-200">
              <Radio className="size-4 text-red-600" aria-hidden="true" />
              Sensor on top
            </div>

            <div className="rounded-full bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-700 ring-1 ring-cyan-100">
              {tank.hasReading ? `Level ${tank.fillPercent}%` : "no data yet"}
            </div>
          </div>

          <div className="relative mt-5 h-64 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm sm:h-72">
            {isRectangular ? (
              <TankRectangularScene3D
                fillPercent={fillPercent}
                lengthCm={tank.lengthCm}
                widthCm={tank.widthCm}
                heightCm={tank.heightCm}
                sensorDistanceCm={tank.sensorDistanceCm}
                fuelHeightCm={tank.fuelHeightCm}
              />
            ) : (
              <TankHorizontalCylinderScene3D
                fillPercent={fillPercent}
                lengthCm={tank.lengthCm}
                diameterCm={tank.diameterCm}
                sensorDistanceCm={tank.sensorDistanceCm}
                fuelHeightCm={tank.fuelHeightCm}
              />
            )}
          </div>

          <div className="mt-1 grid grid-cols-3 gap-2 text-xs font-medium text-zinc-500">
            <span>0%</span>
            <span className="text-center">
              capacity {formatLiter(tank.capacityLiter)} L
            </span>
            <span className="text-right">100%</span>
          </div>

          <div className="mt-4 rounded-lg border border-cyan-100 bg-white p-3 text-xs leading-5 text-zinc-500">
            The red line shows the empty-space height from the sensor point to
            the fuel surface. The blue area follows the fuel height
            vertically, not left to right.
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {dimensionItems.map((item, index) => {
            const Icon = item.icon;
            const shouldCenterItem =
              !isRectangular && index === dimensionItems.length - 1;

            return (
              <div
                key={item.label}
                className={`rounded-lg border border-zinc-200 bg-zinc-50 p-3 ${
                  shouldCenterItem
                    ? "sm:col-span-2 sm:mx-auto sm:w-[calc(50%-0.375rem)]"
                    : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-lg bg-white text-red-600 ring-1 ring-zinc-200">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-xs font-medium text-zinc-400">
                      {item.label}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-zinc-950">
                      {item.value}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-5 text-zinc-500">
                  {item.note}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LocationPanel({ tank }: { tank: TankDetail }) {
  return (
    <article className="animate-soft-fade overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-zinc-200 p-5 sm:flex-row sm:items-start sm:justify-between">
        <SectionHeading
          label="Manual location"
          title="STO points on the manual map"
          description="Coordinates are shown as manual input so the display does not depend on the GPS module."
        />
        <span className="w-fit rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200">
          {tank.coordinateLabel}
        </span>
      </div>

      <TankLocationMap sites={tank.nearbySites} initialTankId={tank.id} />
    </article>
  );
}

function ParameterList({ items }: { items: ParameterItem[] }) {
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <div
            key={item.label}
            className="rounded-lg border border-zinc-200 bg-zinc-50 p-4"
          >
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-lg bg-white text-red-600 ring-1 ring-zinc-200">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-medium text-zinc-400">
                  {item.label}
                </p>
                <p className="mt-1 text-lg font-semibold text-zinc-950">
                  {item.value}
                </p>
              </div>
            </div>
            <p className="mt-3 text-sm text-zinc-500">{item.note}</p>
          </div>
        );
      })}
    </div>
  );
}

function formatSnapshotItem(
  value: string | number | null | undefined,
  suffix = "",
) {
  if (typeof value === "undefined" || value === null || value === "") {
    return "-";
  }

  return typeof value === "number" ? `${formatLiter(value)}${suffix}` : value;
}

function ConfigReviewPanel({ tank }: { tank: TankDetail }) {
  const review = tank.configReview;
  const isProblem = review.needsReview || review.status === "invalid_config";
  const isMinor = review.status === "minor_config_difference";
  const tone = isProblem
    ? "border-red-200 bg-red-50"
    : isMinor
      ? "border-amber-200 bg-amber-50"
      : "border-emerald-200 bg-emerald-50";
  const badgeTone = isProblem
    ? "bg-red-600 text-white"
    : isMinor
      ? "bg-amber-500 text-white"
      : "bg-emerald-600 text-white";
  const payloadConfig = review.payloadTankConfig;
  const registryConfig = review.registryTankConfig;
  const appliedConfig = review.appliedTankConfig;
  const configCards = [
    {
      label: "Registry",
      shape:
        registryConfig.shape === "rectangular"
          ? "Rectangular tank"
          : "Horizontal cylinder",
      capacity: formatSnapshotItem(registryConfig.capacityLiter, " L"),
      source: "official application data",
    },
    {
      label: "Payload",
      shape: payloadConfig?.shape
        ? payloadConfig.shape === "rectangular"
          ? "Tangki balok"
          : "Silinder horizontal"
        : "-",
      capacity: formatSnapshotItem(payloadConfig?.capacityLiter, " L"),
      source: "device report",
    },
    {
      label: "Used by readings",
      shape:
        appliedConfig.shape === "rectangular"
          ? "Rectangular tank"
          : "Horizontal cylinder",
      capacity: formatSnapshotItem(appliedConfig.capacityLiter, " L"),
      source: "normalization result",
    },
  ];

  return (
    <section
      className={`mb-5 animate-soft-fade rounded-lg border p-5 shadow-sm ${tone}`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <SectionHeading
          label="Review config"
          title={review.summaryLabel}
          description="Device payloads may carry tank configuration, but it is still compared against the registry so large changes are not silently trusted."
        />
        <div className="flex flex-wrap gap-2">
          <span
            className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${badgeTone}`}
          >
            {formatConfigStatusLabel(review.status)}
          </span>
          <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200">
            source {review.configSource}
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {configCards.map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-white/70 bg-white/80 p-4 shadow-sm"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
              {item.label}
            </p>
            <p className="mt-2 text-sm font-semibold text-zinc-950">
              {item.shape}
            </p>
            <p className="mt-1 text-sm text-zinc-600">{item.capacity}</p>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              {item.source}
            </p>
          </div>
        ))}
      </div>

      {review.issues.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {review.issues.slice(0, 4).map((issue) => (
            <div
              key={`${issue.field}-${issue.message}`}
              className="rounded-lg border border-white/70 bg-white/80 p-4 text-sm leading-6 text-zinc-700 shadow-sm"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold text-zinc-950">{issue.label}</p>
                  <p className="mt-1">{issue.message}</p>
                </div>
                <span className="w-fit rounded-full bg-zinc-950 px-3 py-1 text-xs font-semibold text-white">
                  {issue.severity}
                </span>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Registry data: {issue.registryValue} | Device data:{" "}
                {issue.payloadValue}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-white/70 bg-white/80 p-4 text-sm leading-6 text-zinc-600 shadow-sm">
          No major configuration conflict was detected in the latest reading.
        </p>
      )}
    </section>
  );
}

function RuntimeParameterPanel({ tank }: { tank: TankDetail }) {
  const activeParameter = getRuntimeLevelParameter(
    tank.hasReading ? tank.runtimeHour : null,
  );

  return (
    <section className="animate-soft-fade rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <SectionHeading
        label="Remaining hours"
        title="Runtime parameter level"
        description="This category reads the generator runtime remaining so operators know the tank position against operational bounds."
      />

      <div
        className={`mt-5 rounded-lg border p-4 ${activeParameter.card}`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Active parameter
            </p>
            <p className="mt-2 text-2xl font-semibold text-zinc-950">
              {activeParameter.label}
            </p>
          </div>
          <span
            className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ring-1 ${activeParameter.badge}`}
          >
            {tank.hasReading ? formatRuntimeHour(tank.runtimeHour) : "-"}
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          {activeParameter.description}
        </p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {runtimeLevelParameters.map((parameter) => {
          const isActive = parameter.label === activeParameter.label;

          return (
            <div
              key={parameter.label}
              className={`rounded-lg border p-3 transition duration-300 ${
                isActive
                  ? `${parameter.card} ring-2 ring-blue-100`
                  : "border-zinc-200 bg-zinc-50"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${parameter.dot}`} />
                  <span className="text-sm font-semibold text-zinc-950">
                    {parameter.label}
                  </span>
                </div>
                <span className="text-xs font-semibold text-zinc-500">
                  {parameter.range}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TankConfigurationPanel({ tank }: { tank: TankDetail }) {
  const dimensionRows =
    tank.shape === "rectangular"
      ? [
          ["Tank length", formatMeasurement(tank.lengthCm, "cm")],
          ["Tank width", formatMeasurement(tank.widthCm, "cm")],
          ["Tank height", formatMeasurement(tank.heightCm, "cm")],
        ]
      : [
          ["Cylinder length", formatMeasurement(tank.lengthCm, "cm")],
          ["Cylinder diameter", formatMeasurement(tank.diameterCm, "cm")],
        ];
  const configRows = [
    ["Status config", tank.configReview.summaryLabel],
    ["Config source", tank.configReview.configSource],
    ["Visual type", tank.shapeLabel],
    ["Capacity", `${formatLiter(tank.capacityLiter)} L`],
    ...dimensionRows,
    ["Tinggi sensor", formatMeasurement(tank.sensorMountHeightCm, "cm")],
    ["Consumption per hour", `${tank.consumptionLiterPerHour} L/h`],
    ["Low level", formatPercent(tank.lowLevelPercent)],
    ["Critical level", formatPercent(tank.criticalLevelPercent)],
    ["Report interval", `${tank.expectedIntervalMin} min`],
  ];

  return (
    <section
      id="configuration"
      className="animate-soft-fade rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
    >
      <SectionHeading
        label="Configuration"
        title="Tank and device specifications"
        description="Config summary used by the UI to choose visuals, calculate volume, and set operational thresholds."
      />

      <div className="mt-6 space-y-3">
        {configRows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3"
          >
            <span className="text-sm font-medium text-zinc-500">{label}</span>
            <span className="text-right text-sm font-semibold text-zinc-950">
              {value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReadingTable({ tank }: { tank: TankDetail }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[720px] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-[0.12em] text-zinc-400">
            <th className="px-4 py-2 font-semibold">Time</th>
            <th className="px-4 py-2 font-semibold">Percent</th>
            <th className="px-4 py-2 font-semibold">Volume</th>
            <th className="px-4 py-2 font-semibold">Empty space</th>
            <th className="px-4 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {tank.readings.length === 0 ? (
            <tr className="bg-zinc-50">
              <td
                colSpan={5}
                className="rounded-lg px-4 py-8 text-center text-sm text-zinc-500"
              >
                No readings stored for this tank yet.
              </td>
            </tr>
          ) : (
            tank.readings.map((reading, index) => (
              <tr
                key={`${reading.time}-${reading.volumeLiter}-${index}`}
                className="bg-zinc-50"
              >
                <td className="rounded-l-lg px-4 py-4 font-semibold text-zinc-950">
                  {reading.time}
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-200">
                      <span
                        className={`block h-full rounded-full ${
                          reading.percent < 25
                            ? "bg-red-500"
                            : reading.percent < 45
                              ? "bg-amber-500"
                              : "bg-cyan-500"
                        }`}
                        style={{ width: `${reading.percent}%` }}
                      />
                    </div>
                    <span className="font-semibold">{reading.percent}%</span>
                  </div>
                </td>
                <td className="px-4 py-4 font-semibold">
                  {formatLiter(reading.volumeLiter)} L
                </td>
                <td className="px-4 py-4 text-zinc-600">
                  {reading.distanceCm} cm
                </td>
                <td className="rounded-r-lg px-4 py-4">
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                    received
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function TankDetailPage({
  params,
}: {
  params: Promise<{ tankId: string }>;
}) {
  const { tankId } = await params;

  await connection();
  const admin = await requirePageAdmin();

  const now = new Date();
  const [latestReadingsResult, tankHistoryReadings, referenceData] =
    await Promise.all([
      listLatestMonitoringReadingsByTankWithSource(),
      listMonitoringReadingsForTank(tankId),
      getMonitoringReferenceData(),
    ]);
  const tankView = buildTankDetail(tankId, {
    now,
    sites: referenceData.sites,
    tanks: referenceData.tanks,
    devices: referenceData.devices,
    readings: mergeMonitoringReadingsById(
      latestReadingsResult.readings,
      tankHistoryReadings,
    ),
  });

  if (!tankView) {
    notFound();
  }

  const simpleTankDetail = buildSimpleTankDetail(tankView, tankHistoryReadings);
  const tank = toTankDetail(tankView, simpleTankDetail.chartTrends);
  const refreshIntervalMs = getMonitoringRefreshIntervalMs();

  const status = statusMeta[tank.status];
  const metrics = [
    {
      label: "Current volume",
      value: tank.hasReading ? `${formatLiter(tank.volumeLiter)} L` : "-",
      note: tank.hasReading
        ? `${tank.fillPercent}% of the configured capacity of ${formatLiter(tank.capacityLiter)} L, volume source ${formatSourceLabel(tank.dataSources.volumeSource)}`
        : `waiting for the first reading from the device, configured capacity ${formatLiter(tank.capacityLiter)} L`,
      icon: Fuel,
      tone: "bg-cyan-50 text-cyan-700 ring-cyan-100",
    },
    {
      label: "Runtime estimate",
      value: tank.hasReading ? formatRuntimeHour(tank.runtimeHour) : "-",
      note: tank.hasReading
        ? `based on ${tank.consumptionLiterPerHour} L/h consumption, calculated ${formatSourceLabel(tank.dataSources.runtimeSource)}`
        : `will be calculated after volume is read, configured consumption ${tank.consumptionLiterPerHour} L/h`,
      icon: Clock,
      tone: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    },
    {
      label: "Device status",
      value: status.label,
      note: `last update ${tank.lastUpdateLabel}`,
      icon: Wifi,
      tone: `${status.soft} ${status.text} ${status.ring}`,
    },
    {
      label: "RSSI signal",
      value: formatMeasurement(tank.rssiDbm, "dBm"),
      note: "value from device data if available",
      icon: Radio,
      tone: "bg-zinc-100 text-zinc-700 ring-zinc-200",
    },
  ];
  const deviceParameters: ParameterItem[] = [
    {
      label: "Device ID",
      value: tank.deviceId,
      note: "device identity for the X-Device-Id header",
      icon: Database,
    },
    {
      label: "Report interval",
      value: `${tank.expectedIntervalMin} min`,
      note: "this number is the basis for stale/offline status",
      icon: Activity,
    },
    {
      label: "Voltage",
      value: formatMeasurement(tank.batteryVolt, "V"),
      note: "value from device data if available",
      icon: Battery,
    },
    {
      label: "Received at",
      value: tank.receivedAtLabel,
      note: "server time the latest data was received",
      icon: History,
    },
  ];
  const dataFlow: TimelineItem[] = [
    {
      label: "Empty-space height read",
      value: tank.hasReading ? `${tank.sensorDistanceCm} cm` : "-",
      detail: tank.hasReading
        ? "empty distance from the sensor point to the fuel surface"
        : "no empty-space height received yet",
    },
    {
      label: "Fuel height calculated",
      value: tank.hasReading ? `${tank.fuelHeightCm} cm` : "-",
      detail: tank.hasReading
        ? `fuel height source ${formatSourceLabel(tank.dataSources.fuelHeightSource)}`
        : "fuel height is not calculated before data arrives",
    },
    {
      label: "Volume and percent",
      value: tank.hasReading
        ? `${formatLiter(tank.volumeLiter)} L / ${tank.fillPercent}%`
        : "-",
      detail: tank.hasReading
        ? `volume from ${formatSourceLabel(tank.dataSources.volumeSource)}, percent from ${formatSourceLabel(tank.dataSources.fillPercentSource)}`
        : "the dashboard keeps showing the STO while waiting for the first data",
    },
    {
      label: "Operational runtime",
      value: tank.hasReading ? `${tank.runtimeHour} hrs` : "-",
      detail: tank.hasReading
        ? "estimated generator duration from hourly consumption"
        : "runtime is only valid after the fuel volume is available",
    },
  ];

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f5faf8] text-zinc-950">
      <DashboardHeader
        navItems={[
          { href: "/dashboard", label: "Tank Management" },
          { current: true, label: "Tank Details" },
          { href: "#history", label: "History" },
          { href: "#location", label: "Location" },
          { href: "#configuration", label: "Configuration" },
          { href: "#device-data", label: "Device Data" },
        ]}
        rightSlot={
          <>
            <LiveRefreshControl
              intervalMs={refreshIntervalMs}
              lastSyncedLabel={`Updated ${tank.lastUpdateLabel}`}
              className="hidden md:inline-flex"
            />
            <div className="hidden sm:block">
              <StatusBadge status={tank.status} />
            </div>
          </>
        }
        user={admin}
      />

      <div className="mx-auto max-w-[1540px] px-4 py-5 sm:px-6 lg:px-8">
        {/* Detail Toolbar */}
        <section className="animate-soft-fade mb-5 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-200"
                >
                  <ArrowLeft className="size-3.5" aria-hidden="true" />
                  Back to dashboard
                </Link>
                <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 ring-1 ring-red-100">
                  tank details
                </span>
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200">
                  data operasional
                </span>
              </div>

              <h1 className="mt-3 max-w-4xl break-words text-[1.85rem] font-semibold leading-[1.08] tracking-normal text-zinc-950 sm:text-4xl lg:text-5xl">
                {tank.tankName} {tank.siteName}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-500 sm:text-base">
                These details show the tank level, sensor parameters, runtime
                estimates, reading history, and STO position based on manual
                coordinates.
              </p>
            </div>

            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5 xl:w-[48rem]">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Site
                </p>
                <p className="mt-1 text-lg font-semibold">{tank.siteCode}</p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Regional
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {tank.regionalLabel ?? "-"}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Territory
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {tank.wilayahLabel ?? "-"}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Area
                </p>
                <p className="mt-1 text-lg font-semibold">{tank.areaLabel}</p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Update
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {tank.lastUpdateLabel}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Detail Metrics */}
        <section className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </section>

        <ConfigReviewPanel tank={tank} />

        <div className="grid min-w-0 gap-5 xl:grid-cols-[1.32fr_0.68fr]">
          <div className="min-w-0 space-y-5">
            {/* Tank Visual Section */}
            <section id="visual">
              <TankVisual tank={tank} />
            </section>

            {/* History Section */}
            <section
              id="history"
              className="animate-soft-fade min-w-0 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <SectionHeading
                  label="History"
                  title="Reading trend"
                  description="Pick a chart range, then download the CSV for the same data period."
                />
              </div>
              <SimpleTankVolumeChart
                capacityLiter={tank.capacityLiter}
                exportHrefBase={`/api/tanks/${tank.id}/readings/export`}
                trends={tank.chartTrends}
              />
              <ReadingTable tank={tank} />
            </section>

          </div>

          <aside className="min-w-0 space-y-5">
            {/* Device Health Section */}
            <section className="animate-soft-fade rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <SectionHeading
                  label="Device"
                  title="Sensor status"
                  description="This information is prepared for device health checks once live data starts arriving."
                />
                <StatusBadge status={tank.status} />
              </div>
              <ParameterList items={deviceParameters} />
            </section>

            {/* Runtime Parameter Section */}
            <RuntimeParameterPanel tank={tank} />

            {/* Tank Configuration Section */}
            <TankConfigurationPanel tank={tank} />
          </aside>
        </div>

        {/* Location Section */}
        <section id="location" className="mt-5 min-w-0">
          <LocationPanel tank={tank} />
        </section>

        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-3">
          {/* Data Flow Section */}
          <section className="animate-soft-fade rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <SectionHeading
              label="Reading flow"
              title="From sensor to decision"
              description="This sequence keeps the dashboard from misreading raw device data."
            />

            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              {dataFlow.map((item, index) => (
                <div key={item.label} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <span className="grid size-9 place-items-center rounded-full bg-red-50 text-sm font-semibold text-red-600 ring-1 ring-red-100">
                      {index + 1}
                    </span>
                    {index < dataFlow.length - 1 ? (
                      <span className="mt-2 h-full min-h-10 border-l border-zinc-200 sm:hidden xl:block" />
                    ) : null}
                  </div>
                  <div className="pb-2">
                    <p className="font-semibold text-zinc-950">{item.label}</p>
                    <p className="mt-1 text-xl font-semibold text-zinc-950">
                      {item.value}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">
                      {item.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Device Data Section */}
          <section
            id="device-data"
            className="animate-soft-fade rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
          >
            <SectionHeading
              label="Device data"
              title="CAT-compatible fields"
              description="The values below bridge the legacy device format to cleaner internal data."
            />

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {[
                [
                  "distance",
                  tank.hasReading ? `${tank.rawPayload.distance} cm` : "-",
                ],
                [
                  "raw.H_cm",
                  tank.hasReading ? `${tank.rawPayload.H_cm} cm` : "-",
                ],
                [
                  "raw.volume",
                  tank.hasReading
                    ? `${formatLiter(tank.rawPayload.volume)} L`
                    : "-",
                ],
                [
                  "raw.percent",
                  tank.hasReading ? `${tank.rawPayload.percent}%` : "-",
                ],
                [
                  "raw.wifi_rssi",
                  tank.hasReading
                    ? formatMeasurement(tank.rawPayload.wifi_rssi, "dBm")
                    : "-",
                ],
                ["config.status", formatConfigStatusLabel(tank.configReview.status)],
                [
                  "source.volume",
                  formatSourceLabel(tank.dataSources.volumeSource),
                ],
                [
                  "source.percent",
                  formatSourceLabel(tank.dataSources.fillPercentSource),
                ],
              ].map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3"
                >
                  <code className="text-sm font-semibold text-zinc-700">
                    {key}
                  </code>
                  <span className="text-sm font-semibold text-zinc-950">
                    {value}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-lg bg-zinc-950 p-4 text-sm text-white">
              <div className="flex items-center gap-2 font-semibold">
                <Zap className="size-4 text-cyan-300" aria-hidden="true" />
                POST /api/ingest
              </div>
              <p className="mt-2 text-zinc-300">
                The dashboard reads normalized data, not the sensor directly.
              </p>
            </div>
          </section>

          {/* Validation Notes Section */}
          <section className="animate-soft-fade rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <SectionHeading
              label="Field validation"
              title="Data to confirm"
              description="Use this list to make sure device readings, tank configuration, and STO locations match field conditions before they are used as operational references."
            />

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {[
                "Tank dimensions follow the latest physical measurements.",
                "Hourly fuel consumption matches each STO's generator load.",
                "Device report interval matches the active configuration.",
                "Manual coordinates are approved by the location owner.",
              ].map((note) => (
                <div
                  key={note}
                  className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4"
                >
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0 text-red-600"
                    aria-hidden="true"
                  />
                  <p className="text-sm leading-6 text-zinc-600">{note}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
