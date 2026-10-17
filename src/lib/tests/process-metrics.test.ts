import { describe, expect, it } from "vitest";

import {
  buildProcessMetricFamilies,
  getEventLoopLagSeconds,
  setEventLoopLagSecondsForTesting,
  startEventLoopLagMonitor,
} from "@/lib/process-metrics";

function family(name: string) {
  const found = buildProcessMetricFamilies().find((entry) => entry.name === name);

  expect(found, `${name} should be exported`).toBeDefined();

  return found;
}

describe("buildProcessMetricFamilies", () => {
  it("exports uptime, memory, CPU, lag, and build identity", () => {
    expect(family("solar_tank_process_uptime_seconds")?.type).toBe("gauge");
    expect(family("solar_tank_process_resident_memory_bytes")?.type).toBe("gauge");
    expect(family("solar_tank_process_heap_used_bytes")?.type).toBe("gauge");
    expect(family("solar_tank_process_heap_total_bytes")?.type).toBe("gauge");
    expect(family("solar_tank_process_external_memory_bytes")?.type).toBe("gauge");
    expect(family("solar_tank_process_cpu_seconds_total")?.type).toBe("counter");
    expect(family("solar_tank_process_event_loop_lag_seconds")?.type).toBe("gauge");
    expect(family("solar_tank_build_info")?.type).toBe("gauge");
  });

  it("reports injected resource values", () => {
    const uptime = family("solar_tank_process_uptime_seconds");
    const rss = family("solar_tank_process_resident_memory_bytes");
    const heap = family("solar_tank_process_heap_used_bytes");
    const lag = family("solar_tank_process_event_loop_lag_seconds");
    const cpu = family("solar_tank_process_cpu_seconds_total");

    expect(uptime?.samples[0]?.value).toBeGreaterThanOrEqual(0);
    expect(rss?.samples[0]?.value).toBeGreaterThan(0);
    expect(heap?.samples[0]?.value).toBeGreaterThan(0);
    expect(cpu?.samples[0]?.value).toBeGreaterThanOrEqual(0);
    expect(lag?.samples[0]?.value).toBeGreaterThanOrEqual(0);
  });

  it("labels build info with version, commit, and environment", () => {
    const labels = family("solar_tank_build_info")?.samples[0]?.labels ?? {};

    expect(Object.keys(labels).sort()).toEqual([
      "commit",
      "environment",
      "version",
    ]);
    expect(String(labels.commit)).not.toHaveLength(0);
  });

  it("rounds CPU seconds so the metric stays stable", () => {
    const cpu = family("solar_tank_process_cpu_seconds_total");
    const value = Number(cpu?.samples[0]?.value);

    expect(value).toBe(Number(value.toFixed(3)));
  });
});

describe("event loop lag", () => {
  it("reports the sampled lag and can be seeded for tests", () => {
    setEventLoopLagSecondsForTesting(0.5123);

    expect(getEventLoopLagSeconds()).toBeCloseTo(0.5123, 4);

    const lag = family("solar_tank_process_event_loop_lag_seconds");

    expect(lag?.samples[0]?.value).toBeCloseTo(0.5123, 3);

    setEventLoopLagSecondsForTesting(0);
  });

  it("never emits NaN, even before the first sample completes", () => {
    setEventLoopLagSecondsForTesting(Number.NaN);
    startEventLoopLagMonitor();

    const lag = family("solar_tank_process_event_loop_lag_seconds");
    const value = Number(lag?.samples[0]?.value);

    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBe(0);
    expect(getEventLoopLagSeconds()).toBe(0);

    setEventLoopLagSecondsForTesting(0);
  });

  it("installs the monitor once and stays idempotent", () => {
    expect(() => {
      startEventLoopLagMonitor();
      startEventLoopLagMonitor();
    }).not.toThrow();
  });
});
