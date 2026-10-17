"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";

import {
  saveUserSiteScopesAction,
  type AccessScopeActionState,
} from "./actions";

const initialState: AccessScopeActionState = { message: "", status: "idle" };

export type ScopeSiteOption = {
  label: string;
  siteId: string;
};

export function AccessScopeForm({
  csrfToken,
  sites,
  user,
}: {
  csrfToken: string;
  sites: ScopeSiteOption[];
  user: {
    assignedSiteIds: string[];
    fullName: string;
    role: string;
    scopeRole: string;
    userId: string;
    username: string;
  };
}) {
  const [state, formAction, pending] = useActionState(
    saveUserSiteScopesAction,
    initialState,
  );
  const disabled = user.role === "admin";

  return (
    <form
      action={formAction}
      className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
    >
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input name="userId" type="hidden" value={user.userId} />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-zinc-900">
            {user.fullName}{" "}
            <span className="font-normal text-zinc-500">({user.username})</span>
          </p>
          <p className="text-xs text-zinc-500">
            Role: {user.role}
            {disabled
              ? " — administrators always see every location."
              : ` — ${user.assignedSiteIds.length} location(s) assigned.`}
          </p>
        </div>
        <label className="text-xs font-medium text-zinc-600">
          Scope role
          <select
            className="ml-2 h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs text-zinc-900"
            defaultValue={user.scopeRole}
            disabled={disabled}
            name="scopeRole"
          >
            <option value="viewer">viewer</option>
            <option value="operator">operator</option>
          </select>
        </label>
      </div>

      <fieldset
        className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3"
        disabled={disabled}
      >
        <legend className="sr-only">Locations</legend>
        {sites.map((site) => (
          <label
            className="flex items-center gap-2 rounded-lg border border-zinc-100 px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-blue-50/60"
            key={site.siteId}
          >
            <input
              className="size-3.5 accent-blue-600"
              defaultChecked={user.assignedSiteIds.includes(site.siteId)}
              name="siteIds"
              type="checkbox"
              value={site.siteId}
            />
            {site.label}
          </label>
        ))}
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="h-9 min-w-56 flex-1 rounded-lg border border-zinc-200 px-3 text-xs text-zinc-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-600/10"
          disabled={disabled}
          name="note"
          placeholder="Why this access was granted (optional)"
        />
        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled || pending}
          type="submit"
        >
          <Save aria-hidden="true" className="size-4" />
          {pending ? "Saving…" : "Save access"}
        </button>
      </div>

      {state.status !== "idle" && state.message ? (
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
      ) : null}
    </form>
  );
}
