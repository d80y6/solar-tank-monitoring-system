import { BrandLogo } from "@/components/brand-logo";

export default function LoginLoading() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-100 px-4 py-5 text-zinc-950 sm:px-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-55"
        style={{
          backgroundImage:
            "radial-gradient(circle, #d4d4d8 1px, transparent 1.25px)",
          backgroundSize: "16px 16px",
        }}
      />
      <section className="relative mx-auto grid min-h-[calc(100vh-2.5rem)] w-full max-w-[1320px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-[0_28px_90px_rgba(24,24,27,0.14)] lg:min-h-[760px] lg:grid-cols-[0.9fr_1.1fr]">
        <div className="flex min-w-0 flex-col px-5 py-6 sm:px-10 sm:py-8 lg:px-14 xl:px-20">
          <header className="flex items-center justify-between gap-4">
            <BrandLogo
              markClassName="size-9"
              priority
              textClassName="text-xl font-semibold tracking-normal"
            />
            <span className="h-5 w-20 animate-pulse rounded bg-zinc-100" />
          </header>

          <div className="mx-auto flex w-full max-w-[27rem] flex-1 flex-col justify-center py-9 sm:py-10 lg:py-8">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-600">
              Signing in
            </p>
            <h1 className="mt-3 text-[clamp(2rem,3vw,2.5rem)] font-medium leading-tight tracking-normal text-zinc-950">
              Preparing the sign-in page
            </h1>
            <p className="mt-4 text-sm leading-7 text-zinc-600 sm:text-[0.95rem]">
              The system is checking your session and preparing dashboard access.
            </p>

            <div className="mt-7 space-y-4">
              <div className="space-y-2">
                <span className="block h-4 w-36 animate-pulse rounded bg-zinc-100" />
                <span className="block h-12 w-full animate-pulse rounded-lg bg-zinc-100" />
              </div>
              <div className="space-y-2">
                <span className="block h-4 w-28 animate-pulse rounded bg-zinc-100" />
                <span className="block h-12 w-full animate-pulse rounded-lg bg-zinc-100" />
              </div>
              <span className="block h-12 w-full animate-pulse rounded-lg bg-blue-100" />
            </div>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-5 text-[0.72rem] text-zinc-400">
            <span>© 2026 FTM</span>
            <span>FTM Fuel Tank Management Service.</span>
          </footer>
        </div>

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
          <div className="relative z-10 max-w-xl">
            <span className="block h-10 w-72 animate-pulse rounded bg-white" />
            <span className="mt-4 block h-10 w-56 animate-pulse rounded bg-white" />
            <span className="mt-6 block h-24 w-full max-w-lg animate-pulse rounded bg-white" />
          </div>
          <div className="mt-10 h-80 w-full animate-pulse rounded-lg border border-zinc-200 bg-white" />
        </aside>
      </section>
    </main>
  );
}
