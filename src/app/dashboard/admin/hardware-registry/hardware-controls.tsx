"use client";

import { useActionState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";

import type {
  HardwareBoardFamily,
  HardwareTankShapeSupport,
  MonitoringFirmwareTemplate,
  MonitoringHardwareProfile,
} from "@/features/monitoring/types/monitoring";

import {
  createFirmwareTemplateAction,
  deleteFirmwareTemplateAction,
  deleteHardwareProfileAction,
  saveHardwareProfileAction,
  updateFirmwareTemplateAction,
  type HardwareActionState,
} from "./actions";

const initialState: HardwareActionState = { message: "", status: "idle" };

const inputClass =
  "h-9 w-full rounded-lg border border-zinc-200 px-3 text-xs text-zinc-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10";

function StateMessage({ state }: { state: HardwareActionState }) {
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

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase text-zinc-500">
      {label}
      {children}
    </label>
  );
}

export function CreateFirmwareTemplateForm({ csrfToken }: { csrfToken: string }) {
  const [state, formAction, pending] = useActionState(
    createFirmwareTemplateAction,
    initialState,
  );

  return (
    <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-zinc-700">
        <Plus aria-hidden="true" className="mr-1 inline size-3.5" />
        Add a firmware template
      </summary>
      <form action={formAction} className="mt-3 grid gap-3 md:grid-cols-3">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <Field label="Template key">
          <input className={inputClass} name="templateKey" placeholder="solartank-esp8266-ultrasonic" required />
        </Field>
        <Field label="Version">
          <input className={inputClass} name="version" placeholder="v1" required />
        </Field>
        <Field label="Display name">
          <input className={inputClass} name="displayName" placeholder="Solar Tank ESP8266 Ultrasonic v1" required />
        </Field>
        <Field label="Source path">
          <input className={inputClass} name="sourcePath" placeholder="firmware/templates/solartank-esp8266-ultrasonic-v1" required />
        </Field>
        <Field label="Checksum SHA-256 (optional)">
          <input className={inputClass} name="checksumSha256" placeholder="64 hex characters" />
        </Field>
        <label className="mt-4 flex items-center gap-2 text-xs font-medium text-zinc-700">
          <input className="size-3.5 accent-blue-600" name="isActive" type="checkbox" />
          Active for new device requests
        </label>
        <div className="md:col-span-3">
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            <Save aria-hidden="true" className="size-4" />
            {pending ? "Saving…" : "Create template"}
          </button>
          <StateMessage state={state} />
        </div>
      </form>
    </details>
  );
}

export function FirmwareTemplateRowControls({
  csrfToken,
  template,
}: {
  csrfToken: string;
  template: MonitoringFirmwareTemplate;
}) {
  const [updateState, updateAction, updatePending] = useActionState(
    updateFirmwareTemplateAction,
    initialState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteFirmwareTemplateAction,
    initialState,
  );

  return (
    <div className="mt-2 flex flex-col gap-2">
      <form action={updateAction} className="flex flex-wrap items-end gap-2">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="id" type="hidden" value={template.id} />
        <div className="min-w-44 flex-1">
          <Field label="Display name">
            <input className={inputClass} defaultValue={template.displayName} name="displayName" required />
          </Field>
        </div>
        <div className="min-w-52 flex-1">
          <Field label="Source path">
            <input className={inputClass} defaultValue={template.sourcePath} name="sourcePath" required />
          </Field>
        </div>
        <div className="min-w-40 flex-1">
          <Field label="Checksum">
            <input
              className={inputClass}
              defaultValue={template.checksumSha256 ?? ""}
              name="checksumSha256"
              placeholder="optional"
            />
          </Field>
        </div>
        <label className="flex h-9 items-center gap-2 text-xs font-medium text-zinc-700">
          <input
            className="size-3.5 accent-blue-600"
            defaultChecked={template.isActive}
            name="isActive"
            type="checkbox"
          />
          Active
        </label>
        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={updatePending}
          type="submit"
        >
          <Save aria-hidden="true" className="size-4" />
          {updatePending ? "Saving…" : "Save"}
        </button>
      </form>
      <form action={deleteAction} className="flex items-center gap-2">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="id" type="hidden" value={template.id} />
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={deletePending}
          type="submit"
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
          {deletePending ? "Deleting…" : "Delete"}
        </button>
        <span className="text-[11px] text-zinc-500">
          Deleting is refused while a hardware profile still uses the template.
        </span>
      </form>
      <StateMessage state={updateState} />
      <StateMessage state={deleteState} />
    </div>
  );
}

export function CreateHardwareProfileForm({
  csrfToken,
  templates,
}: {
  csrfToken: string;
  templates: MonitoringFirmwareTemplate[];
}) {
  const [state, formAction, pending] = useActionState(
    saveHardwareProfileAction,
    initialState,
  );

  return (
    <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-zinc-700">
        <Plus aria-hidden="true" className="mr-1 inline size-3.5" />
        Add a hardware profile
      </summary>
      <form action={formAction} className="mt-3 grid gap-3 md:grid-cols-3">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <Field label="Code">
          <input className={inputClass} name="code" placeholder="esp8266-ultrasonic-v1" required />
        </Field>
        <Field label="Name">
          <input className={inputClass} name="name" placeholder="ESP8266 Ultrasonic v1" required />
        </Field>
        <Field label="Board family">
          <select className={inputClass} defaultValue="esp8266" name="boardFamily">
            {(["esp8266", "esp32", "unknown"] as HardwareBoardFamily[]).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Board label">
          <input className={inputClass} name="boardLabel" placeholder="NodeMCU ESP8266" required />
        </Field>
        <Field label="Sensor type">
          <input className={inputClass} name="sensorType" placeholder="ultrasonic-hc-sr04" required />
        </Field>
        <Field label="Supported tank shape">
          <select className={inputClass} defaultValue="any" name="supportedTankShape">
            {(
              ["rectangular", "horizontal-cylinder", "any"] as HardwareTankShapeSupport[]
            ).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Trigger pin">
          <input className={inputClass} name="triggerPin" placeholder="D6" required />
        </Field>
        <Field label="Echo pin">
          <input className={inputClass} name="echoPin" placeholder="D5" required />
        </Field>
        <Field label="Report interval (ms)">
          <input className={inputClass} defaultValue="20000" min="5000" name="reportIntervalMs" type="number" />
        </Field>
        <Field label="Firmware template">
          <select className={inputClass} name="firmwareTemplateId" required>
            <option value="">Select a template…</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.templateKey} {template.version}
                {template.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </Field>
        <label className="mt-4 flex items-center gap-2 text-xs font-medium text-zinc-700">
          <input className="size-3.5 accent-blue-600" name="isActive" type="checkbox" />
          Active for new device requests
        </label>
        <div className="md:col-span-3">
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            <Save aria-hidden="true" className="size-4" />
            {pending ? "Saving…" : "Create profile"}
          </button>
          <StateMessage state={state} />
        </div>
      </form>
    </details>
  );
}

export function HardwareProfileRowControls({
  csrfToken,
  profile,
  templates,
}: {
  csrfToken: string;
  profile: MonitoringHardwareProfile;
  templates: MonitoringFirmwareTemplate[];
}) {
  const [saveState, saveAction, savePending] = useActionState(
    saveHardwareProfileAction,
    initialState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteHardwareProfileAction,
    initialState,
  );

  return (
    <div className="mt-2 flex flex-col gap-2">
      <form action={saveAction} className="grid gap-2 md:grid-cols-4">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="id" type="hidden" value={profile.id} />
        <Field label="Name">
          <input className={inputClass} defaultValue={profile.name} name="name" required />
        </Field>
        <Field label="Board family">
          <select className={inputClass} defaultValue={profile.boardFamily} name="boardFamily">
            {(["esp8266", "esp32", "unknown"] as HardwareBoardFamily[]).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Board label">
          <input className={inputClass} defaultValue={profile.boardLabel} name="boardLabel" required />
        </Field>
        <Field label="Sensor type">
          <input className={inputClass} defaultValue={profile.sensorType} name="sensorType" required />
        </Field>
        <Field label="Trigger pin">
          <input className={inputClass} defaultValue={profile.triggerPin} name="triggerPin" required />
        </Field>
        <Field label="Echo pin">
          <input className={inputClass} defaultValue={profile.echoPin} name="echoPin" required />
        </Field>
        <Field label="Supported tank shape">
          <select
            className={inputClass}
            defaultValue={profile.supportedTankShape}
            name="supportedTankShape"
          >
            {(
              ["rectangular", "horizontal-cylinder", "any"] as HardwareTankShapeSupport[]
            ).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Report interval (ms)">
          <input
            className={inputClass}
            defaultValue={profile.reportIntervalMs}
            min="5000"
            name="reportIntervalMs"
            type="number"
          />
        </Field>
        <Field label="Firmware template">
          <select
            className={inputClass}
            defaultValue={profile.firmwareTemplateId}
            name="firmwareTemplateId"
            required
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.templateKey} {template.version}
                {template.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </Field>
        <label className="mt-4 flex items-center gap-2 text-xs font-medium text-zinc-700">
          <input
            className="size-3.5 accent-blue-600"
            defaultChecked={profile.isActive}
            name="isActive"
            type="checkbox"
          />
          Active
        </label>
        <div className="flex items-end">
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={savePending}
            type="submit"
          >
            <Save aria-hidden="true" className="size-4" />
            {savePending ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
      <form action={deleteAction} className="flex items-center gap-2">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="id" type="hidden" value={profile.id} />
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={deletePending}
          type="submit"
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
          {deletePending ? "Deleting…" : "Delete"}
        </button>
        <span className="text-[11px] text-zinc-500">
          Deleting is refused while a device request still references the profile.
        </span>
      </form>
      <StateMessage state={saveState} />
      <StateMessage state={deleteState} />
    </div>
  );
}
