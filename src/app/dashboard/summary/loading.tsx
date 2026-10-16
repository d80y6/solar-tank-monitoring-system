import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading";

export default function SummaryLoading() {
  return (
    <DashboardRouteLoading
      label="Loading FTM data"
      title="Preparing the tank summary"
      description="The system is reading the latest operational data for all STOs."
    />
  );
}
