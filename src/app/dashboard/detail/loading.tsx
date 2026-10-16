import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading";

export default function TechnicalDetailLoading() {
  return (
    <DashboardRouteLoading
      label="Loading analysis"
      title="Preparing technical analysis"
      description="The system is reading technical data, the operational map, and device history."
    />
  );
}
