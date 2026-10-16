import type { Metadata } from "next";
import Link from "next/link";
import { HardDrive, ShieldAlert } from "lucide-react";

import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { createAdminActionCsrfToken } from "@/features/auth/lib/auth-csrf";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import {
  getDeviceKeyGraceHours,
  listMonitoringDevicesForAdminFromMysql,
} from "@/features/monitoring/lib/mysql-device-key-repository";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";
import { getDeviceStatus } from "@/features/monitoring/lib/status";

import { DeviceRowActions } from "./device-controls";

export const metadata: Metadata = {
  title: "Device Registry | FTM",
  description:
    "Registered devices, key versions, rotation grace windows, and telemetry freshness.",
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

const STATUS_CLASS: Record<string, string> = {
  delayed: "bg-amber-50 text-amber-800 ring-amber-200",
  offline: "bg-red-50 text-red-700 ring-red-200",
  online: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  unknown: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};

export default async function AdminDevicesPage() {
  const admin = await requirePageAdmin();
  const csrfToken = createAdminActionCsrfToken(admin.sessionId);
  const storageDriver = getMonitoringStorageDriver();
  const graceHours = getDeviceKeyGraceHours();

  const rows =
    storageDriver === "mysql"
      ? await listMonitoringDevicesForAdminFromMysql().catch(() => [])
      : [];

  const now = new Date();
  const expiringGraceWindows = rows.filter((row) => {
    if (!row.previousKeyValidUntil) {
      return false;
    }

    const validUntil = Date.parse(row.previousKeyValidUntil);

    return Number.isFinite(validUntil) && validUntil > now.getTime();
  });

  return (
    <main className="min-h-screen bg-[#f5faf8] text-zinc-950">
      <DashboardHeader
        navItems={[
          { href: "/dashboard", label: "Tank Management" },
          { href: "/dashboard/admin/users", label: "User Management" },
          { href: "/dashboard/admin/alerts", label: "Alert Centre" },
          { href: "/dashboard/admin/access-scopes", label: "Location Access" },
          { href: "/dashboard/admin/hardware-registry", label: "Hardware Registry" },
          { current: true, label: "Device Registry" },
        ]}
        user={admin}
      />

      <div className="mx-auto flex max-w-[1540px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-100">
              <HardDrive aria-hidden="true" className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold uppercase text-zinc-500">
                Device registry
              </p>
              <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">
                Devices, keys, and telemetry freshness
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
                Rotate a leaked device key, disable a device that must stop
                reporting, and confirm that every registered device is still
                delivering telemetry. Rotating keeps the previous key valid for{" "}
                {graceHours} hours so the device in the field can be re-flashed
                without losing data.
              </p>
            </div>
          </div>

          {expiringGraceWindows.length > 0 ? (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                {expiringGraceWindows.length} device(s) still accept a previous
                key. Re-flash them before the grace window closes, otherwise
                their telemetry will be rejected.
              </span>
            </p>
          ) : null}

          {storageDriver !== "mysql" ? (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              The device registry requires the MySQL storage driver. Memory
              storage is active, so devices cannot be managed here.
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Registered devices</h2>
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No devices are registered yet. Approve a device request first.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {rows.map((row) => {
                const deviceStatus = getDeviceStatus({
                  expectedReportIntervalSec:
                    row.device.expectedReportIntervalSec || 3_600,
                  lastReceivedAt: row.lastReadingAt,
                  now,
                });

                return (
                  <li
                    className="rounded-lg border border-zinc-200 bg-zinc-50 p-4"
                    key={row.device.id}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ring-1 ${STATUS_CLASS[deviceStatus] ?? STATUS_CLASS.unknown}`}
                      >
                        {deviceStatus}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200">
                        {row.device.isActive ? "enabled" : "disabled"}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200">
                        key v{row.device.keyVersion ?? 1}
                      </span>
                      {row.previousKeyValidUntil ? (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                          previous key valid until{" "}
                          {formatDate(row.previousKeyValidUntil)}
                        </span>
                      ) : null}
                    </div>

                    <h3 className="mt-2 text-base font-semibold">
                      {row.device.code} · {row.device.label}
                    </h3>
                    <p className="mt-1 text-sm text-zinc-600">
                      {row.siteCode ? `${row.siteCode} · ` : ""}
                      {row.siteName ?? "unknown location"} ·{" "}
                      {row.tankLabel ?? "unassigned tank"}
                    </p>
                    <dl className="mt-2 grid gap-2 text-xs text-zinc-500 sm:grid-cols-4">
                      <div>
                        <dt className="font-semibold uppercase">Last reading</dt>
                        <dd>{formatDate(row.lastReadingAt)}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold uppercase">Last seen</dt>
                        <dd>{formatDate(row.device.lastSeenAt ?? null)}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold uppercase">Level</dt>
                        <dd>
                          {row.fillPercent === null
                            ? "-"
                            : `${row.fillPercent.toFixed(1)}%`}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold uppercase">
                          Report interval
                        </dt>
                        <dd>
                          {Math.round(
                            (row.device.expectedReportIntervalSec || 3600) / 60,
                          )}{" "}
                          min
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-2 text-xs text-zinc-500">
                      Key last rotated {formatDate(row.device.keyRotatedAt ?? null)} ·{" "}
                      <Link
                        className="font-semibold text-blue-700 hover:underline"
                        href={`/dashboard/tanks/${row.device.tankId}`}
                      >
                        open tank detail
                      </Link>
                    </p>

                    <div className="mt-3">
                      <DeviceRowActions
                        csrfToken={csrfToken}
                        deviceId={row.device.id}
                        isActive={row.device.isActive}
                        rotationGraceHours={graceHours}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
