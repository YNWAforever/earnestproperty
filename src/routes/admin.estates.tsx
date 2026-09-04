import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

// fetchAdminCms returns at most this many estates (admin-data.server.ts).
// /admin/cms states the cap on its own estates tab; this page silently showed
// ≤40 rows as if complete, with no search -- the exact "editor searches, gets
// 找不到, creates a duplicate" failure the CMS pass fixed elsewhere.
const ESTATE_ROW_CAP = 40;

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
  const [query, setQuery] = useState("");

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

  const visibleEstates = useMemo(() => {
    if (!estates) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return estates;
    return estates.filter((estate) =>
      [estate.name_zh, estate.slug, estate.district_slug]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [estates, query]);
  const capped = (estates?.length ?? 0) >= ESTATE_ROW_CAP;

  return (
    <AdminShell title="屋苑管理" description="管理屋苑別名、地址、座標、交通、校網及核實狀態。">
      <AdminToolbar
        filters={
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋屋苑名稱、slug 或地區"
            aria-label="搜尋屋苑"
            className="h-11 w-full max-w-sm lg:h-9"
          />
        }
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
        <AdminEmptyState
          title="未有屋苑"
          description="新增第一個屋苑後即可管理完整資料。"
          action={
            <Button asChild>
              <Link to="/admin/estates/new">
                <Plus className="mr-2 h-4 w-4" />
                新增屋苑
              </Link>
            </Button>
          }
        />
      ) : null}
      {estates && estates.length > 0 && visibleEstates ? (
        <Card>
          <CardContent className="p-0">
            <p className="border-b px-4 py-2 text-xs text-muted-foreground">
              {query.trim()
                ? `顯示 ${visibleEstates.length} / ${estates.length} 個屋苑`
                : `${estates.length} 個屋苑`}
              {capped
                ? `（只載入最新 ${ESTATE_ROW_CAP} 個，可能還有更多；搜尋只在已載入的屋苑內進行）`
                : ""}
            </p>
            {visibleEstates.length === 0 ? (
              <div className="p-6">
                <AdminEmptyState
                  title="找不到符合的屋苑"
                  description="試試其他名稱或 slug；如屋苑未建立，可直接新增。"
                  action={
                    <Button type="button" variant="outline" onClick={() => setQuery("")}>
                      清除搜尋
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>屋苑</TableHead>
                      <TableHead>地區</TableHead>
                      <TableHead className="text-right">伙數</TableHead>
                      <TableHead className="w-20 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleEstates.map((estate) => (
                      <TableRow key={estate.id}>
                        <TableCell>
                          <p className="font-medium">{estate.name_zh}</p>
                          <p className="text-xs text-muted-foreground">{estate.slug}</p>
                        </TableCell>
                        <TableCell>{estate.district_slug}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {estate.total_units?.toLocaleString() ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="outline" size="sm" className="h-11 px-2 lg:h-8">
                            <Link to="/admin/estates/$id" params={{ id: estate.id }}>
                              編輯
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </AdminShell>
  );
}
