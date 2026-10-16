import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading";

export default function TankAdminDetailLoading() {
  return (
    <DashboardRouteLoading
      label="Loading details"
      title="Preparing tank details"
      description="The system is reading the latest reading, volume history, and tank parameters."
    />
  );
}
