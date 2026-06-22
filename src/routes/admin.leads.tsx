import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchAdminLeads } from "@/lib/neon/admin-data";
import type { AdminLeadRow } from "@/lib/neon/admin-data.types";
import { useNeonAuth } from "@/hooks/use-neon-auth";

export const Route = createFileRoute("/admin/leads")({
  head: () => ({
    meta: [{ title: "CRM｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminLeads,
});

function AdminLeads() {
  const { user } = useNeonAuth();
  const [rows, setRows] = useState<AdminLeadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchAdminLeads()
      .then((data) => setRows(data as AdminLeadRow[]))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [user]);

  return (
    <AdminShell title="CRM" description="集中處理買樓、租樓及業主估價 leads。">
      {error ? <AdminError message={error} /> : null}
      {!rows && !error ? <Skeleton className="h-72 w-full" /> : null}
      {rows ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>客戶</TableHead>
                  <TableHead>意圖</TableHead>
                  <TableHead>來源</TableHead>
                  <TableHead>相關放盤</TableHead>
                  <TableHead>階段</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell>
                      <p className="font-medium">{lead.name ?? "未命名"}</p>
                      <p className="text-xs text-muted-foreground">
                        {lead.phone ?? lead.email ?? "—"}
                      </p>
                    </TableCell>
                    <TableCell>{lead.intent}</TableCell>
                    <TableCell>{lead.source}</TableCell>
                    <TableCell>{lead.property_title ?? lead.listing_no ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={lead.stage === "new" ? "default" : "secondary"}>
                        {lead.stage}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </AdminShell>
  );
}
