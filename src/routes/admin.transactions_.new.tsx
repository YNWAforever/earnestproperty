import { AdminStaffWorkspace } from "@/components/admin/AdminStaffWorkspace";
import { useStaffWorkspaceCurrent } from "@/hooks/use-staff-workspace";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { TransactionForm } from "@/components/dashboard/TransactionForm";
import { Button } from "@/components/ui/button";
import { useStaffSession } from "@/components/admin/staff-session";
import { useNeonAuth } from "@/hooks/use-neon-auth";

export const Route = createFileRoute("/admin/transactions_/new")({
  head: () => ({
    meta: [{ title: "新增成交｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <AdminStaffWorkspace
      component={NewAdminTransactionPage}
      title="新增成交"
      roles={["admin", "manager", "agent"]}
      contentWidth="form"
    />
  ),
});

function NewAdminTransactionPage({ identity }: { identity: string }) {
  const isWorkspaceCurrent = useStaffWorkspaceCurrent(identity);
  const navigate = useNavigate();
  const { user } = useNeonAuth();
  const { session: staffSession } = useStaffSession(user?.id ?? null);
  const canVerify =
    staffSession?.status === "ok" &&
    (staffSession.roles.includes("admin") || staffSession.roles.includes("manager"));

  return (
    <AdminShell
      contentWidth="form"
      title="新增成交"
      description="先登記成交資料，再於編輯頁記錄私有歸因及佣金。"
      breadcrumb={
        <nav aria-label="麵包屑">
          <Link to="/admin" className="hover:underline">
            後台
          </Link>
          {" › "}
          <Link to="/admin/transactions" className="hover:underline">
            成交管理
          </Link>
          {" › 新增"}
        </nav>
      }
    >
      <div className="w-full min-w-0">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/transactions">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Link>
        </Button>
        <TransactionForm
          isWorkspaceCurrent={isWorkspaceCurrent}
          staffName={user?.name ?? undefined}
          canVerify={canVerify}
          onSaved={(id) => navigate({ to: "/admin/transactions/$id", params: { id } })}
        />
      </div>
    </AdminShell>
  );
}
