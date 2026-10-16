import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading";

export default function AccountSecurityLoading() {
  return (
    <DashboardRouteLoading
      label="Loading security"
      title="Preparing account security"
      description="The system is reading active sessions and account security settings."
    />
  );
}
