"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, RotateCcw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import {
  cleanupDashboardTankAction,
  resetAllDashboardReadingsAction,
  resetDashboardTankReadingsAction,
  type DashboardAdminActionState,
} from "@/app/dashboard/actions";
import type { SimpleDashboardSite } from "@/features/monitoring/lib/simple-dashboard-model";

type SimpleDashboardCardsProps = {
  adminCleanupToken?: string;
  sites: SimpleDashboardSite[];
};

const INITIAL_ACTION_STATE: DashboardAdminActionState = {
  status: "idle",
  message: "",
};
const DELETE_TANK_CONFIRMATION = "DELETE STO DATA";
const RESET_TANK_READINGS_CONFIRMATION = "RESET STO READINGS";
const RESET_ALL_READINGS_CONFIRMATION = "RESET ALL READINGS";
const TELKOM_WATERMARK_SRC = "/brand/Logo_Telkom1.png";

function formatLiter(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function getTankIcon(site: SimpleDashboardSite) {
  return site.tankShape === "rectangular"
    ? "/tank-icons/square-tank.png"
    : "/tank-icons/rounded-tank.png";
}

function OnlineBadge({ isOnline }: { isOnline: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
        isOnline
          ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
          : "bg-red-50 text-red-700 ring-red-100"
      }`}
    >
      {isOnline ? "Online" : "Offline"}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-5 py-10 text-center">
      <p className="text-base font-semibold text-zinc-950">
        No STO matches these filters.
      </p>
      <p className="mt-2 text-sm text-zinc-500">
        Try changing the keyword, status, regional, territory, area, or
        selected STO.
      </p>
    </div>
  );
}

function DeleteTankDialog({
  csrfToken,
  onClose,
  site,
}: {
  csrfToken: string;
  onClose: () => void;
  site: SimpleDashboardSite;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    cleanupDashboardTankAction,
    INITIAL_ACTION_STATE,
  );
  const siteLabel = `${site.name} (${site.code})`;

  useEffect(() => {
    if (state.status === "success") {
      const timeoutId = window.setTimeout(() => {
        onClose();
        router.refresh();
      }, 350);

      return () => window.clearTimeout(timeoutId);
    }

    return undefined;
  }, [onClose, router, state.status]);

  return (
    <div
      aria-labelledby="delete-dashboard-tank-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 px-4 py-6 backdrop-blur-sm"
      role="dialog"
    >
      <section className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl shadow-zinc-950/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-600">
              Delete monitoring data
            </p>
            <h2
              className="mt-2 text-xl font-semibold text-zinc-950"
              id="delete-dashboard-tank-title"
            >
              Delete {site.name}?
            </h2>
          </div>
          <button
            aria-label="Close delete dialog"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-zinc-200 text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-600/15"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Reading data, devices, tanks, and events for{" "}
          <span className="font-semibold text-zinc-950">{siteLabel}</span>{" "}
          will be cleared from the dashboard. Accounts, admins, firmware
          templates, and hardware profiles remain safe.
        </p>

        <form action={formAction} className="mt-5 grid gap-3">
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="tankId" type="hidden" value={site.tankId} />
          <input name="siteLabel" type="hidden" value={siteLabel} />
          <input
            name="confirmation"
            type="hidden"
            value={DELETE_TANK_CONFIRMATION}
          />

          {state.status === "error" && state.message ? (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold leading-6 text-red-700">
              {state.message}
            </p>
          ) : null}
          {state.status === "success" && state.message ? (
            <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-semibold leading-6 text-emerald-700">
              {state.message}
            </p>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-600/15 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white shadow-lg shadow-red-600/15 transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-600/20 disabled:cursor-wait disabled:bg-red-300"
              disabled={pending}
              type="submit"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {pending ? "Deleting..." : "Yes, delete data"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ResetTankReadingsDialog({
  csrfToken,
  onClose,
  site,
}: {
  csrfToken: string;
  onClose: () => void;
  site: SimpleDashboardSite;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    resetDashboardTankReadingsAction,
    INITIAL_ACTION_STATE,
  );
  const siteLabel = `${site.name} (${site.code})`;

  useEffect(() => {
    if (state.status === "success") {
      const timeoutId = window.setTimeout(() => {
        onClose();
        router.refresh();
      }, 350);

      return () => window.clearTimeout(timeoutId);
    }

    return undefined;
  }, [onClose, router, state.status]);

  return (
    <div
      aria-labelledby="reset-dashboard-tank-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 px-4 py-6 backdrop-blur-sm"
      role="dialog"
    >
      <section className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl shadow-zinc-950/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">
              Reset readings
            </p>
            <h2
              className="mt-2 text-xl font-semibold text-zinc-950"
              id="reset-dashboard-tank-title"
            >
              Reset readings for {site.name}?
            </h2>
          </div>
          <button
            aria-label="Close reset dialog"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-zinc-200 text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-600/15"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Reading history for{" "}
          <span className="font-semibold text-zinc-950">{siteLabel}</span>{" "}
          will be cleared. STO data, tanks, devices, requests, and firmware
          packages remain.
        </p>

        <form action={formAction} className="mt-5 grid gap-3">
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="tankId" type="hidden" value={site.tankId} />
          <input name="siteLabel" type="hidden" value={siteLabel} />
          <input
            name="confirmation"
            type="hidden"
            value={RESET_TANK_READINGS_CONFIRMATION}
          />

          {state.status === "error" && state.message ? (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold leading-6 text-red-700">
              {state.message}
            </p>
          ) : null}
          {state.status === "success" && state.message ? (
            <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-semibold leading-6 text-emerald-700">
              {state.message}
            </p>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-600/15 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white shadow-lg shadow-amber-600/15 transition hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-600/20 disabled:cursor-wait disabled:bg-amber-300"
              disabled={pending}
              type="submit"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              {pending ? "Resetting..." : "Reset readings"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ResetAllReadingsDialog({
  csrfToken,
  onClose,
}: {
  csrfToken: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [state, formAction, pending] = useActionState(
    resetAllDashboardReadingsAction,
    INITIAL_ACTION_STATE,
  );
  const canSubmit = confirmation === RESET_ALL_READINGS_CONFIRMATION;

  useEffect(() => {
    if (state.status === "success") {
      const timeoutId = window.setTimeout(() => {
        onClose();
        router.refresh();
      }, 350);

      return () => window.clearTimeout(timeoutId);
    }

    return undefined;
  }, [onClose, router, state.status]);

  return (
    <div
      aria-labelledby="reset-all-dashboard-readings-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 px-4 py-6 backdrop-blur-sm"
      role="dialog"
    >
      <section className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl shadow-zinc-950/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">
              Reset all readings
            </p>
            <h2
              className="mt-2 text-xl font-semibold text-zinc-950"
              id="reset-all-dashboard-readings-title"
            >
              Clear reading history for all STOs?
            </h2>
          </div>
          <button
            aria-label="Close reset-all dialog"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-zinc-200 text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-600/15"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-3 text-sm leading-6 text-zinc-600">
          This action deletes every{" "}
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-800">
            monitoring_readings
          </code>{" "}
          row so the dashboard starts reading fresh data. The STO registry,
          tanks, devices, requests, and firmware packages are not deleted.
        </p>

        <form action={formAction} className="mt-5 grid gap-3">
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <label className="grid gap-2 text-sm font-semibold text-zinc-900">
            <span>Type {RESET_ALL_READINGS_CONFIRMATION}</span>
            <input
              className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-amber-600 focus:ring-4 focus:ring-amber-600/15"
              name="confirmation"
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={RESET_ALL_READINGS_CONFIRMATION}
              value={confirmation}
            />
          </label>

          {state.status === "error" && state.message ? (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold leading-6 text-red-700">
              {state.message}
            </p>
          ) : null}
          {state.status === "success" && state.message ? (
            <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-semibold leading-6 text-emerald-700">
              {state.message}
            </p>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-600/15 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white shadow-lg shadow-amber-600/15 transition hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-600/20 disabled:cursor-not-allowed disabled:bg-amber-300"
              disabled={pending || !canSubmit}
              type="submit"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              {pending ? "Resetting..." : "Reset all readings"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function SimpleDashboardCards({
  adminCleanupToken,
  sites,
}: SimpleDashboardCardsProps) {
  const [siteToDelete, setSiteToDelete] =
    useState<SimpleDashboardSite | null>(null);
  const [siteToReset, setSiteToReset] =
    useState<SimpleDashboardSite | null>(null);
  const [resetAllReadingsOpen, setResetAllReadingsOpen] = useState(false);

  if (sites.length === 0) {
    return <EmptyState />;
  }

  return (
    <>
      <div className="grid gap-3">
        {adminCleanupToken ? (
          <div className="flex justify-end">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700 transition hover:border-amber-300 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-600/15"
              onClick={() => setResetAllReadingsOpen(true)}
              type="button"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Reset all readings
            </button>
          </div>
        ) : null}
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {sites.map((site) => (
            <article
              className="group relative isolate cursor-pointer overflow-hidden rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-950/10 focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-100"
              key={`${site.code}-${site.tankId}`}
            >
              <Link
                aria-label={`Open tank details for ${site.name}`}
                className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none"
                href={`/dashboard/operations/tanks/${site.tankId}`}
              />
              <Image
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-5 z-0 h-24 w-24 object-contain opacity-[0.12] sm:h-28 sm:w-28"
                height={160}
                src={TELKOM_WATERMARK_SRC}
                width={160}
              />
              <span
                className={`pointer-events-none absolute inset-x-0 top-0 h-1 ${
                  site.isOnline ? "bg-emerald-500" : "bg-red-500"
                }`}
              />

            <div className="pointer-events-none relative z-10 flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-zinc-500">
                  {site.code} - {site.regionalLabel} - {site.wilayahLabel}
                </p>
                <p className="mt-0.5 text-xs font-medium text-zinc-500">
                  Area {site.areaLabel}
                </p>
                <h2 className="mt-1 text-lg font-semibold leading-snug text-zinc-950">
                  {site.name}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <OnlineBadge isOnline={site.isOnline} />
                {adminCleanupToken ? (
                  <>
                    <button
                      aria-label={`Reset readings for ${site.name}`}
                      className="pointer-events-auto grid size-8 place-items-center rounded-full border border-amber-100 bg-amber-50 text-amber-700 transition hover:border-amber-200 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-600/15"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setSiteToReset(site);
                      }}
                      title={`Reset readings for ${site.name}`}
                      type="button"
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      aria-label={`Delete monitoring data for ${site.name}`}
                      className="pointer-events-auto grid size-8 place-items-center rounded-full border border-red-100 bg-red-50 text-red-600 transition hover:border-red-200 hover:bg-red-100 hover:text-red-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-600/15"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setSiteToDelete(site);
                      }}
                      title={`Delete monitoring data for ${site.name}`}
                      type="button"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            <div className="pointer-events-none relative z-10 mt-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-500">Tank level</p>
                <p className="mt-2 text-2xl font-semibold tracking-normal text-zinc-950">
                  {formatLiter(site.volumeLiter)} /{" "}
                  {formatLiter(site.capacityLiter)} L
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  current / maximum capacity
                </p>
              </div>

              <span className="grid h-14 w-16 shrink-0 place-items-center rounded-lg bg-blue-50 ring-1 ring-blue-100 sm:h-16 sm:w-20">
                <Image
                  alt=""
                  aria-hidden="true"
                  className="h-10 w-14 object-contain opacity-80 sm:h-12 sm:w-16"
                  height={576}
                  src={getTankIcon(site)}
                  width={768}
                />
              </span>
            </div>

            <div className="pointer-events-none relative z-10 mt-5 flex items-center justify-between gap-3 border-t border-zinc-100 pt-4 text-sm">
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-500">
                  Last update
                </p>
                <p className="mt-0.5 truncate font-semibold text-zinc-950">
                  {site.updateLabel}
                </p>
              </div>
              <span className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-blue-50 px-3 text-xs font-semibold text-blue-700 transition group-hover:bg-blue-600 group-hover:text-white">
                Open details
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </span>
            </div>
            </article>
          ))}
        </div>
      </div>
      {adminCleanupToken && siteToDelete ? (
        <DeleteTankDialog
          csrfToken={adminCleanupToken}
          key={siteToDelete.tankId}
          onClose={() => setSiteToDelete(null)}
          site={siteToDelete}
        />
      ) : null}
      {adminCleanupToken && siteToReset ? (
        <ResetTankReadingsDialog
          csrfToken={adminCleanupToken}
          key={siteToReset.tankId}
          onClose={() => setSiteToReset(null)}
          site={siteToReset}
        />
      ) : null}
      {adminCleanupToken && resetAllReadingsOpen ? (
        <ResetAllReadingsDialog
          csrfToken={adminCleanupToken}
          onClose={() => setResetAllReadingsOpen(false)}
        />
      ) : null}
    </>
  );
}
