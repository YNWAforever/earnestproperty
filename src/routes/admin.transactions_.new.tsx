import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { AdminTransactionForm } from "@/components/admin/transactions/AdminTransactionForm";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/transactions_/new")({
  head: () => ({
    meta: [{ title: "新增成交｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: NewAdminTransaction,
});

function NewAdminTransaction() {
  const navigate = useNavigate();

  return (
    <AdminShell title="新增成交" description="登記成交記錄，儲存後可核實及發布。">
      <div className="max-w-3xl">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/transactions">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Link>
        </Button>
        <AdminTransactionForm
          onSaved={(id) => navigate({ to: "/admin/transactions/$id", params: { id } })}
        />
      </div>
    </AdminShell>
  );
}
