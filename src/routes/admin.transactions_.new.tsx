import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { TransactionForm } from "@/components/dashboard/TransactionForm";
import { Button } from "@/components/ui/button";
import { useNeonAuth } from "@/hooks/use-neon-auth";

export const Route = createFileRoute("/admin/transactions_/new")({
  head: () => ({
    meta: [{ title: "新增成交｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: NewAdminTransactionPage,
});

function NewAdminTransactionPage() {
  const navigate = useNavigate();
  const { user } = useNeonAuth();

  return (
    <AdminShell
      title="新增成交"
      description="登記一筆晉誠地產自己促成的成交。"
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
      <div className="max-w-2xl">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/transactions">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Link>
        </Button>
        <TransactionForm
          staffName={user?.name ?? undefined}
          onSaved={() => navigate({ to: "/admin/transactions" })}
        />
      </div>
    </AdminShell>
  );
}
