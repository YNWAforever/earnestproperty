import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { withStaffAuthHeaders } from "@/auth";
import { saveWhatsappTrackingLink } from "@/lib/neon/whatsapp-enquiries";
import { getWhatsappTrackingLinksPage } from "@/lib/neon/whatsapp-link-management";
import {
  prepareWhatsappLinkExport,
  getWhatsappLinkExportPage,
} from "@/lib/admin/whatsapp-link-export-api";
import type { LinkPageFilter } from "@/lib/neon/whatsapp-link-management.types";
import type { TrackingLink } from "@/lib/neon/whatsapp-enquiries.types";

type Page = Awaited<ReturnType<typeof getWhatsappTrackingLinksPage>>;
type Item = Page["items"][number];
const control = "min-h-11 rounded-md border bg-background px-3 text-sm";
const codeUrl = (code: string) => `${window.location.origin}/w/${code}`;

export function WhatsappLinksTable({
  revision,
  staff,
}: {
  revision: number;
  staff: { id: string; name: string | null; email: string | null }[];
}) {
  const [draftQ, setDraftQ] = useState("");
  const [filter, setFilter] = useState<LinkPageFilter>({ pageSize: 50 });
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<string[]>([]);
  const [page, setPage] = useState<Page | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editStaff, setEditStaff] = useState("");
  const [editVerified, setEditVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copyFallback, setCopyFallback] = useState("");
  const [notice, setNotice] = useState("");
  function updateFilter(next: LinkPageFilter) {
    setFilter(next);
    setCursor(undefined);
    setHistory([]);
    setSelected([]);
  }
  function reload() {
    setFilter((current) => ({ ...current }));
  }
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getWhatsappTrackingLinksPage({ ...filter, cursor })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((cause) => {
        if (!cancelled) {
          setPage(null);
          setError(cause instanceof Error ? cause.message : "連結未能載入");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, cursor, revision]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作未完成，請重試。");
    } finally {
      setBusy(false);
    }
  }
  async function save(
    link: Item,
    enabled: boolean,
    staffId = link.requestedStaffId,
    verified = Boolean(link.placementVerifiedAt),
  ) {
    const input: TrackingLink = {
      id: link.id,
      code: link.code,
      version: link.version,
      channelId: link.channelId,
      createdAt: link.createdAt,
      placementVerifiedAt: link.placementVerifiedAt,
      referenceMappingId: link.referenceMappingId,
      placementSource: link.placementSource,
      entryPointType: link.entryPointType,
      publicListingNo: link.publicListingNo,
      propertyId: link.propertyId,
      dealType: link.dealType,
      requestedStaffId: staffId || null,
      branchId: link.branchId,
      externalListingId: link.externalListingId,
      videoId: link.videoId,
      enabled,
      placementVerified: verified,
    };
    const {
      id,
      version,
      code: _code,
      channelId: _channel,
      createdAt: _created,
      placementVerifiedAt: _verifiedAt,
      ...fields
    } = input;
    await saveWhatsappTrackingLink(
      await withStaffAuthHeaders({
        data: {
          ...fields,
          id,
          expectedVersion: version,
        },
      }),
    );
    setEditing(null);
    setNotice("已儲存新版本；短連結不變。");
    reload();
  }
  async function copy(link: Item) {
    const url = codeUrl(link.code);
    try {
      await navigator.clipboard.writeText(url);
      setCopyFallback("");
      setNotice("已複製連結。");
    } catch {
      setCopyFallback(url);
      setNotice("複製未成功，請從下方欄位手動複製。");
    }
  }
  async function exportRows(scope: "selected" | "all") {
    const snapshot = await prepareWhatsappLinkExport({
      scope,
      selectedIds: scope === "selected" ? selected : undefined,
      filter: {
        q: filter.q,
        source: filter.source,
        staffId: filter.staffId,
        enabled: filter.enabled,
      },
    });
    const parts: string[] = [];
    let offset = 0;
    let more = true;
    while (more) {
      const result = await getWhatsappLinkExportPage({ snapshotId: snapshot.snapshotId, offset });
      parts.push(result.csv);
      more = result.nextOffset !== null;
      if (result.nextOffset !== null) offset = result.nextOffset;
    }
    const href = URL.createObjectURL(new Blob(parts, { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `earnest-whatsapp-links-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    setNotice(`已匯出 ${snapshot.total} 條連結。`);
  }
  const items = page?.items ?? [];
  return (
    <section aria-label="WhatsApp 連結管理" className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">連結管理</h2>
      <div className="flex flex-wrap items-end gap-2">
        <form
          className="flex min-w-56 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            updateFilter({ ...filter, q: draftQ.trim() || undefined });
          }}
        >
          <Input
            aria-label="搜尋連結或公開樓編"
            placeholder="樓編、短碼或投放 ID"
            value={draftQ}
            onChange={(event) => setDraftQ(event.target.value)}
          />
          <Button disabled={busy}>搜尋</Button>
        </form>
        <label className="text-sm">
          來源
          <select
            className={control}
            value={filter.source ?? ""}
            onChange={(event) =>
              updateFilter({
                ...filter,
                source: event.target.value
                  ? (event.target.value as LinkPageFilter["source"])
                  : undefined,
              })
            }
          >
            <option value="">全部</option>
            <option value="website">網站</option>
            <option value="28hse">28hse</option>
            <option value="youtube">YouTube</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label className="text-sm">
          同事
          <select
            className={control}
            value={filter.staffId ?? ""}
            onChange={(event) =>
              updateFilter({ ...filter, staffId: event.target.value || undefined })
            }
          >
            <option value="">全部</option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name ?? person.email ?? person.id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          狀態
          <select
            className={control}
            value={filter.enabled == null ? "" : String(filter.enabled)}
            onChange={(event) =>
              updateFilter({
                ...filter,
                enabled: event.target.value === "" ? undefined : event.target.value === "true",
              })
            }
          >
            <option value="">全部</option>
            <option value="true">可用</option>
            <option value="false">停用</option>
          </select>
        </label>
        <label className="text-sm">
          每頁
          <select
            className={control}
            value={filter.pageSize ?? 50}
            onChange={(event) =>
              updateFilter({ ...filter, pageSize: Number(event.target.value) as 25 | 50 | 100 })
            }
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}{" "}
          <button type="button" className="underline" onClick={reload}>
            重新載入
          </button>
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {copyFallback ? (
        <label className="block text-sm">
          手動複製連結
          <Input readOnly value={copyFallback} onFocus={(event) => event.target.select()} />
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>
          符合篩選 {page?.total ?? "—"} 條；本頁 {items.length} 條；已選 {selected.length} 條
        </span>
        <Button
          variant="outline"
          disabled={busy || selected.length === 0}
          onClick={() => void run(() => exportRows("selected"))}
        >
          匯出已選
        </Button>
        <Button
          variant="outline"
          disabled={busy || !page?.total}
          onClick={() => void run(() => exportRows("all"))}
        >
          匯出全部符合篩選
        </Button>
      </div>
      {loading ? <p role="status">正在載入連結…</p> : null}
      {!loading && !items.length && !error ? (
        <p className="rounded border p-6 text-center">沒有符合條件的連結。</p>
      ) : null}
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((link) => (
          <li key={link.id} className="min-w-0 rounded border p-3 text-sm">
            <label className="flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                aria-label={`選擇連結 ${link.code}`}
                checked={selected.includes(link.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, link.id]
                      : current.filter((id) => id !== link.id),
                  )
                }
              />
              <span>
                {link.publicListingNo ?? "一般查詢"} ·{" "}
                {link.dealType === "sale" ? "售" : link.dealType === "rent" ? "租" : "—"} ·{" "}
                {link.placementSource}
              </span>
            </label>
            <p className="mt-2 break-all font-mono text-xs">/w/{link.code}</p>
            <p className="mt-1">
              {link.enabled ? "可用" : "停用"} · v{link.version} ·{" "}
              {link.requestedStaffName ?? "總台"}
            </p>
            <p>
              開啟 {link.opens ?? "unknown"} · 歸因查詢 {link.enquiries ?? "unknown"}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer">投放與就緒詳情</summary>
              <p className="break-all">投放 ID：{link.sourcePlacementId ?? "未記錄"}</p>
              <p>核實：{link.placementVerifiedAt ?? "未核實"}</p>
              <p>指派就緒：{link.readiness}</p>
              <p>
                最近試送：
                {link.recentTest
                  ? `${link.recentTest.state} · ${link.recentTest.createdAt}`
                  : "unknown"}
              </p>
            </details>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void copy(link)}>
                複製
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setEditing(link);
                  setEditStaff(link.requestedStaffId ?? "");
                  setEditVerified(Boolean(link.placementVerifiedAt));
                }}
              >
                編輯
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => save(link, !link.enabled))}
              >
                {link.enabled ? "停用" : "重新啟用"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          disabled={busy || !history.length}
          onClick={() => {
            const previous = history.at(-1);
            setHistory((value) => value.slice(0, -1));
            setCursor(previous || undefined);
            setSelected([]);
          }}
        >
          上一頁
        </Button>
        <span className="text-sm">
          已瀏覽 {history.length * (filter.pageSize ?? 50) + items.length}／{page?.total ?? 0}
        </span>
        <Button
          variant="outline"
          disabled={busy || !page?.nextCursor}
          onClick={() => {
            setHistory((value) => [...value, cursor ?? ""]);
            setCursor(page?.nextCursor ?? undefined);
            setSelected([]);
          }}
        >
          下一頁
        </Button>
      </div>
      {editing ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="編輯追蹤連結"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-auto rounded-lg bg-background p-5">
            <h3 className="font-semibold">
              編輯 {editing.publicListingNo ?? "一般查詢"} · v{editing.version}
            </h3>
            <p className="break-all text-xs">/w/{editing.code} · 儲存後保留此短碼</p>
            <label className="block text-sm">
              指定同事
              <select
                className={`${control} w-full`}
                value={editStaff}
                onChange={(event) => setEditStaff(event.target.value)}
              >
                <option value="">總台／不指定</option>
                {staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name ?? person.email ?? person.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={editVerified}
                onChange={(event) => setEditVerified(event.target.checked)}
              />
              已人工核對投放
            </label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                取消
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() => save(editing, editing.enabled, editStaff, editVerified))
                }
              >
                儲存新版本
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
