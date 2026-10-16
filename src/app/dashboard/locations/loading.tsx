import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading";

export default function LocationsLoading() {
  return (
    <DashboardRouteLoading
      label="Loading locations"
      title="Preparing device locations"
      description="The system is reading STO data, devices, and tank configuration."
    />
  );
}
