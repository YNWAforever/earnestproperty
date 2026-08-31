import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin/AdminShell";
import { TransactionForm } from "@/components/dashboard/TransactionForm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { fetchAdminTransaction } from "@/lib/neon/admin-data";
import type { AdminTransactionRow } from "@/lib/neon/admin-data.types";

export const Route = createFileRoute("/admin/transactions_/$id")({
  head: () => ({
    meta: [{ title: "編輯成交｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: EditAdminTransactionPage,
});

function EditAdminTransactionPage() {
  const { id } = Route.useParams();
  const { user, loading } = useNeonAuth();
  const navigate = useNavigate();
  const [transaction, setTransaction] = useState<AdminTransactionRow | null>(null);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setTransaction(null);

    if (loading)
      return () => {
        cancelled = true;
      };
    if (!user) {
      setFetching(false);
      return () => {
        cancelled = true;
      };
    }

    setFetching(true);
    fetchAdminTransaction({ data: { id } })
      .then((data) => {
        if (cancelled) return;
        setTransaction(data as AdminTransactionRow | null);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : String(err));
        setTransaction(null);
      })
      .finally(() => {
        if (cancelled) return;
        setFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, loading, user]);

  return (
    <AdminShell
      title="編輯成交"
      description="更新成交金額、面積、來源及發布狀態。"
      breadcrumb={
        <nav aria-label="麵包屑">
          <Link to="/admin" className="hover:underline">
            後台
          </Link>
          {" › "}
          <Link to="/admin/transactions" className="hover:underline">
            成交管理
          </Link>
          {" › 編輯"}
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
        {loading || fetching ? <Skeleton className="h-96 w-full" /> : null}
        {!loading && !fetching && !transaction ? (
          <div className="rounded-lg border bg-background p-8 text-center">
            <p className="text-sm text-muted-foreground">找不到此成交記錄或無權限編輯。</p>
            <Button asChild variant="link" className="mt-3">
              <Link to="/admin/transactions">返回成交管理</Link>
            </Button>
          </div>
        ) : null}
        {!loading && !fetching && transaction ? (
          <TransactionForm
            transaction={transaction}
            onSaved={() => navigate({ to: "/admin/transactions" })}
          />
        ) : null}
      </div>
    </AdminShell>
  );
}
