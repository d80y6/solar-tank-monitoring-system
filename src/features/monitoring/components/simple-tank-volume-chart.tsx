"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Download } from "lucide-react";
import {
  SIMPLE_TANK_CHART_RANGES,
  type SimpleTankChartRangeKey,
  type SimpleTankTrendByRange,
} from "@/features/monitoring/lib/simple-tank-detail-model";

type SimpleTankVolumeChartProps = {
  trends: SimpleTankTrendByRange;
  capacityLiter: number;
  exportHrefBase?: string;
};

const FALLBACK_CHART_SIZE = {
  width: 960,
  height: 288,
};

function formatLiter(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function buildLinePath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function buildAreaPath(points: Array<{ x: number; y: number }>, bottom: number) {
  if (points.length < 2) {
    return "";
  }

  const linePath = buildLinePath(points);

  return `${linePath} L ${points.at(-1)?.x} ${bottom} L ${points[0].x} ${bottom} Z`;
}

function buildExportHref(base: string, rangeKey: SimpleTankChartRangeKey) {
  const separator = base.includes("?") ? "&" : "?";

  return `${base}${separator}range=${rangeKey}`;
}

export function SimpleTankVolumeChart({
  trends,
  capacityLiter,
  exportHrefBase,
}: SimpleTankVolumeChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rangeMenuRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [selectedRange, setSelectedRange] =
    useState<SimpleTankChartRangeKey>("day");
  const [isRangeMenuOpen, setIsRangeMenuOpen] = useState(false);
  const [chartSize, setChartSize] = useState(FALLBACK_CHART_SIZE);
  const trend = trends[selectedRange] ?? trends.day;
  const exportHref = exportHrefBase
    ? buildExportHref(exportHrefBase, selectedRange)
    : null;
  const selectedRangeOption =
    SIMPLE_TANK_CHART_RANGES.find((option) => option.key === selectedRange) ??
    SIMPLE_TANK_CHART_RANGES[0];
  const padding = useMemo(
    () => ({
      top: 20,
      right: chartSize.width < 560 ? 18 : 34,
      bottom: 44,
      left: chartSize.width < 560 ? 54 : 70,
    }),
    [chartSize.width],
  );

  useEffect(() => {
    const svg = svgRef.current;

    if (!svg) {
      return;
    }

    function syncChartSize() {
      if (!svg) {
        return;
      }

      const rect = svg.getBoundingClientRect();
      const nextWidth = Math.max(Math.round(rect.width), 320);
      const nextHeight = Math.max(Math.round(rect.height), 220);

      setChartSize((currentSize) => {
        if (
          currentSize.width === nextWidth &&
          currentSize.height === nextHeight
        ) {
          return currentSize;
        }

        return {
          height: nextHeight,
          width: nextWidth,
        };
      });
    }

    syncChartSize();

    const resizeObserver = new ResizeObserver(syncChartSize);
    resizeObserver.observe(svg);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isRangeMenuOpen) {
      return;
    }

    function handlePointerDown(event: globalThis.PointerEvent) {
      if (!rangeMenuRef.current?.contains(event.target as Node)) {
        setIsRangeMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsRangeMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isRangeMenuOpen]);

  const chart = useMemo(() => {
    const maxVolume = Math.max(
      capacityLiter,
      ...trend.points.map((point) => point.volumeLiter),
      1,
    );
    const innerWidth = chartSize.width - padding.left - padding.right;
    const innerHeight = chartSize.height - padding.top - padding.bottom;
    const bottom = chartSize.height - padding.bottom;

    const coordinates = trend.points.map((point) => {
      const x = padding.left + clamp(point.xRatio, 0, 1) * innerWidth;
      const y =
        padding.top +
        (1 - clamp(point.volumeLiter / maxVolume, 0, 1)) * innerHeight;

      return {
        ...point,
        x,
        y,
      };
    });
    const coordinateByBucketStart = new Map(
      coordinates.map((point) => [point.bucketStart, point]),
    );
    const segments = trend.segments
      .map((segment) => ({
        id: segment.id,
        points: segment.points
          .map((point) => coordinateByBucketStart.get(point.bucketStart))
          .filter(isDefined),
      }))
      .filter((segment) => segment.points.length > 0);
    const linePaths = segments.map((segment) => ({
      id: segment.id,
      path: buildLinePath(segment.points),
    }));
    const areaPaths = segments
      .map((segment) => ({
        id: segment.id,
        path: buildAreaPath(segment.points, bottom),
      }))
      .filter((segment) => segment.path.length > 0);
    const gapBridges = trend.gaps
      .map((gap) => {
        const start = coordinateByBucketStart.get(gap.fromBucketStart);
        const end = coordinateByBucketStart.get(gap.toBucketStart);

        if (!start || !end) {
          return undefined;
        }

        return {
          ...gap,
          path: buildLinePath([start, end]),
        };
      })
      .filter(isDefined);
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
      const value = maxVolume * ratio;
      const y = padding.top + (1 - ratio) * innerHeight;

      return {
        value,
        y,
      };
    });

    return {
      coordinates,
      linePaths,
      areaPaths,
      gapBridges,
      yTicks,
      bottom,
      innerWidth,
    };
  }, [
    capacityLiter,
    chartSize.height,
    chartSize.width,
    padding,
    trend.gaps,
    trend.points,
    trend.segments,
  ]);

  const activePoint =
    activeIndex === null ? null : chart.coordinates[activeIndex] ?? null;

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;

    if (!svg || chart.coordinates.length === 0) {
      return;
    }

    const rect = svg.getBoundingClientRect();
    const pointerX =
      ((event.clientX - rect.left) / rect.width) * chartSize.width;
    const nearestIndex = chart.coordinates.reduce(
      (nearest, point, index) => {
        const nearestDistance = Math.abs(
          chart.coordinates[nearest].x - pointerX,
        );
        const pointDistance = Math.abs(point.x - pointerX);

        return pointDistance < nearestDistance ? index : nearest;
      },
      0,
    );

    setActiveIndex(nearestIndex);
  }

  function handleSelectRange(rangeKey: SimpleTankChartRangeKey) {
    setSelectedRange(rangeKey);
    setActiveIndex(null);
    setIsRangeMenuOpen(false);
  }

  if (trend.points.length === 0) {
    return (
      <div className="mt-5 grid min-h-72 place-items-center rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center">
        <div>
          <p className="text-base font-semibold text-zinc-950">
            No volume history yet
          </p>
          <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">
            The chart appears once a device sends volume readings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 min-w-0 max-w-full">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Trend range filter */}
        <div className="relative w-full sm:w-56" ref={rangeMenuRef}>
          <button
            aria-expanded={isRangeMenuOpen}
            aria-haspopup="listbox"
            aria-label="Select chart range"
            className="flex h-12 w-full items-center justify-between gap-3 rounded-lg border border-zinc-300 bg-white px-4 text-left text-sm font-semibold text-zinc-950 shadow-sm transition hover:border-blue-200 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15"
            onClick={() => setIsRangeMenuOpen((current) => !current)}
            type="button"
          >
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                Time range
              </span>
              <span className="mt-0.5 block truncate">
                {selectedRangeOption.label}
              </span>
            </span>
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-600 transition ${
                isRangeMenuOpen ? "rotate-180 bg-blue-100 text-blue-700" : ""
              }`}
              aria-hidden="true"
            >
              ▾
            </span>
          </button>

          {isRangeMenuOpen ? (
            <div
              className="absolute left-0 top-full z-20 mt-2 w-full overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-2xl shadow-zinc-950/10"
              role="listbox"
              style={{
                animation:
                  "login-shell-enter 160ms cubic-bezier(0.22, 1, 0.36, 1) both",
              }}
            >
              {SIMPLE_TANK_CHART_RANGES.map((option) => (
                <button
                  aria-selected={selectedRange === option.key}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15 ${
                    selectedRange === option.key
                      ? "bg-blue-600 text-white"
                      : "text-zinc-700 hover:bg-blue-50 hover:text-blue-700"
                  }`}
                  key={option.key}
                  onClick={() => handleSelectRange(option.key)}
                  role="option"
                  type="button"
                >
                  {option.label}
                  {selectedRange === option.key ? (
                    <span className="text-xs text-white/80">Active</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 ring-1 ring-blue-100">
            {trend.points.length} data points
          </span>
          {trend.gaps.length > 0 ? (
            <span className="w-fit rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-700 ring-1 ring-amber-100">
              {trend.gaps.length} data gaps
            </span>
          ) : null}
          {exportHref ? (
            <a
              aria-label={`Download CSV for the ${selectedRangeOption.label} range`}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15"
              href={exportHref}
            >
              <Download className="size-4" aria-hidden="true" />
              Download CSV
            </a>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        <span>{trend.range.bucketLabel}</span>
        <span>
          {trend.totalSlots} time slots, gaps longer than{" "}
          {trend.gapThresholdMinutes} minutes are marked with dashed lines
        </span>
      </div>

      <div className="mt-4 relative min-w-0 max-w-full overflow-hidden rounded-lg bg-zinc-50 p-3 ring-1 ring-zinc-100">
        <svg
          ref={svgRef}
          className="block aspect-[640/260] h-auto w-full min-w-0 max-w-full touch-pan-y sm:aspect-auto sm:h-72"
          role="img"
          aria-label="Diesel volume change line chart"
          viewBox={`0 0 ${chartSize.width} ${chartSize.height}`}
          onPointerLeave={() => setActiveIndex(null)}
          onPointerMove={handlePointerMove}
        >
          <defs>
            <linearGradient id="simple-volume-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          <rect
            fill="#fafafa"
            height={chartSize.height}
            rx="12"
            width={chartSize.width}
          />

          {chart.yTicks.map((tick) => (
            <g key={tick.y}>
              <line
                stroke="#e4e4e7"
                strokeDasharray="4 6"
                strokeWidth="1"
                x1={padding.left}
                x2={chartSize.width - padding.right}
                y1={tick.y}
                y2={tick.y}
              />
              <text
                fill="#71717a"
                fontSize="12"
                fontWeight="600"
                textAnchor="end"
                x={padding.left - 12}
                y={tick.y + 4}
              >
                {formatLiter(tick.value)} L
              </text>
            </g>
          ))}

          {chart.areaPaths.map((area) => (
            <path d={area.path} fill="url(#simple-volume-area)" key={area.id} />
          ))}

          {chart.gapBridges.map((gap) => (
            <path
              d={gap.path}
              fill="none"
              key={gap.id}
              stroke="#f59e0b"
              strokeDasharray="6 7"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.25"
            />
          ))}

          {chart.linePaths.map((line) => (
            <path
              d={line.path}
              fill="none"
              key={line.id}
              stroke="#2563eb"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.75"
            />
          ))}

          {chart.coordinates.map((point, index) => (
            <circle
              className="transition"
              cx={point.x}
              cy={point.y}
              fill={activeIndex === index ? "#ffffff" : "#2563eb"}
              key={`${point.receivedAt}-${index}`}
              r={activeIndex === index ? 5.5 : 2.4}
              stroke="#2563eb"
              strokeWidth={activeIndex === index ? "3" : "1.5"}
            />
          ))}

          {activePoint ? (
            <g>
              <line
                stroke="#2563eb"
                strokeDasharray="4 6"
                strokeOpacity="0.45"
                strokeWidth="1.5"
                x1={activePoint.x}
                x2={activePoint.x}
                y1={padding.top}
                y2={chart.bottom}
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                fill="#1d4ed8"
                r="7"
                stroke="#ffffff"
                strokeWidth="3"
              />
            </g>
          ) : null}

          {trend.xTicks.length > 0 ? (
            <>
              {trend.xTicks.map((tick, index) => {
                const x = padding.left + tick.xRatio * chart.innerWidth;
                const isFirst = index === 0;
                const isLast = index === trend.xTicks.length - 1;

                return (
                  <text
                    fill="#71717a"
                    fontSize="12"
                    fontWeight="600"
                    key={`${tick.label}-${index}`}
                    textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
                    x={x}
                    y={chartSize.height - 12}
                  >
                    {tick.label}
                  </text>
                );
              })}
            </>
          ) : null}
        </svg>

        {activePoint ? (
          <div
            className={`pointer-events-none absolute max-w-52 rounded-lg bg-white px-3 py-2 text-sm shadow-lg ring-1 ring-zinc-200 ${
              activePoint.x > chartSize.width * 0.7
                ? "-translate-x-full"
                : "translate-x-3"
            }`}
            style={{
              left: `${(activePoint.x / chartSize.width) * 100}%`,
              top: `${Math.max((activePoint.y / chartSize.height) * 100, 8)}%`,
            }}
          >
            <p className="font-semibold text-zinc-950">
              {formatLiter(activePoint.volumeLiter)} /{" "}
              {formatLiter(capacityLiter)} L
            </p>
            <p className="mt-1 text-xs font-medium text-zinc-500">
              {activePoint.fullTimeLabel}
            </p>
            {activePoint.sampleCount > 1 ? (
              <p className="mt-1 text-xs font-medium text-zinc-500">
                average of {activePoint.sampleCount} samples
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {trend.gaps.length > 0 ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Data gap detected</p>
          <div className="mt-2 grid gap-2">
            {trend.gaps.slice(0, 3).map((gap) => (
              <div
                className="flex flex-col gap-1 rounded-md bg-white/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                key={gap.id}
              >
                <span>
                  {gap.fromLabel} to {gap.toLabel}
                </span>
                <span className="font-semibold">{gap.durationLabel}</span>
              </div>
            ))}
          </div>
          {trend.gaps.length > 3 ? (
            <p className="mt-2 text-xs font-medium">
              {trend.gaps.length - 3} more gaps available in this range.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
