import type { Device, Reading, Site, Tank } from "@/features/monitoring/types/monitoring";

import type { AuthSafeUser } from "../types";

export type SiteScopeRole = "viewer" | "operator";

export type SiteScope = {
  id: string;
  userId: string;
  siteId: string;
  scopeRole: SiteScopeRole;
  note: string | null;
  grantedByUserId: string | null;
  createdAt: string;
};

/**
 * Whether per-location restriction is enforced in this environment.
 *
 * Off by default so existing deployments keep working while an administrator
 * assigns scopes; turn it on with AUTH_ENFORCE_SITE_SCOPES=true once every
 * non-admin account has at least one scope.
 */
export function isSiteScopeEnforcementEnabled(
  envValue = process.env.AUTH_ENFORCE_SITE_SCOPES,
): boolean {
  return envValue?.trim().toLowerCase() === "true";
}

export type SiteAccess = {
  /** `null` means "every location" (unrestricted). */
  allowedSiteIds: string[] | null;
  enforced: boolean;
  reason: "admin" | "enforcement-disabled" | "scoped" | "no-scope-assigned";
};

export function resolveSiteAccess({
  enforcementEnabled,
  scopes,
  user,
}: {
  enforcementEnabled: boolean;
  scopes: Pick<SiteScope, "siteId">[];
  user: Pick<AuthSafeUser, "role">;
}): SiteAccess {
  if (user.role === "admin") {
    return { allowedSiteIds: null, enforced: false, reason: "admin" };
  }

  if (!enforcementEnabled) {
    return {
      allowedSiteIds: null,
      enforced: false,
      reason: "enforcement-disabled",
    };
  }

  const allowedSiteIds = Array.from(
    new Set(scopes.map((scope) => scope.siteId).filter(Boolean)),
  );

  if (allowedSiteIds.length === 0) {
    return { allowedSiteIds: [], enforced: true, reason: "no-scope-assigned" };
  }

  return { allowedSiteIds, enforced: true, reason: "scoped" };
}

export function isSiteAllowed(
  access: SiteAccess,
  siteId: string | null | undefined,
): boolean {
  if (access.allowedSiteIds === null) {
    return true;
  }

  if (!siteId) {
    return false;
  }

  return access.allowedSiteIds.includes(siteId);
}

export function filterSitesByAccess(
  access: SiteAccess,
  sites: Site[],
): Site[] {
  if (access.allowedSiteIds === null) {
    return sites;
  }

  return sites.filter((site) => access.allowedSiteIds!.includes(site.id));
}

export function filterTanksByAccess(
  access: SiteAccess,
  tanks: Tank[],
): Tank[] {
  if (access.allowedSiteIds === null) {
    return tanks;
  }

  return tanks.filter((tank) => access.allowedSiteIds!.includes(tank.siteId));
}

export function filterDevicesByAccess(
  access: SiteAccess,
  devices: Device[],
): Device[] {
  if (access.allowedSiteIds === null) {
    return devices;
  }

  return devices.filter((device) => access.allowedSiteIds!.includes(device.siteId));
}

export function filterReadingsByTankIds(
  readings: Reading[],
  tankIds: Set<string>,
): Reading[] {
  return readings.filter((reading) => tankIds.has(reading.tankId));
}

export function describeSiteAccess(access: SiteAccess): string {
  switch (access.reason) {
    case "admin":
      return "Administrator: access to every location.";
    case "enforcement-disabled":
      return "Per-location restriction is not enforced in this environment.";
    case "no-scope-assigned":
      return "No location has been assigned to this account yet. Contact an administrator.";
    default:
      return `Access limited to ${access.allowedSiteIds?.length ?? 0} location(s).`;
  }
}
