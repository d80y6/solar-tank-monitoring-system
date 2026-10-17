import {
  isSiteScopeEnforcementEnabled,
  resolveSiteAccess,
  type SiteAccess,
} from "@/features/auth/lib/site-scope";
import { listSiteScopesForUserFromMysql } from "@/features/auth/lib/mysql-site-scope-repository";
import type { AuthSessionUser } from "@/features/auth/types";
import { createLogger } from "@/lib/logger";

import type { Reading } from "../types/monitoring";
import {
  getMonitoringReferenceDataWithSource,
  type MonitoringReferenceData,
  type MonitoringRegistrySource,
} from "./monitoring-registry";
import {
  getMonitoringStorageDriver,
  listLatestMonitoringReadingsByTankWithSource,
  type MonitoringStorageSource,
} from "./monitoring-storage";

const log = createLogger({ module: "site-scope" });

/**
 * Resolves which locations an account may read.
 *
 * Scope rows are only read from MySQL, which is where accounts live. When the
 * scope table is unavailable (memory storage or a pre-migration environment)
 * the account keeps its previous unrestricted behaviour and the degradation is
 * logged instead of locking users out.
 */
export async function resolveSiteAccessForUser(
  user: Pick<AuthSessionUser, "id" | "role">,
  {
    enforcementEnabled = isSiteScopeEnforcementEnabled(),
  }: { enforcementEnabled?: boolean } = {},
): Promise<SiteAccess> {
  if (user.role === "admin" || !enforcementEnabled) {
    return resolveSiteAccess({ enforcementEnabled, scopes: [], user });
  }

  if (getMonitoringStorageDriver() !== "mysql") {
    log.warn("site-scope.storage-not-mysql", { userId: user.id });

    return resolveSiteAccess({ enforcementEnabled: false, scopes: [], user });
  }

  try {
    const scopes = await listSiteScopesForUserFromMysql(user.id);

    return resolveSiteAccess({ enforcementEnabled, scopes, user });
  } catch (error) {
    log.error("site-scope.lookup-failed", { error, userId: user.id });

    return resolveSiteAccess({ enforcementEnabled: false, scopes: [], user });
  }
}

export type ScopedReferenceResult = {
  access: SiteAccess;
  reference: MonitoringReferenceData;
  source: MonitoringRegistrySource;
};

export async function getScopedMonitoringReference(
  user: Pick<AuthSessionUser, "id" | "role">,
): Promise<ScopedReferenceResult> {
  const [access, referenceResult] = await Promise.all([
    resolveSiteAccessForUser(user),
    getMonitoringReferenceDataWithSource(),
  ]);
  const { reference } = referenceResult;

  if (access.allowedSiteIds === null) {
    return { access, reference, source: referenceResult.source };
  }

  const allowed = new Set(access.allowedSiteIds);
  const sites = reference.sites.filter((site) => allowed.has(site.id));
  const tanks = reference.tanks.filter((tank) => allowed.has(tank.siteId));
  const tankIds = new Set(tanks.map((tank) => tank.id));
  const devices = reference.devices.filter((device) =>
    tankIds.has(device.tankId),
  );

  return {
    access,
    reference: { devices, sites, tanks },
    source: referenceResult.source,
  };
}

export type ScopedReadingsResult = {
  access: SiteAccess;
  readings: Reading[];
  source: MonitoringStorageSource;
};

export async function getScopedLatestReadings(
  user: Pick<AuthSessionUser, "id" | "role">,
): Promise<ScopedReadingsResult> {
  const [access, referenceResult, readingsResult] = await Promise.all([
    resolveSiteAccessForUser(user),
    getMonitoringReferenceDataWithSource(),
    listLatestMonitoringReadingsByTankWithSource(),
  ]);

  if (access.allowedSiteIds === null) {
    return {
      access,
      readings: readingsResult.readings,
      source: readingsResult.source,
    };
  }

  const allowed = new Set(access.allowedSiteIds);
  const tankIds = new Set(
    referenceResult.reference.tanks
      .filter((tank) => allowed.has(tank.siteId))
      .map((tank) => tank.id),
  );

  return {
    access,
    readings: readingsResult.readings.filter((reading) =>
      tankIds.has(reading.tankId),
    ),
    source: readingsResult.source,
  };
}

/**
 * True when the account may read a specific tank. Used by the tank routes so a
 * direct URL or API call cannot bypass the location restriction.
 */
export async function canUserAccessTank(
  user: Pick<AuthSessionUser, "id" | "role">,
  tankId: string,
): Promise<boolean> {
  const access = await resolveSiteAccessForUser(user);

  if (access.allowedSiteIds === null) {
    return true;
  }

  const referenceResult = await getMonitoringReferenceDataWithSource();
  const tank = referenceResult.reference.tanks.find((item) => item.id === tankId);

  return Boolean(tank && access.allowedSiteIds.includes(tank.siteId));
}
