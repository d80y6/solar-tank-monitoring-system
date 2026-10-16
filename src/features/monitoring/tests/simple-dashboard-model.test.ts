import { describe, expect, it } from "vitest";
import {
  createSimpleDashboardSites,
  filterSimpleDashboardSites,
  getSimpleDashboardAreas,
  getSimpleDashboardRegionals,
  getSimpleDashboardSummary,
  getSimpleDashboardWilayahs,
  SIMPLE_DASHBOARD_ALL_AREAS,
  SIMPLE_DASHBOARD_ALL_REGIONALS,
  SIMPLE_DASHBOARD_ALL_WILAYAHS,
  sortSimpleDashboardSites,
  type SimpleDashboardSite,
} from "../lib/simple-dashboard-model";
import type { DashboardMonitoringSite } from "../lib/dashboard-view-model";

const sites: SimpleDashboardSite[] = [
  {
    code: "TPH",
    name: "STO Tosari Pasuruan",
    areaLabel: "Pasuruan West",
    regionalLabel: "TREG 5",
    wilayahLabel: "TIF 3",
    tankId: "tank-tph",
    tankShape: "horizontal-cylinder",
    volumeLiter: 3900,
    capacityLiter: 5000,
    updateLabel: "2 min ago",
    lastReceivedAt: "2026-07-01T10:02:00.000Z",
    deviceId: "demo-tph-01",
    isOnline: true,
  },
  {
    code: "NJA",
    name: "STO Nguling Jaya",
    areaLabel: "Pasuruan East",
    regionalLabel: "TREG 5",
    wilayahLabel: "TIF 3",
    tankId: "tank-nja",
    tankShape: "horizontal-cylinder",
    volumeLiter: 350,
    capacityLiter: 5000,
    updateLabel: "4 min ago",
    lastReceivedAt: "2026-07-01T10:00:00.000Z",
    deviceId: "demo-nja-01",
    isOnline: true,
  },
  {
    code: "SKP",
    name: "STO Sukorejo Pasuruan",
    areaLabel: "Pasuruan West",
    regionalLabel: "TREG 4",
    wilayahLabel: "TIF 3",
    tankId: "tank-skp",
    tankShape: "rectangular",
    volumeLiter: 3200,
    capacityLiter: 5000,
    updateLabel: "2 hrs ago",
    lastReceivedAt: "2026-07-01T08:00:00.000Z",
    deviceId: "demo-skp-01",
    isOnline: false,
  },
];

describe("simple dashboard model", () => {
  it("passes capacity, tank shape, and coordinates to cards and map", () => {
    const rows: DashboardMonitoringSite[] = [
      {
        id: "site-tph-tank-tph",
        code: "TPH",
        name: "STO TPH",
        areaLabel: "Demo area",
        regionalLabel: "TREG 5",
        wilayahLabel: "TIF 3",
        tankId: "tank-tph",
        tank: "TPH tank",
        status: "online",
        deviceStatus: "online",
        runtimeStatus: "safe",
        operationalStatus: "safe",
        fillPercent: 59,
        volumeLiter: 317,
        runtimeHour: 13,
        lastReceivedAt: "2026-07-01T10:02:00.000Z",
        updateLabel: "10 sec ago",
        deviceId: "demo-tph-01",
        signal: "-",
        left: "50%",
        top: "50%",
        latitude: -7.65,
        longitude: 112.9,
        note: "Data stable.",
        consumptionLiterPerHour: 24,
        configStatus: "normal",
        configNeedsReview: false,
        configSummary: "Matches registry",
      },
    ];

    expect(
      createSimpleDashboardSites(
        rows,
        new Map([["tank-tph", 540]]),
        new Map([["tank-tph", "rectangular"]]),
      )[0],
    ).toMatchObject({
      capacityLiter: 540,
      tankShape: "rectangular",
      latitude: -7.65,
      longitude: 112.9,
      regionalLabel: "TREG 5",
      wilayahLabel: "TIF 3",
    });
  });

  it("calculates online and offline summary", () => {
    expect(getSimpleDashboardSummary(sites)).toEqual({
      total: 3,
      online: 2,
      offline: 1,
    });
  });

  it("gets unique area list for filters", () => {
    expect(getSimpleDashboardAreas(sites)).toEqual([
      "Pasuruan East",
      "Pasuruan West",
    ]);
  });

  it("gets unique regional and territory lists for the national filter", () => {
    expect(getSimpleDashboardRegionals(sites)).toEqual(["TREG 4", "TREG 5"]);
    expect(getSimpleDashboardWilayahs(sites)).toEqual(["TIF 3"]);
  });

  it("filters by code, name, area, regional, territory, or device keyword", () => {
    expect(
      filterSimpleDashboardSites(sites, {
        query: "demo-nja",
        status: "all",
        area: SIMPLE_DASHBOARD_ALL_AREAS,
        regional: SIMPLE_DASHBOARD_ALL_REGIONALS,
        wilayah: SIMPLE_DASHBOARD_ALL_WILAYAHS,
      }).map((site) => site.code),
    ).toEqual(["NJA"]);

    expect(
      filterSimpleDashboardSites(sites, {
        query: "sukorejo",
        status: "all",
        area: SIMPLE_DASHBOARD_ALL_AREAS,
        regional: SIMPLE_DASHBOARD_ALL_REGIONALS,
        wilayah: SIMPLE_DASHBOARD_ALL_WILAYAHS,
      }).map((site) => site.code),
    ).toEqual(["SKP"]);

    expect(
      filterSimpleDashboardSites(sites, {
        query: "treg 4",
        status: "all",
        area: SIMPLE_DASHBOARD_ALL_AREAS,
        regional: SIMPLE_DASHBOARD_ALL_REGIONALS,
        wilayah: SIMPLE_DASHBOARD_ALL_WILAYAHS,
      }).map((site) => site.code),
    ).toEqual(["SKP"]);
  });

  it("filters by online and offline status only", () => {
    expect(
      filterSimpleDashboardSites(sites, {
        query: "",
        status: "online",
        area: SIMPLE_DASHBOARD_ALL_AREAS,
        regional: SIMPLE_DASHBOARD_ALL_REGIONALS,
        wilayah: SIMPLE_DASHBOARD_ALL_WILAYAHS,
      }).map((site) => site.code),
    ).toEqual(["TPH", "NJA"]);

    expect(
      filterSimpleDashboardSites(sites, {
        query: "",
        status: "offline",
        area: SIMPLE_DASHBOARD_ALL_AREAS,
        regional: SIMPLE_DASHBOARD_ALL_REGIONALS,
        wilayah: SIMPLE_DASHBOARD_ALL_WILAYAHS,
      }).map((site) => site.code),
    ).toEqual(["SKP"]);
  });

  it("filters area from registry data, not hardcode", () => {
    expect(
      filterSimpleDashboardSites(sites, {
        query: "",
        status: "all",
        area: "Pasuruan West",
        regional: SIMPLE_DASHBOARD_ALL_REGIONALS,
        wilayah: SIMPLE_DASHBOARD_ALL_WILAYAHS,
      }).map((site) => site.code),
    ).toEqual(["TPH", "SKP"]);
  });

  it("filters regional and territory from registry data", () => {
    expect(
      filterSimpleDashboardSites(sites, {
        query: "",
        status: "all",
        area: SIMPLE_DASHBOARD_ALL_AREAS,
        regional: "TREG 5",
        wilayah: SIMPLE_DASHBOARD_ALL_WILAYAHS,
      }).map((site) => site.code),
    ).toEqual(["TPH", "NJA"]);

    expect(
      filterSimpleDashboardSites(sites, {
        query: "",
        status: "all",
        area: SIMPLE_DASHBOARD_ALL_AREAS,
        regional: SIMPLE_DASHBOARD_ALL_REGIONALS,
        wilayah: "TIF 3",
      }).map((site) => site.code),
    ).toEqual(["TPH", "NJA", "SKP"]);
  });

  it("sorts offline first, then newest reading", () => {
    expect(sortSimpleDashboardSites(sites).map((site) => site.code)).toEqual([
      "SKP",
      "TPH",
      "NJA",
    ]);
  });
});
