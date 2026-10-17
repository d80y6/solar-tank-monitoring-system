"use client";

import { useActionState } from "react";
import { CheckCheck, RefreshCw, ShieldCheck } from "lucide-react";

import type { MonitoringAlert } from "@/features/ops/types";

import {
  acknowledgeAlertAction,
  resolveAlertAction,
  runAlertEvaluationAction,
  type AlertActionState,
} from "./actions";

const initialState: AlertActionState = { message: "", status: "idle" };

function StatusMessage({ state }: { state: AlertActionState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <p
      className={
        state.status === "success"
          ? "mt-2 text-xs font-medium text-emerald-700"
          : "mt-2 text-xs font-medium text-red-600"
      }
      role="status"
    >
      {state.message}
    </p>
  );
}

export function AlertRowControls({
  alert,
  csrfToken,
}: {
  alert: MonitoringAlert;
  csrfToken: string;
}) {
  const [ackState, ackAction, ackPending] = useActionState(
    acknowledgeAlertAction,
    initialState,
  );
  const [resolveState, resolveAction, resolvePending] = useActionState(
    resolveAlertAction,
    initialState,
  );

  return (
    <div className="flex flex-col gap-2">
      <form action={ackAction} className="flex flex-wrap items-center gap-2">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="alertId" type="hidden" value={alert.id} />
        <input
          className="h-9 min-w-40 flex-1 rounded-lg border border-zinc-200 px-3 text-xs text-zinc-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10"
          name="note"
          placeholder="Acknowledgement note (optional)"
        />
        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={ackPending || alert.status === "acknowledged"}
          type="submit"
        >
          <ShieldCheck aria-hidden="true" className="size-4" />
          {ackPending ? "Saving…" : "Acknowledge"}
        </button>
      </form>
      <form action={resolveAction} className="flex flex-wrap items-center gap-2">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="alertId" type="hidden" value={alert.id} />
        <input
          className="h-9 min-w-40 flex-1 rounded-lg border border-zinc-200 px-3 text-xs text-zinc-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10"
          name="note"
          placeholder="Resolution note (required to resolve)"
        />
        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={resolvePending}
          type="submit"
        >
          <CheckCheck aria-hidden="true" className="size-4" />
          {resolvePending ? "Saving…" : "Resolve"}
        </button>
      </form>
      <StatusMessage state={ackState} />
      <StatusMessage state={resolveState} />
    </div>
  );
}

export function RunEvaluationButton({ csrfToken }: { csrfToken: string }) {
  const [state, action, pending] = useActionState(
    runAlertEvaluationAction,
    initialState,
  );

  return (
    <form action={action}>
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <button
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        <RefreshCw
          aria-hidden="true"
          className={pending ? "size-4 animate-spin" : "size-4"}
        />
        {pending ? "Evaluating…" : "Run evaluation now"}
      </button>
      <StatusMessage state={state} />
    </form>
  );
}
