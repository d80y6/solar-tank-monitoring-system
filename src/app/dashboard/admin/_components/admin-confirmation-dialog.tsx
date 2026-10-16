"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type AdminConfirmationTone = "danger" | "primary" | "warning";

export type AdminConfirmationContent = {
  confirmLabel: string;
  description: ReactNode;
  eyebrow: string;
  title: string;
  tone?: AdminConfirmationTone;
};

type AdminConfirmationDialogBaseProps = {
  children?: ReactNode;
  confirmation: AdminConfirmationContent;
  confirmIcon?: ReactNode;
  onClose: () => void;
  pending: boolean;
};

type AdminConfirmationDialogFormProps =
  AdminConfirmationDialogBaseProps & {
    formAction: (formData: FormData) => void;
    onConfirm?: never;
  };

type AdminConfirmationDialogCallbackProps =
  AdminConfirmationDialogBaseProps & {
    formAction?: never;
    onConfirm: () => void;
  };

export type AdminConfirmationDialogProps =
  | AdminConfirmationDialogFormProps
  | AdminConfirmationDialogCallbackProps;

const toneClasses: Record<
  AdminConfirmationTone,
  { button: string; eyebrow: string; icon: string }
> = {
  danger: {
    button:
      "bg-red-600 text-white shadow-red-600/15 hover:bg-red-700 focus-visible:ring-red-600/20 disabled:bg-red-300",
    eyebrow: "text-red-600",
    icon: "bg-red-50 text-red-700 ring-red-100",
  },
  primary: {
    button:
      "bg-blue-600 text-white shadow-blue-600/15 hover:bg-blue-700 focus-visible:ring-blue-600/20 disabled:bg-blue-300",
    eyebrow: "text-blue-600",
    icon: "bg-blue-50 text-blue-700 ring-blue-100",
  },
  warning: {
    button:
      "bg-amber-500 text-zinc-950 shadow-amber-500/15 hover:bg-amber-400 focus-visible:ring-amber-600/20 disabled:bg-amber-200",
    eyebrow: "text-amber-700",
    icon: "bg-amber-50 text-amber-800 ring-amber-100",
  },
};

export function AdminConfirmationDialog(
  props: AdminConfirmationDialogProps,
) {
  const {
    children,
    confirmation,
    confirmIcon,
    onClose,
    pending,
  } = props;
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const tone = confirmation.tone ?? "danger";
  const classes = toneClasses[tone];

  useEffect(() => {
    const activeElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    cancelButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      activeElement?.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);

    if (!firstElement || !lastElement) {
      event.preventDefault();
      return;
    }

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  const actionContent = (
    <>
      {children}
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-600/15 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          onClick={onClose}
          ref={cancelButtonRef}
          type="button"
        >
          Cancel
        </button>
        <button
          className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold shadow-lg transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-wait ${classes.button}`}
          disabled={pending}
          onClick={"onConfirm" in props ? props.onConfirm : undefined}
          type={"formAction" in props ? "submit" : "button"}
        >
          {confirmIcon}
          {pending ? "Processing..." : confirmation.confirmLabel}
        </button>
      </div>
    </>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-zinc-950/40 px-4 py-6 backdrop-blur-sm"
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section
        aria-busy={pending}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl shadow-zinc-950/20"
        ref={dialogRef}
        role="dialog"
        style={{
          animation:
            "login-shell-enter 180ms cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <span
              className={`grid size-11 shrink-0 place-items-center rounded-full ring-1 ${classes.icon}`}
            >
              {confirmIcon}
            </span>
            <div className="min-w-0">
              <p
                className={`text-xs font-semibold uppercase tracking-[0.18em] ${classes.eyebrow}`}
              >
                {confirmation.eyebrow}
              </p>
              <h2
                className="mt-2 text-xl font-semibold text-zinc-950"
                id={titleId}
              >
                {confirmation.title}
              </h2>
            </div>
          </div>
          <button
            aria-label="Close confirmation dialog"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-600/15 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <p
          className="mt-4 text-sm leading-6 text-zinc-600"
          id={descriptionId}
        >
          {confirmation.description}
        </p>

        {"formAction" in props ? (
          <form action={props.formAction} className="mt-5 grid gap-3">
            {actionContent}
          </form>
        ) : (
          <div className="mt-5 grid gap-3">{actionContent}</div>
        )}
      </section>
    </div>,
    document.body,
  );
}
