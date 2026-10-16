import type { Metadata } from "next";
import { Activity, BellRing } from "lucide-react";

import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { createAdminActionCsrfToken } from "@/features/auth/lib/auth-csrf";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import {
  listMonitoringAlertsFromMysql,
  listRecentOpsJobRunsFromMysql,
} from "@/features/ops/lib/mysql-alert-repository";
import { getOpsConfig } from "@/features/ops/lib/ops-config";
import type { MonitoringAlert } from "@/features/ops/types";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";

import { AlertRowControls, RunEvaluationButton } from "./alert-controls";

export const metadata: Metadata = {
  title: "Alert Centre | FTM",
  description:
    "Operational alerts for device connectivity, fuel level, and platform health.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Jakarta",
    year: "numeric",
  }).format(new Date(value));
}

function severityClass(severity: string) {
  switch (severity) {
    case "critical":
      return "bg-red-50 text-red-700 ring-red-200";
    case "warning":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    default:
      return "bg-blue-50 text-blue-700 ring-blue-200";
  }
}

function statusClass(status: string) {
  switch (status) {
    case "open":
      return "bg-red-50 text-red-700 ring-red-200";
    case "acknowledged":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    default:
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }
}

function groupByStatus(alerts: MonitoringAlert[]) {
  return {
    acknowledged: alerts.filter((alert) => alert.status === "acknowledged"),
    open: alerts.filter((alert) => alert.status === "open"),
    resolved: alerts.filter((alert) => alert.status === "resolved"),
  };
}

export default async function AdminAlertsPage() {
  const admin = await requirePageAdmin();
  const csrfToken = createAdminActionCsrfToken(admin.sessionId);
  const storageDriver = getMonitoringStorageDriver();
  const config = getOpsConfig();

  const [alerts, jobRuns] =
    storageDriver === "mysql"
      ? await Promise.all([
          listMonitoringAlertsFromMysql({ limit: 200 }).catch(() => []),
          listRecentOpsJobRunsFromMysql({ limit: 10 }).catch(() => []),
        ])
      : [[], []];

  const grouped = groupByStatus(alerts);
  const activeAlerts = [...grouped.open, ...grouped.acknowledged];
  const criticalCount = activeAlerts.filter(
    (alert) => alert.severity === "critical",
  ).length;

  return (
    <main className="min-h-screen bg-[#f5faf8] text-zinc-950">
      <DashboardHeader
        navItems={[
          { href: "/dashboard", label: "Tank Management" },
          { href: "/dashboard/admin/users", label: "User Management" },
          { href: "/dashboard/admin/audit", label: "Security Audit" },
          { href: "/dashboard/admin/devices", label: "Device Registry" },
          { current: true, label: "Alert Centre" },
        ]}
        user={admin}
      />

      <div className="mx-auto flex max-w-[1540px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-red-50 text-red-700 ring-1 ring-red-100">
                <BellRing aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="text-sm font-semibold uppercase text-zinc-500">
                  Alert centre
                </p>
                <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">
                  Operational alerts
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                  Devices that stopped reporting, fuel levels below the
                  configured threshold, ingestion rejections, and platform
                  health problems. Alerts are evaluated every ten minutes and
                  notified through Telegram and e-mail.
                </p>
              </div>
            </div>
            {storageDriver === "mysql" ? (
              <RunEvaluationButton csrfToken={csrfToken} />
            ) : null}
          </div>

          <dl className="mt-5 grid gap-3 sm:grid-cols-4">
            {[
              { label: "Active alerts", value: activeAlerts.length },
              { label: "Critical", value: criticalCount },
              { label: "Acknowledged", value: grouped.acknowledged.length },
              { label: "Resolved (recent)", value: grouped.resolved.length },
            ].map((item) => (
              <div
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3"
                key={item.label}
              >
                <dt className="text-xs font-semibold uppercase text-zinc-500">
                  {item.label}
                </dt>
                <dd className="mt-1 text-2xl font-semibold">{item.value}</dd>
              </div>
            ))}
          </dl>

          {!config.enabled ? (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Alert evaluation is disabled (OPS_ALERTS_ENABLED=false). Rules are
              not being evaluated and no notifications are sent.
            </p>
          ) : null}

          {storageDriver !== "mysql" ? (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              The alert store requires the MySQL storage driver. Memory storage
              is active, so alerts cannot be listed or acknowledged.
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Active alerts</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Keep a condition acknowledged while you work on it; resolve it with a
            note once the cause is fixed. Auto-resolution happens only after the
            condition stops being detected in consecutive evaluations.
          </p>

          {activeAlerts.length === 0 ? (
            <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              No active alerts. Every monitored rule is inside its threshold.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {activeAlerts.map((alert) => (
                <li
                  className="rounded-lg border border-zinc-200 bg-zinc-50 p-4"
                  key={alert.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ring-1 ${severityClass(alert.severity)}`}
                    >
                      {alert.severity}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ring-1 ${statusClass(alert.status)}`}
                    >
                      {alert.status}
                    </span>
                    <span className="text-xs font-medium uppercase text-zinc-500">
                      {alert.ruleKey}
                    </span>
                  </div>
                  <h3 className="mt-2 text-base font-semibold">{alert.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">
                    {alert.detail}
                  </p>
                  <p className="mt-2 text-xs text-zinc-500">
                    First detected {formatDate(alert.firstDetectedAt)} · last
                    detected {formatDate(alert.lastDetectedAt)} · notifications{" "}
                    {alert.notificationCount}
                    {alert.acknowledgedAt
                      ? ` · acknowledged ${formatDate(alert.acknowledgedAt)}`
                      : ""}
                  </p>
                  <div className="mt-3">
                    <AlertRowControls alert={alert} csrfToken={csrfToken} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Activity aria-hidden="true" className="size-5 text-blue-700" />
            <h2 className="text-lg font-semibold">Recent scheduler runs</h2>
          </div>
          {jobRuns.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No scheduler run has been recorded yet. Trigger one manually or
              wait for the scheduled invocation.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] border-separate border-spacing-y-2 text-left text-sm">
                <thead className="text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Started</th>
                    <th className="px-3 py-2">Job</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {jobRuns.map((run, index) => (
                    <tr className="bg-zinc-50" key={`${run.jobKey}-${run.startedAt}-${index}`}>
                      <td className="rounded-l-lg px-3 py-3 text-zinc-600">
                        {formatDate(run.startedAt)}
                      </td>
                      <td className="px-3 py-3 font-semibold">{run.jobKey}</td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ring-1 ${
                            run.status === "succeeded"
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                              : "bg-red-50 text-red-700 ring-red-200"
                          }`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-zinc-600">
                        {run.durationMs === null ? "-" : `${run.durationMs} ms`}
                      </td>
                      <td className="rounded-r-lg px-3 py-3 text-zinc-600">
                        <span className="block max-w-xl break-all">
                          {run.errorMessage ??
                            (run.detail ? JSON.stringify(run.detail) : "-")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
