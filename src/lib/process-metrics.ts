import { monitorEventLoopDelay } from "node:perf_hooks";

import { getBuildInfo } from "./build-info";
import type { MetricFamilySnapshot } from "./metrics";

/**
 * Process-level metrics for the Prometheus endpoint.
 *
 * The point is to answer "is this instance healthy?" without shell access:
 * memory, CPU consumption, and event-loop lag (the earliest signal that the
 * single Node.js thread is saturated). Disk space is a property of the hosting
 * platform, not of the application process, so it is monitored there — see
 * `docs/operational-runbook.md`.
 */

let latestEventLoopLagSeconds = 0;
let eventLoopMonitor: ReturnType<typeof monitorEventLoopDelay> | null = null;

/**
 * Starts sampling event-loop delay once per process. Safe to call repeatedly;
 * only the first call installs the monitor. The reported value is the mean
 * delay of the last completed sampling interval, in seconds; a sustained value
 * above one second means the instance is saturated.
 */
export function startEventLoopLagMonitor(): void {
  if (eventLoopMonitor) {
    return;
  }

  const monitor = monitorEventLoopDelay({ resolution: 20 });

  monitor.enable();

  const refresh = () => {
    const meanNanoseconds = monitor.mean;

    // Before the first sampling interval completes, `mean` is NaN. Reporting
    // NaN would break every Prometheus scrape, so an unmeasured lag is 0.
    latestEventLoopLagSeconds = Number.isFinite(meanNanoseconds)
      ? meanNanoseconds / 1_000_000_000
      : 0;
    monitor.reset();
  };

  const interval = setInterval(refresh, 5_000);

  interval.unref?.();
  eventLoopMonitor = monitor;
  refresh();
}

export function getEventLoopLagSeconds(): number {
  return Number.isFinite(latestEventLoopLagSeconds) ? latestEventLoopLagSeconds : 0;
}

/** Test seam: inject a lag value without waiting for a real stall. */
export function setEventLoopLagSecondsForTesting(value: number): void {
  latestEventLoopLagSeconds = value;
}

export function buildProcessMetricFamilies({
  memoryUsage = process.memoryUsage(),
  cpuUsage = process.cpuUsage(),
  uptimeSeconds = process.uptime(),
}: {
  cpuUsage?: NodeJS.CpuUsage;
  memoryUsage?: NodeJS.MemoryUsage;
  uptimeSeconds?: number;
} = {}): MetricFamilySnapshot[] {
  const cpuSecondsTotal = (cpuUsage.user + cpuUsage.system) / 1_000_000;

  return [
    {
      name: "solar_tank_process_uptime_seconds",
      help: "Process uptime in seconds.",
      type: "gauge",
      samples: [
        {
          name: "solar_tank_process_uptime_seconds",
          labels: {},
          value: Math.round(uptimeSeconds),
        },
      ],
    },
    {
      name: "solar_tank_process_resident_memory_bytes",
      help: "Resident memory size in bytes.",
      type: "gauge",
      samples: [
        {
          name: "solar_tank_process_resident_memory_bytes",
          labels: {},
          value: memoryUsage.rss,
        },
      ],
    },
    {
      name: "solar_tank_process_heap_used_bytes",
      help: "V8 heap used in bytes.",
      type: "gauge",
      samples: [
        {
          name: "solar_tank_process_heap_used_bytes",
          labels: {},
          value: memoryUsage.heapUsed,
        },
      ],
    },
    {
      name: "solar_tank_process_heap_total_bytes",
      help: "V8 heap total in bytes.",
      type: "gauge",
      samples: [
        {
          name: "solar_tank_process_heap_total_bytes",
          labels: {},
          value: memoryUsage.heapTotal,
        },
      ],
    },
    {
      name: "solar_tank_process_external_memory_bytes",
      help: "Memory used by C++ objects bound to JavaScript objects.",
      type: "gauge",
      samples: [
        {
          name: "solar_tank_process_external_memory_bytes",
          labels: {},
          value: memoryUsage.external,
        },
      ],
    },
    {
      name: "solar_tank_process_cpu_seconds_total",
      help: "Total CPU time consumed by the process in seconds.",
      type: "counter",
      samples: [
        {
          name: "solar_tank_process_cpu_seconds_total",
          labels: {},
          value: Number(cpuSecondsTotal.toFixed(3)),
        },
      ],
    },
    {
      name: "solar_tank_process_event_loop_lag_seconds",
      help: "Most recent event loop lag sample in seconds. Sustained lag above one second means the instance is saturated.",
      type: "gauge",
      samples: [
        {
          name: "solar_tank_process_event_loop_lag_seconds",
          labels: {},
          value: Number(getEventLoopLagSeconds().toFixed(4)),
        },
      ],
    },
    {
      name: "solar_tank_build_info",
      help: "Application build identity.",
      type: "gauge",
      samples: [
        {
          name: "solar_tank_build_info",
          labels: {
            commit: getBuildInfo().commitSha?.slice(0, 12) ?? "unknown",
            environment: getBuildInfo().environment,
            version: getBuildInfo().version,
          },
          value: 1,
        },
      ],
    },
  ];
}
