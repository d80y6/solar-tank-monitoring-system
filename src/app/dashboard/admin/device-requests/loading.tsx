import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading";

export default function DeviceRequestsLoading() {
  return (
    <DashboardRouteLoading
      label="Loading requests"
      title="Preparing the device queue"
      description="The system is reading device requests and the latest provisioning status."
    />
  );
}
