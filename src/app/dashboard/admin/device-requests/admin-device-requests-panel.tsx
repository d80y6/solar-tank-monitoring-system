"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import type {
  DeviceRequestStatus,
  MonitoringDeviceRequest,
  MonitoringHardwareProfile,
  TankShape,
} from "@/features/monitoring/types/monitoring";
import { formatCoordinatePair } from "@/features/monitoring/lib/number";
import {
  ApproveDeviceRequestForm,
  CleanupDeviceRequestForm,
  ReissueDevicePackageForm,
  RejectDeviceRequestForm,
  ResendDevicePackageForm,
  RevokeDeviceProvisioningForm,
} from "./admin-device-request-controls";

type AdminDeviceRequestsPanelProps = {
  csrfToken: string;
  filteredRequests: MonitoringDeviceRequest[];
  hardwareProfiles: MonitoringHardwareProfile[];
  isMysqlEnabled: boolean;
  totalRequestCount: number;
};

const STATUS_LABELS: Record<DeviceRequestStatus, string> = {
  active: "Device active",
  approved_package_ready: "Firmware package ready",
  approved_waiting_package: "Approved, waiting for firmware package",
  expired: "Expired",
  package_generation_failed: "Package generation failed",
  pending_admin_review: "Waiting for admin",
  rejected: "Rejected",
  revoked: "Revoked",
  waiting_firmware_download: "Waiting for firmware download",
  waiting_first_valid_ping: "Waiting for device online",
};

function formatDate(value: string | null | undefined) {
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

function formatNumber(value: number | null | undefined, suffix = "") {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value)}${suffix}`;
}

function getStatusClass(status: DeviceRequestStatus) {
  switch (status) {
    case "pending_admin_review":
      return "bg-amber-50 text-amber-700 ring-amber-100";
    case "rejected":
      return "bg-red-50 text-red-700 ring-red-100";
    case "approved_waiting_package":
    case "approved_package_ready":
    case "waiting_firmware_download":
    case "waiting_first_valid_ping":
      return "bg-blue-50 text-blue-700 ring-blue-100";
    case "active":
      return "bg-emerald-50 text-emerald-700 ring-emerald-100";
    case "expired":
    case "revoked":
    case "package_generation_failed":
      return "bg-zinc-100 text-zinc-700 ring-zinc-200";
  }
}

function getTankShapeLabel(shape: TankShape) {
  return shape === "rectangular" ? "Rectangular tank" : "Horizontal cylinder tank";
}

function getSupportedTankShapeLabel(shape: MonitoringHardwareProfile["supportedTankShape"]) {
  if (shape === "any") {
    return "All tank types";
  }

  return getTankShapeLabel(shape);
}

function getSensorTypeLabel(sensorType: MonitoringDeviceRequest["deviceSensorType"]) {
  return sensorType === "energy" ? "Energy sensor" : "Fuel sensor";
}

function getDimensionSummary(request: MonitoringDeviceRequest) {
  if (request.tankShape === "rectangular") {
    return `${formatNumber(request.lengthCm, " cm")} × ${formatNumber(
      request.widthCm,
      " cm",
    )} × ${formatNumber(request.heightCm, " cm")}`;
  }

  return `Length ${formatNumber(request.lengthCm, " cm")} · diameter ${formatNumber(
    request.diameterCm,
    " cm",
  )}`;
}

function getCoordinateSummary(request: MonitoringDeviceRequest) {
  if (typeof request.latitude !== "number" || typeof request.longitude !== "number") {
    return "-";
  }

  return formatCoordinatePair(request.latitude, request.longitude);
}

function DetailItem({
  children,
  label,
  note,
}: {
  children: ReactNode;
  label: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-zinc-950">{children}</dd>
      {note ? <p className="mt-1 text-xs leading-5 text-zinc-500">{note}</p> : null}
    </div>
  );
}

function RequestStatusBadge({ status }: { status: DeviceRequestStatus }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${getStatusClass(
        status,
      )}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function RequestDetailModal({
  csrfToken,
  onClose,
  profile,
  request,
}: {
  csrfToken: string;
  onClose: () => void;
  profile: MonitoringHardwareProfile | undefined;
  request: MonitoringDeviceRequest;
}) {
  const canReview = request.status === "pending_admin_review";
  const canResend =
    request.status === "approved_package_ready" ||
    request.status === "waiting_firmware_download" ||
    request.status === "waiting_first_valid_ping";
  const canReissue =
    request.status === "approved_package_ready" ||
    request.status === "waiting_firmware_download" ||
    request.status === "waiting_first_valid_ping" ||
    request.status === "expired" ||
    request.status === "package_generation_failed";
  const canRevoke =
    request.status !== "pending_admin_review" &&
    request.status !== "rejected" &&
    request.status !== "revoked";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/40 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section
        aria-modal="true"
        className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-zinc-950/10"
        role="dialog"
        style={{
          animation: "login-shell-enter 180ms cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {/* Modal header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <RequestStatusBadge status={request.status} />
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">
                {request.requestCode}
              </span>
            </div>
            <h3 className="mt-3 truncate text-2xl font-semibold text-zinc-950">
              {request.siteName}
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              Submitted {formatDate(request.createdAt)} by {request.requesterEmail}
            </p>
          </div>
          <button
            aria-label="Close request details"
            className="grid size-10 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-600/15"
            onClick={onClose}
            type="button"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50/70 px-5 py-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
            {/* Modal detail fields */}
            <div className="grid gap-4">
              <section className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-600">
                  Location data
                </p>
                <dl className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <DetailItem label="STO name">{request.siteName}</DetailItem>
                  <DetailItem label="STO code">{request.siteCode}</DetailItem>
                  <DetailItem label="Regional">{request.regionalLabel}</DetailItem>
                  <DetailItem label="Territory">{request.wilayahLabel}</DetailItem>
                  <DetailItem label="Area">{request.areaLabel}</DetailItem>
                  <DetailItem label="Device code">{request.deviceCode}</DetailItem>
                  <DetailItem label="Device label">{request.deviceLabel}</DetailItem>
                  <DetailItem label="Coordinates">{getCoordinateSummary(request)}</DetailItem>
                </dl>
              </section>

              <section className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-600">
                  Tank specification
                </p>
                <dl className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <DetailItem label="Tank shape">
                    {getTankShapeLabel(request.tankShape)}
                  </DetailItem>
                  <DetailItem label="Capacity">
                    {formatNumber(request.capacityLiter, " L")}
                  </DetailItem>
                  <DetailItem label="Dimensions">{getDimensionSummary(request)}</DetailItem>
                  <DetailItem label="Sensor height">
                    {formatNumber(request.sensorMountHeightCm, " cm")}
                  </DetailItem>
                  <DetailItem label="Low level">
                    {formatNumber(request.lowLevelPercent, "%")}
                  </DetailItem>
                  <DetailItem label="Critical level">
                    {formatNumber(request.criticalLevelPercent, "%")}
                  </DetailItem>
                </dl>
              </section>

              <section className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-600">
                  Operations
                </p>
                <dl className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <DetailItem label="Sensor mode">
                    {getSensorTypeLabel(request.deviceSensorType)}
                  </DetailItem>
                  <DetailItem label="Site load">
                    {formatNumber(request.loadValue, ` ${request.loadUnit.toUpperCase()}`)}
                  </DetailItem>
                  <DetailItem label="Diesel engine">
                    {formatNumber(request.dieselEngineCapacityKva, " kVA")}
                  </DetailItem>
                  <DetailItem label="Cos phi">{formatNumber(request.cosPhi)}</DetailItem>
                  <DetailItem label="Calculated consumption">
                    {formatNumber(request.consumptionLiterPerHour, " L/hour")}
                  </DetailItem>
                  <DetailItem label="Reviewed">
                    {formatDate(request.adminReviewedAt)}
                  </DetailItem>
                </dl>
              </section>

              <section className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-600">
                  Hardware profile
                </p>
                <dl className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <DetailItem label="Profile name">
                    {profile?.name ?? "Hardware profile not found"}
                  </DetailItem>
                  <DetailItem label="Profile code">{profile?.code ?? "-"}</DetailItem>
                  <DetailItem label="Board">{profile?.boardLabel ?? "-"}</DetailItem>
                  <DetailItem label="Trigger pin">{profile?.triggerPin ?? "-"}</DetailItem>
                  <DetailItem label="Echo pin">{profile?.echoPin ?? "-"}</DetailItem>
                  <DetailItem label="Tank support">
                    {profile ? getSupportedTankShapeLabel(profile.supportedTankShape) : "-"}
                  </DetailItem>
                </dl>
              </section>

              {request.validationWarnings.length > 0 ? (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-900">
                    Validation notes
                  </p>
                  <ul className="mt-2 grid gap-2 text-sm leading-6 text-amber-800">
                    {request.validationWarnings.map((warning) => (
                      <li key={`${warning.field}-${warning.message}`}>
                        {warning.message}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {request.rejectionReason ? (
                <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
                  <p className="font-semibold text-red-800">Rejection reason</p>
                  <p className="mt-1">{request.rejectionReason}</p>
                </section>
              ) : null}
            </div>

            {/* Modal action panel */}
            <aside className="grid content-start gap-3">
              <section className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="text-sm font-semibold text-zinc-950">
                  Request actions
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  All admin decisions still use the same server action as before.
                </p>
                <div className="mt-4 grid gap-2">
                  {canReview ? (
                    <>
                      <ApproveDeviceRequestForm
                        csrfToken={csrfToken}
                        requestId={request.id}
                      />
                      <RejectDeviceRequestForm
                        csrfToken={csrfToken}
                        requestId={request.id}
                      />
                    </>
                  ) : canResend || canReissue || canRevoke ? (
                    <>
                      {canResend ? (
                        <ResendDevicePackageForm
                          csrfToken={csrfToken}
                          requestId={request.id}
                        />
                      ) : null}
                      {canReissue ? (
                        <ReissueDevicePackageForm
                          csrfToken={csrfToken}
                          requestId={request.id}
                        />
                      ) : null}
                      {canRevoke ? (
                        <RevokeDeviceProvisioningForm
                          csrfToken={csrfToken}
                          requestId={request.id}
                        />
                      ) : null}
                    </>
                  ) : (
                    <p className="rounded-lg bg-zinc-50 p-3 text-sm leading-6 text-zinc-500 ring-1 ring-zinc-200">
                      This request has been processed and has no further review actions.
                    </p>
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-red-100 bg-white p-4">
                <p className="text-sm font-semibold text-red-700">
                  Clean up request data
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Use only if this request data needs to be removed from the system.
                </p>
                <div className="mt-3">
                  <CleanupDeviceRequestForm
                    csrfToken={csrfToken}
                    requestId={request.id}
                    requestLabel={request.requestCode}
                  />
                </div>
              </section>
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
}

export function AdminDeviceRequestsPanel({
  csrfToken,
  filteredRequests,
  hardwareProfiles,
  isMysqlEnabled,
  totalRequestCount,
}: AdminDeviceRequestsPanelProps) {
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const profileById = useMemo(
    () => new Map(hardwareProfiles.map((profile) => [profile.id, profile])),
    [hardwareProfiles],
  );
  const activeRequest =
    filteredRequests.find((request) => request.id === activeRequestId) ?? null;

  useEffect(() => {
    if (!activeRequestId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveRequestId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeRequestId]);

  return (
    <section className="flex flex-col rounded-lg border border-zinc-200 bg-white shadow-sm lg:min-h-0 lg:flex-1 lg:overflow-hidden">
      {/* Compact request list */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-600">
            Request list
          </p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-950">
            Devices that need review
          </h2>
        </div>
        <span className="w-fit rounded-full bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200">
          {filteredRequests.length} of {totalRequestCount} requests
        </span>
      </div>

      <div className="lg:min-h-0 lg:flex-1 lg:overflow-hidden">
        {!isMysqlEnabled ? (
          <div className="grid h-full place-items-center p-6 text-center text-sm leading-6 text-zinc-500">
            Device request review requires MySQL storage.
          </div>
        ) : totalRequestCount === 0 ? (
          <div className="grid h-full place-items-center p-6 text-center text-sm leading-6 text-zinc-500">
            No device requests yet.
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="grid h-full place-items-center p-6 text-center text-sm leading-6 text-zinc-500">
            No requests match this filter.
          </div>
        ) : (
          <div className="overflow-x-auto px-3 pb-3 lg:h-full lg:overflow-auto">
            <table className="min-w-[860px] w-full border-separate border-spacing-y-2">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                  <th className="px-3 py-3">STO name</th>
                  <th className="px-3 py-3">Requester name/email</th>
                  <th className="px-3 py-3">Request status</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((request) => (
                  <tr
                    className="group rounded-lg bg-zinc-50/70 text-sm transition hover:bg-blue-50/60"
                    key={request.id}
                  >
                    <td className="rounded-l-lg border-y border-l border-zinc-200 px-3 py-3">
                      <p className="font-semibold text-zinc-950">{request.siteName}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {request.siteCode} / {request.regionalLabel} /{" "}
                        {request.wilayahLabel}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Area {request.areaLabel}
                      </p>
                    </td>
                    <td className="border-y border-zinc-200 px-3 py-3">
                      <p className="font-semibold text-zinc-800">
                        {request.requesterEmail}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        User ID: {request.requesterUserId}
                      </p>
                    </td>
                    <td className="border-y border-zinc-200 px-3 py-3">
                      <RequestStatusBadge status={request.status} />
                    </td>
                    <td className="border-y border-zinc-200 px-3 py-3 text-zinc-600">
                      {formatDate(request.createdAt)}
                    </td>
                    <td className="rounded-r-lg border-y border-r border-zinc-200 px-3 py-3 text-right">
                      <button
                        className="inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20"
                        onClick={() => setActiveRequestId(request.id)}
                        type="button"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {activeRequest ? (
        <RequestDetailModal
          csrfToken={csrfToken}
          onClose={() => setActiveRequestId(null)}
          profile={profileById.get(activeRequest.hardwareProfileId)}
          request={activeRequest}
        />
      ) : null}
    </section>
  );
}
