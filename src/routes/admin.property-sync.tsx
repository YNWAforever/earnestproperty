import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { useStaffSession } from "@/components/admin/staff-session";
import { PropertySyncWorkspace } from "@/components/admin/property-sync/PropertySyncWorkspace";
import { fetchAdminSyncWorkspace, requestAdminSyncOperation } from "@/lib/neon/admin-property-sync";
export const Route = createFileRoute("/admin/property-sync")({
  head: () => ({
    meta: [{ title: "盤源同步｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: PropertySyncPage,
});
function PropertySyncPage() {
  return (
    <AdminShell title="盤源同步" description="查看每日來源進度、待上架及核實撤盤。">
      <SyncContent />
    </AdminShell>
  );
}
function SyncContent() {
  const { user } = useNeonAuth();
  const { session, loading } = useStaffSession(user?.id ?? null);
  if (loading || !session) return <p role="status">正在核實職員權限…</p>;
  return (
    <PropertySyncWorkspace
      roles={session.status === "ok" ? session.roles : []}
      load={(cursor) => fetchAdminSyncWorkspace({ data: { limit: 25, cursor } })}
      request={(input) => requestAdminSyncOperation({ data: input })}
    />
  );
}
