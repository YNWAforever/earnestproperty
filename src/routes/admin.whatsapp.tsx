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
import { fetchAdminConversations } from "@/lib/neon/admin-data";
import type { AdminConversationRow } from "@/lib/neon/admin-data.types";
import { useNeonAuth } from "@/hooks/use-neon-auth";

export const Route = createFileRoute("/admin/whatsapp")({
  head: () => ({
    meta: [{ title: "WhatsApp Inbox｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminWhatsapp,
});

function AdminWhatsapp() {
  const { user } = useNeonAuth();
  const [rows, setRows] = useState<AdminConversationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchAdminConversations()
      .then((data) => setRows(data as AdminConversationRow[]))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [user]);

  return (
    <AdminShell title="WhatsApp Inbox" description="Woztell 收件匣、對話紀錄及客服窗口。">
      {error ? <AdminError message={error} /> : null}
      {!rows && !error ? <Skeleton className="h-72 w-full" /> : null}
      {rows ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>客戶</TableHead>
                  <TableHead>最近訊息</TableHead>
                  <TableHead>方向</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead>Opt-out</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((conversation) => (
                  <TableRow key={conversation.id}>
                    <TableCell>
                      <p className="font-medium">{conversation.name ?? "WhatsApp 客戶"}</p>
                      <p className="text-xs text-muted-foreground">{conversation.phone ?? "—"}</p>
                    </TableCell>
                    <TableCell className="max-w-md truncate">
                      {conversation.last_text ?? "—"}
                    </TableCell>
                    <TableCell>{conversation.last_direction ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={conversation.status === "open" ? "default" : "outline"}>
                        {conversation.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{conversation.opted_out_whatsapp ? "是" : "否"}</TableCell>
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
