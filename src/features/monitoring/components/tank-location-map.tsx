"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";

export type TankLocationMapStatus =
  | "online"
  | "warning"
  | "critical"
  | "offline";

export type TankLocationMapSite = {
  tankId: string;
  code: string;
  name: string;
  status: TankLocationMapStatus;
  left: string;
  top: string;
  runtimeHour: number;
  fillPercent: number;
  updateLabel: string;
};

type TankLocationMapProps = {
  sites: TankLocationMapSite[];
  initialTankId: string;
};

const statusMeta: Record<
  TankLocationMapStatus,
  {
    label: string;
    dot: string;
    pin: string;
    ring: string;
    badge: string;
  }
> = {
  online: {
    label: "Online",
    dot: "bg-emerald-500",
    pin: "text-emerald-500",
    ring: "ring-emerald-100",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  },
  warning: {
    label: "Warning",
    dot: "bg-amber-500",
    pin: "text-amber-500",
    ring: "ring-amber-100",
    badge: "bg-amber-50 text-amber-700 ring-amber-100",
  },
  critical: {
    label: "Critical",
    dot: "bg-red-600",
    pin: "text-red-600",
    ring: "ring-red-100",
    badge: "bg-red-50 text-red-700 ring-red-100",
  },
  offline: {
    label: "Offline",
    dot: "bg-zinc-600",
    pin: "text-zinc-700",
    ring: "ring-zinc-200",
    badge: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  },
};

function StatusBadge({ status }: { status: TankLocationMapStatus }) {
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

function LocationMarker({
  site,
  active,
  onPreview,
}: {
  site: TankLocationMapSite;
  active: boolean;
  onPreview: (site: TankLocationMapSite) => void;
}) {
  const meta = statusMeta[site.status];
  const markerStyle = {
    left: site.left,
    top: site.top,
  } satisfies CSSProperties;

  return (
    <Link
      href={`/dashboard/tanks/${site.tankId}`}
      className="group absolute z-20 -translate-x-1/2 -translate-y-full text-left outline-none"
      style={markerStyle}
      onPointerEnter={() => onPreview(site)}
      onMouseEnter={() => onPreview(site)}
      onFocus={() => onPreview(site)}
      aria-label={`Open details for ${site.name}, status ${meta.label}`}
    >
      <MapPin
        className={`size-8 drop-shadow-[0_8px_12px_rgba(0,0,0,0.26)] transition duration-200 group-hover:-translate-y-1 group-hover:scale-110 group-focus:-translate-y-1 group-focus:scale-110 ${meta.pin} ${
          active ? "-translate-y-1 scale-110" : ""
        }`}
        fill="currentColor"
        stroke="white"
        strokeWidth={2.2}
        aria-hidden="true"
      />
      <span className="absolute left-1/2 top-[0.45rem] size-2 -translate-x-1/2 rounded-full bg-white shadow-sm" />

      <span className="pointer-events-none absolute left-1/2 top-8 z-30 hidden w-max -translate-x-1/2 rounded-full bg-zinc-950 px-2.5 py-1 text-xs font-semibold text-white shadow-lg group-hover:block group-focus:block">
        {site.code}
      </span>
    </Link>
  );
}

export function TankLocationMap({
  sites,
  initialTankId,
}: TankLocationMapProps) {
  const initialSite = useMemo(
    () => sites.find((site) => site.tankId === initialTankId) ?? sites[0],
    [initialTankId, sites],
  );
  const [activeTankId, setActiveTankId] = useState(initialSite?.tankId ?? "");
  const activeSite =
    sites.find((site) => site.tankId === activeTankId) ?? initialSite;

  if (!activeSite) {
    return (
      <div className="grid min-h-[28rem] place-items-center bg-zinc-50 p-6 text-center">
        <p className="max-w-sm text-sm leading-6 text-zinc-500">
          No location pins available to display.
        </p>
      </div>
    );
  }

  const activeMarkerStyle = {
    left: activeSite.left,
    top: activeSite.top,
  } satisfies CSSProperties;

  return (
    <div className="relative min-h-[28rem] overflow-hidden bg-[#dff7f5]">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 22%, rgba(34, 211, 238, 0.32), transparent 24%), radial-gradient(circle at 72% 18%, rgba(132, 204, 22, 0.22), transparent 28%), radial-gradient(circle at 47% 72%, rgba(250, 204, 21, 0.24), transparent 25%), linear-gradient(135deg, rgba(255,255,255,0.8), rgba(236,253,245,0.66))",
        }}
      />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "linear-gradient(28deg, transparent 47%, rgba(113,113,122,.2) 48%, rgba(113,113,122,.2) 49%, transparent 50%), linear-gradient(96deg, transparent 47%, rgba(14,165,233,.24) 48%, rgba(14,165,233,.24) 49%, transparent 50%)",
          backgroundSize: "92px 92px, 124px 124px",
        }}
      />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1000 560"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M70 330 C210 250 340 290 460 220 C580 148 680 192 870 116"
          stroke="#ffffff"
          strokeLinecap="round"
          strokeWidth="28"
        />
        <path
          d="M90 410 C260 380 360 445 530 350 C680 266 770 320 920 260"
          stroke="#ffffff"
          strokeLinecap="round"
          strokeWidth="22"
        />
        <path
          d="M180 120 C280 210 310 300 420 380 C540 466 660 438 820 488"
          stroke="#ffffff"
          strokeLinecap="round"
          strokeWidth="18"
        />
        <path
          d="M70 330 C210 250 340 290 460 220 C580 148 680 192 870 116"
          stroke="#94a3b8"
          strokeDasharray="8 10"
          strokeWidth="2"
        />
        <path
          d="M90 410 C260 380 360 445 530 350 C680 266 770 320 920 260"
          stroke="#94a3b8"
          strokeDasharray="8 10"
          strokeWidth="2"
        />
      </svg>

      <div
        className="absolute left-4 right-4 top-4 z-40 rounded-lg border border-zinc-200 bg-white/95 p-4 shadow-lg shadow-zinc-300/30 backdrop-blur md:left-auto md:right-5 md:w-80"
        aria-live="polite"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
              <MapPin
                className={`size-4 shrink-0 ${statusMeta[activeSite.status].pin}`}
                aria-hidden="true"
              />
              <span className="truncate">{activeSite.name}</span>
            </div>
            <p className="mt-1 text-xs font-medium text-zinc-500">
              {activeSite.code}
            </p>
          </div>
          <StatusBadge status={activeSite.status} />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md bg-zinc-50 p-2">
            <p className="text-zinc-400">Level</p>
            <p className="mt-1 font-semibold text-zinc-950">
              {activeSite.fillPercent}%
            </p>
          </div>
          <div className="rounded-md bg-zinc-50 p-2">
            <p className="text-zinc-400">Runtime</p>
            <p className="mt-1 font-semibold text-zinc-950">
              {activeSite.runtimeHour} hrs
            </p>
          </div>
          <div className="rounded-md bg-zinc-50 p-2">
            <p className="text-zinc-400">Update</p>
            <p className="mt-1 font-semibold text-zinc-950">
              {activeSite.updateLabel}
            </p>
          </div>
        </div>

        <Link
          href={`/dashboard/tanks/${activeSite.tankId}`}
          className="mt-4 block rounded-lg bg-zinc-950 px-4 py-2.5 text-center text-xs font-semibold text-white transition hover:bg-red-600"
        >
          Open tank details
        </Link>
      </div>

      {sites.map((site) => (
        <LocationMarker
          key={site.tankId}
          site={site}
          active={activeSite.tankId === site.tankId}
          onPreview={(nextSite) => setActiveTankId(nextSite.tankId)}
        />
      ))}

      <div
        className={`pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full rounded-full bg-white p-1 shadow-lg ring-8 transition-all duration-300 ${statusMeta[activeSite.status].ring}`}
        style={activeMarkerStyle}
        aria-hidden="true"
      >
        <div className={`size-3.5 rounded-full ${statusMeta[activeSite.status].dot}`} />
      </div>
    </div>
  );
}
