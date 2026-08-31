import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { Button } from "@/components/ui/button";
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
import { fetchAdminCms } from "@/lib/neon/admin-data";
import type { AdminCmsData, AdminEstateCmsRow } from "@/lib/neon/admin-data.types";

export const Route = createFileRoute("/admin/estates")({
  head: () => ({
    meta: [{ title: "屋苑管理｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminEstates,
});

function AdminEstates() {
  const { user } = useNeonAuth();
  const [estates, setEstates] = useState<AdminEstateCmsRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchAdminCms()
      .then((data) => {
        if (!cancelled) setEstates((data as AdminCmsData).estates);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "未能載入屋苑資料");
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <AdminShell title="屋苑管理" description="管理屋苑別名、地址、座標、交通、校網及核實狀態。">
      <AdminToolbar
        filters={null}
        actions={
          <Button asChild size="sm" className="h-11 lg:h-9">
            <Link to="/admin/estates/new">
              <Plus className="mr-2 h-4 w-4" />
              新增屋苑
            </Link>
          </Button>
        }
      />
      {error ? <AdminError message={error} /> : null}
      {!estates && !error ? <Skeleton className="h-72 w-full" /> : null}
      {estates?.length === 0 ? (
        <AdminEmptyState title="未有屋苑" description="新增第一個屋苑後即可管理完整資料。" />
      ) : null}
      {estates && estates.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>屋苑</TableHead>
              <TableHead>地區</TableHead>
              <TableHead className="text-right">伙數</TableHead>
              <TableHead className="w-20 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {estates.map((estate) => (
              <TableRow key={estate.id}>
                <TableCell>
                  <p className="font-medium">{estate.name_zh}</p>
                  <p className="text-xs text-muted-foreground">{estate.slug}</p>
                </TableCell>
                <TableCell>{estate.district_slug}</TableCell>
                <TableCell className="text-right">
                  {estate.total_units?.toLocaleString() ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link to="/admin/estates/$id" params={{ id: estate.id }}>
                      編輯
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </AdminShell>
  );
}
