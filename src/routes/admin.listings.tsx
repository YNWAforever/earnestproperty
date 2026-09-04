import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
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
  q: string;
  status: string;
  deal_type: "all" | "sale" | "rent";
  estate_id: string;
  featured: "all" | "yes" | "no";
  agent_id: string;
  limit: number;
};

const LISTING_PAGE_SIZE = 80;

const defaultFilters: ListingFilters = {
  q: "",
  status: "all",
  deal_type: "all",
  estate_id: "all",
  featured: "all",
  agent_id: "all",
  limit: LISTING_PAGE_SIZE,
};

const statusLabels: Record<string, string> = {
  all: "全部狀態",
  draft: "草稿",
  active: "公開",
  sold: "已售",
  rented: "已租",
  offline: "下架",
};

// Filters used to live in local useState, so a reload or Back from an edit page
// reset the agent's whole working view, and no filtered list was shareable.
// Only non-default values are written, so a plain /admin/listings stays clean.
function parseListingSearch(search: Record<string, unknown>): Partial<ListingFilters> {
  const result: Partial<ListingFilters> = {};
  for (const key of ["status", "deal_type", "estate_id", "featured", "agent_id"] as const) {
    const value = search[key];
    if (typeof value === "string" && value !== defaultFilters[key]) {
      result[key] = value as never;
    }
  }
  if (typeof search.q === "string" && search.q.trim()) result.q = search.q;
  const limit = Number(search.limit);
  if (Number.isFinite(limit) && limit > LISTING_PAGE_SIZE) {
    result.limit = Math.min(limit, 200);
  }
  return result;
}

export const Route = createFileRoute("/admin/listings")({
  validateSearch: parseListingSearch,
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
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filters: ListingFilters = useMemo(() => ({ ...defaultFilters, ...search }), [search]);

  function setFilters(updater: (current: ListingFilters) => ListingFilters, replace = false) {
    void navigate({
      search: parseListingSearch(updater(filters)),
      replace,
      resetScroll: false,
    });
  }
  const [error, setError] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  // The search box types into this and pushes to `filters.q` debounced, so a
  // keystroke does not fire a server round-trip.
  const [queryDraft, setQueryDraft] = useState(filters.q);
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    listing: AdminListingRow;
    status: ListingStatus;
    successLabel: string;
  } | null>(null);
  const requestIdRef = useRef(0);

  const refreshListings = useCallback(async () => {
    if (!user) return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoadingRows(true);
    try {
      const data = await fetchAdminListingsFiltered({ data: filters as AdminListingFiltersInput });
      if (requestId !== requestIdRef.current) return;
      setRows(data as AdminListingRow[]);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(errorText(err));
    } finally {
      if (requestId === requestIdRef.current) setLoadingRows(false);
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (filters.q === queryDraft.trim()) return;
      setFilters(
        (current) => ({ ...current, q: queryDraft.trim(), limit: LISTING_PAGE_SIZE }),
        true,
      );
    }, 300);
    return () => window.clearTimeout(timer);
    // setFilters is redeclared each render; depending on it would re-arm the
    // timer continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDraft, filters.q]);

  useEffect(() => {
    setQueryDraft(filters.q);
  }, [filters.q]);

  function setFilter<K extends keyof ListingFilters>(key: K, value: ListingFilters[K]) {
    // Any filter change resets paging: keeping an expanded limit across a filter
    // switch would silently show a different slice than the count implies.
    setFilters((current) => ({ ...current, [key]: value, limit: LISTING_PAGE_SIZE }), true);
  }

  async function handleStatusChange() {
    if (!pendingStatusChange) return;
    const { listing, status, successLabel } = pendingStatusChange;
    setMutatingId(`${listing.id}:${status}`);
    try {
      const result = await updateAdminPropertyStatus({ data: { id: listing.id, status } });
      assertNoMutationError(result);
      await refreshListings();
      setPendingStatusChange(null);
      toast.success(`${listing.listing_no} ${successLabel}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setMutatingId(null);
    }
  }

  return (
    <AdminShell title="樓盤管理" description="管理售盤、租盤、相片、代理及發布狀態。">
      <AdminToolbar
        filters={
          <>
            {/* The server has supported `q` end to end all along; the page just
                never offered a box, so a listing outside the 80-row window was
                unreachable and read as deleted. */}
            <Input
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder="搜尋編號、標題或屋苑"
              aria-label="搜尋放盤"
              className="h-11 w-full sm:w-56 lg:h-9"
            />
            <Select value={filters.status} onValueChange={(value) => setFilter("status", value)}>
              <SelectTrigger className="h-11 w-[8.5rem] lg:h-9" aria-label="狀態">
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
              <SelectTrigger className="h-11 w-[7rem] lg:h-9" aria-label="類型">
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
              value={filters.featured}
              onValueChange={(value) => setFilter("featured", value as ListingFilters["featured"])}
            >
              <SelectTrigger className="h-11 w-[8rem] lg:h-9" aria-label="精選">
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
              <SelectTrigger className="h-11 w-[10rem] lg:h-9" aria-label="代理">
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
              className="h-11 lg:h-9"
              onClick={() => setFilters(() => defaultFilters, true)}
            >
              重設
            </Button>
          </>
        }
        actions={
          <Button asChild size="sm" className="h-11 lg:h-9">
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
            <div className="overflow-x-auto">
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
                      onStatusChange={(listing, status, successLabel) =>
                        setPendingStatusChange({ listing, status, successLabel })
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {/* Showed at most 80 of ~398 rows with no count and no pagination, so
              a listing further down the list read as deleted. */}
          <p className="text-sm text-muted-foreground">
            顯示 {rows.length} 筆
            {rows.length >= filters.limit ? `（上限 ${filters.limit} 筆，可能還有更多）` : ""}
          </p>
          {rows.length >= filters.limit ? (
            <Button
              type="button"
              variant="outline"
              disabled={loadingRows}
              onClick={() =>
                setFilters(
                  (current) => ({
                    ...current,
                    limit: Math.min(current.limit + LISTING_PAGE_SIZE, 200),
                  }),
                  true,
                )
              }
            >
              {loadingRows ? "載入中…" : "載入更多"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* 下架 and 已售／已租 used to fire on one click, sitting one button away
          from 編輯 -- a mis-tap on a tablet pulled a live listing off the public
          site with only a green toast as feedback and no undo control. */}
      <AdminConfirmDialog
        open={pendingStatusChange !== null}
        title={
          pendingStatusChange?.status === "offline" ? "確認下架此放盤？" : "確認更新放盤狀態？"
        }
        description={
          pendingStatusChange?.status === "offline"
            ? "下架後此放盤會即時從公開網站移除。你可以之後在編輯頁重新設為公開。"
            : "標記為已售／已租後，此放盤會從公開搜尋結果移除。"
        }
        confirmLabel="確認"
        confirmVariant="destructive"
        isPending={mutatingId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStatusChange(null);
        }}
        onConfirm={() => void handleStatusChange()}
      >
        {pendingStatusChange ? (
          <dl className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted-foreground">放盤編號</dt>
              <dd className="font-medium">{pendingStatusChange.listing.listing_no}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted-foreground">標題</dt>
              <dd className="max-w-[60%] truncate">{pendingStatusChange.listing.title_zh}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted-foreground">新狀態</dt>
              <dd className="font-semibold">
                {statusLabels[pendingStatusChange.status] ?? pendingStatusChange.status}
              </dd>
            </div>
          </dl>
        ) : null}
      </AdminConfirmDialog>
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
  onStatusChange: (listing: AdminListingRow, status: ListingStatus, successLabel: string) => void;
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
          <Button asChild variant="outline" size="sm" className="h-11 px-2 lg:h-8">
            <Link to="/admin/listings/$id" params={{ id: listing.id }}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              編輯
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-11 px-2 lg:h-8">
            <Link to="/property/$listingNo" params={{ listingNo: listing.listing_no }}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              公開預覽
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 px-2 lg:h-8"
            disabled={listing.status === "offline" || rowMutating || mutatingId === offlineMutation}
            onClick={() => onStatusChange(listing, "offline", "已下架")}
          >
            下架
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 px-2 lg:h-8"
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
