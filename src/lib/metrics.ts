export type MetricLabels = Record<string, string | number | boolean | null | undefined>;

export type MetricSample = {
  name: string;
  labels: Record<string, string>;
  value: number;
};

export type MetricFamilySnapshot = {
  name: string;
  help: string;
  type: "counter" | "gauge" | "histogram";
  samples: MetricSample[];
};

export type MetricsCollector = () => MetricFamilySnapshot[];

const DEFAULT_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

const MAX_SERIES_PER_FAMILY = 300;

type SeriesState = {
  labels: Record<string, string>;
  value: number;
};

type HistogramSeriesState = {
  labels: Record<string, string>;
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
};

type FamilyState = {
  name: string;
  help: string;
  type: "counter" | "gauge" | "histogram";
  series: Map<string, SeriesState | HistogramSeriesState>;
  droppedSeries: number;
};

function normalizeLabelValue(value: MetricLabels[string]): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();

  if (text === "") {
    return null;
  }

  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function normalizeLabels(labels: MetricLabels): Record<string, string> {
  const entries = Object.entries(labels)
    .map(([key, value]) => [key, normalizeLabelValue(value)] as const)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .sort((first, second) => first[0].localeCompare(second[0]));

  return Object.fromEntries(entries);
}

function seriesKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([key, value]) => `${key}=${value}`)
    .join("\u0001");
}

export function toPrometheusText(snapshot: MetricFamilySnapshot[]): string {
  const lines: string[] = [];

  for (const family of snapshot) {
    lines.push(`# HELP ${family.name} ${family.help}`);
    lines.push(`# TYPE ${family.name} ${family.type}`);

    for (const sample of family.samples) {
      const labelEntries = Object.entries(sample.labels);

      if (labelEntries.length === 0) {
        lines.push(`${sample.name} ${sample.value}`);
        continue;
      }

      const labelText = labelEntries
        .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
        .join(",");
      lines.push(`${sample.name}{${labelText}} ${sample.value}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function escapeLabelValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

export function createMetricsRegistry() {
  const families = new Map<string, FamilyState>();
  const collectors = new Set<MetricsCollector>();

  function getFamily(
    name: string,
    help: string,
    type: FamilyState["type"],
  ): FamilyState {
    const existing = families.get(name);

    if (existing) {
      return existing;
    }

    const created: FamilyState = {
      name,
      help,
      type,
      series: new Map(),
      droppedSeries: 0,
    };

    families.set(name, created);

    return created;
  }

  function incrementCounter({
    name,
    help,
    labels = {},
    value = 1,
  }: {
    name: string;
    help: string;
    labels?: MetricLabels;
    value?: number;
  }): void {
    if (!Number.isFinite(value) || value < 0) {
      return;
    }

    const family = getFamily(name, help, "counter");
    const normalizedLabels = normalizeLabels(labels);
    const key = seriesKey(normalizedLabels);
    const existing = family.series.get(key) as SeriesState | undefined;

    if (!existing && family.series.size >= MAX_SERIES_PER_FAMILY) {
      family.droppedSeries += 1;
      return;
    }

    if (existing) {
      existing.value += value;
      return;
    }

    family.series.set(key, { labels: normalizedLabels, value });
  }

  function setGauge({
    name,
    help,
    labels = {},
    value,
  }: {
    name: string;
    help: string;
    labels?: MetricLabels;
    value: number;
  }): void {
    if (!Number.isFinite(value)) {
      return;
    }

    const family = getFamily(name, help, "gauge");
    const normalizedLabels = normalizeLabels(labels);
    const key = seriesKey(normalizedLabels);
    const existing = family.series.get(key) as SeriesState | undefined;

    if (!existing && family.series.size >= MAX_SERIES_PER_FAMILY) {
      family.droppedSeries += 1;
      return;
    }

    if (existing) {
      existing.value = value;
      return;
    }

    family.series.set(key, { labels: normalizedLabels, value });
  }

  function observeHistogram({
    name,
    help,
    labels = {},
    value,
    buckets = DEFAULT_BUCKETS_SECONDS,
  }: {
    name: string;
    help: string;
    labels?: MetricLabels;
    value: number;
    buckets?: number[];
  }): void {
    if (!Number.isFinite(value) || value < 0) {
      return;
    }

    const family = getFamily(name, help, "histogram");
    const normalizedLabels = normalizeLabels(labels);
    const key = seriesKey(normalizedLabels);
    const existing = family.series.get(key) as
      | HistogramSeriesState
      | undefined;

    if (!existing && family.series.size >= MAX_SERIES_PER_FAMILY) {
      family.droppedSeries += 1;
      return;
    }

    const state: HistogramSeriesState =
      existing ??
      {
        labels: normalizedLabels,
        buckets,
        counts: buckets.map(() => 0),
        sum: 0,
        count: 0,
      };

    const bucketIndex = state.buckets.findIndex((bound) => value <= bound);

    if (bucketIndex >= 0) {
      state.counts[bucketIndex] += 1;
    }

    state.sum += value;
    state.count += 1;

    if (!existing) {
      family.series.set(key, state);
    }
  }

  function registerCollector(collector: MetricsCollector): () => void {
    collectors.add(collector);

    return () => {
      collectors.delete(collector);
    };
  }

  function snapshot(): MetricFamilySnapshot[] {
    const output: MetricFamilySnapshot[] = [];
    const droppedSamples: MetricSample[] = [];

    for (const family of families.values()) {
      const samples: MetricSample[] = [];

      if (family.droppedSeries > 0) {
        droppedSamples.push({
          name: "solar_tank_metrics_series_dropped_total",
          labels: { family: family.name },
          value: family.droppedSeries,
        });
      }

      for (const state of family.series.values()) {
        if (family.type === "histogram") {
          const histogram = state as HistogramSeriesState;
          let cumulative = 0;

          for (let index = 0; index < histogram.buckets.length; index += 1) {
            cumulative += histogram.counts[index];

            samples.push({
              name: `${family.name}_bucket`,
              labels: {
                ...histogram.labels,
                le: String(histogram.buckets[index]),
              },
              value: cumulative,
            });
          }

          samples.push({
            name: `${family.name}_bucket`,
            labels: { ...histogram.labels, le: "+Inf" },
            value: histogram.count,
          });
          samples.push({
            name: `${family.name}_sum`,
            labels: histogram.labels,
            value: histogram.sum,
          });
          samples.push({
            name: `${family.name}_count`,
            labels: histogram.labels,
            value: histogram.count,
          });
          continue;
        }

        samples.push({
          name: family.name,
          labels: state.labels,
          value: (state as SeriesState).value,
        });
      }

      output.push({
        name: family.name,
        help: family.help,
        type: family.type,
        samples,
      });
    }

    for (const collector of collectors) {
      try {
        output.push(...collector());
      } catch {
        // Collectors must never break a scrape.
      }
    }

    if (droppedSamples.length > 0) {
      output.push({
        name: "solar_tank_metrics_series_dropped_total",
        help: "Metric series rejected by the cardinality guard.",
        type: "counter",
        samples: droppedSamples,
      });
    }

    return output;
  }

  function reset(): void {
    families.clear();
  }

  return {
    incrementCounter,
    setGauge,
    observeHistogram,
    registerCollector,
    snapshot,
    reset,
  };
}

export type MetricsRegistry = ReturnType<typeof createMetricsRegistry>;

declare global {
  var __solarTankMetrics: MetricsRegistry | undefined;
}

function getGlobalRegistry(): MetricsRegistry {
  globalThis.__solarTankMetrics ??= createMetricsRegistry();

  return globalThis.__solarTankMetrics;
}

export const metrics = getGlobalRegistry();

export const metricNames = {
  httpRequests: "solar_tank_http_requests_total",
  httpRequestDuration: "solar_tank_http_request_duration_seconds",
  ingestOutcome: "solar_tank_ingest_requests_total",
  ingestRejections: "solar_tank_ingest_rejections_total",
  authAttempts: "solar_tank_auth_attempts_total",
  alerts: "solar_tank_alerts_total",
  jobRuns: "solar_tank_ops_job_runs_total",
  jobDuration: "solar_tank_ops_job_duration_seconds",
  errors: "solar_tank_errors_total",
  rateLimited: "solar_tank_rate_limited_total",
  processUptime: "solar_tank_process_uptime_seconds",
  processResidentMemory: "solar_tank_process_resident_memory_bytes",
  processHeapUsed: "solar_tank_process_heap_used_bytes",
} as const;
