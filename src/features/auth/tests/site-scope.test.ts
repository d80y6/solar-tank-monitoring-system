import { describe, expect, it } from "vitest";

import type {
  Device,
  Reading,
  Site,
  Tank,
} from "@/features/monitoring/types/monitoring";

import {
  describeSiteAccess,
  filterDevicesByAccess,
  filterReadingsByTankIds,
  filterSitesByAccess,
  filterTanksByAccess,
  isSiteAllowed,
  isSiteScopeEnforcementEnabled,
  resolveSiteAccess,
} from "../lib/site-scope";

const site = (id: string): Site => ({
  areaLabel: "Area",
  code: id.toUpperCase(),
  id,
  isActive: true,
  name: `Site ${id}`,
});

const tank = (id: string, siteId: string): Tank => ({
  capacityLiter: 1000,
  consumptionLiterPerHour: 4,
  criticalLevelPercent: 15,
  id,
  isActive: true,
  lowLevelPercent: 30,
  name: `Tank ${id}`,
  sensorMountHeightCm: 120,
  shape: "rectangular",
  siteId,
});

const device = (id: string, siteId: string, tankId: string): Device => ({
  code: id,
  expectedReportIntervalSec: 300,
  id,
  isActive: true,
  label: id,
  siteId,
  tankId,
});

const reading = (id: string, tankId: string): Reading => ({
  deviceId: `device-${tankId}`,
  fillPercent: 50,
  fuelHeightCm: 60,
  id,
  measuredAt: "2026-01-01T00:00:00.000Z",
  receivedAt: "2026-01-01T00:00:00.000Z",
  runtimeHour: 10,
  sensorDistanceCm: 60,
  tankId,
  volumeLiter: 500,
});

describe("site scope enforcement flag", () => {
  it("is off unless explicitly enabled", () => {
    expect(isSiteScopeEnforcementEnabled(undefined)).toBe(false);
    expect(isSiteScopeEnforcementEnabled("")).toBe(false);
    expect(isSiteScopeEnforcementEnabled("false")).toBe(false);
    expect(isSiteScopeEnforcementEnabled("TRUE")).toBe(true);
    expect(isSiteScopeEnforcementEnabled(" true ")).toBe(true);
  });
});

describe("resolveSiteAccess", () => {
  it("never restricts administrators", () => {
    const access = resolveSiteAccess({
      enforcementEnabled: true,
      scopes: [],
      user: { role: "admin" },
    });

    expect(access).toEqual({
      allowedSiteIds: null,
      enforced: false,
      reason: "admin",
    });
  });

  it("does not restrict users while enforcement is disabled", () => {
    const access = resolveSiteAccess({
      enforcementEnabled: false,
      scopes: [{ siteId: "site-a" }],
      user: { role: "user" },
    });

    expect(access.allowedSiteIds).toBeNull();
    expect(access.reason).toBe("enforcement-disabled");
  });

  it("locks a scoped user out when no scope has been assigned", () => {
    const access = resolveSiteAccess({
      enforcementEnabled: true,
      scopes: [],
      user: { role: "user" },
    });

    expect(access).toEqual({
      allowedSiteIds: [],
      enforced: true,
      reason: "no-scope-assigned",
    });
  });

  it("deduplicates assigned locations", () => {
    const access = resolveSiteAccess({
      enforcementEnabled: true,
      scopes: [{ siteId: "site-a" }, { siteId: "site-a" }],
      user: { role: "user" },
    });

    expect(access.allowedSiteIds).toEqual(["site-a"]);
    expect(access.reason).toBe("scoped");
  });
});

describe("access filters", () => {
  const access = resolveSiteAccess({
    enforcementEnabled: true,
    scopes: [{ siteId: "site-a" }],
    user: { role: "user" },
  });

  it("keeps only the allowed sites, tanks, and devices", () => {
    expect(
      filterSitesByAccess(access, [site("site-a"), site("site-b")]).map(
        (item) => item.id,
      ),
    ).toEqual(["site-a"]);
    expect(
      filterTanksByAccess(access, [
        tank("tank-a", "site-a"),
        tank("tank-b", "site-b"),
      ]).map((item) => item.id),
    ).toEqual(["tank-a"]);
    expect(
      filterDevicesByAccess(access, [
        device("dev-a", "site-a", "tank-a"),
        device("dev-b", "site-b", "tank-b"),
      ]).map((item) => item.id),
    ).toEqual(["dev-a"]);
  });

  it("keeps every location for an unrestricted account", () => {
    const unrestricted = resolveSiteAccess({
      enforcementEnabled: false,
      scopes: [],
      user: { role: "user" },
    });

    expect(
      filterSitesByAccess(unrestricted, [site("site-a"), site("site-b")]),
    ).toHaveLength(2);
  });

  it("filters readings by the allowed tank ids", () => {
    const readings = [
      reading("reading-a", "tank-a"),
      reading("reading-b", "tank-b"),
    ];

    expect(
      filterReadingsByTankIds(readings, new Set(["tank-a"])).map(
        (item) => item.id,
      ),
    ).toEqual(["reading-a"]);
  });
});

describe("isSiteAllowed", () => {
  it("accepts any site for unrestricted accounts", () => {
    const access = resolveSiteAccess({
      enforcementEnabled: false,
      scopes: [],
      user: { role: "user" },
    });

    expect(isSiteAllowed(access, "site-z")).toBe(true);
  });

  it("rejects unknown or missing sites for scoped accounts", () => {
    const access = resolveSiteAccess({
      enforcementEnabled: true,
      scopes: [{ siteId: "site-a" }],
      user: { role: "user" },
    });

    expect(isSiteAllowed(access, "site-a")).toBe(true);
    expect(isSiteAllowed(access, "site-z")).toBe(false);
    expect(isSiteAllowed(access, null)).toBe(false);
    expect(isSiteAllowed(access, undefined)).toBe(false);
  });
});

describe("describeSiteAccess", () => {
  it("explains every access reason in operator language", () => {
    expect(
      describeSiteAccess({
        allowedSiteIds: null,
        enforced: false,
        reason: "admin",
      }),
    ).toMatch(/administrator/i);
    expect(
      describeSiteAccess({
        allowedSiteIds: null,
        enforced: false,
        reason: "enforcement-disabled",
      }),
    ).toMatch(/not enforced/i);
    expect(
      describeSiteAccess({
        allowedSiteIds: [],
        enforced: true,
        reason: "no-scope-assigned",
      }),
    ).toMatch(/no location/i);
    expect(
      describeSiteAccess({
        allowedSiteIds: ["site-a", "site-b"],
        enforced: true,
        reason: "scoped",
      }),
    ).toMatch(/2 location/i);
  });
});
