"use client";

import {
  AlertCircle,
  CheckCircle2,
  Fuel,
  Gauge,
  MapPin,
  Send,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type {
  LoadPowerUnit,
  MonitoringHardwareProfile,
  TankShape,
} from "@/features/monitoring/types/monitoring";
import {
  FTM_REGIONAL_OPTIONS,
  FTM_WILAYAH_OPTIONS,
} from "@/features/monitoring/lib/location-taxonomy";
import {
  createDeviceRequestAction,
  type DeviceRequestFormState,
} from "./actions";

const INITIAL_STATE: DeviceRequestFormState = {
  status: "idle",
  message: "",
};

function FormField({
  children,
  className = "",
  help,
  label,
}: {
  children: ReactNode;
  className?: string;
  help?: string;
  label: string;
}) {
  return (
    <label
      className={`flex h-full w-full min-w-0 flex-col gap-2 text-sm font-semibold text-zinc-900 ${className}`}
    >
      <span className="break-words">{label}</span>
      {children}
      {help ? (
        <span className="min-h-5 break-words text-xs font-normal leading-5 text-zinc-500">
          {help}
        </span>
      ) : null}
    </label>
  );
}

function SectionHeader({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-100">
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-zinc-950">{title}</h3>
        <p className="mt-1 break-words text-sm leading-6 text-zinc-500">
          {children}
        </p>
      </div>
    </div>
  );
}

function inputClassName(extra = "") {
  return `h-11 w-full min-w-0 max-w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-950 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-600/15 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 ${extra}`;
}

function parsePositiveFormNumber(value: string): number | null {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatMetric(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function calculateCapacityPreview({
  diameterCm,
  heightCm,
  lengthCm,
  tankShape,
  widthCm,
}: {
  diameterCm: string;
  heightCm: string;
  lengthCm: string;
  tankShape: TankShape;
  widthCm: string;
}): number | null {
  const length = parsePositiveFormNumber(lengthCm);

  if (!length) {
    return null;
  }

  if (tankShape === "horizontal-cylinder") {
    const diameter = parsePositiveFormNumber(diameterCm);

    if (!diameter) {
      return null;
    }

    const radius = diameter / 2;
    return roundMetric((Math.PI * radius * radius * length) / 1000);
  }

  const width = parsePositiveFormNumber(widthCm);
  const height = parsePositiveFormNumber(heightCm);

  if (!width || !height) {
    return null;
  }

  return roundMetric((length * width * height) / 1000);
}

function calculateConsumptionPreview({
  cosPhi,
  dieselEngineCapacityKva,
  loadUnit,
  loadValue,
}: {
  cosPhi: string;
  dieselEngineCapacityKva: string;
  loadUnit: LoadPowerUnit;
  loadValue: string;
}): number | null {
  const load = parsePositiveFormNumber(loadValue);
  const engineCapacity = parsePositiveFormNumber(dieselEngineCapacityKva);
  const cos = parsePositiveFormNumber(cosPhi);

  if (!load || !engineCapacity || !cos || cos > 1) {
    return null;
  }

  const effectiveLoadKw = loadUnit === "kva" ? load * cos : load;
  const engineCapacityKw = engineCapacity * cos;

  if (engineCapacityKw <= 0) {
    return null;
  }

  const loadRatio = effectiveLoadKw / engineCapacityKw;
  return roundMetric(Math.max(0, engineCapacity * loadRatio * 0.21));
}

function ComputedMetric({
  emptyLabel = "auto",
  help,
  label,
  unit,
  value,
}: {
  emptyLabel?: string;
  help?: string;
  label: string;
  unit: string;
  value: number | null;
}) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-2 text-sm font-semibold text-zinc-900">
      <span className="break-words">{label}</span>
      <output className="flex min-h-11 w-full min-w-0 max-w-full items-center rounded-lg border border-blue-100 bg-blue-50 px-3 text-sm font-semibold text-blue-950 shadow-sm">
        {value === null ? emptyLabel : `${formatMetric(value)} ${unit}`}
      </output>
      {help ? (
        <span className="min-h-5 break-words text-xs font-normal leading-5 text-zinc-500">
          {help}
        </span>
      ) : null}
    </div>
  );
}

function NumberInput({
  max,
  min = "0",
  name,
  onValueChange,
  placeholder,
  required,
  step = "0.01",
  value,
}: {
  max?: string;
  min?: string;
  name: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  step?: string;
  value?: string;
}) {
  return (
    <input
      className={inputClassName()}
      inputMode="decimal"
      max={max}
      min={min}
      name={name}
      onChange={(event) => onValueChange?.(event.target.value)}
      placeholder={placeholder}
      required={required}
      step={step}
      type="number"
      value={value}
    />
  );
}

function SubmitButton({
  disabled,
}: {
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 disabled:shadow-none sm:w-auto"
      disabled={disabled || pending}
      type="submit"
    >
      <Send className="size-4" aria-hidden="true" />
      {pending ? "Sending..." : "Request device"}
    </button>
  );
}

function ActionMessage({ state }: { state: DeviceRequestFormState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  const isSuccess = state.status === "success";
  const Icon = isSuccess ? CheckCircle2 : AlertCircle;

  return (
    <div
      className={`rounded-lg border p-4 text-sm ${
        isSuccess
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-800"
      }`}
      role={isSuccess ? "status" : "alert"}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold">{state.message}</p>
          {state.requestCode ? (
            <p className="mt-1 text-xs">Request code: {state.requestCode}</p>
          ) : null}
          {state.issues && state.issues.length > 0 ? (
            <ul className="mt-3 grid gap-1 text-xs leading-5">
              {state.issues.map((issue) => (
                <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function DeviceRequestForm({
  hardwareProfiles,
}: {
  hardwareProfiles: MonitoringHardwareProfile[];
}) {
  const [state, formAction] = useActionState(
    createDeviceRequestAction,
    INITIAL_STATE,
  );
  const [tankShape, setTankShape] = useState<TankShape>("rectangular");
  const [lengthCm, setLengthCm] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [diameterCm, setDiameterCm] = useState("");
  const [loadValue, setLoadValue] = useState("");
  const [loadUnit, setLoadUnit] = useState<LoadPowerUnit>("kw");
  const [dieselEngineCapacityKva, setDieselEngineCapacityKva] = useState("");
  const [cosPhi, setCosPhi] = useState("");
  const matchingProfiles = useMemo(
    () =>
      hardwareProfiles.filter(
        (profile) =>
          profile.supportedTankShape === "any" ||
          profile.supportedTankShape === tankShape,
      ),
    [hardwareProfiles, tankShape],
  );
  const canSubmit = matchingProfiles.length > 0;
  const calculatedCapacityLiter = useMemo(
    () =>
      calculateCapacityPreview({
        diameterCm,
        heightCm,
        lengthCm,
        tankShape,
        widthCm,
      }),
    [diameterCm, heightCm, lengthCm, tankShape, widthCm],
  );
  const calculatedConsumptionLiterPerHour = useMemo(
    () =>
      calculateConsumptionPreview({
        cosPhi,
        dieselEngineCapacityKva,
        loadUnit,
        loadValue,
      }),
    [cosPhi, dieselEngineCapacityKva, loadUnit, loadValue],
  );

  return (
    <form
      action={formAction}
      className="mx-auto grid w-full min-w-0 max-w-6xl gap-6"
    >
      <div className="grid w-full min-w-0 gap-3 sm:grid-cols-3">
        {[
          "STO code and device code are created automatically",
          "Device key is created after admin approval",
          "Level limits and send interval use system defaults",
        ].map((item) => (
          <div
            className="min-w-0 break-words rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold leading-6 text-zinc-700"
            key={item}
          >
            {item}
          </div>
        ))}
      </div>

      <section className="grid min-w-0 gap-5 border-t border-zinc-100 pt-5">
        <SectionHeader
          icon={<MapPin className="size-5" aria-hidden="true" />}
          title="STO location"
        >
          This data determines location grouping and STO map points.
        </SectionHeader>

        <div className="grid w-full min-w-0 max-w-6xl gap-4 md:grid-cols-2 xl:grid-cols-3">
          <FormField label="STO name" help="Example: STO Bangil or STO TPH">
            <input
              className={inputClassName()}
              name="siteName"
              placeholder="STO Bangil"
              required
            />
          </FormField>
          <FormField
            label="Regional"
            help="Telkom's large territory group, for example TREG 5."
          >
            <select className={inputClassName()} name="regionalLabel" required>
              <option value="">Select regional</option>
              {FTM_REGIONAL_OPTIONS.map((regional) => (
                <option key={regional} value={regional}>
                  {regional}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Territory"
            help="Operational territory under a regional, for example TIF 3."
          >
            <select className={inputClassName()} name="wilayahLabel" required>
              <option value="">Select territory</option>
              {FTM_WILAYAH_OPTIONS.map((wilayah) => (
                <option key={wilayah} value={wilayah}>
                  {wilayah}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Area"
            help="Work area or city, for example Pasuruan."
          >
            <input
              className={inputClassName()}
              name="areaLabel"
              placeholder="Pasuruan"
              required
            />
          </FormField>
          <FormField
            label="Latitude"
            help="Optional. Supports up to 7 decimal places."
          >
            <NumberInput
              max="90"
              min="-90"
              name="latitude"
              placeholder="-7.7201234"
              step="0.0000001"
            />
          </FormField>
          <FormField
            label="Longitude"
            help="Optional. Supports up to 7 decimal places."
          >
            <NumberInput
              max="180"
              min="-180"
              name="longitude"
              placeholder="112.8801234"
              step="0.0000001"
            />
          </FormField>
        </div>
      </section>

      <section className="grid min-w-0 gap-5 border-t border-zinc-100 pt-5">
        <SectionHeader
          icon={<Fuel className="size-5" aria-hidden="true" />}
          title="Sensor and tank"
        >
          Choose the tank type, sensor mode, hardware profile, and physical
          dimensions used on site.
        </SectionHeader>

        <div className="grid w-full min-w-0 gap-3 sm:grid-cols-2">
          <button
            className={`w-full min-w-0 rounded-lg border p-4 text-left transition ${
              tankShape === "rectangular"
                ? "border-blue-500 bg-blue-50 ring-4 ring-blue-600/10"
                : "border-zinc-200 bg-white hover:border-blue-200"
            }`}
            onClick={() => setTankShape("rectangular")}
            type="button"
          >
            <span className="text-sm font-semibold text-zinc-950">
              Rectangular tank
            </span>
            <span className="mt-1 block text-xs leading-5 text-zinc-500">
              Length, width, height, and sensor height.
            </span>
          </button>
          <button
            className={`w-full min-w-0 rounded-lg border p-4 text-left transition ${
              tankShape === "horizontal-cylinder"
                ? "border-blue-500 bg-blue-50 ring-4 ring-blue-600/10"
                : "border-zinc-200 bg-white hover:border-blue-200"
            }`}
            onClick={() => setTankShape("horizontal-cylinder")}
            type="button"
          >
            <span className="text-sm font-semibold text-zinc-950">
              Horizontal cylinder tank
            </span>
            <span className="mt-1 block text-xs leading-5 text-zinc-500">
              Cylinder length, diameter, and sensor height.
            </span>
          </button>
          <input name="tankShape" type="hidden" value={tankShape} />
        </div>

        <div className="grid w-full min-w-0 max-w-5xl gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
          <FormField
            label="Sensor mode"
            help="The currently active firmware package for fuel sensors."
          >
            <select className={inputClassName()} name="deviceSensorType" required>
              <option value="fuel">Fuel sensor</option>
              <option value="energy" disabled>
                Energy sensor (not active yet)
              </option>
            </select>
          </FormField>
          <FormField
            label="Hardware profile"
            help="The profile determines the board, sensor, and pins used."
          >
            <select
              className={inputClassName()}
              disabled={!canSubmit}
              key={tankShape}
              name="hardwareProfileId"
              required
            >
              {matchingProfiles.length === 0 ? (
                <option value="">No active profile for this type yet</option>
              ) : (
                matchingProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.triggerPin}/{profile.echoPin})
                  </option>
                ))
              )}
            </select>
          </FormField>
        </div>

        <div className="grid w-full min-w-0 max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <ComputedMetric
            help="From tank dimensions."
            label="Capacity in liters"
            unit="L"
            value={calculatedCapacityLiter}
          />
          <FormField label="Length cm">
            <NumberInput
              name="lengthCm"
              onValueChange={setLengthCm}
              placeholder="150"
              required
              value={lengthCm}
            />
          </FormField>
          {tankShape === "rectangular" ? (
            <>
              <FormField label="Width cm">
                <NumberInput
                  name="widthCm"
                  onValueChange={setWidthCm}
                  placeholder="60"
                  required
                  value={widthCm}
                />
              </FormField>
              <FormField label="Height cm">
                <NumberInput
                  name="heightCm"
                  onValueChange={setHeightCm}
                  placeholder="60"
                  required
                  value={heightCm}
                />
              </FormField>
            </>
          ) : (
            <FormField label="Diameter cm">
              <NumberInput
                name="diameterCm"
                onValueChange={setDiameterCm}
                placeholder="60"
                required
                value={diameterCm}
              />
            </FormField>
          )}
          <FormField
            label="Sensor reference cm"
            help="Sensor height from the top of the tank."
          >
            <NumberInput name="sensorMountHeightCm" placeholder="60" required />
          </FormField>
        </div>
      </section>

      <section className="grid min-w-0 gap-5 border-t border-zinc-100 pt-5">
        <SectionHeader
          icon={<Gauge className="size-5" aria-hidden="true" />}
          title="Generator load"
        >
          The system calculates hourly fuel consumption from site load, diesel
          engine capacity, and cos phi.
        </SectionHeader>

        <div className="grid w-full min-w-0 max-w-6xl gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <FormField label="Site load">
            <NumberInput
              name="loadValue"
              onValueChange={setLoadValue}
              placeholder="20"
              required
              value={loadValue}
            />
          </FormField>
          <FormField label="Load unit">
            <select
              className={inputClassName()}
              name="loadUnit"
              onChange={(event) => setLoadUnit(event.target.value as LoadPowerUnit)}
              required
              value={loadUnit}
            >
              <option value="kw">kW</option>
              <option value="kva">kVA</option>
            </select>
          </FormField>
          <FormField
            label="Diesel engine capacity"
            help="Enter in kVA."
          >
            <NumberInput
              name="dieselEngineCapacityKva"
              onValueChange={setDieselEngineCapacityKva}
              placeholder="40"
              required
              value={dieselEngineCapacityKva}
            />
          </FormField>
          <FormField label="Cos phi" help="Typically 0.8. Enter 0 to 1.">
            <NumberInput
              max="1"
              min="0.01"
              name="cosPhi"
              onValueChange={setCosPhi}
              placeholder="0.8"
              required
              value={cosPhi}
            />
          </FormField>
          <ComputedMetric
            help="Used for runtime estimates."
            label="Fuel consumption"
            unit="L/hr"
            value={calculatedConsumptionLiterPerHour}
          />
        </div>
      </section>

      {!canSubmit ? (
        <div className="w-full min-w-0 max-w-5xl break-words rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
          No active device profile is available for this tank type yet. An admin
          needs to enable the firmware template and hardware profile in the
          database after the pin configuration is confirmed.
        </div>
      ) : null}

      <ActionMessage state={state} />
      <div className="flex w-full min-w-0 justify-end border-t border-zinc-100 pt-5">
        <SubmitButton disabled={!canSubmit} />
      </div>
    </form>
  );
}
