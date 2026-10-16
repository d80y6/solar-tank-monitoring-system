import type { Metadata } from "next";
import { Mail, MapPin, Send, ShieldCheck } from "lucide-react";

import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { requirePageUser } from "@/features/auth/lib/auth-guards";
import { ContactMessageTemplate } from "./contact-message-template";

export const metadata: Metadata = {
  title: "Kontak Operasional | FTM",
  description:
    "FTM operational contacts for coordinating fuel tank management assistance.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const contactItems = [
  {
    href: "https://t.me/Astraata",
    icon: Send,
    label: "ID Telegram",
    value: "@Astraata",
  },
  {
    href: "mailto:cmesurolajang@gmail.com",
    icon: Mail,
    label: "Email",
    value: "cmesurolajang@gmail.com",
  },
  {
    icon: MapPin,
    label: "Address",
    value: "STO Pasuruan",
  },
];

function formatRole(role: string) {
  return role === "admin" ? "Admin" : "User";
}

function buildContactMessage({
  email,
  fullName,
  role,
  username,
}: {
  email: string;
  fullName: string;
  role: string;
  username: string;
}) {
  return [
    "Hello Mr. Astra, I need help with FTM.",
    "",
    `Nama: ${fullName}`,
    `Username: ${username}`,
    `Email: ${email}`,
    `Account role: ${formatRole(role)}`,
    "Related page: /dashboard/contact",
    "",
    "Need/issue:",
    "- ",
    "",
    "Related STO/tank/device:",
    "- ",
    "",
    "Steps already tried:",
    "- ",
    "",
    "Time of incident:",
    "- ",
  ].join("\n");
}

export default async function DashboardContactPage() {
  const user = await requirePageUser();
  const contactMessage = buildContactMessage({
    email: user.email,
    fullName: user.fullName || user.email,
    role: user.role,
    username: user.username,
  });

  return (
    <main className="min-h-screen overflow-hidden bg-[#f5faf8] text-zinc-950">
      <DashboardHeader
        navItems={[
          { href: "/dashboard", label: "Tank Management" },
          { current: true, label: "Contact" },
        ]}
        user={user}
      />

      <section className="relative flex min-h-[calc(100dvh-4rem)] items-center justify-center overflow-hidden px-4 py-4 sm:px-6 lg:px-8">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(circle, #dce3ea 1px, transparent 1.35px)",
            backgroundSize: "14px 14px",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-white via-[#f5faf8]/95 to-blue-50/70" />

        {/* Contact card */}
        <div className="login-shell-enter relative mx-auto w-full max-w-4xl rounded-3xl border border-zinc-200 bg-white p-5 text-center shadow-[0_28px_90px_rgba(24,24,27,0.12)] sm:p-7 lg:p-8">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-blue-50 text-blue-700 ring-1 ring-blue-100">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </div>

          <p className="mt-5 text-sm font-semibold uppercase tracking-[0.18em] text-red-600">
            Operational contacts
          </p>
          <h1 className="mx-auto mt-2 max-w-2xl text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl lg:text-4xl">
            FTM help information
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-zinc-500 sm:text-base">
            A short channel for access coordination, operational data
            clarification, and STO area IoT device follow-up.
          </p>

          <div className="mt-6 grid gap-3 text-left sm:grid-cols-3">
            {contactItems.map(({ href, icon: Icon, label, value }) => {
              const content = (
                <>
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-zinc-500">
                      {label}
                    </span>
                    <span className="mt-1 block truncate text-base font-semibold text-zinc-950">
                      {value}
                    </span>
                  </span>
                </>
              );

              if (href) {
                return (
                  <a
                    className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-blue-200 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15 sm:flex-col sm:items-start"
                    href={href}
                    key={label}
                    rel="noreferrer"
                    target={href.startsWith("http") ? "_blank" : undefined}
                  >
                    {content}
                  </a>
                );
              }

              return (
                <div
                  className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:flex-col sm:items-start"
                  key={label}
                >
                  {content}
                </div>
              );
            })}
          </div>

          <ContactMessageTemplate
            message={contactMessage}
            telegramHref="https://t.me/Astraata"
          />
        </div>
      </section>
    </main>
  );
}
