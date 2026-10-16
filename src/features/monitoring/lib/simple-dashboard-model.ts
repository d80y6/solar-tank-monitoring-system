import type { DashboardMonitoringSite } from "./dashboard-view-model";
import type { TankShape } from "@/features/monitoring/types/monitoring";
import {
  DEFAULT_REGIONAL_LABEL,
  DEFAULT_WILAYAH_LABEL,
} from "./location-taxonomy";

export const SIMPLE_DASHBOARD_ALL_AREAS = "all";
export const SIMPLE_DASHBOARD_ALL_REGIONALS = "all";
export const SIMPLE_DASHBOARD_ALL_WILAYAHS = "all";

export type SimpleDashboardStatusFilter = "all" | "online" | "offline";

export type SimpleDashboardSite = {
  code: string;
  name: string;
  areaLabel: string;
  regionalLabel: string;
  wilayahLabel: string;
  tankId: string;
  tankShape: TankShape;
  volumeLiter: number;
  capacityLiter: number;
  updateLabel: string;
  lastReceivedAt: string;
  deviceId: string;
  latitude?: number;
  longitude?: number;
  isOnline: boolean;
};

export type SimpleDashboardFilters = {
  query: string;
  status: SimpleDashboardStatusFilter;
  area: string;
  regional: string;
  wilayah: string;
};

export type SimpleDashboardSummary = {
  total: number;
  online: number;
  offline: number;
};

function normalizeSearchValue(value: string) {
  return value.toLocaleLowerCase("en-US").trim();
}

function getReceivedTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function createSimpleDashboardSites(
  rows: DashboardMonitoringSite[],
  capacityByTankId: ReadonlyMap<string, number>,
  shapeByTankId: ReadonlyMap<string, TankShape>,
): SimpleDashboardSite[] {
  return rows.map((site) => ({
    code: site.code,
    name: site.name,
    areaLabel: site.areaLabel,
    regionalLabel: site.regionalLabel ?? DEFAULT_REGIONAL_LABEL,
    wilayahLabel: site.wilayahLabel ?? DEFAULT_WILAYAH_LABEL,
    tankId: site.tankId,
    tankShape: shapeByTankId.get(site.tankId) ?? "horizontal-cylinder",
    volumeLiter: site.volumeLiter,
    capacityLiter: capacityByTankId.get(site.tankId) ?? 0,
    updateLabel: site.updateLabel,
    lastReceivedAt: site.lastReceivedAt,
    deviceId: site.deviceId,
    latitude: site.latitude,
    longitude: site.longitude,
    isOnline: site.deviceStatus === "online",
  }));
}

export function getSimpleDashboardSummary(
  sites: SimpleDashboardSite[],
): SimpleDashboardSummary {
  const online = sites.filter((site) => site.isOnline).length;

  return {
    total: sites.length,
    online,
    offline: sites.length - online,
  };
}

export function getSimpleDashboardAreas(sites: SimpleDashboardSite[]) {
  return Array.from(
    new Set(
      sites
        .map((site) => site.areaLabel.trim())
        .filter((areaLabel) => areaLabel.length > 0),
    ),
  ).sort((first, second) => first.localeCompare(second, "en-US"));
}

export function getSimpleDashboardRegionals(sites: SimpleDashboardSite[]) {
  return Array.from(
    new Set(
      sites
        .map((site) => site.regionalLabel.trim())
        .filter((regionalLabel) => regionalLabel.length > 0),
    ),
  ).sort((first, second) => first.localeCompare(second, "en-US"));
}

export function getSimpleDashboardWilayahs(sites: SimpleDashboardSite[]) {
  return Array.from(
    new Set(
      sites
        .map((site) => site.wilayahLabel.trim())
        .filter((wilayahLabel) => wilayahLabel.length > 0),
    ),
  ).sort((first, second) => first.localeCompare(second, "en-US"));
}

export function filterSimpleDashboardSites(
  sites: SimpleDashboardSite[],
  filters: SimpleDashboardFilters,
) {
  const query = normalizeSearchValue(filters.query);
  const area = filters.area.trim();
  const regional = filters.regional.trim();
  const wilayah = filters.wilayah.trim();

  return sites.filter((site) => {
    if (filters.status === "online" && !site.isOnline) {
      return false;
    }

    if (filters.status === "offline" && site.isOnline) {
      return false;
    }

    if (area !== SIMPLE_DASHBOARD_ALL_AREAS && site.areaLabel !== area) {
      return false;
    }

    if (
      regional !== SIMPLE_DASHBOARD_ALL_REGIONALS &&
      site.regionalLabel !== regional
    ) {
      return false;
    }

    if (
      wilayah !== SIMPLE_DASHBOARD_ALL_WILAYAHS &&
      site.wilayahLabel !== wilayah
    ) {
      return false;
    }

    if (query.length === 0) {
      return true;
    }

    const haystack = [
      site.code,
      site.name,
      site.areaLabel,
      site.regionalLabel,
      site.wilayahLabel,
      site.deviceId,
    ]
      .map(normalizeSearchValue)
      .join(" ");

    return haystack.includes(query);
  });
}

export function sortSimpleDashboardSites(sites: SimpleDashboardSite[]) {
  return [...sites].sort((first, second) => {
    if (first.isOnline !== second.isOnline) {
      return first.isOnline ? 1 : -1;
    }

    return (
      getReceivedTime(second.lastReceivedAt) -
        getReceivedTime(first.lastReceivedAt) ||
      first.code.localeCompare(second.code, "en-US")
    );
  });
}
