import type { Metadata } from "next";
import { CircuitBoard, Cpu, ShieldAlert } from "lucide-react";

import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { createAdminActionCsrfToken } from "@/features/auth/lib/auth-csrf";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import {
  listAllFirmwareTemplatesFromMysql,
  listAllHardwareProfilesFromMysql,
  listFirmwareTemplateUsageFromMysql,
  listHardwareProfileUsageFromMysql,
} from "@/features/monitoring/lib/mysql-hardware-registry-repository";
import { getMonitoringStorageDriver } from "@/features/monitoring/lib/monitoring-storage";

import {
  CreateFirmwareTemplateForm,
  CreateHardwareProfileForm,
  FirmwareTemplateRowControls,
  HardwareProfileRowControls,
} from "./hardware-controls";

export const metadata: Metadata = {
  title: "Hardware Registry | FTM",
  description:
    "Firmware templates and hardware profiles used to generate device packages.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminHardwareRegistryPage() {
  const admin = await requirePageAdmin();
  const csrfToken = createAdminActionCsrfToken(admin.sessionId);
  const storageDriver = getMonitoringStorageDriver();
  const isMysql = storageDriver === "mysql";

  const [templates, profiles, templateUsage, profileUsage] = isMysql
    ? await Promise.all([
        listAllFirmwareTemplatesFromMysql().catch(() => []),
        listAllHardwareProfilesFromMysql().catch(() => []),
        listFirmwareTemplateUsageFromMysql().catch(() => []),
        listHardwareProfileUsageFromMysql().catch(() => []),
      ])
    : [[], [], [], []];
  const templateUsageById = new Map(
    templateUsage.map((entry) => [entry.firmwareTemplateId, entry.hardwareProfileCount]),
  );
  const profileUsageById = new Map(
    profileUsage.map((entry) => [entry.hardwareProfileId, entry.deviceRequestCount]),
  );

  return (
    <main className="min-h-screen bg-[#f5faf8] text-zinc-950">
      <DashboardHeader
        navItems={[
          { href: "/dashboard", label: "Tank Management" },
          { href: "/dashboard/admin/users", label: "User Management" },
          { href: "/dashboard/admin/alerts", label: "Alert Centre" },
          { href: "/dashboard/admin/devices", label: "Device Registry" },
          { href: "/dashboard/admin/access-scopes", label: "Location Access" },
          { current: true, label: "Hardware Registry" },
        ]}
        user={admin}
      />

      <div className="mx-auto flex max-w-[1540px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-100">
              <CircuitBoard aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase text-zinc-500">
                Hardware registry
              </p>
              <h1 className="mt-1 text-xl font-semibold text-zinc-950">
                Firmware templates and hardware profiles
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                Device requests compile the firmware template attached to the
                selected hardware profile. Activate exactly one template per
                board family and keep older versions inactive so existing
                packages stay reproducible.
              </p>
            </div>
          </div>
        </section>

        {!isMysql ? (
          <section className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <p>
              The hardware registry lives in MySQL. The active storage driver is{" "}
              <strong>{storageDriver}</strong>, so it is read-only here. Set{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">
                SOLAR_TANK_STORAGE_DRIVER=mysql
              </code>{" "}
              to manage it.
            </p>
          </section>
        ) : null}

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Cpu aria-hidden="true" className="size-4 text-zinc-500" />
            <h2 className="text-sm font-semibold uppercase text-zinc-500">
              Firmware templates ({templates.length})
            </h2>
          </div>
          {isMysql ? <CreateFirmwareTemplateForm csrfToken={csrfToken} /> : null}
          <div className="mt-3 flex flex-col gap-3">
            {templates.length === 0 ? (
              <p className="text-sm text-zinc-600">
                No firmware templates registered yet.
              </p>
            ) : (
              templates.map((template) => (
                <article
                  className="rounded-lg border border-zinc-200 p-3"
                  key={template.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-900">
                      {template.templateKey} {template.version}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] font-semibold">
                      <span
                        className={
                          template.isActive
                            ? "rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 ring-1 ring-emerald-200"
                            : "rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 ring-1 ring-zinc-200"
                        }
                      >
                        {template.isActive ? "active" : "inactive"}
                      </span>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 ring-1 ring-zinc-200">
                        {templateUsageById.get(template.id) ?? 0} profile(s)
                      </span>
                    </div>
                  </div>
                  {isMysql ? (
                    <FirmwareTemplateRowControls
                      csrfToken={csrfToken}
                      template={template}
                    />
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase text-zinc-500">
            Hardware profiles ({profiles.length})
          </h2>
          {isMysql ? (
            <CreateHardwareProfileForm csrfToken={csrfToken} templates={templates} />
          ) : null}
          <div className="mt-3 flex flex-col gap-3">
            {profiles.length === 0 ? (
              <p className="text-sm text-zinc-600">
                No hardware profiles registered yet. A profile is required before
                a device request can be approved.
              </p>
            ) : (
              profiles.map((profile) => (
                <article
                  className="rounded-lg border border-zinc-200 p-3"
                  key={profile.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-900">
                      {profile.code}{" "}
                      <span className="font-normal text-zinc-500">
                        — {profile.name}
                      </span>
                    </p>
                    <div className="flex items-center gap-2 text-[11px] font-semibold">
                      <span
                        className={
                          profile.isActive
                            ? "rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 ring-1 ring-emerald-200"
                            : "rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 ring-1 ring-zinc-200"
                        }
                      >
                        {profile.isActive ? "active" : "inactive"}
                      </span>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 ring-1 ring-zinc-200">
                        {profileUsageById.get(profile.id) ?? 0} request(s)
                      </span>
                    </div>
                  </div>
                  {isMysql ? (
                    <HardwareProfileRowControls
                      csrfToken={csrfToken}
                      profile={profile}
                      templates={templates}
                    />
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
