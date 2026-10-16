import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading";

export default function AuditLoading() {
  return (
    <DashboardRouteLoading
      label="Loading audit"
      title="Preparing security records"
      description="The system is reading the audit trail and recent security activity."
    />
  );
}
