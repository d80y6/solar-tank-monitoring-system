import Link from "next/link";
import type { Metadata } from "next";
import {
  Clock3,
  Filter,
  MailWarning,
  Search,
  ShieldCheck,
  UserCheck,
  UserRound,
  UsersRound,
} from "lucide-react";

import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import type { AuthRole, AuthUserStatus } from "@/features/auth/types";
import { createAdminActionCsrfToken } from "@/features/auth/lib/auth-csrf";
import { requirePageAdmin } from "@/features/auth/lib/auth-guards";
import {
  listAuthUsersForAdmin,
  listPendingAccessRequests,
  type AuthUserDirectoryItem,
} from "@/features/auth/lib/mysql-auth-repository";
import {
  activateAuthUserAction,
  approveAccessRequestAction,
  changeAuthUserRoleAction,
  deleteAuthUserAction,
  disableAuthUserAction,
  rejectAccessRequestAction,
  resendUserVerificationEmailAction,
  revokeAuthUserSessionsAction,
  sendUserPasswordResetAction,
} from "./actions";
import { AdminActionForm, AdminRoleForm } from "./admin-action-controls";

export const metadata: Metadata = {
  title: "User Management | FTM",
  description:
    "FTM user access management for fuel tank management admins.",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const USER_STATUS_OPTIONS: Array<{
  label: string;
  value: AuthUserStatus | "all";
}> = [
  { label: "All statuses", value: "all" },
  { label: "Active", value: "active" },
  { label: "Pending", value: "pending" },
  { label: "Suspended", value: "suspended" },
  { label: "Disabled", value: "disabled" },
];

const ROLE_OPTIONS: Array<{ label: string; value: AuthRole | "all" }> = [
  { label: "All roles", value: "all" },
  { label: "Admin", value: "admin" },
  { label: "User", value: "user" },
];

const VERIFICATION_OPTIONS = [
  { label: "All emails", value: "all" },
  { label: "Verified", value: "verified" },
  { label: "Unverified", value: "unverified" },
] as const;

const SORT_OPTIONS = [
  { label: "Newest created", value: "created_desc" },
  { label: "Last sign-in", value: "last_login_desc" },
  { label: "Name A-Z", value: "name_asc" },
] as const;

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const FILTER_CONTROL_CLASS =
  "h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 outline-none transition hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10";
const FILTER_BUTTON_CLASS =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20";
const FILTER_RESET_CLASS =
  "inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-600/15";

type VerificationFilter = (typeof VERIFICATION_OPTIONS)[number]["value"];
type SortFilter = (typeof SORT_OPTIONS)[number]["value"];

type AdminUsersPageProps = {
  searchParams: Promise<{
    page?: string | string[];
    pageSize?: string | string[];
    q?: string | string[];
    role?: string | string[];
    sort?: string | string[];
    status?: string | string[];
    verification?: string | string[];
  }>;
};

type UsersUrlState = {
  page: number;
  pageSize: number;
  query: string;
  role: AuthRole | "all";
  sort: SortFilter;
  status: AuthUserStatus | "all";
  verification: VerificationFilter;
};

function getParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function getRoleFilter(value: string): AuthRole | "all" {
  return value === "admin" || value === "user" ? value : "all";
}

function getStatusFilter(value: string): AuthUserStatus | "all" {
  return value === "active" ||
    value === "disabled" ||
    value === "pending" ||
    value === "suspended"
    ? value
    : "all";
}

function getVerificationFilter(value: string): VerificationFilter {
  return value === "verified" || value === "unverified" ? value : "all";
}

function getSortFilter(value: string): SortFilter {
  return value === "last_login_desc" || value === "name_asc"
    ? value
    : "created_desc";
}

function getPositiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getPageSize(value: string): number {
  const parsed = getPositiveInteger(value, PAGE_SIZE_OPTIONS[0]);

  return PAGE_SIZE_OPTIONS.includes(parsed as (typeof PAGE_SIZE_OPTIONS)[number])
    ? parsed
    : PAGE_SIZE_OPTIONS[0];
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Jakarta",
    year: "numeric",
  }).format(new Date(value));
}

function getStatusLabel(status: AuthUserStatus) {
  switch (status) {
    case "active":
      return "Active";
    case "disabled":
      return "Disabled";
    case "suspended":
      return "Suspended";
    case "pending":
      return "Pending";
  }
}

function getRoleLabel(role: AuthRole) {
  return role === "admin" ? "Admin" : "User";
}

function getStatusClass(status: AuthUserStatus) {
  switch (status) {
    case "active":
      return "bg-emerald-50 text-emerald-700 ring-emerald-100";
    case "disabled":
      return "bg-red-50 text-red-700 ring-red-100";
    case "suspended":
      return "bg-amber-50 text-amber-700 ring-amber-100";
    case "pending":
      return "bg-zinc-100 text-zinc-700 ring-zinc-200";
  }
}

function getInitials(user: Pick<AuthUserDirectoryItem, "fullName" | "username">) {
  const source = user.fullName.trim() || user.username.trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "U";
}

function getUsersHref(
  current: UsersUrlState,
  overrides: Partial<UsersUrlState>,
) {
  const next = { ...current, ...overrides };
  const params = new URLSearchParams();

  if (next.query) {
    params.set("q", next.query);
  }

  if (next.status !== "all") {
    params.set("status", next.status);
  }

  if (next.role !== "all") {
    params.set("role", next.role);
  }

  if (next.verification !== "all") {
    params.set("verification", next.verification);
  }

  if (next.sort !== "created_desc") {
    params.set("sort", next.sort);
  }

  if (next.pageSize !== PAGE_SIZE_OPTIONS[0]) {
    params.set("pageSize", String(next.pageSize));
  }

  if (next.page > 1) {
    params.set("page", String(next.page));
  }

  const queryString = params.toString();

  return queryString
    ? `/dashboard/admin/users?${queryString}`
    : "/dashboard/admin/users";
}

function getPageNumbers(page: number, pageCount: number) {
  const windowSize = 5;
  const start = Math.max(1, Math.min(page - 2, pageCount - windowSize + 1));
  const end = Math.min(pageCount, start + windowSize - 1);

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function StatusBadge({ status }: { status: AuthUserStatus }) {
  return (
    <span
      className={`inline-flex min-w-[5.5rem] justify-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${getStatusClass(status)}`}
    >
      {getStatusLabel(status)}
    </span>
  );
}

function EmailVerificationBadge({ verified }: { verified: boolean }) {
  return (
    <span
      className={`inline-flex min-w-[7.25rem] justify-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${
        verified
          ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
          : "bg-amber-50 text-amber-700 ring-amber-100"
      }`}
    >
      {verified ? "Verified" : "Unverified"}
    </span>
  );
}

function UserIdentity({
  isCurrentUser,
  user,
}: {
  isCurrentUser: boolean;
  user: AuthUserDirectoryItem;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-sm font-semibold text-blue-700 ring-1 ring-blue-100">
        {getInitials(user)}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-zinc-950">
            {user.fullName}
          </p>
          {isCurrentUser ? (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-100">
              your account
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs leading-5 text-zinc-500">
          @{user.username}
        </p>
      </div>
    </div>
  );
}

function UserActionStack({
  adminId,
  csrfToken,
  user,
}: {
  adminId: string;
  csrfToken: string;
  user: AuthUserDirectoryItem;
}) {
  const isCurrentUser = user.id === adminId;
  const canUseDirectActions = user.status !== "pending";
  const canDisable =
    canUseDirectActions && !isCurrentUser && user.status === "active";
  const canActivate =
    canUseDirectActions && !isCurrentUser && user.status !== "active";
  const canRevokeSessions = canUseDirectActions && !isCurrentUser;
  const canSendReset = canUseDirectActions && !isCurrentUser;
  const canDelete = !isCurrentUser;

  if (isCurrentUser) {
    return (
      <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-500">
        Your own account is locked from admin actions.
      </p>
    );
  }

  return (
    <div className="inline-flex w-max flex-nowrap items-center gap-1.5 whitespace-nowrap">
      {canDisable ? (
        <AdminActionForm
          action={disableAuthUserAction}
          compact
          confirmation={{
            confirmLabel: "Yes, disable",
            description: `${user.fullName} cannot use this account until an admin reactivates it.`,
            eyebrow: "Disable user access",
            title: `Disable ${user.fullName}'s account?`,
            tone: "danger",
          }}
          csrfToken={csrfToken}
          fields={{ targetUserId: user.id }}
          hideMessage
          icon="ban"
          variant="dangerOutline"
        >
          Disable
        </AdminActionForm>
      ) : null}

      {canActivate ? (
        <AdminActionForm
          action={activateAuthUserAction}
          compact
          confirmation={{
            confirmLabel: "Yes, activate",
            description: `${user.fullName} will be able to sign in and use features according to their role again.`,
            eyebrow: "Enable user access",
            title: `Reactivate ${user.fullName}?`,
            tone: "primary",
          }}
          csrfToken={csrfToken}
          fields={{ targetUserId: user.id }}
          hideMessage
          icon="refresh"
          variant="success"
        >
          Activate
        </AdminActionForm>
      ) : null}

      {canRevokeSessions ? (
        <AdminActionForm
          action={revokeAuthUserSessionsAction}
          compact
          confirmation={{
            confirmLabel: "Yes, revoke all sessions",
            description: `${user.fullName} will be signed out of all devices and must sign in again.`,
            eyebrow: "User session security",
            title: `Revoke all sessions for ${user.fullName}?`,
            tone: "warning",
          }}
          csrfToken={csrfToken}
          fields={{ targetUserId: user.id }}
          hideMessage
          icon="logout"
          variant="neutralOutline"
        >
          Revoke sessions
        </AdminActionForm>
      ) : null}

      {!user.emailVerifiedAt ? (
        <AdminActionForm
          action={resendUserVerificationEmailAction}
          compact
          confirmation={{
            confirmLabel: "Yes, send email",
            description: `The system will send a new verification link to ${user.email}.`,
            eyebrow: "Send verification email",
            title: `Send verification to ${user.fullName}?`,
            tone: "primary",
          }}
          csrfToken={csrfToken}
          fields={{ targetUserId: user.id }}
          hideMessage
          icon="send"
          variant="neutralOutline"
        >
          Send verification
        </AdminActionForm>
      ) : null}

      {canSendReset ? (
        <AdminActionForm
          action={sendUserPasswordResetAction}
          compact
          confirmation={{
            confirmLabel: "Yes, send link",
            description: `A password reset link will be sent to ${user.email}. The password does not change until the user completes the process.`,
            eyebrow: "User account recovery",
            title: `Send password reset for ${user.fullName}?`,
            tone: "warning",
          }}
          csrfToken={csrfToken}
          fields={{ targetUserId: user.id }}
          hideMessage
          icon="key"
          variant="neutralOutline"
        >
          Reset password
        </AdminActionForm>
      ) : null}

      {canDelete ? (
        <AdminActionForm
          action={deleteAuthUserAction}
          compact
          confirmation={{
            confirmLabel: "Yes, delete account",
            description: `The ${user.fullName} account will be permanently deleted. This action can only be done if the account has no device request trail.`,
            eyebrow: "Delete user account",
            title: `Delete ${user.fullName}?`,
            tone: "danger",
          }}
          csrfToken={csrfToken}
          fields={{ targetUserId: user.id }}
          hideMessage
          icon="trash"
          variant="dangerOutline"
        >
          Delete
        </AdminActionForm>
      ) : null}
    </div>
  );
}

function SearchField({ query }: { query: string }) {
  return (
    <label className="block">
      <span className="sr-only">Search users</span>
      <span className="relative block">
        <Search
          aria-hidden="true"
          className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
        />
        <input
          className="h-9 w-full rounded-lg border border-zinc-300 bg-white pl-10 pr-3 text-sm font-medium text-zinc-950 outline-none transition placeholder:text-zinc-400 hover:border-zinc-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
          defaultValue={query}
          name="q"
          placeholder="Search name, email, username"
          type="search"
        />
      </span>
    </label>
  );
}

function UserFilterControls({
  pageSize,
  roleFilter,
  sortFilter,
  statusFilter,
  verificationFilter,
}: {
  pageSize: number;
  roleFilter: AuthRole | "all";
  sortFilter: SortFilter;
  statusFilter: AuthUserStatus | "all";
  verificationFilter: VerificationFilter;
}) {
  return (
    <>
      <label className="block">
        <span className="sr-only">Status</span>
        <select
          className={FILTER_CONTROL_CLASS}
          defaultValue={statusFilter}
          name="status"
        >
          {USER_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="sr-only">Role</span>
        <select
          className={FILTER_CONTROL_CLASS}
          defaultValue={roleFilter}
          name="role"
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="sr-only">Verification</span>
        <select
          className={FILTER_CONTROL_CLASS}
          defaultValue={verificationFilter}
          name="verification"
        >
          {VERIFICATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="sr-only">Sort</span>
        <select
          className={FILTER_CONTROL_CLASS}
          defaultValue={sortFilter}
          name="sort"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="sr-only">Per page</span>
        <select
          className={FILTER_CONTROL_CLASS}
          defaultValue={pageSize}
          name="pageSize"
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function PendingAccessRequests({
  accessRequests,
  csrfToken,
}: {
  accessRequests: Awaited<ReturnType<typeof listPendingAccessRequests>>;
  csrfToken: string;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-600">
            Needs review
          </p>
          <h2 className="mt-0.5 text-base font-semibold">
            Pending access requests
          </h2>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-100">
          <Clock3 className="size-4" aria-hidden="true" />
          {accessRequests.length} pending
        </span>
      </div>

      <div className="max-h-64 overflow-y-auto p-2">
        {accessRequests.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
            No new access requests yet.
          </div>
        ) : (
          <div className="grid gap-2">
            {accessRequests.map((request) => (
              <article
                className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,28rem)] lg:items-center"
                key={request.id}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-blue-700 ring-1 ring-zinc-200">
                      <UserRound className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-zinc-950">
                        {request.user.fullName}
                      </h3>
                      <p className="truncate text-xs text-zinc-500">
                        {request.user.email} / @{request.user.username}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-zinc-600 sm:grid-cols-3">
                    <p>
                      Role:{" "}
                      <span className="font-semibold text-zinc-950">
                        {getRoleLabel(request.requestedRole)}
                      </span>
                    </p>
                    <p>Submitted: {formatDate(request.createdAt)}</p>
                    <p>
                      Email:{" "}
                      {request.user.emailVerifiedAt
                        ? "verified"
                        : "unverified"}
                    </p>
                  </div>
                  {request.accessReason ? (
                    <p className="mt-2 truncate text-sm text-zinc-600">
                      <span className="font-semibold text-zinc-950">
                        Reason:
                      </span>{" "}
                      {request.accessReason}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  <AdminActionForm
                    action={approveAccessRequestAction}
                    className="min-w-0"
                    confirmation={{
                      confirmLabel: "Yes, approve access",
                      description: `${request.user.fullName} will gain access as ${getRoleLabel(request.requestedRole)} and can sign in to the system once the account requirements are met.`,
                      eyebrow: "User access approval",
                      title: `Approve ${request.user.fullName}'s request?`,
                      tone: "primary",
                    }}
                    csrfToken={csrfToken}
                    fields={{ accessRequestId: request.id }}
                    icon="check"
                    variant="primary"
                  >
                    Approve
                  </AdminActionForm>
                  <AdminActionForm
                    action={rejectAccessRequestAction}
                    className="min-w-0"
                    confirmation={{
                      confirmLabel: "Yes, reject request",
                      description: `The access request from ${request.user.fullName} will be rejected and cannot be processed as an active request.`,
                      eyebrow: "Reject user access",
                      title: `Reject ${request.user.fullName}'s request?`,
                      tone: "danger",
                    }}
                    csrfToken={csrfToken}
                    fields={{ accessRequestId: request.id }}
                    icon="x"
                    variant="dangerOutline"
                  >
                    Reject
                  </AdminActionForm>
                  {!request.user.emailVerifiedAt ? (
                    <AdminActionForm
                      action={resendUserVerificationEmailAction}
                      className="col-span-2 min-w-0 sm:col-span-1"
                      confirmation={{
                        confirmLabel: "Yes, send email",
                        description: `The system will send a new verification link to ${request.user.email}.`,
                        eyebrow: "Send verification email",
                        title: `Send verification to ${request.user.fullName}?`,
                        tone: "primary",
                      }}
                      csrfToken={csrfToken}
                      fields={{ targetUserId: request.user.id }}
                      icon="send"
                      variant="neutralOutline"
                    >
                      Verify
                    </AdminActionForm>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default async function AdminUsersPage({
  searchParams,
}: AdminUsersPageProps) {
  const admin = await requirePageAdmin();
  const params = await searchParams;
  const query = getParam(params.q).trim();
  const statusFilter = getStatusFilter(getParam(params.status));
  const roleFilter = getRoleFilter(getParam(params.role));
  const verificationFilter = getVerificationFilter(
    getParam(params.verification),
  );
  const sortFilter = getSortFilter(getParam(params.sort));
  const pageSize = getPageSize(getParam(params.pageSize));
  const requestedPage = getPositiveInteger(getParam(params.page), 1);
  const csrfToken = createAdminActionCsrfToken(admin.sessionId);
  const [accessRequests, directory] = await Promise.all([
    listPendingAccessRequests(),
    listAuthUsersForAdmin({
      page: requestedPage,
      pageSize,
      query,
      role: roleFilter,
      sort: sortFilter,
      status: statusFilter,
      verification: verificationFilter,
    }),
  ]);
  const urlState: UsersUrlState = {
    page: directory.page,
    pageSize: directory.pageSize,
    query,
    role: roleFilter,
    sort: sortFilter,
    status: statusFilter,
    verification: verificationFilter,
  };
  const showingStart =
    directory.filteredCount === 0
      ? 0
      : (directory.page - 1) * directory.pageSize + 1;
  const showingEnd = Math.min(
    directory.filteredCount,
    directory.page * directory.pageSize,
  );
  const pageNumbers = getPageNumbers(directory.page, directory.pageCount);
  const activeFilterCount = [
    statusFilter !== "all",
    roleFilter !== "all",
    verificationFilter !== "all",
    sortFilter !== "created_desc",
    directory.pageSize !== PAGE_SIZE_OPTIONS[0],
  ].filter(Boolean).length;

  return (
    <main className="min-h-screen bg-[#f5faf8] text-zinc-950">
      <DashboardHeader
        navItems={[
          { href: "/dashboard", label: "Tank Management" },
          { current: true, label: "Manajemen Pengguna" },
          {
            href: "/dashboard/admin/device-requests",
            label: "Review requests",
          },
          { href: "/dashboard/admin/audit", label: "Security audit" },
        ]}
        user={admin}
      />

      <div className="mx-auto flex max-w-[1540px] flex-col gap-3 px-4 py-3 pb-20 sm:px-6 lg:px-8 lg:pb-6">
        <section className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-600">
                User management
              </p>
              <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
                Users and admin access
              </h1>
            </div>

            <div className="flex flex-wrap gap-2 xl:justify-end">
              {[
                {
                  icon: UsersRound,
                  label: "Total",
                  value: directory.counts.total,
                },
                {
                  icon: UserCheck,
                  label: "Aktif",
                  value: directory.counts.active,
                },
                {
                  icon: Clock3,
                  label: "Pending",
                  value: directory.counts.pending,
                },
                {
                  icon: ShieldCheck,
                  label: "Admin",
                  value: directory.counts.admin,
                },
                {
                  icon: MailWarning,
                  label: "Email",
                  value: directory.counts.unverified,
                },
              ].map((item) => {
                const Icon = item.icon;

                return (
                  <div
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3"
                    key={item.label}
                  >
                    <span className="grid size-7 place-items-center rounded-lg bg-white text-blue-700 ring-1 ring-zinc-200">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">
                      {item.label}
                    </span>
                    <span className="text-sm font-semibold text-zinc-950">
                      {item.value}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <PendingAccessRequests
          accessRequests={accessRequests}
          csrfToken={csrfToken}
        />

        <section className="rounded-lg border border-zinc-200 bg-white p-2 shadow-sm">
          <form
            action="/dashboard/admin/users"
            className="grid gap-2 xl:hidden"
            method="get"
          >
            <input name="page" type="hidden" value="1" />
            <SearchField query={query} />

            <details className="group rounded-lg border border-zinc-200 bg-zinc-50">
              <summary className="flex h-9 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-semibold text-zinc-800 [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-2">
                  <Filter className="size-4 text-blue-700" aria-hidden="true" />
                  Filters and sorting
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-500 ring-1 ring-zinc-200">
                  {activeFilterCount > 0
                    ? `${activeFilterCount} active`
                    : "Open"}
                </span>
              </summary>
              <div className="grid gap-2 border-t border-zinc-200 p-2">
                <UserFilterControls
                  pageSize={directory.pageSize}
                  roleFilter={roleFilter}
                  sortFilter={sortFilter}
                  statusFilter={statusFilter}
                  verificationFilter={verificationFilter}
                />
              </div>
            </details>

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button className={FILTER_BUTTON_CLASS} type="submit">
                <Filter className="size-4" aria-hidden="true" />
                Apply
              </button>
              <Link className={FILTER_RESET_CLASS} href="/dashboard/admin/users">
                Reset
              </Link>
            </div>
          </form>

          <form
            action="/dashboard/admin/users"
            className="hidden gap-2 xl:grid xl:grid-cols-[minmax(16rem,1fr)_10rem_9rem_11rem_10rem_8rem_auto_auto] xl:items-center"
            method="get"
          >
            <input name="page" type="hidden" value="1" />
            <SearchField query={query} />
            <UserFilterControls
              pageSize={directory.pageSize}
              roleFilter={roleFilter}
              sortFilter={sortFilter}
              statusFilter={statusFilter}
              verificationFilter={verificationFilter}
            />
            <button className={FILTER_BUTTON_CLASS} type="submit">
              <Filter className="size-4" aria-hidden="true" />
              Apply
            </button>
            <Link className={FILTER_RESET_CLASS} href="/dashboard/admin/users">
              Reset
            </Link>
          </form>
        </section>

        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-600">
                User list
              </p>
              <h2 className="mt-0.5 text-base font-semibold">
                {showingStart}-{showingEnd} of {directory.filteredCount} accounts
              </h2>
            </div>
            <span className="w-fit rounded-full bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200">
              Page {directory.page} of {directory.pageCount}
            </span>
          </div>

          {directory.users.length === 0 ? (
            <div className="grid min-h-64 place-items-center p-6 text-center">
              <div>
                <p className="text-sm font-semibold text-zinc-950">
                  No users match.
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  Change the keyword or reset filters to see all accounts.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1180px] text-left text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                    <tr>
                      <th className="w-[22%] px-4 py-2.5">User</th>
                      <th className="w-[22%] px-4 py-2.5">Email</th>
                      <th className="w-[13rem] px-4 py-2.5">Role</th>
                      <th className="w-[7rem] px-4 py-2.5">Status</th>
                      <th className="w-[9rem] px-4 py-2.5">Sign in</th>
                      <th className="w-[9rem] px-4 py-2.5">Created</th>
                      <th className="w-[14rem] min-w-[14rem] px-4 py-2.5">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200">
                    {directory.users.map((user) => {
                      const isCurrentUser = user.id === admin.id;
                      const canSaveRole =
                        user.status !== "pending" && !isCurrentUser;

                      return (
                        <tr
                          className="align-middle transition hover:bg-blue-50/40"
                          key={user.id}
                        >
                          <td className="px-4 py-2.5">
                            <UserIdentity
                              isCurrentUser={isCurrentUser}
                              user={user}
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <p className="max-w-56 truncate text-sm font-medium text-zinc-800">
                              {user.email}
                            </p>
                            <div className="mt-1">
                              <EmailVerificationBadge
                                verified={Boolean(user.emailVerifiedAt)}
                              />
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <AdminRoleForm
                              action={changeAuthUserRoleAction}
                              compact
                              csrfToken={csrfToken}
                              currentRole={user.role}
                              disabled={!canSaveRole}
                              targetUserId={user.id}
                              targetUserName={user.fullName}
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusBadge status={user.status} />
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-xs text-zinc-600">
                            {formatDate(user.lastLoginAt)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-xs text-zinc-600">
                            {formatDate(user.createdAt)}
                          </td>
                          <td className="min-w-[14rem] whitespace-nowrap px-4 py-2.5">
                            <UserActionStack
                              adminId={admin.id}
                              csrfToken={csrfToken}
                              user={user}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 p-3 lg:hidden">
                {directory.users.map((user) => {
                  const isCurrentUser = user.id === admin.id;
                  const canSaveRole =
                    user.status !== "pending" && !isCurrentUser;

                  return (
                    <article
                      className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm"
                      key={user.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <UserIdentity
                          isCurrentUser={isCurrentUser}
                          user={user}
                        />
                        <StatusBadge status={user.status} />
                      </div>

                      <div className="mt-3 min-w-0">
                        <p className="break-all text-sm font-medium text-zinc-800">
                          {user.email}
                        </p>
                        <div className="mt-1.5">
                          <EmailVerificationBadge
                            verified={Boolean(user.emailVerifiedAt)}
                          />
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-zinc-200 pt-3 text-xs text-zinc-600">
                        <div>
                          <p className="font-semibold uppercase tracking-[0.14em] text-zinc-400">
                            Login
                          </p>
                          <p className="mt-1 leading-5">
                            {formatDate(user.lastLoginAt)}
                          </p>
                        </div>
                        <div>
                          <p className="font-semibold uppercase tracking-[0.14em] text-zinc-400">
                            Dibuat
                          </p>
                          <p className="mt-1 leading-5">
                            {formatDate(user.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 border-t border-zinc-200 pt-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                          Role
                        </p>
                        <div className="mt-2">
                          <AdminRoleForm
                            action={changeAuthUserRoleAction}
                            csrfToken={csrfToken}
                            currentRole={user.role}
                            disabled={!canSaveRole}
                            targetUserId={user.id}
                            targetUserName={user.fullName}
                          />
                        </div>
                      </div>

                      <div className="mt-3 border-t border-zinc-200 pt-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                          Actions
                        </p>
                        <div className="mt-2">
                          <UserActionStack
                            adminId={admin.id}
                            csrfToken={csrfToken}
                            user={user}
                          />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}

          <div className="grid gap-3 border-t border-zinc-200 px-4 pb-8 pt-3 text-center sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:pb-5 sm:text-left lg:pb-4">
            <p className="text-sm text-zinc-500 sm:justify-self-start">
              Showing {showingStart}-{showingEnd} of{" "}
              {directory.filteredCount} results.
            </p>
            <nav
              aria-label="User pagination"
              className="flex max-w-full flex-wrap items-center justify-center gap-2 sm:justify-self-center"
            >
              <Link
                aria-disabled={directory.page <= 1}
                className={`inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-600/15 ${
                  directory.page <= 1
                    ? "pointer-events-none border-zinc-100 bg-zinc-50 text-zinc-300"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
                href={getUsersHref(urlState, {
                  page: Math.max(1, directory.page - 1),
                })}
              >
                Previous
              </Link>

              {pageNumbers.map((pageNumber) => (
                <Link
                  aria-current={
                    pageNumber === directory.page ? "page" : undefined
                  }
                  className={`grid size-9 place-items-center rounded-lg text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/20 ${
                    pageNumber === directory.page
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-600/15"
                      : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                  href={getUsersHref(urlState, { page: pageNumber })}
                  key={pageNumber}
                >
                  {pageNumber}
                </Link>
              ))}

              <Link
                aria-disabled={directory.page >= directory.pageCount}
                className={`inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-600/15 ${
                  directory.page >= directory.pageCount
                    ? "pointer-events-none border-zinc-100 bg-zinc-50 text-zinc-300"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
                href={getUsersHref(urlState, {
                  page: Math.min(directory.pageCount, directory.page + 1),
                })}
              >
                Next
              </Link>
            </nav>
            <span aria-hidden="true" className="hidden sm:block" />
          </div>
        </section>
      </div>
    </main>
  );
}
