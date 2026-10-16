"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/client-error-reporter";

type TankDetailErrorProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export default function TankDetailError({
  error,
  unstable_retry,
}: TankDetailErrorProps) {
  useEffect(() => {
    reportClientError({
      digest: error.digest,
      error,
      source: "dashboard.tank-detail.error-boundary",
    });
  }, [error]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f5faf8] px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-3xl rounded-lg border border-red-100 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-600">
          Tank details are not ready
        </p>
        <h1 className="mt-3 break-words text-2xl font-semibold tracking-normal sm:text-3xl">
          Tank details could not be read yet
        </h1>
        <p className="mt-3 break-words text-sm leading-6 text-zinc-600">
          The detail page failed to fetch data from the active storage. Check the
          /api/ready endpoint and make sure the database or memory mode is
          running as configured. If you just changed .env.local, stop and
          restart pnpm dev because env is read when the server process starts.
        </p>
        <p className="mt-3 break-words text-sm leading-6 text-zinc-600">
          The retry button only re-renders after the database, network, or server
          configuration is correct. It cannot power on the database and cannot
          reload .env.local changes.
        </p>

        {error.digest ? (
          <p className="mt-4 rounded-lg bg-zinc-50 px-4 py-3 text-xs font-medium text-zinc-500">
            Error reference: {error.digest}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
          >
            Try again
          </button>
          <a
            href="/api/ready"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-zinc-200 px-5 py-3 text-center text-sm font-semibold text-zinc-800 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            Check /api/ready
          </a>
        </div>
      </section>
    </main>
  );
}
