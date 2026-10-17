import { describe, expect, it } from "vitest";

import {
  createMetricsRegistry,
  toPrometheusText,
  type MetricFamilySnapshot,
} from "../metrics";

describe("metrics registry", () => {
  it("aggregates counters by label set", () => {
    const registry = createMetricsRegistry();

    registry.incrementCounter({
      name: "solar_tank_ingest_requests_total",
      help: "Ingest outcomes.",
      labels: { outcome: "accepted" },
    });
    registry.incrementCounter({
      name: "solar_tank_ingest_requests_total",
      help: "Ingest outcomes.",
      labels: { outcome: "accepted" },
      value: 2,
    });
    registry.incrementCounter({
      name: "solar_tank_ingest_requests_total",
      help: "Ingest outcomes.",
      labels: { outcome: "rejected" },
    });

    const [family] = registry.snapshot();

    expect(family.type).toBe("counter");
    expect(family.samples).toHaveLength(2);
    expect(
      family.samples.find((sample) => sample.labels.outcome === "accepted")
        ?.value,
    ).toBe(3);
  });

  it("produces cumulative histogram buckets", () => {
    const registry = createMetricsRegistry();

    for (const value of [0.004, 0.02, 0.3, 9]) {
      registry.observeHistogram({
        name: "solar_tank_http_request_duration_seconds",
        help: "Latency.",
        labels: { route: "api.ingest" },
        value,
      });
    }

    const text = toPrometheusText(registry.snapshot());
    const bucket = (le: string) =>
      Number(
        new RegExp(
          `_bucket\\{[^}]*le="${le.replace("+", "\\+")}"[^}]*\\} (\\d+)`,
        ).exec(text)?.[1] ?? "0",
      );

    expect(bucket("0.005")).toBe(1);
    expect(bucket("0.025")).toBe(2);
    expect(bucket("0.5")).toBe(3);
    expect(bucket("+Inf")).toBe(4);
    expect(text).toContain("solar_tank_http_request_duration_seconds_count");
    expect(text).toContain("solar_tank_http_request_duration_seconds_sum");
  });

  it("skips labels with empty values and sorts them deterministically", () => {
    const registry = createMetricsRegistry();

    registry.incrementCounter({
      name: "solar_tank_test_total",
      help: "Test metric.",
      labels: { alpha: "1", missing: null, zeta: "2" },
    });

    const [family] = registry.snapshot();

    expect(Object.keys(family.samples[0].labels)).toEqual(["alpha", "zeta"]);
  });

  it("drops new series beyond the cardinality limit", () => {
    const registry = createMetricsRegistry();

    for (let index = 0; index < 400; index += 1) {
      registry.incrementCounter({
        name: "solar_tank_cardinality_total",
        help: "Cardinality guard.",
        labels: { id: `id-${index}` },
      });
    }

    const snapshot = registry.snapshot();
    const family = snapshot.find(
      (item) => item.name === "solar_tank_cardinality_total",
    );

    expect(family?.samples.length).toBe(300);
    expect(
      snapshot.some(
        (item) =>
          item.name === "solar_tank_metrics_series_dropped_total" &&
          item.samples[0].value === 100,
      ),
    ).toBe(true);
  });

  it("escapes label values", () => {
    expect(
      toPrometheusText([
        {
          name: "solar_tank_example",
          help: "Example.",
          type: "gauge",
          samples: [
            {
              name: "solar_tank_example",
              labels: { path: 'a"b\\c\nd' },
              value: 1,
            },
          ],
        },
      ]),
    ).toContain('path="a\\"b\\\\c\\nd"');
  });

  it("keeps collectors isolated from scrape failures", () => {
    const registry = createMetricsRegistry();

    registry.registerCollector(() => {
      throw new Error("collector boom");
    });
    registry.registerCollector((): MetricFamilySnapshot[] => [
      {
        name: "solar_tank_runtime",
        help: "Runtime gauge.",
        type: "gauge",
        samples: [
          { name: "solar_tank_runtime", labels: {}, value: 42 },
        ],
      },
    ]);

    const snapshot = registry.snapshot();

    expect(snapshot.map((family) => family.name)).toContain("solar_tank_runtime");
  });
});
