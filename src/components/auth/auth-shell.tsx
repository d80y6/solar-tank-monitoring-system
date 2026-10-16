import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";

type AuthShellProps = {
  children: ReactNode;
  description: string;
  heading: string;
  footerPrompt: ReactNode;
  contentWidth?: "default" | "wide";
  contextNote?: {
    title: string;
    description: string;
  };
};

const DEFAULT_CONTEXT_NOTE = {
  title: "Operational access",
  description: "Operational data is available to authorized accounts.",
};

function MonitoringVisual({
  contextNote,
}: {
  contextNote: NonNullable<AuthShellProps["contextNote"]>;
}) {
  return (
    <div className="relative mt-8 flex min-h-0 flex-1 items-center justify-center">
      <div className="login-visual-float relative w-full max-w-[34rem]">
        {/* Main monitoring preview */}
        <div className="relative overflow-hidden rounded-lg border border-zinc-200 bg-white p-5 text-zinc-950 shadow-2xl shadow-zinc-200/80 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Main tank
              </p>
              <p className="mt-2 text-lg font-semibold">STO TPH</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
              <span className="size-2 rounded-full bg-emerald-500" />
              Online
            </span>
          </div>

          <div className="mt-7 grid gap-5 sm:grid-cols-[1.1fr_0.9fr]">
            <div className="relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 p-5">
              <div
                aria-hidden="true"
                className="absolute inset-0 opacity-70"
                style={{
                  backgroundImage:
                    "radial-gradient(circle, #d4d4d8 1px, transparent 1px)",
                  backgroundSize: "12px 12px",
                }}
              />
              <div className="relative mx-auto flex h-36 max-w-[15rem] items-center justify-center">
                <svg
                  aria-label="Illustration of a fuel tank filled to 78 percent"
                  className="h-full w-full"
                  role="img"
                  viewBox="0 0 280 150"
                >
                  <defs>
                    <clipPath id="tank-body">
                      <rect height="84" rx="42" width="218" x="31" y="30" />
                    </clipPath>
                    <linearGradient id="fuel-fill" x1="0" x2="1">
                      <stop offset="0" stopColor="#22d3ee" />
                      <stop offset="1" stopColor="#2563eb" />
                    </linearGradient>
                  </defs>
                  <rect
                    fill="#ffffff"
                    height="84"
                    rx="42"
                    stroke="#18181b"
                    strokeWidth="5"
                    width="218"
                    x="31"
                    y="30"
                  />
                  <rect
                    clipPath="url(#tank-body)"
                    fill="url(#fuel-fill)"
                    height="84"
                    width="170"
                    x="31"
                    y="30"
                  />
                  <path
                    d="M65 114v15M215 114v15M51 130h28M201 130h28"
                    stroke="#18181b"
                    strokeLinecap="round"
                    strokeWidth="5"
                  />
                  <rect
                    fill="#18181b"
                    height="13"
                    rx="3"
                    width="34"
                    x="123"
                    y="17"
                  />
                  <circle cx="140" cy="72" fill="#ffffff" r="25" />
                  <text
                    fill="#18181b"
                    fontFamily="Arial, sans-serif"
                    fontSize="19"
                    fontWeight="700"
                    textAnchor="middle"
                    x="140"
                    y="79"
                  >
                    78%
                  </text>
                </svg>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-1">
              {[
                ["Volume", "3,900 L", "text-blue-600"],
                ["Runtime", "18 hrs", "text-zinc-950"],
                ["Updated", "10 sec", "text-zinc-950"],
              ].map(([label, value, tone]) => (
                <div
                  className="rounded-lg border border-zinc-200 bg-white p-3.5"
                  key={label}
                >
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    {label}
                  </p>
                  <p className={`mt-2 text-lg font-semibold ${tone}`}>
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-3 text-xs font-medium text-white">
            <span className="size-2 rounded-full bg-cyan-400" />
            Device
            <span className="mx-1 text-zinc-500">→</span>
            <span className="size-2 rounded-full bg-red-500" />
            API
            <span className="mx-1 text-zinc-500">→</span>
            <span className="size-2 rounded-full bg-blue-400" />
            Dashboard
          </div>
        </div>

        {/* Supporting floating cards */}
        <div className="absolute -bottom-4 -left-6 hidden w-40 rotate-[-4deg] rounded-lg border border-zinc-200 bg-white p-4 shadow-xl shadow-zinc-200/80 sm:block">
          <p className="text-xs font-semibold text-zinc-500">Data status</p>
          <div className="mt-3 flex items-end gap-2">
            {[42, 58, 50, 76, 68, 86].map((height, index) => (
              <span
                className={`w-full rounded-sm ${
                  index === 5 ? "bg-red-500" : "bg-cyan-400"
                }`}
                key={`${height}-${index}`}
                style={{ height: `${height / 2}px` }}
              />
            ))}
          </div>
        </div>

        <div className="absolute -right-5 -top-7 hidden w-44 rotate-3 rounded-lg border border-zinc-200 bg-[#ffdf42] p-4 text-zinc-950 shadow-xl shadow-zinc-200/80 sm:block">
          <p className="text-sm font-semibold">{contextNote.title}</p>
          <p className="mt-2 text-xs leading-5 text-zinc-700">
            {contextNote.description}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AuthShell({
  children,
  contentWidth = "default",
  contextNote = DEFAULT_CONTEXT_NOTE,
  description,
  footerPrompt,
  heading,
}: AuthShellProps) {
  const contentWidthClass =
    contentWidth === "wide" ? "max-w-[36rem]" : "max-w-[27rem]";
  const contentPaddingClass =
    contentWidth === "wide"
      ? "py-5 sm:py-6 lg:py-4"
      : "py-9 sm:py-10 lg:py-8";

  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-100 px-4 py-5 text-zinc-950 sm:px-6">
      {/* Ambient page background */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-55"
        style={{
          backgroundImage:
            "radial-gradient(circle, #d4d4d8 1px, transparent 1.25px)",
          backgroundSize: "16px 16px",
        }}
      />
      <section className="login-shell-enter relative mx-auto grid min-h-[calc(100vh-2.5rem)] w-full max-w-[1320px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-[0_28px_90px_rgba(24,24,27,0.14)] lg:min-h-[760px] lg:grid-cols-[0.9fr_1.1fr]">
        {/* Authentication panel */}
        <div className="flex min-w-0 flex-col px-5 py-6 sm:px-10 sm:py-8 lg:px-14 xl:px-20">
          <header className="flex items-center justify-between gap-4">
            <Link
              aria-label="Back to the FTM home page"
              className="flex items-center gap-3"
              href="/"
            >
              <BrandLogo
                markClassName="size-9"
                priority
                textClassName="text-xl font-semibold tracking-normal"
              />
            </Link>

            <Link
              className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition hover:text-red-600"
              href="/"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">Home</span>
            </Link>
          </header>

          <div
            className={`mx-auto flex w-full flex-1 flex-col justify-center ${contentPaddingClass} ${contentWidthClass}`}
          >
            <h1 className="text-[clamp(2rem,3vw,2.5rem)] font-medium leading-tight tracking-normal text-zinc-950">
              {heading}
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-600 sm:text-[0.95rem]">
              {description}
            </p>

            {children}

            <div className="mt-5 text-center text-xs leading-6 text-zinc-500">
              {footerPrompt}
            </div>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-5 text-[0.72rem] text-zinc-400">
            <span>© 2026 FTM</span>
            <span>FTM Fuel Tank Management Service.</span>
          </footer>
        </div>

        {/* Product context panel */}
        <aside className="relative m-2 hidden min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-[#f5faf8] p-10 text-zinc-950 lg:flex lg:flex-col xl:p-12">
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                "linear-gradient(rgba(24,24,27,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(24,24,27,.08) 1px, transparent 1px)",
              backgroundSize: "38px 38px",
            }}
          />
          <div
            aria-hidden="true"
            className="absolute right-12 top-12 size-3 rounded-full bg-red-500 shadow-[0_0_0_10px_rgba(239,68,68,0.12)]"
          />

          <div className="relative z-10 max-w-xl">
            <h2 className="text-[clamp(2rem,3vw,3rem)] font-medium leading-[1.08] tracking-normal">
              Tank management,
              <span className="block text-red-600">
                clearer in a single screen.
              </span>
            </h2>
            <p className="mt-5 max-w-lg text-sm leading-7 text-zinc-600 sm:text-base">
              Monitor fuel volume, estimate generator runtime, and track
              device data health to support operational follow-up.
            </p>
          </div>

          <MonitoringVisual contextNote={contextNote} />
        </aside>
      </section>
    </main>
  );
}
