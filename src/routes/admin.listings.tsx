import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  fetchAdminAgents,
  fetchAdminEstateOptions,
  fetchAdminListingsFiltered,
  updateAdminPropertyStatus,
} from "@/lib/neon/admin-data";
import type {
  AdminAgentRow,
  AdminListingFiltersInput,
  AdminListingRow,
  AdminPropertyInput,
} from "@/lib/neon/admin-data.types";

type Estate = { id: string; name_zh: string; district_slug: string };
type ListingStatus = AdminPropertyInput["status"];
type ListingFilters = {
  status: string;
  deal_type: "all" | "sale" | "rent";
  estate_id: string;
  featured: "all" | "yes" | "no";
  agent_id: string;
};

const defaultFilters: ListingFilters = {
  status: "all",
  deal_type: "all",
  estate_id: "all",
  featured: "all",
  agent_id: "all",
};

const statusLabels: Record<string, string> = {
  all: "全部狀態",
  draft: "草稿",
  active: "公開",
  sold: "已售",
  rented: "已租",
  offline: "下架",
};

export const Route = createFileRoute("/admin/listings")({
  head: () => ({
    meta: [{ title: "放盤｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminListings,
});

function AdminListings() {
  const { user } = useNeonAuth();
  const [rows, setRows] = useState<AdminListingRow[] | null>(null);
  const [estates, setEstates] = useState<Estate[]>([]);
  const [agents, setAgents] = useState<AdminAgentRow[]>([]);
  const [filters, setFilters] = useState<ListingFilters>(defaultFilters);
  const [error, setError] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  const refreshListings = useCallback(async () => {
    if (!user) return;

    setLoadingRows(true);
    try {
      const data = await fetchAdminListingsFiltered({ data: filters as AdminListingFiltersInput });
      setRows(data as AdminListingRow[]);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingRows(false);
    }
  }, [filters, user]);

  useEffect(() => {
    if (!user) return;
    Promise.all([fetchAdminEstateOptions(), fetchAdminAgents()])
      .then(([estateData, agentData]) => {
        setEstates(estateData as Estate[]);
        setAgents(agentData as AdminAgentRow[]);
      })
      .catch((err) => setError(errorText(err)));
  }, [user]);

  useEffect(() => {
    refreshListings();
  }, [refreshListings]);

  function setFilter<K extends keyof ListingFilters>(key: K, value: ListingFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function handleStatusChange(
    listing: AdminListingRow,
    status: ListingStatus,
    successLabel: string,
  ) {
    setMutatingId(`${listing.id}:${status}`);
    try {
      const result = await updateAdminPropertyStatus({ data: { id: listing.id, status } });
      assertNoMutationError(result);
      await refreshListings();
      toast.success(`${listing.listing_no} ${successLabel}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setMutatingId(null);
    }
  }

  return (
    <AdminShell title="放盤" description="管理售盤、租盤、相片、代理及發布狀態。">
      <AdminToolbar
        filters={
          <>
            <Select value={filters.status} onValueChange={(value) => setFilter("status", value)}>
              <SelectTrigger className="h-9 w-[8.5rem]" aria-label="狀態">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all", "draft", "active", "sold", "rented", "offline"].map((status) => (
                  <SelectItem key={status} value={status}>
                    {statusLabels[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.deal_type}
              onValueChange={(value) =>
                setFilter("deal_type", value as ListingFilters["deal_type"])
              }
            >
              <SelectTrigger className="h-9 w-[7rem]" aria-label="類型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部類型</SelectItem>
                <SelectItem value="sale">售盤</SelectItem>
                <SelectItem value="rent">租盤</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.estate_id}
              onValueChange={(value) => setFilter("estate_id", value)}
            >
              <SelectTrigger className="h-9 w-[10rem]" aria-label="屋苑">
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
              value={filters.featured}
              onValueChange={(value) => setFilter("featured", value as ListingFilters["featured"])}
            >
              <SelectTrigger className="h-9 w-[8rem]" aria-label="精選">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部精選</SelectItem>
                <SelectItem value="yes">只看精選</SelectItem>
                <SelectItem value="no">非精選</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.agent_id}
              onValueChange={(value) => setFilter("agent_id", value)}
            >
              <SelectTrigger className="h-9 w-[10rem]" aria-label="代理">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部代理</SelectItem>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name ?? agent.email ?? "未命名代理"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => setFilters(defaultFilters)}
            >
              重設
            </Button>
          </>
        }
        actions={
          <Button asChild size="sm" className="h-9">
            <Link to="/admin/listings/new">
              <Plus className="mr-2 h-4 w-4" />
              新增放盤
            </Link>
          </Button>
        }
      />

      {error ? <AdminError message={error} /> : null}
      {loadingRows && !rows ? <Skeleton className="h-72 w-full" /> : null}
      {rows && rows.length === 0 ? (
        <AdminEmptyState
          title="未有符合條件的放盤"
          description="調整篩選或新增一個售盤 / 租盤。"
          action={
            <Button asChild>
              <Link to="/admin/listings/new">新增放盤</Link>
            </Button>
          }
        />
      ) : null}
      {rows && rows.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[28%]">放盤</TableHead>
                  <TableHead>類型</TableHead>
                  <TableHead>屋苑</TableHead>
                  <TableHead>代理</TableHead>
                  <TableHead className="text-right">價格</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((listing) => (
                  <ListingRow
                    key={listing.id}
                    listing={listing}
                    mutatingId={mutatingId}
                    onStatusChange={handleStatusChange}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </AdminShell>
  );
}

function ListingRow({
  listing,
  mutatingId,
  onStatusChange,
}: {
  listing: AdminListingRow;
  mutatingId: string | null;
  onStatusChange: (
    listing: AdminListingRow,
    status: ListingStatus,
    successLabel: string,
  ) => Promise<void>;
}) {
  const terminalStatus: ListingStatus = listing.deal_type === "rent" ? "rented" : "sold";
  const terminalLabel = listing.deal_type === "rent" ? "已租" : "已售";
  const offlineMutation = `${listing.id}:offline`;
  const terminalMutation = `${listing.id}:${terminalStatus}`;
  const rowMutating = mutatingId?.startsWith(`${listing.id}:`) ?? false;

  return (
    <TableRow>
      <TableCell>
        <Link
          to="/admin/listings/$id"
          params={{ id: listing.id }}
          className="line-clamp-2 font-medium hover:underline"
        >
          {listing.title_zh}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>#{listing.listing_no}</span>
          {listing.featured ? <Badge variant="outline">精選</Badge> : null}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={listing.deal_type === "rent" ? "secondary" : "default"}>
          {listing.deal_type === "rent" ? "租" : "售"}
        </Badge>
      </TableCell>
      <TableCell className="max-w-[11rem] truncate">{listing.estate_name_zh ?? "—"}</TableCell>
      <TableCell className="max-w-[10rem] truncate">{listing.agent_name ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap text-right">{formatPrice(listing)}</TableCell>
      <TableCell>
        <Badge variant={listing.status === "active" ? "default" : "outline"}>
          {statusLabels[listing.status] ?? listing.status}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button asChild variant="outline" size="sm" className="h-8 px-2">
            <Link to="/admin/listings/$id" params={{ id: listing.id }}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              編輯
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-8 px-2">
            <Link to="/property/$listingNo" params={{ listingNo: listing.listing_no }}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              公開預覽
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2"
            disabled={listing.status === "offline" || rowMutating || mutatingId === offlineMutation}
            onClick={() => onStatusChange(listing, "offline", "已下架")}
          >
            下架
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2"
            disabled={
              listing.status === terminalStatus || rowMutating || mutatingId === terminalMutation
            }
            onClick={() => onStatusChange(listing, terminalStatus, `已標記為${terminalLabel}`)}
          >
            {terminalLabel}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function formatPrice(listing: AdminListingRow) {
  if (listing.deal_type === "rent") {
    return listing.rent ? `$${Number(listing.rent).toLocaleString()}` : "—";
  }
  return listing.price ? `$${(Number(listing.price) / 1_000_000).toFixed(2)}M` : "—";
}

function assertNoMutationError(result: unknown) {
  if (!result || typeof result !== "object") return;
  const maybeError = (result as { error?: unknown }).error;
  if (maybeError) throw new Error(String(maybeError));
  if ((result as { ok?: unknown }).ok === false) throw new Error("更新失敗");
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
