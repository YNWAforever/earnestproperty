import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchAdminCms } from "@/lib/neon/admin-data";
import type { AdminCmsData } from "@/lib/neon/admin-data.types";
import { useNeonAuth } from "@/hooks/use-neon-auth";

export const Route = createFileRoute("/admin/cms")({
  head: () => ({
    meta: [{ title: "CMS｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminCms,
});

function AdminCms() {
  const { user } = useNeonAuth();
  const [data, setData] = useState<AdminCmsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchAdminCms()
      .then((data) => setData(data as AdminCmsData))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [user]);

  return (
    <AdminShell title="CMS" description="管理屋苑內容、文章、FAQ 及 SEO 資料。">
      {error ? <AdminError message={error} /> : null}
      {!data && !error ? <Skeleton className="h-72 w-full" /> : null}
      {data ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">屋苑 SEO 頁</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>屋苑</TableHead>
                    <TableHead>地區</TableHead>
                    <TableHead className="text-right">伙數</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.estates.map((estate) => (
                    <TableRow key={estate.id}>
                      <TableCell className="font-medium">{estate.name_zh}</TableCell>
                      <TableCell>{estate.district_slug}</TableCell>
                      <TableCell className="text-right">{estate.total_units ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">文章</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>標題</TableHead>
                    <TableHead>分類</TableHead>
                    <TableHead>狀態</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.articles.map((article) => (
                    <TableRow key={article.id}>
                      <TableCell className="font-medium">{article.title}</TableCell>
                      <TableCell>{article.category ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={article.published ? "default" : "outline"}>
                          {article.published ? "已發布" : "草稿"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">FAQ 群組</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {data.faqGroups.map((faq) => (
                <Badge key={faq.scope} variant="secondary" className="rounded-md">
                  {faq.scope} · {faq.total}
                </Badge>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </AdminShell>
  );
}
