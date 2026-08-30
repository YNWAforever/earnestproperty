import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { AdminTransactionForm } from "@/components/admin/transactions/AdminTransactionForm";
import { AdminShell } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import {
  getAdminTransaction,
  publishAdminTransaction,
  unpublishAdminTransaction,
  verifyAdminTransaction,
} from "@/lib/neon/admin-transactions";
import type {
  AdminTransactionRow,
  AdminTransactionVerificationState,
} from "@/lib/neon/admin-transactions.types";

const VERIFICATION_LABELS: Record<AdminTransactionVerificationState, string> = {
  unverified: "未核實",
  pending: "待覆核",
  verified: "已核實",
};

function transactionErrorMessage(err: unknown): string {
  const status =
    err && typeof err === "object" && "status" in err
      ? Number((err as { status?: unknown }).status)
      : 0;
  if (status === 401) return "登入已過期，請重新登入後再試。";
  if (status === 403) return "你的角色沒有核實／發布權限，請聯絡管理員或主管。";
  return err instanceof Error ? err.message : "操作失敗，請重試。";
}

/** Normalizes both the typed { ok: false, code } result from publish/unpublish
 * and a thrown error into a single thrown Error with a zh-HK message, so
 * every call site here can share the same catch-and-toast shape. */
async function callTransactions<T extends { ok: boolean }>(call: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await call();
  } catch (err) {
    throw new Error(transactionErrorMessage(err));
  }
  if (!result.ok) {
    const code = "code" in result ? String((result as { code?: unknown }).code) : "";
    throw new Error(
      code === "TRANSACTION_NOT_VERIFIED"
        ? "請先核實此成交記錄，才可以發布。"
        : "操作失敗，請重試。",
    );
  }
  return result;
}

export const Route = createFileRoute("/admin/transactions_/$id")({
  head: () => ({
    meta: [{ title: "編輯成交｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: EditAdminTransaction,
});

function EditAdminTransaction() {
  const { id } = Route.useParams();
  const { user, loading } = useNeonAuth();
  const navigate = useNavigate();
  const [transaction, setTransaction] = useState<AdminTransactionRow | null>(null);
  const [fetching, setFetching] = useState(true);
  const [working, setWorking] = useState(false);

  async function refresh() {
    const data = await getAdminTransaction({ data: { id } });
    setTransaction(data);
  }

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setFetching(false);
      return;
    }
    let cancelled = false;
    setFetching(true);
    refresh()
      .catch((err) => {
        if (!cancelled) toast.error(transactionErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loading, user]);

  async function handleVerify() {
    setWorking(true);
    try {
      await callTransactions(() => verifyAdminTransaction({ data: { id } }));
      toast.success("已核實成交記錄");
      await refresh();
    } catch (err) {
      toast.error(transactionErrorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  async function handleTogglePublish() {
    setWorking(true);
    try {
      if (transaction?.published) {
        await callTransactions(() => unpublishAdminTransaction({ data: { id } }));
        toast.success("已取消發布");
      } else {
        await callTransactions(() => publishAdminTransaction({ data: { id } }));
        toast.success("已發布成交記錄");
      }
      await refresh();
    } catch (err) {
      toast.error(transactionErrorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <AdminShell title="編輯成交" description="更新成交資料、核實及發布狀態。">
      <div className="max-w-3xl">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/transactions">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Link>
        </Button>
        {loading || fetching ? <Skeleton className="h-96 w-full" /> : null}
        {!loading && !fetching && !transaction ? (
          <div className="border-y py-10 text-center">
            <p className="text-sm text-muted-foreground">找不到此成交記錄。</p>
            <Button asChild variant="link" className="mt-3">
              <Link to="/admin/transactions">返回成交管理</Link>
            </Button>
          </div>
        ) : null}
        {!loading && !fetching && transaction ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle as="h2" className="text-base">
                  狀態
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3">
                <Badge
                  variant={transaction.verification_state === "verified" ? "default" : "outline"}
                >
                  {VERIFICATION_LABELS[transaction.verification_state]}
                </Badge>
                <Badge variant={transaction.published ? "default" : "outline"}>
                  {transaction.published ? "已發布" : "未發布"}
                </Badge>
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleVerify}
                    disabled={working || transaction.verification_state === "verified"}
                  >
                    核實
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleTogglePublish}
                    disabled={
                      working ||
                      (!transaction.published && transaction.verification_state !== "verified")
                    }
                  >
                    {transaction.published ? "取消發布" : "發布"}
                  </Button>
                </div>
              </CardContent>
            </Card>
            <AdminTransactionForm
              transaction={transaction}
              onSaved={() => {
                toast.info("編輯後成交記錄需重新核實，才可繼續公開顯示。");
                void refresh();
              }}
            />
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}
