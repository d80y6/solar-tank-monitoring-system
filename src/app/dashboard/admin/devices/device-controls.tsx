"use client";

import { useActionState } from "react";
import { KeyRound, Power, PowerOff } from "lucide-react";

import type { DeviceActionState } from "./actions";
import {
  rotateDeviceKeyAction,
  setDeviceActiveStateAction,
} from "./actions";

const initialState: DeviceActionState = { message: "", status: "idle" };

function StateMessage({ state }: { state: DeviceActionState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <div className="mt-3">
      <p
        className={
          state.status === "success"
            ? "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
            : "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
        }
        role="status"
      >
        {state.message}
      </p>
      {state.issuedDeviceKey ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-900">
            {state.issuedDeviceCode} new key (shown once — store it in the
            firmware configuration now):
          </p>
          <code className="mt-1 block break-all font-mono text-xs text-amber-950">
            {state.issuedDeviceKey}
          </code>
        </div>
      ) : null}
    </div>
  );
}

export function DeviceRowActions({
  csrfToken,
  deviceId,
  isActive,
  rotationGraceHours,
}: {
  csrfToken: string;
  deviceId: string;
  isActive: boolean;
  rotationGraceHours: number;
}) {
  const [rotateState, rotateAction, rotatePending] = useActionState(
    rotateDeviceKeyAction,
    initialState,
  );
  const [stateState, stateAction, statePending] = useActionState(
    setDeviceActiveStateAction,
    initialState,
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <form
          action={rotateAction}
          onSubmit={(event) => {
            if (
              !globalThis.confirm(
                `Rotate the device key now? The previous key keeps working for ${rotationGraceHours} hours while you re-flash the device.`,
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="deviceId" type="hidden" value={deviceId} />
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={rotatePending || !isActive}
            type="submit"
          >
            <KeyRound aria-hidden="true" className="size-4" />
            {rotatePending ? "Rotating…" : "Rotate key"}
          </button>
        </form>
        <form action={stateAction}>
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="deviceId" type="hidden" value={deviceId} />
          <input
            name="isActive"
            type="hidden"
            value={isActive ? "false" : "true"}
          />
          <button
            className={
              isActive
                ? "inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-800 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                : "inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            }
            disabled={statePending}
            type="submit"
          >
            {isActive ? (
              <PowerOff aria-hidden="true" className="size-4" />
            ) : (
              <Power aria-hidden="true" className="size-4" />
            )}
            {statePending ? "Saving…" : isActive ? "Disable" : "Enable"}
          </button>
        </form>
      </div>
      <StateMessage state={rotateState} />
      <StateMessage state={stateState} />
    </div>
  );
}
