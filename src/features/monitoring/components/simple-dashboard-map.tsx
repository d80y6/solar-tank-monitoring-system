"use client";

/* eslint-disable @next/next/no-img-element -- Map tiles use OpenStreetMap's slippy-tile URLs directly. */

import Link from "next/link";
import {
  Crosshair,
  MapPin,
  Minus,
  Plus,
} from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { formatCoordinatePair } from "@/features/monitoring/lib/number";
import type { SimpleDashboardSite } from "@/features/monitoring/lib/simple-dashboard-model";

type LatLng = {
  latitude: number;
  longitude: number;
};

type WorldPixel = {
  x: number;
  y: number;
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

const TILE_SIZE = 256;
const MAP_WIDTH = 1024;
const MAP_HEIGHT = 560;
const MIN_ZOOM = 9;
const MAX_ZOOM = 16;
const DEFAULT_ZOOM = 12;

function formatLiter(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function isValidCoordinate(site: SimpleDashboardSite): site is SimpleDashboardSite &
  Required<Pick<SimpleDashboardSite, "latitude" | "longitude">> {
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
  const latitude = clamp(point.latitude, -85, 85);
  const sinLatitude = Math.sin((latitude * Math.PI) / 180);
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
    90 -
    (360 * Math.atan(Math.exp(-normalizedY * 2 * Math.PI))) / Math.PI;

  return {
    latitude: clamp(latitude, -85, 85),
    longitude: ((longitude + 540) % 360) - 180,
  };
}

function getAverageCenter(sites: SimpleDashboardSite[]): LatLng {
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

function getMarkerPosition(
  site: SimpleDashboardSite,
  center: LatLng,
  zoom: number,
) {
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

function getStatusLabel(site: SimpleDashboardSite) {
  return site.isOnline ? "Online" : "Offline";
}

function getStatusClasses(site: SimpleDashboardSite) {
  return site.isOnline
    ? {
        pin: "text-emerald-500",
        badge: "bg-emerald-50 text-emerald-700 ring-emerald-100",
        bar: "bg-emerald-500",
        row: "border-emerald-200 bg-emerald-50/70",
      }
    : {
        pin: "text-red-500",
        badge: "bg-red-50 text-red-700 ring-red-100",
        bar: "bg-red-500",
        row: "border-red-200 bg-red-50/70",
      };
}

function StatusBadge({ site }: { site: SimpleDashboardSite }) {
  const classes = getStatusClasses(site);

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${classes.badge}`}
    >
      {getStatusLabel(site)}
    </span>
  );
}

function MapEmptyState({ hasSites }: { hasSites: boolean }) {
  return (
    <div className="grid min-h-[30rem] place-items-center rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center shadow-sm">
      <div className="max-w-sm">
        <MapPin className="mx-auto size-9 text-zinc-400" aria-hidden="true" />
        <h3 className="mt-4 text-base font-semibold text-zinc-950">
          {hasSites ? "Coordinates unavailable" : "No STOs on the map"}
        </h3>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          {hasSites
            ? "Fill in latitude and longitude in the location data so the STO pin appears."
            : "Try changing the search, status, area, or selected STO."}
        </p>
      </div>
    </div>
  );
}

export function SimpleDashboardMap({ sites }: { sites: SimpleDashboardSite[] }) {
  const coordinateSites = useMemo(() => sites.filter(isValidCoordinate), [sites]);
  const initialCenter = useMemo(() => getAverageCenter(sites), [sites]);
  const [center, setCenter] = useState<LatLng>(initialCenter);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [activeTankId, setActiveTankId] = useState(sites[0]?.tankId ?? "");
  const dragState = useRef<DragState | null>(null);
  const hasCoordinates = coordinateSites.length > 0;
  const tiles = useMemo(() => buildTiles(center, zoom), [center, zoom]);
  const activeSite =
    sites.find((site) => site.tankId === activeTankId) ??
    coordinateSites[0] ??
    sites[0];

  function changeZoom(nextZoom: number) {
    setZoom(clamp(nextZoom, MIN_ZOOM, MAX_ZOOM));
  }

  function resetMap() {
    setCenter(initialCenter);
    setZoom(DEFAULT_ZOOM);
  }

  function focusSite(site: SimpleDashboardSite) {
    setActiveTankId(site.tankId);

    if (isValidCoordinate(site)) {
      setCenter({
        latitude: site.latitude,
        longitude: site.longitude,
      });
    }
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

  if (!hasCoordinates) {
    return <MapEmptyState hasSites={sites.length > 0} />;
  }

  return (
    <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-[#dceee8] shadow-sm">
        <div
          aria-label="STO map"
          className="relative h-[28rem] touch-none overflow-hidden bg-[#dceee8] md:h-[32rem]"
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          role="application"
        >
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
                alt=""
                className="absolute select-none"
                draggable={false}
                key={tile.key}
                loading="lazy"
                src={tile.url}
                style={{
                  left: tile.left,
                  top: tile.top,
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                }}
              />
            ))}

            {coordinateSites.map((site) => {
              const position = getMarkerPosition(site, center, zoom);

              if (!position) {
                return null;
              }

              const classes = getStatusClasses(site);
              const active = activeSite?.tankId === site.tankId;

              return (
                <button
                  aria-label={`${site.name}, ${formatLiter(site.volumeLiter)} of ${formatLiter(site.capacityLiter)} liters, ${getStatusLabel(site)}`}
                  className="group absolute z-20 -translate-x-1/2 -translate-y-full text-left outline-none"
                  key={site.tankId}
                  onClick={(event) => {
                    event.stopPropagation();
                    focusSite(site);
                  }}
                  onFocus={() => setActiveTankId(site.tankId)}
                  onMouseEnter={() => setActiveTankId(site.tankId)}
                  onPointerDown={(event) => event.stopPropagation()}
                  style={{
                    left: position.left,
                    top: position.top,
                  }}
                  type="button"
                >
                  <span
                    className={`grid size-10 place-items-center rounded-full bg-white shadow-lg ring-2 ring-white transition duration-200 group-hover:-translate-y-1 group-hover:scale-110 group-focus-visible:-translate-y-1 group-focus-visible:scale-110 group-focus-visible:ring-blue-200 ${
                      active ? "-translate-y-1 scale-110 ring-blue-200" : ""
                    }`}
                  >
                    <MapPin
                      aria-hidden="true"
                      className={`size-8 ${classes.pin}`}
                      fill="currentColor"
                      stroke="white"
                      strokeWidth={2.3}
                    />
                  </span>

                  <span className="pointer-events-none absolute left-1/2 top-11 z-30 hidden w-max -translate-x-1/2 rounded-full bg-zinc-950 px-2.5 py-1 text-xs font-semibold text-white shadow-lg group-hover:block group-focus-visible:block">
                    {site.code}
                  </span>

                  <div className="pointer-events-none absolute bottom-12 left-1/2 z-40 hidden w-44 -translate-x-1/2 overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-950 shadow-xl shadow-zinc-500/20 group-hover:block group-focus-visible:block">
                    <span className={`block h-1 ${classes.bar}`} />
                    <div className="p-2.5">
                      <p className="truncate text-xs font-semibold text-zinc-950">
                        {site.name}
                      </p>
                      <p className="mt-1 text-sm font-semibold tracking-normal text-zinc-950">
                        {formatLiter(site.volumeLiter)} /{" "}
                        {formatLiter(site.capacityLiter)} L
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div
            className="absolute right-3 top-3 z-30 grid gap-2"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              aria-label="Zoom in"
              className="grid size-10 place-items-center rounded-lg border border-zinc-200 bg-white/95 text-zinc-800 shadow-sm backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => changeZoom(zoom + 1)}
              type="button"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
            <button
              aria-label="Zoom out"
              className="grid size-10 place-items-center rounded-lg border border-zinc-200 bg-white/95 text-zinc-800 shadow-sm backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => changeZoom(zoom - 1)}
              type="button"
            >
              <Minus className="size-4" aria-hidden="true" />
            </button>
            <button
              aria-label="Recenter map"
              className="grid size-10 place-items-center rounded-lg border border-zinc-200 bg-white/95 text-zinc-800 shadow-sm backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15"
              onClick={resetMap}
              type="button"
            >
              <Crosshair className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="absolute bottom-3 right-3 z-30 rounded-full border border-zinc-200 bg-white/95 px-3 py-2 text-[0.68rem] font-medium text-zinc-500 shadow-sm backdrop-blur">
            ©{" "}
            <a
              className="underline decoration-zinc-300 underline-offset-2"
              href="https://www.openstreetmap.org/copyright"
              rel="noreferrer"
              target="_blank"
            >
              OpenStreetMap
            </a>
            {" "}contributors
          </div>
        </div>
      </div>

      <aside className="min-w-0 self-start rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        {activeSite ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-zinc-500">
                  {activeSite.code} - {activeSite.regionalLabel} -{" "}
                  {activeSite.wilayahLabel}
                </p>
                <p className="mt-0.5 text-xs font-medium text-zinc-500">
                  Area {activeSite.areaLabel}
                </p>
                <h2 className="mt-1 text-lg font-semibold leading-snug text-zinc-950">
                  {activeSite.name}
                </h2>
              </div>
              <StatusBadge site={activeSite} />
            </div>

            <div className="mt-5 rounded-lg border border-zinc-100 bg-zinc-50 p-4">
              <p className="text-sm font-medium text-zinc-500">Tank level</p>
              <p className="mt-2 text-2xl font-semibold tracking-normal text-zinc-950">
                {formatLiter(activeSite.volumeLiter)} /{" "}
                {formatLiter(activeSite.capacityLiter)} L
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                current / maximum capacity
              </p>
            </div>

            <dl className="mt-4 grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-3">
                <dt className="text-zinc-500">Last update</dt>
                <dd className="font-semibold text-zinc-950">
                  {activeSite.updateLabel}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-3">
                <dt className="text-zinc-500">Device</dt>
                <dd className="font-semibold text-zinc-950">
                  {activeSite.deviceId}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-500">Coordinates</dt>
                <dd className="font-semibold text-zinc-950">
                  {isValidCoordinate(activeSite)
                    ? formatCoordinatePair(
                        activeSite.latitude,
                        activeSite.longitude,
                      )
                    : "-"}
                </dd>
              </div>
            </dl>

            <Link
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20"
              href={`/dashboard/operations/tanks/${activeSite.tankId}`}
            >
              Details
              <MapPin className="size-4" aria-hidden="true" />
            </Link>

          </div>
        ) : (
          <p className="text-sm text-zinc-500">No STO selected yet.</p>
        )}
      </aside>
    </div>
  );
}
