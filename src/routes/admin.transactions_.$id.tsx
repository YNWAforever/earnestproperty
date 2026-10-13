import { AdminStaffWorkspace } from "@/components/admin/AdminStaffWorkspace";
import { useStaffWorkspaceCurrent } from "@/hooks/use-staff-workspace";
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { TransactionForm } from "@/components/dashboard/TransactionForm";
import { TransactionAttributionEditor } from "@/components/admin/TransactionAttributionEditor";
import { useStaffSession } from "@/components/admin/staff-session";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { fetchAdminTransaction } from "@/lib/neon/admin-data";
import type { AdminTransactionRow } from "@/lib/neon/admin-data.types";

export const Route = createFileRoute("/admin/transactions_/$id")({
  head: () => ({
    meta: [{ title: "編輯成交｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <AdminStaffWorkspace
      component={EditAdminTransactionPage}
      title="編輯成交"
      roles={["admin", "manager", "agent"]}
      contentWidth="form"
    />
  ),
});

function EditAdminTransactionPage({ identity }: { identity: string }) {
  const isWorkspaceCurrent = useStaffWorkspaceCurrent(identity);
  const { id } = Route.useParams();
  const { user, loading } = useNeonAuth();
  const { session: staffSession } = useStaffSession(user?.id ?? null);
  const canSeeFinance =
    staffSession?.status === "ok" &&
    (staffSession.roles.includes("admin") || staffSession.roles.includes("manager"));
  const [transaction, setTransaction] = useState<AdminTransactionRow | null>(null);
  const [fetching, setFetching] = useState(true);
  const [readError, setReadError] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setTransaction((current) => (current?.id === id ? current : null));

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
        if (cancelled || !isWorkspaceCurrent()) return;
        setTransaction(data as AdminTransactionRow | null);
        setReadError(false);
      })
      .catch(() => {
        if (cancelled || !isWorkspaceCurrent()) return;
        setReadError(true);
      })
      .finally(() => {
        if (cancelled || !isWorkspaceCurrent()) return;
        setFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, loading, user, readAttempt, isWorkspaceCurrent]);

  return (
    <AdminShell
      contentWidth="form"
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
      <div className="w-full min-w-0">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/transactions">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Link>
        </Button>
        {(loading || fetching) && !transaction ? <Skeleton className="h-96 w-full" /> : null}
        {readError ? (
          <div>
            <AdminError message="未能載入成交資料，並非確認資料不存在。請重試或核對存取權限。" />
            <Button
              type="button"
              variant="outline"
              disabled={fetching}
              onClick={() => setReadAttempt((value) => value + 1)}
            >
              重新載入成交
            </Button>
          </div>
        ) : null}
        {!loading && !fetching && !readError && !transaction ? (
          <div className="rounded-lg border bg-background p-8 text-center">
            <p className="text-sm text-muted-foreground">找不到此成交記錄或無權限編輯。</p>
            <Button asChild variant="link" className="mt-3">
              <Link to="/admin/transactions">返回成交管理</Link>
            </Button>
          </div>
        ) : null}
        {!loading && transaction ? (
          <>
            <TransactionForm
              isWorkspaceCurrent={isWorkspaceCurrent}
              transaction={transaction}
              canVerify={canSeeFinance}
              onSaved={() => {
                void fetchAdminTransaction({ data: { id } })
                  .then((data) => {
                    if (isWorkspaceCurrent()) {
                      setTransaction(data as AdminTransactionRow | null);
                      setReadError(false);
                    }
                  })
                  .catch(() => {
                    if (isWorkspaceCurrent()) setReadError(true);
                  });
              }}
            />
            {canSeeFinance ? (
              <TransactionAttributionEditor
                transactionId={transaction.id}
                dealType={transaction.deal_type === "rent" ? "rent" : "sale"}
                publicationVerified={transaction.published}
                sourceVerified={transaction.verification_state === "verified"}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
