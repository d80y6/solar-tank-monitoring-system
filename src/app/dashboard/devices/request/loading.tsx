import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading";

export default function DeviceRequestLoading() {
  return (
    <DashboardRouteLoading
      label="Loading form"
      title="Preparing the device request"
      description="The system is preparing the sensor profile, tank type, and request validation."
    />
  );
}
