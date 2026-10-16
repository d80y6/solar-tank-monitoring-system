"use client";

import type { ReactNode } from "react";
import { useActionState, useCallback, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Ban,
  Check,
  KeyRound,
  LogOut,
  RefreshCcw,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import type { AuthRole } from "@/features/auth/types";
import {
  AdminConfirmationDialog,
  type AdminConfirmationContent,
} from "../_components/admin-confirmation-dialog";
import type { AdminActionState } from "./actions";

type AdminServerAction = (
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

const INITIAL_ACTION_STATE: AdminActionState = {
  status: "idle",
  message: "",
};

type ButtonVariant =
  | "danger"
  | "primary"
  | "dangerOutline"
  | "success"
  | "neutralOutline";

type ButtonIcon =
  | "check"
  | "x"
  | "ban"
  | "refresh"
  | "logout"
  | "send"
  | "key"
  | "trash";

const buttonVariantClass: Record<ButtonVariant, string> = {
  danger:
    "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600/20",
  primary:
    "bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-600/20",
  dangerOutline:
    "border border-red-200 bg-white text-red-700 hover:bg-red-50 focus-visible:ring-red-600/15",
  success:
    "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600/20",
  neutralOutline:
    "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 focus-visible:ring-zinc-600/10",
};

function getIcon(icon: ButtonIcon) {
  switch (icon) {
    case "check":
      return <Check className="size-4" aria-hidden="true" />;
    case "x":
      return <X className="size-4" aria-hidden="true" />;
    case "ban":
      return <Ban className="size-4" aria-hidden="true" />;
    case "refresh":
      return <RefreshCcw className="size-4" aria-hidden="true" />;
    case "logout":
      return <LogOut className="size-4" aria-hidden="true" />;
    case "send":
      return <Send className="size-4" aria-hidden="true" />;
    case "key":
      return <KeyRound className="size-4" aria-hidden="true" />;
    case "trash":
      return <Trash2 className="size-4" aria-hidden="true" />;
  }
}

function ActionMessage({ state }: { state: AdminActionState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <p
      aria-live="polite"
      className={`text-xs font-semibold ${
        state.status === "success" ? "text-emerald-700" : "text-red-700"
      }`}
    >
      {state.message}
    </p>
  );
}

function DialogActionMessage({ state }: { state: AdminActionState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <p
      aria-live="polite"
      className={`rounded-lg border px-3 py-2 text-sm font-semibold leading-6 ${
        state.status === "success"
          ? "border-emerald-100 bg-emerald-50 text-emerald-700"
          : "border-red-100 bg-red-50 text-red-700"
      }`}
    >
      {state.message}
    </p>
  );
}

function SubmitButton({
  children,
  compact,
  disabled,
  icon,
  variant,
}: {
  children: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  icon: ButtonIcon;
  variant: ButtonVariant;
}) {
  const { pending } = useFormStatus();
  const label = pending ? "Processing..." : children;

  return (
    <button
      aria-label={typeof children === "string" ? children : undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 ${
        compact ? "size-8 px-0" : "h-9 w-full px-3"
      } ${buttonVariantClass[variant]}`}
      disabled={Boolean(disabled) || pending}
      title={typeof children === "string" ? children : undefined}
      type="submit"
    >
      {getIcon(icon)}
      {compact ? (
        <span className="sr-only">{label}</span>
      ) : (
        label
      )}
    </button>
  );
}

function AdminActionHiddenFields({
  csrfToken,
  fields,
}: {
  csrfToken: string;
  fields: Record<string, string>;
}) {
  return (
    <>
      <input name="csrfToken" type="hidden" value={csrfToken} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} name={name} type="hidden" value={value} />
      ))}
    </>
  );
}

function DirectAdminActionForm({
  action,
  children,
  className,
  compact,
  csrfToken,
  disabled,
  fields,
  hideMessage,
  icon,
  variant,
}: {
  action: AdminServerAction;
  children: ReactNode;
  className?: string;
  compact?: boolean;
  csrfToken: string;
  disabled?: boolean;
  fields: Record<string, string>;
  hideMessage?: boolean;
  icon: ButtonIcon;
  variant: ButtonVariant;
}) {
  const [state, formAction] = useActionState(action, INITIAL_ACTION_STATE);

  return (
    <form action={formAction} className={`grid gap-1.5 ${className ?? ""}`}>
      <AdminActionHiddenFields csrfToken={csrfToken} fields={fields} />
      <SubmitButton
        compact={compact}
        disabled={disabled}
        icon={icon}
        variant={variant}
      >
        {children}
      </SubmitButton>
      {hideMessage ? null : <ActionMessage state={state} />}
    </form>
  );
}

function AdminActionConfirmationDialog({
  action,
  confirmation,
  csrfToken,
  fields,
  icon,
  onClose,
}: {
  action: AdminServerAction;
  confirmation: AdminConfirmationContent;
  csrfToken: string;
  fields: Record<string, string>;
  icon: ButtonIcon;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    INITIAL_ACTION_STATE,
  );
  useEffect(() => {
    if (state.status !== "success") {
      return undefined;
    }

    const timeoutId = window.setTimeout(onClose, 450);

    return () => window.clearTimeout(timeoutId);
  }, [onClose, state.status]);

  return (
    <AdminConfirmationDialog
      confirmation={confirmation}
      confirmIcon={getIcon(icon)}
      formAction={formAction}
      onClose={onClose}
      pending={pending}
    >
      <AdminActionHiddenFields csrfToken={csrfToken} fields={fields} />
      <DialogActionMessage state={state} />
    </AdminConfirmationDialog>
  );
}

function ConfirmedAdminAction({
  action,
  children,
  className,
  compact,
  confirmation,
  csrfToken,
  disabled,
  fields,
  icon,
  variant,
}: {
  action: AdminServerAction;
  children: ReactNode;
  className?: string;
  compact?: boolean;
  confirmation: AdminConfirmationContent;
  csrfToken: string;
  disabled?: boolean;
  fields: Record<string, string>;
  icon: ButtonIcon;
  variant: ButtonVariant;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const handleClose = useCallback(() => setIsOpen(false), []);
  const triggerLabel =
    typeof children === "string"
      ? `${children}: ${confirmation.title}`
      : undefined;

  return (
    <div className={className}>
      <button
        aria-haspopup="dialog"
        aria-label={triggerLabel}
        className={`inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 ${
          compact ? "size-8 px-0" : "h-9 w-full px-3"
        } ${buttonVariantClass[variant]}`}
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        title={triggerLabel}
        type="button"
      >
        {getIcon(icon)}
        {compact ? <span className="sr-only">{children}</span> : children}
      </button>

      {isOpen ? (
        <AdminActionConfirmationDialog
          action={action}
          confirmation={confirmation}
          csrfToken={csrfToken}
          fields={fields}
          icon={icon}
          onClose={handleClose}
        />
      ) : null}
    </div>
  );
}

export function AdminActionForm({
  action,
  children,
  className,
  compact,
  confirmation,
  csrfToken,
  disabled,
  fields,
  hideMessage,
  icon,
  variant,
}: {
  action: AdminServerAction;
  children: ReactNode;
  className?: string;
  compact?: boolean;
  confirmation?: AdminConfirmationContent;
  csrfToken: string;
  disabled?: boolean;
  fields: Record<string, string>;
  hideMessage?: boolean;
  icon: ButtonIcon;
  variant: ButtonVariant;
}) {
  if (confirmation) {
    return (
      <ConfirmedAdminAction
        action={action}
        className={className}
        compact={compact}
        confirmation={confirmation}
        csrfToken={csrfToken}
        disabled={disabled}
        fields={fields}
        icon={icon}
        variant={variant}
      >
        {children}
      </ConfirmedAdminAction>
    );
  }

  return (
    <DirectAdminActionForm
      action={action}
      className={className}
      compact={compact}
      csrfToken={csrfToken}
      disabled={disabled}
      fields={fields}
      hideMessage={hideMessage}
      icon={icon}
      variant={variant}
    >
      {children}
    </DirectAdminActionForm>
  );
}

export function AdminRoleForm({
  action,
  compact,
  csrfToken,
  currentRole,
  disabled,
  targetUserId,
  targetUserName,
}: {
  action: AdminServerAction;
  compact?: boolean;
  csrfToken: string;
  currentRole: AuthRole;
  disabled?: boolean;
  targetUserId: string;
  targetUserName: string;
}) {
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
  const [roleDraft, setRoleDraft] = useState<{
    baseRole: AuthRole;
    selectedRole: AuthRole;
  }>({
    baseRole: currentRole,
    selectedRole: currentRole,
  });

  const selectedRole =
    roleDraft.baseRole === currentRole ? roleDraft.selectedRole : currentRole;
  const hasRoleChange = selectedRole !== currentRole;
  const submitDisabled = Boolean(disabled) || !hasRoleChange;

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label={`Role ${targetUserName}`}
        className={`rounded-lg border border-zinc-200 bg-white font-semibold text-zinc-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-600/15 disabled:bg-zinc-100 disabled:text-zinc-400 ${
          compact ? "h-8 w-24 px-2 text-xs" : "h-9 min-w-28 px-3 text-sm"
        }`}
        disabled={disabled}
        onChange={(event) =>
          setRoleDraft({
            baseRole: currentRole,
            selectedRole: event.target.value as AuthRole,
          })
        }
        value={selectedRole}
      >
        <option value="user">User</option>
        <option value="admin">Admin</option>
      </select>
      <button
        aria-haspopup="dialog"
        aria-label={`Save role for ${targetUserName}`}
        className={`inline-flex items-center justify-center rounded-lg bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 ${
          compact ? "size-8 px-0" : "h-9 px-3"
        }`}
        disabled={submitDisabled}
        onClick={() => setIsConfirmationOpen(true)}
        title={`Save role for ${targetUserName}`}
        type="button"
      >
        {compact ? (
          <>
            <Check className="size-4" aria-hidden="true" />
            <span className="sr-only">Save</span>
          </>
        ) : (
          "Save"
        )}
      </button>

      {isConfirmationOpen ? (
        <AdminRoleConfirmationDialog
          action={action}
          csrfToken={csrfToken}
          onClose={() => setIsConfirmationOpen(false)}
          role={selectedRole}
          targetUserId={targetUserId}
          targetUserName={targetUserName}
        />
      ) : null}
    </div>
  );
}

function AdminRoleConfirmationDialog({
  action,
  csrfToken,
  onClose,
  role,
  targetUserId,
  targetUserName,
}: {
  action: AdminServerAction;
  csrfToken: string;
  onClose: () => void;
  role: AuthRole;
  targetUserId: string;
  targetUserName: string;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    INITIAL_ACTION_STATE,
  );
  const isPromotion = role === "admin";

  useEffect(() => {
    if (state.status !== "success") {
      return undefined;
    }

    const timeoutId = window.setTimeout(onClose, 650);

    return () => window.clearTimeout(timeoutId);
  }, [onClose, state.status]);

  return (
    <AdminConfirmationDialog
      confirmation={{
        confirmLabel: "Yes, change role",
        description: isPromotion
          ? `${targetUserName} will gain full access to administration features and operational data.`
          : `${targetUserName} will no longer be able to open administration features after the role is changed to User.`,
        eyebrow: "Access change",
        title: `Change ${targetUserName}'s role to ${isPromotion ? "Admin" : "User"}?`,
        tone: "warning",
      }}
      confirmIcon={<ShieldCheck className="size-4" aria-hidden="true" />}
      formAction={formAction}
      onClose={onClose}
      pending={pending}
    >
      <AdminActionHiddenFields
        csrfToken={csrfToken}
        fields={{ role, targetUserId }}
      />
      <DialogActionMessage state={state} />
    </AdminConfirmationDialog>
  );
}
