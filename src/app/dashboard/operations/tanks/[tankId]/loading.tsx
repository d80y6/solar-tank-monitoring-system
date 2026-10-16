import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading";

export default function TankOperationalDetailLoading() {
  return (
    <DashboardRouteLoading
      label="Loading details"
      title="Preparing operational details"
      description="The system is reading device status, volume, and the latest tank trends."
    />
  );
}
