import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AdminShell, AdminError } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { fetchAdminAgents, fetchAdminEstateOptions } from "@/lib/neon/admin-data";
import { fetchAdminPropertyGroups } from "@/lib/neon/admin-properties";
import type { PropertyGroupFilters, PropertyGroupPage } from "@/lib/neon/admin-properties.types";
import {
  neutralPropertyTitle,
  offeringPrice,
  propertyStatusLabels,
} from "@/lib/admin/property-management-ui";

function parseListingSearch(search: Record<string, unknown>): PropertyGroupFilters {
  const result: PropertyGroupFilters = {};
  if (typeof search.q === "string" && search.q.trim()) result.q = search.q.trim().slice(0, 200);
  if (["all", "active", "draft", "offline", "sold", "rented"].includes(String(search.status)))
    result.status = search.status as PropertyGroupFilters["status"];
  const deal = search.deal ?? search.deal_type;
  if (deal === "sale" || deal === "rent") result.deal = deal;
  for (const [key, legacy] of [
    ["estateId", "estate_id"],
    ["agentId", "agent_id"],
  ] as const) {
    const value = search[key] ?? search[legacy];
    if (typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)) result[key] = value;
  }
  const page = Number(search.page);
  if (Number.isInteger(page) && page > 1) result.page = page;
  return result;
}
export const Route = createFileRoute("/admin/listings")({
  validateSearch: parseListingSearch,
  head: () => ({
    meta: [{ title: "物業管理｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminListings,
});
function AdminListings() {
  const { user } = useNeonAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<PropertyGroupPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  const [query, setQuery] = useState(search.q ?? "");
  const [estates, setEstates] = useState<{ id: string; name_zh: string }[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string | null; email: string | null }[]>(
    [],
  );
  function filter(patch: Partial<PropertyGroupFilters>) {
    void navigate({
      search: parseListingSearch({ ...search, ...patch, page: 1 }),
      replace: true,
      resetScroll: false,
    });
  }
  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim() !== (search.q ?? "")) filter({ q: query });
    }, 300);
    return () => clearTimeout(timer);
    // URL changes are deliberately debounced only for the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, search.q]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([fetchAdminEstateOptions(), fetchAdminAgents()])
      .then(([e, a]) => {
        if (!cancelled) {
          setEstates(e);
          setAgents(a);
        }
      })
      .catch(() => {
        if (!cancelled) setError("篩選選項未能載入，請重新整理。");
      });
    return () => {
      cancelled = true;
    };
  }, [user]);
  useEffect(() => {
    if (!user) return;
    const request = ++sequence.current;
    setBusy(true);
    setData(null);
    setError(null);
    fetchAdminPropertyGroups({ data: search })
      .then((result) => {
        if (sequence.current === request) setData(result);
      })
      .catch((e) => {
        if (sequence.current === request) setError(e instanceof Error ? e.message : "未能載入物業");
      })
      .finally(() => {
        if (sequence.current === request) setBusy(false);
      });
    return () => {
      sequence.current = request + 1;
    };
  }, [user, search, retry]);
  const selectClass = "h-11 min-w-0 rounded-md border bg-background px-3 text-sm";
  return (
    <AdminShell
      title="物業管理"
      description="一個樓編號，一個管理頁。出售與出租的價格和狀態獨立管理。"
    >
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Input
          aria-label="搜尋物業"
          placeholder="搜尋樓編號、舊放盤編號或屋苑"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 w-full sm:w-72"
        />
        <select
          className={selectClass}
          aria-label="狀態"
          value={search.status ?? "active"}
          onChange={(e) => filter({ status: e.target.value as PropertyGroupFilters["status"] })}
        >
          <option value="active">目前公開</option>
          <option value="all">全部（含已結束）</option>
          {["draft", "offline", "sold", "rented"].map((s) => (
            <option key={s} value={s}>
              {propertyStatusLabels[s]}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          aria-label="放盤類型"
          value={search.deal ?? "all"}
          onChange={(e) => filter({ deal: e.target.value as "all" | "sale" | "rent" })}
        >
          <option value="all">出售及出租</option>
          <option value="sale">出售</option>
          <option value="rent">出租</option>
        </select>
        <select
          className={selectClass}
          aria-label="屋苑"
          value={search.estateId ?? ""}
          onChange={(e) => filter({ estateId: e.target.value || undefined })}
        >
          <option value="">全部屋苑</option>
          {estates.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name_zh}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          aria-label="代理"
          value={search.agentId ?? ""}
          onChange={(e) => filter({ agentId: e.target.value || undefined })}
        >
          <option value="">全部代理</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name ?? a.email ?? "未命名代理"}
            </option>
          ))}
        </select>
        <Button variant="ghost" onClick={() => void navigate({ search: {}, replace: true })}>
          重設
        </Button>
        <Button asChild className="sm:ml-auto">
          <Link to="/admin/listings/new">新增物業／放盤</Link>
        </Button>
      </div>
      {error ? (
        <div className="mb-4">
          <AdminError message={error} />
          <Button variant="outline" onClick={() => setRetry((v) => v + 1)}>
            重新載入
          </Button>
        </div>
      ) : null}
      {busy ? (
        <p role="status" className="p-8 text-center">
          正在載入物業…
        </p>
      ) : null}
      {data ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            共 {data.total} 個物業 · 同一物業的租售只計一次
          </p>
          <div className="space-y-3">
            {data.rows.map((row) => (
              <article
                key={row.propertyNo}
                className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-[minmax(0,2fr)_1fr_1fr_auto] md:items-center"
              >
                <div className="flex min-w-0 gap-3">
                  {row.image ? (
                    <img src={row.image} alt="" className="h-20 w-24 rounded-md object-cover" />
                  ) : (
                    <div className="flex h-20 w-24 shrink-0 items-center justify-center rounded-md bg-muted text-xs">
                      暫無相片
                    </div>
                  )}
                  <div className="min-w-0">
                    <Link
                      className="font-semibold hover:underline"
                      to="/admin/listings/$id"
                      params={{ id: row.propertyNo }}
                    >
                      {neutralPropertyTitle(row.title)}
                    </Link>
                    <p className="break-all text-sm text-muted-foreground">#{row.propertyNo}</p>
                    <p className="text-sm">
                      {row.estateName ?? "未填屋苑"} ·{" "}
                      {row.saleableArea === null ? "未填實用面積" : `${row.saleableArea} 實呎`}
                    </p>
                    {row.reviewRequired || row.unlinked ? (
                      <p className="text-xs text-amber-700">
                        {row.unlinked ? "編號待核實" : "資料有差異，待核實"}
                      </p>
                    ) : null}
                  </div>
                </div>
                {(["sale", "rent"] as const).map((deal) => (
                  <div key={deal} className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">
                      {deal === "sale" ? "出售" : "出租"} ·{" "}
                      {row.offerings[deal]
                        ? (propertyStatusLabels[row.offerings[deal]!.status] ??
                          row.offerings[deal]!.status)
                        : "未開放"}
                    </p>
                    <p className="font-semibold tabular-nums">
                      {offeringPrice(row.offerings[deal])}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.offerings[deal]?.agentName ?? "—"}
                    </p>
                  </div>
                ))}
                <div className="flex gap-2 md:flex-col">
                  <Button asChild variant="outline">
                    <Link to="/admin/listings/$id" params={{ id: row.propertyNo }}>
                      管理物業
                    </Link>
                  </Button>
                  <Button asChild variant="ghost">
                    <Link to="/property/$listingNo" params={{ listingNo: row.propertyNo }}>
                      公開預覽
                    </Link>
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {data.rows.length === 0 ? (
            <p className="rounded-lg border p-8 text-center">沒有符合條件的物業，請調整篩選。</p>
          ) : null}
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button
              variant="outline"
              disabled={data.page <= 1 || busy}
              onClick={() => void navigate({ search: { ...search, page: data.page - 1 } })}
            >
              上一頁
            </Button>
            <span className="text-sm">
              第 {data.page}／{Math.max(1, Math.ceil(data.total / data.pageSize))} 頁
            </span>
            <Button
              variant="outline"
              disabled={data.page * data.pageSize >= data.total || busy}
              onClick={() => void navigate({ search: { ...search, page: data.page + 1 } })}
            >
              下一頁
            </Button>
          </div>
        </>
      ) : null}
    </AdminShell>
  );
}
