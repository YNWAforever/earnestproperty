import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Pencil, Plus } from "lucide-react";

import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { fetchAdminEstateOptions, fetchAdminTransactionsFiltered } from "@/lib/neon/admin-data";
import type {
  AdminTransactionFiltersInput,
  AdminTransactionRow,
} from "@/lib/neon/admin-data.types";

type Estate = { id: string; name_zh: string; district_slug: string };
type TransactionFilters = {
  q: string;
  deal_type: "all" | "sale" | "rent";
  estate_id: string;
  verification_state: "all" | "unverified" | "pending" | "verified";
};

const defaultFilters: TransactionFilters = {
  q: "",
  deal_type: "all",
  estate_id: "all",
  verification_state: "all",
};

const verificationLabels: Record<string, string> = {
  unverified: "未核實",
  pending: "審核中",
  verified: "已核實",
};

export const Route = createFileRoute("/admin/transactions")({
  head: () => ({
    meta: [{ title: "成交管理｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminTransactions,
});

function AdminTransactions() {
  const { user } = useNeonAuth();
  const [rows, setRows] = useState<AdminTransactionRow[] | null>(null);
  const [estates, setEstates] = useState<Estate[]>([]);
  const [filters, setFilters] = useState<TransactionFilters>(defaultFilters);
  const [error, setError] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const requestIdRef = useRef(0);

  const refreshTransactions = useCallback(async () => {
    if (!user) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoadingRows(true);
    try {
      const data = await fetchAdminTransactionsFiltered({
        data: filters as AdminTransactionFiltersInput,
      });
      if (requestId !== requestIdRef.current) return;
      setRows(data as AdminTransactionRow[]);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestId === requestIdRef.current) setLoadingRows(false);
    }
  }, [filters, user]);

  useEffect(() => {
    if (!user) return;
    fetchAdminEstateOptions()
      .then((data) => setEstates(data as Estate[]))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [user]);

  useEffect(() => {
    refreshTransactions();
  }, [refreshTransactions]);

  return (
    <AdminShell title="成交管理" description="登記、核實及發布晉誠地產自己促成的成交記錄。">
      <AdminToolbar
        filters={
          <>
            <Input
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="搜尋屋苑"
              aria-label="搜尋成交"
              className="h-11 w-full sm:w-56 lg:h-9"
            />
            <Select
              value={filters.deal_type}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, deal_type: v as TransactionFilters["deal_type"] }))
              }
            >
              <SelectTrigger className="h-11 w-[7rem] lg:h-9" aria-label="類型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部類型</SelectItem>
                <SelectItem value="sale">買賣</SelectItem>
                <SelectItem value="rent">租賃</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.estate_id}
              onValueChange={(v) => setFilters((f) => ({ ...f, estate_id: v }))}
            >
              <SelectTrigger className="h-11 w-[10rem] lg:h-9" aria-label="屋苑">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部屋苑</SelectItem>
                {estates.map((estate) => (
                  <SelectItem key={estate.id} value={estate.id}>
                    {estate.name_zh}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.verification_state}
              onValueChange={(v) =>
                setFilters((f) => ({
                  ...f,
                  verification_state: v as TransactionFilters["verification_state"],
                }))
              }
            >
              <SelectTrigger className="h-11 w-[8rem] lg:h-9" aria-label="狀態">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部狀態</SelectItem>
                <SelectItem value="unverified">未核實</SelectItem>
                <SelectItem value="pending">審核中</SelectItem>
                <SelectItem value="verified">已核實</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        actions={
          <Button asChild size="sm" className="h-11 lg:h-9">
            <Link to="/admin/transactions/new">
              <Plus className="mr-2 h-4 w-4" />
              新增成交
            </Link>
          </Button>
        }
      />

      {error ? <AdminError message={error} /> : null}
      {loadingRows && !rows ? <Skeleton className="h-72 w-full" /> : null}
      {rows && rows.length === 0 ? (
        <AdminEmptyState
          title="未有符合條件的成交記錄"
          description="調整篩選或新增一筆成交。"
          action={
            <Button asChild>
              <Link to="/admin/transactions/new">新增成交</Link>
            </Button>
          }
        />
      ) : null}
      {rows && rows.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[840px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>屋苑</TableHead>
                    <TableHead>類型</TableHead>
                    <TableHead className="text-right">價錢</TableHead>
                    <TableHead>成交日</TableHead>
                    <TableHead>負責人</TableHead>
                    <TableHead>狀態</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell className="max-w-[11rem] truncate">
                        {transaction.estate_name_zh ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={transaction.deal_type === "rent" ? "secondary" : "default"}>
                          {transaction.deal_type === "rent" ? "租" : "售"}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {transaction.price ? `$${Number(transaction.price).toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell>{transaction.deal_date ?? "—"}</TableCell>
                      <TableCell className="max-w-[10rem] truncate">
                        {transaction.agent_name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={transaction.published ? "default" : "outline"}>
                          {transaction.published
                            ? "已發布"
                            : (verificationLabels[transaction.verification_state] ??
                              transaction.verification_state)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button asChild variant="outline" size="sm" className="h-11 px-2 lg:h-8">
                            <Link to="/admin/transactions/$id" params={{ id: transaction.id }}>
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                              編輯
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </AdminShell>
  );
}
