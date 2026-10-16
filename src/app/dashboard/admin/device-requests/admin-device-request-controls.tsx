"use client";

import {
  Ban,
  Check,
  Download,
  RefreshCw,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useActionState, useCallback, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  AdminConfirmationDialog,
  type AdminConfirmationContent,
} from "../_components/admin-confirmation-dialog";
import {
  approveDeviceRequestAction,
  cleanupDeviceRequestsAction,
  rejectDeviceRequestAction,
  resetMonitoringDeviceDataAction,
  reissueDevicePackageAction,
  resendDevicePackageAction,
  revokeDeviceProvisioningAction,
  type DeviceRequestAdminActionState,
} from "./actions";

const INITIAL_STATE: DeviceRequestAdminActionState = {
  status: "idle",
  message: "",
};
const CLEANUP_SELECTED_CONFIRMATION = "CLEANUP SELECTED DEVICE REQUESTS";
const CLEANUP_SINGLE_CONFIRMATION = "CLEANUP SINGLE DEVICE REQUEST";
const RESET_CONFIRMATION = "CLEANUP ALL DEVICE DATA";

function ActionMessage({ state }: { state: DeviceRequestAdminActionState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <div aria-live="polite" className="grid gap-2">
      <p
        className={`text-xs font-semibold ${
          state.status === "success" ? "text-emerald-700" : "text-red-700"
        }`}
      >
        {state.message}
      </p>
      {state.status === "success" && state.downloadUrl ? (
        <a
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-50 px-3 text-xs font-semibold text-blue-700 ring-1 ring-blue-100 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15"
          href={state.downloadUrl}
          rel="noreferrer"
          target="_blank"
        >
          <Download className="size-3.5" aria-hidden="true" />
          Download firmware package
        </a>
      ) : null}
    </div>
  );
}

function SubmitButton({
  children,
  disabled,
  icon,
  variant,
}: {
  children: ReactNode;
  disabled?: boolean;
  icon: "ban" | "check" | "refresh" | "rotate" | "trash" | "x";
  variant: "danger" | "dangerOutline" | "neutral" | "primary" | "warning";
}) {
  const { pending } = useFormStatus();
  const Icon =
    icon === "ban"
      ? Ban
      : icon === "check"
        ? Check
        : icon === "refresh"
          ? RefreshCw
          : icon === "rotate"
            ? RotateCw
            : icon === "trash"
              ? Trash2
              : X;
  const variantClass = {
    danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600/20",
    dangerOutline:
      "border border-red-200 bg-white text-red-700 hover:bg-red-50 focus-visible:ring-red-600/15",
    neutral:
      "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 focus-visible:ring-zinc-600/15",
    primary:
      "bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-600/20",
    warning:
      "border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 focus-visible:ring-amber-600/15",
  }[variant];

  return (
    <button
      className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 ${variantClass}`}
      disabled={disabled || pending}
      type="submit"
    >
      <Icon className="size-4" aria-hidden="true" />
      {pending ? "Processing..." : children}
    </button>
  );
}

function ConfirmedSubmitButton({
  children,
  confirmation,
  disabled,
  icon,
  variant,
}: {
  children: ReactNode;
  confirmation: AdminConfirmationContent;
  disabled?: boolean;
  icon: "ban" | "refresh" | "rotate" | "trash";
  variant: "danger" | "dangerOutline" | "neutral" | "warning";
}) {
  const { pending } = useFormStatus();
  const [isOpen, setIsOpen] = useState(false);
  const hiddenSubmitRef = useRef<HTMLButtonElement>(null);
  const handleClose = useCallback(() => setIsOpen(false), []);
  const Icon =
    icon === "ban"
      ? Ban
      : icon === "refresh"
        ? RefreshCw
        : icon === "rotate"
          ? RotateCw
          : Trash2;
  const variantClass = {
    danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600/20",
    dangerOutline:
      "border border-red-200 bg-white text-red-700 hover:bg-red-50 focus-visible:ring-red-600/15",
    neutral:
      "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 focus-visible:ring-zinc-600/15",
    warning:
      "border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 focus-visible:ring-amber-600/15",
  }[variant];

  return (
    <>
      <button
        aria-haspopup="dialog"
        className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 ${variantClass}`}
        disabled={disabled || pending}
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <Icon className="size-4" aria-hidden="true" />
        {pending ? "Processing..." : children}
      </button>
      <button hidden ref={hiddenSubmitRef} type="submit" />

      {isOpen ? (
        <AdminConfirmationDialog
          confirmation={confirmation}
          confirmIcon={<Icon className="size-4" aria-hidden="true" />}
          onClose={handleClose}
          onConfirm={() => {
            handleClose();
            hiddenSubmitRef.current?.click();
          }}
          pending={pending}
        />
      ) : null}
    </>
  );
}

export function ApproveDeviceRequestForm({
  csrfToken,
  disabled,
  requestId,
}: {
  csrfToken: string;
  disabled?: boolean;
  requestId: string;
}) {
  const [state, formAction] = useActionState(
    approveDeviceRequestAction,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="grid gap-1.5">
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input name="requestId" type="hidden" value={requestId} />
      <SubmitButton disabled={disabled} icon="check" variant="primary">
        Approve
      </SubmitButton>
      <ActionMessage state={state} />
    </form>
  );
}

export function RejectDeviceRequestForm({
  csrfToken,
  disabled,
  requestId,
}: {
  csrfToken: string;
  disabled?: boolean;
  requestId: string;
}) {
  const [state, formAction] = useActionState(
    rejectDeviceRequestAction,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="grid gap-2">
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input name="requestId" type="hidden" value={requestId} />
      <textarea
        className="min-h-20 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/15 disabled:bg-zinc-100 disabled:text-zinc-400"
        disabled={disabled}
        maxLength={1000}
        name="rejectionReason"
        placeholder="Rejection reason, for example conflicting device code or mismatched dimensions."
        required
      />
      <SubmitButton disabled={disabled} icon="x" variant="dangerOutline">
        Reject
      </SubmitButton>
      <ActionMessage state={state} />
    </form>
  );
}

function PackageActionForm({
  action,
  children,
  confirmation,
  csrfToken,
  icon,
  requestId,
  variant,
}: {
  action: (
    state: DeviceRequestAdminActionState,
    formData: FormData,
  ) => Promise<DeviceRequestAdminActionState>;
  children: ReactNode;
  confirmation?: AdminConfirmationContent;
  csrfToken: string;
  icon: "ban" | "refresh" | "rotate";
  requestId: string;
  variant: "dangerOutline" | "neutral" | "warning";
}) {
  const [state, formAction] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="grid gap-1.5">
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input name="requestId" type="hidden" value={requestId} />
      {confirmation ? (
        <ConfirmedSubmitButton
          confirmation={confirmation}
          icon={icon}
          variant={variant}
        >
          {children}
        </ConfirmedSubmitButton>
      ) : (
        <SubmitButton icon={icon} variant={variant}>
          {children}
        </SubmitButton>
      )}
      <ActionMessage state={state} />
    </form>
  );
}

export function ResendDevicePackageForm({
  csrfToken,
  requestId,
}: {
  csrfToken: string;
  requestId: string;
}) {
  return (
    <PackageActionForm
      action={resendDevicePackageAction}
      csrfToken={csrfToken}
      icon="refresh"
      requestId={requestId}
      variant="neutral"
    >
      Resend link
    </PackageActionForm>
  );
}

export function ReissueDevicePackageForm({
  csrfToken,
  requestId,
}: {
  csrfToken: string;
  requestId: string;
}) {
  return (
    <PackageActionForm
      action={reissueDevicePackageAction}
      confirmation={{
        confirmLabel: "Yes, recreate package",
        description:
          "The old package and credentials will be revoked, then the system creates a new provisioning package for this device.",
        eyebrow: "Device credential rotation",
        title: "Recreate provisioning package?",
        tone: "warning",
      }}
      csrfToken={csrfToken}
      icon="rotate"
      requestId={requestId}
      variant="warning"
    >
      Recreate package
    </PackageActionForm>
  );
}

export function RevokeDeviceProvisioningForm({
  csrfToken,
  requestId,
}: {
  csrfToken: string;
  requestId: string;
}) {
  return (
    <PackageActionForm
      action={revokeDeviceProvisioningAction}
      confirmation={{
        confirmLabel: "Yes, revoke access",
        description:
          "The device can no longer send telemetry using the current provisioning credentials.",
        eyebrow: "Revoke device access",
        title: "Revoke device provisioning access?",
        tone: "danger",
      }}
      csrfToken={csrfToken}
      icon="ban"
      requestId={requestId}
      variant="dangerOutline"
    >
      Revoke access
    </PackageActionForm>
  );
}

export function CleanupDeviceRequestForm({
  csrfToken,
  requestId,
  requestLabel,
}: {
  csrfToken: string;
  requestId: string;
  requestLabel: string;
}) {
  const [state, formAction] = useActionState(
    cleanupDeviceRequestsAction,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="grid gap-1.5">
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input name="cleanupMode" type="hidden" value="single" />
      <input name="requestIds" type="hidden" value={requestId} />
      <input
        name="confirmation"
        type="hidden"
        value={CLEANUP_SINGLE_CONFIRMATION}
      />
      <ConfirmedSubmitButton
        confirmation={{
          confirmLabel: "Yes, delete data",
          description: `The request, firmware package, events, readings, and device related to ${requestLabel} will be deleted if no other data uses them.`,
          eyebrow: "Device data cleanup",
          title: `Delete data for ${requestLabel}?`,
          tone: "danger",
        }}
        icon="trash"
        variant="dangerOutline"
      >
        Delete data
      </ConfirmedSubmitButton>
      <ActionMessage state={state} />
    </form>
  );
}

export function CleanupSelectedDeviceRequestsForm({
  csrfToken,
  formId,
}: {
  csrfToken: string;
  formId: string;
}) {
  const [state, formAction] = useActionState(
    cleanupDeviceRequestsAction,
    INITIAL_STATE,
  );

  return (
    <form
      action={formAction}
      className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end"
      id={formId}
    >
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input name="cleanupMode" type="hidden" value="selected" />
      <label className="grid gap-2 text-sm font-semibold text-zinc-950">
        Delete checked requests
        <input
          autoComplete="off"
          className="h-11 rounded-lg border border-amber-200 bg-white px-3 text-sm font-semibold text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-amber-500 focus:ring-4 focus:ring-amber-600/15"
          name="confirmation"
          placeholder={CLEANUP_SELECTED_CONFIRMATION}
          required
        />
      </label>
      <ConfirmedSubmitButton
        confirmation={{
          confirmLabel: "Yes, clean up selection",
          description:
            "All checked requests along with related device data will be cleaned up according to data relation safety rules.",
          eyebrow: "Selected data cleanup",
          title: "Clean up all checked requests?",
          tone: "warning",
        }}
        icon="trash"
        variant="warning"
      >
        Clean up selection
      </ConfirmedSubmitButton>
      <p className="text-xs leading-5 text-zinc-500 lg:col-span-2">
        Check one or more requests, type exactly{" "}
        <span className="font-semibold">{CLEANUP_SELECTED_CONFIRMATION}</span>,
        then clean up. The system only deletes data related to the selection.
      </p>
      <div className="lg:col-span-2">
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

export function ResetMonitoringDeviceDataForm({
  csrfToken,
}: {
  csrfToken: string;
}) {
  const [state, formAction] = useActionState(
    resetMonitoringDeviceDataAction,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="grid gap-3">
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <label className="grid gap-2 text-sm font-semibold text-zinc-950">
        Confirmation phrase
        <input
          autoComplete="off"
          className="h-11 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-red-500 focus:ring-4 focus:ring-red-600/15"
          name="confirmation"
          placeholder={RESET_CONFIRMATION}
          required
        />
      </label>
      <p className="text-xs leading-5 text-zinc-500">
        Type exactly <span className="font-semibold">{RESET_CONFIRMATION}</span>{" "}
        to clean up all STO, tank, device, reading, request, firmware package, and
        provisioning event data. User accounts, admins, firmware templates, and
        hardware profiles are not deleted.
      </p>
      <ConfirmedSubmitButton
        confirmation={{
          confirmLabel: "Yes, clean up everything",
          description:
            "All STO, tank, device, reading, request, firmware package, and provisioning event operational data will be deleted. User accounts and templates are retained.",
          eyebrow: "Operational data reset",
          title: "Clean up all device operational data?",
          tone: "danger",
        }}
        icon="trash"
        variant="danger"
      >
        Clean up all data
      </ConfirmedSubmitButton>
      <ActionMessage state={state} />
    </form>
  );
}
