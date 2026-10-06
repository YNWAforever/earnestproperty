import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createFileRoute, Link, useBlocker } from "@tanstack/react-router";
import { AdminShell, AdminError } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { staffSessionStore, useStaffSession } from "@/components/admin/staff-session";
import { fetchAdminAgents, fetchAdminEstateOptions } from "@/lib/neon/admin-data";
import { fetchAdminPropertyGroups } from "@/lib/neon/admin-properties";
import { snapshotWhatsappLinkOffers } from "@/lib/neon/whatsapp-link-selection";
import {
  linkOffersFromGroups,
  linkSeedKey,
  type LinkOfferSelection,
} from "@/lib/admin/whatsapp-link-selection";
import type { PropertyGroupFilters, PropertyGroupPage } from "@/lib/neon/admin-properties.types";
import { propertyStatusLabels, canSelectProperty } from "@/lib/admin/property-management-ui";
import { AdminPropertyTable } from "@/components/admin/AdminPropertyTable";
import { AdminPropertyBulkActions } from "@/components/admin/AdminPropertyBulkActions";
import { staffActionErrorText } from "@/components/admin/admin-error-text";

function parseListingSearch(search: Record<string, unknown>): PropertyGroupFilters {
  const result: PropertyGroupFilters = {};
  if (typeof search.q === "string" && search.q.trim()) result.q = search.q.trim().slice(0, 200);
  if (
    ["all", "active", "draft", "offline", "inactive", "sold", "rented"].includes(
      String(search.status),
    )
  )
    result.status = search.status as PropertyGroupFilters["status"];
  if (search.publication === "public") result.publication = "public";
  const deal = search.deal ?? search.deal_type;
  if (deal === "sale" || deal === "rent") result.deal = deal;
  for (const [key, legacy] of [
    ["estateId", "estate_id"],
    ["agentId", "agent_id"],
  ] as const) {
    const value = search[key] ?? search[legacy];
    if (typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)) result[key] = value;
  }
  if (
    ["updated", "propertyNo", "estate", "area", "salePrice", "rentPrice"].includes(
      String(search.sort),
    )
  )
    result.sort = search.sort as PropertyGroupFilters["sort"];
  if (search.direction === "asc" || search.direction === "desc")
    result.direction = search.direction;
  if ([30, 50, 100].includes(Number(search.pageSize))) result.pageSize = Number(search.pageSize);
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
  const { session } = useStaffSession(user?.id ?? null);
  if (!user || session?.status !== "ok")
    return (
      <AdminShell
        title="物業管理"
        description="一個樓編號，一個管理頁。出售與出租的價格和狀態獨立管理。"
      >
        {null}
      </AdminShell>
    );
  const identity = JSON.stringify([user.id, session.staffId, [...session.roles].sort()]);
  return <AdminListingsWorkspace key={identity} identity={identity} />;
}
function AdminListingsWorkspace({ identity }: { identity: string }) {
  const { user } = useNeonAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<PropertyGroupPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  // A submitted batch cannot be cancelled by leaving; preserve its outcome UI,
  // including same-path filter/page history changes until all responses settle.
  useBlocker({
    shouldBlockFn: () => bulkBusy,
    enableBeforeUnload: () => bulkBusy,
    disabled: !bulkBusy,
    withResolver: false,
  });
  useEffect(() => {
    setSelected(new Set());
  }, [search]);
  const sequence = useRef(0);
  const active = useRef(false);
  const lifetime = useRef(0);
  useLayoutEffect(() => {
    active.current = true;
    const epoch = ++lifetime.current;
    return () => {
      active.current = false;
      lifetime.current = epoch + 1;
      sequence.current++;
    };
  }, []);
  const isWorkspaceCurrent = useCallback(
    (epoch = lifetime.current) => {
      const current = staffSessionStore.getSnapshot();
      return (
        active.current &&
        lifetime.current === epoch &&
        current.session?.status === "ok" &&
        JSON.stringify([
          current.userId,
          current.session.staffId,
          [...current.session.roles].sort(),
        ]) === identity
      );
    },
    [identity],
  );
  const [query, setQuery] = useState(search.q ?? "");
  const [estates, setEstates] = useState<{ id: string; name_zh: string }[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string | null; email: string | null }[]>(
    [],
  );
  function filter(patch: Partial<PropertyGroupFilters>) {
    if (!isWorkspaceCurrent()) return;
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
    if (!user || !isWorkspaceCurrent()) return;
    let cancelled = false;
    Promise.all([fetchAdminEstateOptions(), fetchAdminAgents()])
      .then(([e, a]) => {
        if (!cancelled && isWorkspaceCurrent()) {
          setEstates(e);
          setAgents(a);
        }
      })
      .catch(() => {
        if (!cancelled && isWorkspaceCurrent()) setError("篩選選項未能載入，請重新整理。");
      });
    return () => {
      cancelled = true;
    };
  }, [user, isWorkspaceCurrent]);
  useEffect(() => {
    if (!user || !isWorkspaceCurrent()) return;
    const request = ++sequence.current;
    setBusy(true);

    setError(null);
    fetchAdminPropertyGroups({ data: search })
      .then((result) => {
        if (sequence.current === request && isWorkspaceCurrent()) {
          setData(result);
          setSelected(
            (current) =>
              new Set(
                [...current].filter((no) => result.rows.some((row) => row.propertyNo === no)),
              ),
          );
        }
      })
      .catch((e) => {
        if (sequence.current === request && isWorkspaceCurrent()) {
          setData(null);
          setError(e instanceof Error ? e.message : "未能載入物業");
        }
      })
      .finally(() => {
        if (sequence.current === request && isWorkspaceCurrent()) setBusy(false);
      });
    return () => {
      sequence.current = request + 1;
    };
  }, [user, search, retry, isWorkspaceCurrent]);
  function openLinkWizard(offers: LinkOfferSelection[], scope: string) {
    if (!isWorkspaceCurrent()) return;
    if (!offers.length) {
      setError("所選範圍沒有目前公開的租售盤。");
      return;
    }
    if (offers.length > 1000) {
      setError("展開後超過 1000 筆，請縮小篩選。");
      return;
    }
    try {
      sessionStorage.setItem(
        linkSeedKey,
        JSON.stringify({ offers, scope, capturedAt: new Date().toISOString() }),
      );
      window.location.assign("/admin/whatsapp-links");
    } catch {
      setError("未能保存樓盤選取，請允許此網站使用瀏覽器儲存空間後重試。尚未建立連結。");
    }
  }
  const selectClass = "h-11 min-w-0 rounded-md border bg-background px-3 text-sm";
  return (
    <AdminShell
      title="物業管理"
      description="一個樓編號，一個管理頁。出售與出租的價格和狀態獨立管理。"
    >
      <p className="mb-4">
        <Link to="/admin/property-sync" className="text-sm underline">
          查看盤源同步及待處理紀錄
        </Link>
      </p>
      <fieldset disabled={bulkBusy} className="mb-5 flex flex-wrap items-center gap-2">
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
          {["draft", "offline", "inactive", "sold", "rented"].map((s) => (
            <option key={s} value={s}>
              {propertyStatusLabels[s]}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          aria-label="刊登範圍"
          value={search.publication ?? "all"}
          onChange={(e) =>
            filter({ publication: e.target.value as PropertyGroupFilters["publication"] })
          }
        >
          <option value="all">所有管理紀錄</option>
          <option value="public">有公開樓編</option>
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
        <select
          className={selectClass}
          aria-label="排序欄位"
          value={search.sort ?? "updated"}
          onChange={(e) => filter({ sort: e.target.value as PropertyGroupFilters["sort"] })}
        >
          <option value="updated">更新時間</option>
          <option value="propertyNo">樓編</option>
          <option value="estate">屋苑</option>
          <option value="area">實用面積</option>
          <option value="salePrice">售價</option>
          <option value="rentPrice">租金</option>
        </select>
        <select
          className={selectClass}
          aria-label="排序方向"
          value={search.direction ?? "desc"}
          onChange={(e) => filter({ direction: e.target.value as "asc" | "desc" })}
        >
          <option value="desc">由高至低／由新至舊</option>
          <option value="asc">由低至高／由舊至新</option>
        </select>
        <select
          className={selectClass}
          aria-label="每頁物業數量"
          value={search.pageSize ?? 30}
          onChange={(e) => filter({ pageSize: Number(e.target.value) })}
        >
          {[30, 50, 100].map((n) => (
            <option key={n} value={n}>
              每頁 {n} 個
            </option>
          ))}
        </select>
        <Button variant="ghost" onClick={() => void navigate({ search: {}, replace: true })}>
          重設
        </Button>
        <Button asChild className="sm:ml-auto">
          <Link to="/admin/listings/new">新增物業／放盤</Link>
        </Button>
      </fieldset>
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
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm">
            <span>
              連結建立範圍：本頁已選 {selected.size} 個；全部符合目前篩選 {data.total} 個物業。
            </span>
            <Button
              variant="outline"
              disabled={linkBusy || busy || bulkBusy || !data.total || data.total > 1000}
              onClick={() => {
                const epoch = lifetime.current;
                if (!isWorkspaceCurrent(epoch)) return;
                setLinkBusy(true);
                setError(null);
                void snapshotWhatsappLinkOffers({ ...search, page: 1, pageSize: 100 })
                  .then((snapshot) => {
                    if (isWorkspaceCurrent(epoch))
                      openLinkWizard(
                        snapshot.offers,
                        `全部符合篩選 ${snapshot.totalProperties} 個物業；展開 ${snapshot.activeOffers} 筆租售`,
                      );
                  })
                  .catch((cause) => {
                    if (isWorkspaceCurrent(epoch))
                      setError(staffActionErrorText(cause, "未能擷取符合篩選的樓盤"));
                  })
                  .finally(() => {
                    if (isWorkspaceCurrent(epoch)) setLinkBusy(false);
                  });
              }}
            >
              下一步：預覽 WhatsApp 連結（全部符合篩選）
            </Button>
            {data.total > 1000 ? <span>超過 1000 個物業，請縮小篩選。</span> : null}
            {linkBusy ? <span role="status">正在擷取實際放盤 ID…</span> : null}
          </div>
          <AdminPropertyBulkActions
            key={JSON.stringify(search)}
            rows={data.rows.filter((row) => selected.has(row.propertyNo))}
            agents={agents}
            disabled={busy || bulkBusy}
            isWorkspaceCurrent={isWorkspaceCurrent}
            onBusy={setBulkBusy}
            onClear={() => setSelected(new Set())}
            onReload={() => setRetry((v) => v + 1)}
            onWhatsappLinks={(rows) =>
              openLinkWizard(linkOffersFromGroups(rows), `本頁已選 ${rows.length} 個物業`)
            }
            onSettled={(results) => {
              setSelected(
                (current) =>
                  new Set(
                    [...current].filter((no) => !results.some((r) => r.propertyNo === no && r.ok)),
                  ),
              );
              setRetry((v) => v + 1);
            }}
          />
          <AdminPropertyTable
            rows={data.rows}
            selected={selected}
            disabled={busy || bulkBusy}
            onToggle={(no) =>
              setSelected((current) => {
                const next = new Set(current);
                if (next.has(no)) next.delete(no);
                else next.add(no);
                return next;
              })
            }
            onToggleAll={() =>
              setSelected((current) => {
                const eligible = data.rows.filter(canSelectProperty).map((row) => row.propertyNo);
                return eligible.every((no) => current.has(no)) ? new Set() : new Set(eligible);
              })
            }
          />
          {data.rows.length === 0 ? (
            <p className="rounded-lg border p-8 text-center">沒有符合條件的物業，請調整篩選。</p>
          ) : null}
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button
              variant="outline"
              disabled={data.page <= 1 || busy || bulkBusy}
              onClick={() => void navigate({ search: { ...search, page: data.page - 1 } })}
            >
              上一頁
            </Button>
            <span className="text-sm">
              第 {data.page}／{Math.max(1, Math.ceil(data.total / data.pageSize))} 頁
            </span>
            <Button
              variant="outline"
              disabled={data.page * data.pageSize >= data.total || busy || bulkBusy}
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
