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
import { fetchAdminCampaigns } from "@/lib/neon/admin-data";
import type { AdminCampaignRow } from "@/lib/neon/admin-data.types";
import { useNeonAuth } from "@/hooks/use-neon-auth";

export const Route = createFileRoute("/admin/blasts")({
  head: () => ({
    meta: [{ title: "WhatsApp 群發｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminBlasts,
});

function AdminBlasts() {
  const { user } = useNeonAuth();
  const [rows, setRows] = useState<AdminCampaignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchAdminCampaigns()
      .then((data) => setRows(data as AdminCampaignRow[]))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [user]);

  return (
    <AdminShell title="WhatsApp 群發" description="Template-only、opt-in-only、審核後排程發送。">
      {error ? <AdminError message={error} /> : null}
      {!rows && !error ? <Skeleton className="h-72 w-full" /> : null}
      {rows ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead className="text-right">人數</TableHead>
                  <TableHead>狀態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell className="font-medium">{campaign.name}</TableCell>
                    <TableCell>
                      {campaign.element_name
                        ? `${campaign.element_name} (${campaign.language_code})`
                        : "—"}
                    </TableCell>
                    <TableCell>{campaign.audience_name ?? "—"}</TableCell>
                    <TableCell className="text-right">{campaign.recipients ?? 0}</TableCell>
                    <TableCell>
                      <Badge variant={campaign.status === "queued" ? "default" : "outline"}>
                        {campaign.status}
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
