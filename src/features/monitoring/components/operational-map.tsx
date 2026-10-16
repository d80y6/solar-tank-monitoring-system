"use client";

/* eslint-disable @next/next/no-img-element -- Map tiles are external slippy-map tiles; routing them through next/image would add unnecessary proxying. */

import {
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { Crosshair, MapPin, Minus, Plus, Search } from "lucide-react";

import type { DashboardSiteStatus } from "../lib/dashboard-view-model";

export type OperationalMapSite = {
  code: string;
  name: string;
  areaLabel: string;
  regionalLabel?: string;
  wilayahLabel?: string;
  tankId: string;
  status: DashboardSiteStatus;
  fillPercent: number;
  runtimeHour: number;
  updateLabel: string;
  deviceId: string;
  signal: string;
  note: string;
  latitude?: number;
  longitude?: number;
};

type OperationalMapProps = {
  sites: OperationalMapSite[];
  selectedCode?: string;
  priorityCount: number;
  onSitePreview?: (site: OperationalMapSite) => void;
  onSiteSelect?: (site: OperationalMapSite) => void;
};

type LatLng = {
  latitude: number;
  longitude: number;
};

type Tile = {
  key: string;
  url: string;
  left: number;
  top: number;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startCenterPixel: WorldPixel;
};

type WorldPixel = {
  x: number;
  y: number;
};

const TILE_SIZE = 256;
const MAP_WIDTH = 1024;
const MAP_HEIGHT = 540;
const MIN_ZOOM = 9;
const MAX_ZOOM = 15;
const DEFAULT_ZOOM = 12;

const statusMeta: Record<
  DashboardSiteStatus,
  {
    label: string;
    dot: string;
    pin: string;
    chip: string;
  }
> = {
  online: {
    label: "Online",
    dot: "bg-emerald-500",
    pin: "text-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  },
  warning: {
    label: "Warning",
    dot: "bg-amber-500",
    pin: "text-amber-500",
    chip: "bg-amber-50 text-amber-700 ring-amber-100",
  },
  critical: {
    label: "Critical",
    dot: "bg-red-600",
    pin: "text-red-600",
    chip: "bg-red-50 text-red-700 ring-red-100",
  },
  offline: {
    label: "Offline",
    dot: "bg-zinc-600",
    pin: "text-zinc-700",
    chip: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  },
};

const statusFilters: Array<DashboardSiteStatus | "all"> = [
  "all",
  "online",
  "warning",
  "critical",
  "offline",
];

function isValidCoordinate(site: OperationalMapSite): site is OperationalMapSite &
  Required<Pick<OperationalMapSite, "latitude" | "longitude">> {
  return (
    typeof site.latitude === "number" &&
    Number.isFinite(site.latitude) &&
    typeof site.longitude === "number" &&
    Number.isFinite(site.longitude)
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function wrapTileX(tileX: number, tilesPerAxis: number) {
  return ((tileX % tilesPerAxis) + tilesPerAxis) % tilesPerAxis;
}

function getWorldSize(zoom: number) {
  return TILE_SIZE * 2 ** zoom;
}

function latLngToWorldPixel(point: LatLng, zoom: number): WorldPixel {
  const sinLatitude = Math.sin((point.latitude * Math.PI) / 180);
  const normalizedX = (point.longitude + 180) / 360;
  const normalizedY =
    0.5 -
    Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI);
  const worldSize = getWorldSize(zoom);

  return {
    x: normalizedX * worldSize,
    y: normalizedY * worldSize,
  };
}

function worldPixelToLatLng(pixel: WorldPixel, zoom: number): LatLng {
  const worldSize = getWorldSize(zoom);
  const normalizedX = pixel.x / worldSize - 0.5;
  const normalizedY = 0.5 - pixel.y / worldSize;
  const longitude = normalizedX * 360;
  const latitude =
    (90 -
      (360 * Math.atan(Math.exp(-normalizedY * 2 * Math.PI))) / Math.PI);

  return {
    latitude: clamp(latitude, -85, 85),
    longitude: ((longitude + 540) % 360) - 180,
  };
}

function getAverageCenter(sites: OperationalMapSite[]): LatLng {
  const coordinateSites = sites.filter(isValidCoordinate);

  if (coordinateSites.length === 0) {
    return {
      latitude: -7.65,
      longitude: 112.9,
    };
  }

  return {
    latitude:
      coordinateSites.reduce((total, site) => total + site.latitude, 0) /
      coordinateSites.length,
    longitude:
      coordinateSites.reduce((total, site) => total + site.longitude, 0) /
      coordinateSites.length,
  };
}

function buildTiles(center: LatLng, zoom: number): Tile[] {
  const centerPixel = latLngToWorldPixel(center, zoom);
  const minTileX = Math.floor((centerPixel.x - MAP_WIDTH / 2) / TILE_SIZE) - 1;
  const maxTileX = Math.floor((centerPixel.x + MAP_WIDTH / 2) / TILE_SIZE) + 1;
  const minTileY = Math.floor((centerPixel.y - MAP_HEIGHT / 2) / TILE_SIZE) - 1;
  const maxTileY = Math.floor((centerPixel.y + MAP_HEIGHT / 2) / TILE_SIZE) + 1;
  const tilesPerAxis = 2 ** zoom;
  const tiles: Tile[] = [];

  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      if (tileY < 0 || tileY >= tilesPerAxis) {
        continue;
      }

      const wrappedX = wrapTileX(tileX, tilesPerAxis);
      tiles.push({
        key: `${zoom}-${tileX}-${tileY}`,
        url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`,
        left: tileX * TILE_SIZE - centerPixel.x + MAP_WIDTH / 2,
        top: tileY * TILE_SIZE - centerPixel.y + MAP_HEIGHT / 2,
      });
    }
  }

  return tiles;
}

function getMarkerPosition(site: OperationalMapSite, center: LatLng, zoom: number) {
  if (!isValidCoordinate(site)) {
    return null;
  }

  const centerPixel = latLngToWorldPixel(center, zoom);
  const markerPixel = latLngToWorldPixel(site, zoom);

  return {
    left: markerPixel.x - centerPixel.x + MAP_WIDTH / 2,
    top: markerPixel.y - centerPixel.y + MAP_HEIGHT / 2,
  };
}

function StatusChip({ status }: { status: DashboardSiteStatus }) {
  const meta = statusMeta[status];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${meta.chip}`}
    >
      <span className={`size-2 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

export function OperationalMap({
  sites,
  selectedCode,
  priorityCount,
  onSitePreview,
  onSiteSelect,
}: OperationalMapProps) {
  const initialCenter = useMemo(() => getAverageCenter(sites), [sites]);
  const [center, setCenter] = useState<LatLng>(initialCenter);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DashboardSiteStatus | "all">(
    "all",
  );
  const [internalSelectedCode, setInternalSelectedCode] = useState<string>(
    sites[0]?.code ?? "",
  );
  const dragState = useRef<DragState | null>(null);

  const coordinateSites = useMemo(() => sites.filter(isValidCoordinate), [sites]);
  const hasCoordinates = coordinateSites.length > 0;
  const tiles = useMemo(() => buildTiles(center, zoom), [center, zoom]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSites = useMemo(
    () =>
      sites.filter((site) => {
        const matchesStatus =
          statusFilter === "all" || site.status === statusFilter;
        const matchesQuery =
          normalizedQuery.length === 0 ||
          `${site.code} ${site.name} ${site.areaLabel} ${site.regionalLabel ?? ""} ${site.wilayahLabel ?? ""} ${site.deviceId}`
            .toLowerCase()
            .includes(normalizedQuery);

        return matchesStatus && matchesQuery;
      }),
    [normalizedQuery, sites, statusFilter],
  );
  const activeSelectedCode = selectedCode ?? internalSelectedCode;
  const selectedSite =
    sites.find((site) => site.code === activeSelectedCode) ??
    filteredSites[0] ??
    sites[0];

  function previewSite(site: OperationalMapSite) {
    setInternalSelectedCode(site.code);
    onSitePreview?.(site);
  }

  function focusSite(site: OperationalMapSite) {
    setInternalSelectedCode(site.code);
    onSiteSelect?.(site);

    if (isValidCoordinate(site)) {
      setCenter({
        latitude: site.latitude,
        longitude: site.longitude,
      });
    }
  }

  function changeZoom(nextZoom: number) {
    setZoom(clamp(nextZoom, MIN_ZOOM, MAX_ZOOM));
  }

  function resetMap() {
    setCenter(initialCenter);
    setZoom(DEFAULT_ZOOM);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!hasCoordinates) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startCenterPixel: latLngToWorldPixel(center, zoom),
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const currentDrag = dragState.current;

    if (!currentDrag || currentDrag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - currentDrag.startX;
    const deltaY = event.clientY - currentDrag.startY;
    setCenter(
      worldPixelToLatLng(
        {
          x: currentDrag.startCenterPixel.x - deltaX,
          y: currentDrag.startCenterPixel.y - deltaY,
        },
        zoom,
      ),
    );
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (dragState.current?.pointerId === event.pointerId) {
      dragState.current = null;
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div
        className="relative h-[31rem] touch-none overflow-hidden bg-[#ddeee8] md:h-[36rem]"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        role="application"
        aria-label="STO coordinate map"
      >
        {hasCoordinates ? (
          <div
            className="absolute left-1/2 top-1/2 origin-center cursor-grab active:cursor-grabbing"
            style={{
              width: MAP_WIDTH,
              height: MAP_HEIGHT,
              transform: "translate(-50%, -50%)",
            }}
          >
            {tiles.map((tile) => (
              <img
                key={tile.key}
                src={tile.url}
                alt=""
                draggable={false}
                loading="lazy"
                className="absolute select-none"
                style={{
                  left: tile.left,
                  top: tile.top,
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                }}
              />
            ))}

            {filteredSites.map((site) => {
              const position = getMarkerPosition(site, center, zoom);

              if (!position) {
                return null;
              }

              const meta = statusMeta[site.status];
              const selected = selectedSite?.code === site.code;

              return (
                <button
                  key={site.code}
                  type="button"
                  data-map-marker-code={site.code}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerEnter={() => previewSite(site)}
                  onMouseEnter={() => previewSite(site)}
                  onFocus={() => previewSite(site)}
                  onClick={(event) => {
                    event.stopPropagation();
                    focusSite(site);
                  }}
                  className="group absolute z-20 -translate-x-1/2 -translate-y-full text-left outline-none"
                  style={{
                    left: position.left,
                    top: position.top,
                  }}
                  aria-label={`Select ${site.name}, status ${meta.label}`}
                >
                  <MapPin
                    className={`size-8 drop-shadow-[0_8px_12px_rgba(0,0,0,0.28)] transition duration-200 group-hover:-translate-y-1 group-hover:scale-110 group-focus:-translate-y-1 group-focus:scale-110 ${meta.pin} ${
                      selected ? "-translate-y-1 scale-110" : ""
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

                  <div className="pointer-events-none absolute bottom-10 left-1/2 z-40 hidden w-64 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-3 shadow-2xl shadow-zinc-500/20 group-hover:block group-focus:block">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-950">
                          {site.name}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {site.regionalLabel ?? "-"} /{" "}
                          {site.wilayahLabel ?? "-"}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          Area {site.areaLabel} / {site.deviceId}
                        </p>
                      </div>
                      <StatusChip status={site.status} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md bg-zinc-50 p-2">
                        <p className="text-zinc-400">Level</p>
                        <p className="mt-1 font-semibold text-zinc-950">
                          {site.fillPercent}%
                        </p>
                      </div>
                      <div className="rounded-md bg-zinc-50 p-2">
                        <p className="text-zinc-400">Runtime</p>
                        <p className="mt-1 font-semibold text-zinc-950">
                          {site.runtimeHour} hrs
                        </p>
                      </div>
                      <div className="rounded-md bg-zinc-50 p-2">
                        <p className="text-zinc-400">Update</p>
                        <p className="mt-1 font-semibold text-zinc-950">
                          {site.updateLabel}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 line-clamp-2 text-xs leading-5 text-zinc-500">
                      {site.note}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid h-full place-items-center p-6 text-center">
            <div className="max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
              <MapPin
                className="mx-auto size-10 text-zinc-400"
                aria-hidden="true"
              />
              <h3 className="mt-4 text-lg font-semibold text-zinc-950">
                Coordinates unavailable
              </h3>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Fill in latitude and longitude in the MySQL registry so the STO
                pin appears on the map.
              </p>
            </div>
          </div>
        )}

        <div
          className="absolute left-3 right-3 top-3 z-30 md:left-4 md:right-auto md:top-4"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="rounded-xl border border-zinc-200 bg-white/95 p-2 shadow-lg shadow-zinc-500/10 backdrop-blur md:w-[42rem]">
            <div className="grid gap-2 md:grid-cols-[minmax(14rem,1fr)_auto]">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search STO or device"
                  className="h-10 w-full rounded-lg border border-transparent bg-zinc-50 pl-10 pr-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-red-200 focus:bg-white focus:ring-4 focus:ring-red-50"
                />
              </div>

              <div
                className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1"
                aria-label="Map status filter"
              >
                {statusFilters.map((status) => {
                  const active = statusFilter === status;
                  const label =
                    status === "all" ? "All" : statusMeta[status].label;

                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setStatusFilter(status)}
                      className={`rounded-md px-2.5 py-2 text-xs font-semibold transition sm:px-3 ${
                        active
                          ? "bg-zinc-950 text-white shadow-sm"
                          : "text-zinc-600 hover:bg-white"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div
          className="absolute right-4 top-36 z-30 grid gap-2 md:top-4"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => changeZoom(zoom + 1)}
            disabled={zoom >= MAX_ZOOM}
            className="grid size-10 place-items-center rounded-lg border border-zinc-200 bg-white/95 text-zinc-800 shadow-sm backdrop-blur transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="Zoom in"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => changeZoom(zoom - 1)}
            disabled={zoom <= MIN_ZOOM}
            className="grid size-10 place-items-center rounded-lg border border-zinc-200 bg-white/95 text-zinc-800 shadow-sm backdrop-blur transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="Zoom out"
          >
            <Minus className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={resetMap}
            className="grid size-10 place-items-center rounded-lg border border-zinc-200 bg-white/95 text-zinc-800 shadow-sm backdrop-blur transition hover:bg-white"
            aria-label="Recenter map"
          >
            <Crosshair className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="absolute bottom-14 left-3 z-30 max-w-[calc(100%-1.5rem)] rounded-full border border-zinc-200 bg-white/95 px-3 py-2 text-xs font-semibold text-zinc-700 shadow-sm backdrop-blur md:bottom-4 md:left-4">
          Showing {filteredSites.length} of {sites.length} STOs
          {priorityCount > 0 ? `, ${priorityCount} need attention` : ""}
        </div>

        <div className="absolute bottom-3 right-3 z-30 rounded-full border border-zinc-200 bg-white/95 px-3 py-2 text-[0.68rem] font-medium text-zinc-500 shadow-sm backdrop-blur md:bottom-4 md:right-4">
          ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-zinc-300 underline-offset-2"
          >
            OpenStreetMap
          </a>{" "}
          contributors
        </div>
      </div>
    </div>
  );
}
