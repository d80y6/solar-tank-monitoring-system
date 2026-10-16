import { BrandLogo } from "@/components/brand-logo";

type DashboardRouteLoadingProps = {
  label?: string;
  title?: string;
  description?: string;
};

export function DashboardRouteLoading({
  label = "Loading page",
  title = "Preparing the latest data",
  description = "The system is reading data and preparing the view. The page will open automatically once it is ready.",
}: DashboardRouteLoadingProps) {
  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-[#f5faf8] text-zinc-950">
      <header className="border-b border-zinc-200/70 bg-white/90">
        <div className="mx-auto flex h-16 max-w-[1540px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <BrandLogo
            markClassName="size-9"
            priority
            textClassName="text-lg font-semibold"
          />
          <div className="hidden items-center gap-2 sm:flex">
            <span className="h-9 w-32 animate-pulse rounded-lg bg-zinc-100" />
            <span className="h-9 w-24 animate-pulse rounded-lg bg-zinc-100" />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1540px] px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-600">
            {label}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-normal text-zinc-950 sm:text-3xl">
            {title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            {description}
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <span className="h-24 animate-pulse rounded-lg bg-zinc-50" />
            <span className="h-24 animate-pulse rounded-lg bg-zinc-50" />
            <span className="h-24 animate-pulse rounded-lg bg-zinc-50" />
          </div>
          <div className="mt-4 h-72 animate-pulse rounded-lg bg-zinc-50" />
        </section>
      </div>
    </main>
  );
}
