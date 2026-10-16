import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";

import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import { listAuthAuditEvents } from "@/features/auth/lib/mysql-auth-repository";

export const metadata: Metadata = {
  title: "Security Audit | FTM",
  description: "FTM account security audit log for administrators.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

function formatMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "-";
  }

  return JSON.stringify(metadata);
}

export default async function AdminAuditPage() {
  const admin = await requirePageAdmin();
  const events = await listAuthAuditEvents();

  return (
    <main className="min-h-screen bg-[#f5faf8] text-zinc-950">
      <DashboardHeader
        navItems={[
          { href: "/dashboard", label: "Tank Management" },
          { href: "/dashboard/admin/users", label: "User Management" },
          { href: "/dashboard/admin/alerts", label: "Alert Centre" },
          { href: "/dashboard/admin/devices", label: "Device Registry" },
          { current: true, label: "Security Audit" },
        ]}
        user={admin}
      />

      <div className="mx-auto flex max-w-[1540px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-100">
              <ClipboardList className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold uppercase text-zinc-500">
                Security audit
              </p>
              <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">
                Security activity log
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                Records of sign-ins, OTPs, password resets, role changes,
                activations, and other account security events.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-separate border-spacing-y-2 text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr className="bg-zinc-50" key={event.id}>
                    <td className="rounded-l-lg px-3 py-3 text-zinc-600">
                      {formatDate(event.createdAt)}
                    </td>
                    <td className="px-3 py-3 font-semibold text-zinc-950">
                      {event.eventType}
                    </td>
                    <td className="px-3 py-3 text-zinc-600">
                      {event.actorUserId ?? "-"}
                    </td>
                    <td className="px-3 py-3 text-zinc-600">
                      {event.targetUserId ?? "-"}
                    </td>
                    <td className="rounded-r-lg px-3 py-3 text-zinc-600">
                      <span className="block max-w-xl break-all">
                        {formatMetadata(event.metadata)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
