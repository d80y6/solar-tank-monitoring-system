import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading";

export default function UsersLoading() {
  return (
    <DashboardRouteLoading
      label="Loading users"
      title="Preparing user management"
      description="The system is reading accounts, access status, and the approval queue."
    />
  );
}
