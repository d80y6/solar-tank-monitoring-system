import type { Metadata } from "next";
import { MapPin, Pencil, UserRound } from "lucide-react";

import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { requirePageUser } from "@/features/auth/lib/auth-guards";
import type { AuthSafeUser } from "@/features/auth/types";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = {
  title: "Profile | FTM",
  description:
    "FTM account profile page for viewing and updating user data.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROFILE_LOCATION = {
  country: "Indonesia",
  cityState: "Pasuruan, Jawa Timur",
  label: "Telkom Pasuruan, Jawa Timur",
};

function getAvatarLabel(user: Pick<AuthSafeUser, "fullName" | "username">) {
  const nameParts = user.fullName
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);

  if (nameParts.length >= 2) {
    return `${nameParts[0][0] ?? ""}${nameParts[1][0] ?? ""}`.toUpperCase();
  }

  return (nameParts[0]?.slice(0, 2) || user.username.slice(0, 2) || "ST")
    .toUpperCase()
    .slice(0, 2);
}

function getRoleLabel(role: AuthSafeUser["role"]) {
  return role === "admin" ? "Admin" : "User";
}

function EditAnchor({ href = "#personal-information" }: { href?: string }) {
  return (
    <a
      className="inline-flex h-9 items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/15"
      href={href}
    >
      Edit
      <Pencil className="size-4" aria-hidden="true" />
    </a>
  );
}

function InfoValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-zinc-400">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-zinc-950 sm:text-base">
        {value}
      </dd>
    </div>
  );
}

export default async function ProfilePage() {
  const user = await requirePageUser();
  const avatarLabel = getAvatarLabel(user);

  return (
    <main className="min-h-screen bg-[#f5faf8] text-zinc-950">
      <DashboardHeader
        navItems={[{ href: "/dashboard", label: "Tank Management" }]}
        user={user}
      />

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        {/* Profile summary card */}
        <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-5">
              <div className="relative grid size-24 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-3xl font-semibold text-white shadow-sm ring-1 ring-zinc-200">
                {avatarLabel}
                <span className="absolute bottom-1 right-1 grid size-7 place-items-center rounded-full bg-white text-blue-700 shadow-sm ring-1 ring-blue-100">
                  <UserRound className="size-3.5" aria-hidden="true" />
                </span>
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">
                  {user.fullName}
                </h1>
                <p className="mt-1 text-base font-semibold text-zinc-700">
                  {getRoleLabel(user.role)}
                </p>
                <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm font-medium text-zinc-400">
                  <MapPin className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{PROFILE_LOCATION.label}</span>
                </p>
              </div>
            </div>
            <div className="self-start sm:self-center">
              <EditAnchor />
            </div>
          </div>
        </section>

        <ProfileForm user={user} />

        {/* Work location card */}
        <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">
              Work Location
            </h2>
            <EditAnchor />
          </div>
          <dl className="mt-7 grid gap-x-12 gap-y-7 sm:grid-cols-2">
            <InfoValue label="Country" value={PROFILE_LOCATION.country} />
            <InfoValue label="City/Area" value={PROFILE_LOCATION.cityState} />
          </dl>
        </section>
      </div>
    </main>
  );
}
