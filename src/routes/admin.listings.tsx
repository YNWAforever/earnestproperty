import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { fetchAdminListings } from "@/lib/neon/admin-data";
import type { AdminListingRow } from "@/lib/neon/admin-data.types";
import { useNeonAuth } from "@/hooks/use-neon-auth";

export const Route = createFileRoute("/admin/listings")({
  head: () => ({
    meta: [{ title: "放盤｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminListings,
});

function AdminListings() {
  const { user } = useNeonAuth();
  const [rows, setRows] = useState<AdminListingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchAdminListings()
      .then((data) => setRows(data as AdminListingRow[]))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [user]);

  return (
    <AdminShell title="放盤" description="管理售盤、租盤、相片、代理及發布狀態。">
      <div className="mb-4 flex justify-end">
        <Button asChild>
          <Link to="/dashboard/property/new">
            <Plus className="mr-2 h-4 w-4" />
            新增放盤
          </Link>
        </Button>
      </div>
      {error ? <AdminError message={error} /> : null}
      {!rows && !error ? <Skeleton className="h-72 w-full" /> : null}
      {rows ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>放盤</TableHead>
                  <TableHead>類型</TableHead>
                  <TableHead>屋苑</TableHead>
                  <TableHead className="text-right">價格</TableHead>
                  <TableHead>狀態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((listing) => (
                  <TableRow key={listing.id}>
                    <TableCell>
                      <Link
                        to="/dashboard/property/$id"
                        params={{ id: listing.id }}
                        className="font-medium hover:underline"
                      >
                        {listing.title_zh}
                      </Link>
                      <p className="text-xs text-muted-foreground">#{listing.listing_no}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={listing.deal_type === "rent" ? "secondary" : "default"}>
                        {listing.deal_type === "rent" ? "租" : "售"}
                      </Badge>
                    </TableCell>
                    <TableCell>{listing.estate_name_zh ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {listing.deal_type === "rent"
                        ? listing.rent
                          ? `$${Number(listing.rent).toLocaleString()}`
                          : "—"
                        : listing.price
                          ? `$${(Number(listing.price) / 1_000_000).toFixed(2)}M`
                          : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={listing.status === "active" ? "default" : "outline"}>
                        {listing.status}
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
