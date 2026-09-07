import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AdminError } from "./AdminShell";
import { AdminConfirmDialog } from "./AdminConfirmDialog";
import { ImageUploader } from "@/components/dashboard/ImageUploader";
import { useRouteLeaveGuard } from "@/hooks/use-unsaved-changes-guard";
import {
  fetchAdminAgents,
  fetchAdminEstateOptions,
  fetchAdminDistrictOptions,
} from "@/lib/neon/admin-data";
import {
  fetchAdminManagedProperty,
  saveAdminPropertyManagement,
} from "@/lib/neon/admin-properties";
import type {
  ManagedPropertyDetail,
  PropertyManagementInput,
  SharedPropertyFields,
} from "@/lib/neon/admin-properties.types";
import {
  changedFields,
  neutralPropertyTitle,
  offeringDraft,
  offeringPatch,
  offeringPrice,
  existingOfferingDeals,
  propertyStatusLabels,
} from "@/lib/admin/property-management-ui";

type Tab = "shared" | "sale" | "rent";
const labels: Record<string, string> = {
  title_zh: "中文標題",
  title_en: "英文標題",
  estate_id: "屋苑",
  district_slug: "分區",
  address: "地址",
  saleable_area: "實用面積（平方呎）",
  bedrooms: "睡房",
  bathrooms: "浴室",
  floor: "樓層",
  description: "物業介紹",
  images: "相片",
  seo_title: "SEO 標題",
  seo_description: "SEO 描述",
  video_url: "影片網址",
};
const control = "h-11 w-full rounded-md border bg-background px-3 text-sm";
export function AdminPropertyWorkspace({
  initial,
  sourceId,
}: {
  initial: ManagedPropertyDetail;
  sourceId: string;
}) {
  const [detail, setDetail] = useState(initial);
  const [tab, setTab] = useState<Tab>(
    () =>
      (["sale", "rent"].includes(initial.history.find((h) => h.id === sourceId)?.dealType ?? "")
        ? initial.history.find((h) => h.id === sourceId)!.dealType
        : "shared") as Tab,
  );
  const [shared, setShared] = useState(initial.shared);
  const [confirmedFields, setConfirmedFields] = useState<string[]>([]);
  const sharedPatch = {
    ...changedFields(detail.shared, shared),
    ...Object.fromEntries(
      confirmedFields.map((key) => [key, shared[key as keyof SharedPropertyFields]]),
    ),
  };
  const [offer, setOffer] = useState(() =>
    offeringDraft(initial.offerings[tab === "rent" ? "rent" : "sale"]),
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [pending, setPending] = useState<{
    scope: "sale" | "rent" | "all";
    status: "offline" | "sold" | "rented";
  } | null>(null);
  const [nextTab, setNextTab] = useState<Tab | null>(null);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [estates, setEstates] = useState<{ id: string; name_zh: string }[]>([]);
  const [districts, setDistricts] = useState<{ slug: string; name_zh: string }[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string | null; email: string | null }[]>(
    [],
  );
  const current = tab === "shared" ? null : detail.offerings[tab];
  const dirty =
    tab === "shared"
      ? Object.keys(sharedPatch).length > 0
      : JSON.stringify(offer) !== JSON.stringify(offeringDraft(current));
  const guard = useRouteLeaveGuard(dirty || uploading || busy);
  const editable =
    detail.managementAvailable &&
    !refreshNeeded &&
    (tab === "shared" ? detail.editableShared : (current?.editable ?? detail.editableShared));
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAdminEstateOptions(), fetchAdminDistrictOptions(), fetchAdminAgents()])
      .then(([e, d, a]) => {
        if (!cancelled) {
          setEstates(e);
          setDistricts(d);
          setAgents(a);
        }
      })
      .catch(() => {
        if (!cancelled) setError("選項未能載入，請重新整理。");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  function choose(next: Tab) {
    setTab(next);
    setShared(detail.shared);
    setConfirmedFields([]);
    setOffer(offeringDraft(next === "shared" ? null : detail.offerings[next]));
    setNextTab(null);
    setError(null);
  }
  async function reload() {
    const fresh = await fetchAdminManagedProperty({ data: { id: detail.propertyNo } });
    if (!fresh) throw new Error("物業不存在或已失去存取權限");
    setDetail(fresh);
    setShared(fresh.shared);
    setConfirmedFields([]);
    setOffer(offeringDraft(tab === "shared" ? null : fresh.offerings[tab]));
    setRefreshNeeded(false);
    setError(null);
  }
  async function save(
    scope: PropertyManagementInput["scope"],
    payload: PropertyManagementInput["payload"],
  ) {
    if (!Object.keys(payload).length) {
      toast.info("沒有需要儲存的修改");
      return;
    }
    setBusy(true);
    setError(null);
    let saved = false;
    try {
      await saveAdminPropertyManagement({
        data: { propertyNo: detail.propertyNo, expectedVersion: detail.version, scope, payload },
      });
      saved = true;
      setPending(null);
      await reload();
      toast.success("已儲存物業資料");
    } catch (e) {
      setError(
        saved
          ? "修改已儲存，但畫面未能更新。請重新載入後繼續。"
          : e instanceof Error
            ? e.message
            : "未能儲存，請重試",
      );
      if (saved) setRefreshNeeded(true);
    } finally {
      setBusy(false);
    }
  }
  function submit() {
    try {
      void save(tab, tab === "shared" ? sharedPatch : offeringPatch(current, offer, tab));
    } catch (e) {
      setError(e instanceof Error ? e.message : "請檢查輸入資料");
    }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{neutralPropertyTitle(detail.title)}</h2>
          <p className="text-sm text-muted-foreground">樓編號 #{detail.propertyNo}</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/property/$listingNo" params={{ listingNo: detail.propertyNo }}>
            公開預覽
          </Link>
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {existingOfferingDeals(detail.offerings).map((deal) => (
          <div key={deal} className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">
              {deal === "sale" ? "出售" : "出租"} ·{" "}
              {detail.offerings[deal]
                ? (propertyStatusLabels[detail.offerings[deal]!.status] ??
                  detail.offerings[deal]!.status)
                : "—"}
            </p>
            <p className="text-xl font-semibold">{offeringPrice(detail.offerings[deal])}</p>
          </div>
        ))}
      </div>
      {!detail.managementAvailable ? (
        <p role="status" className="rounded-lg border bg-amber-50 p-4 text-sm text-amber-900">
          物業資料可供查閱。管理功能正在準備，暫時未能儲存修改。
        </p>
      ) : null}
      {detail.conflicts.length ? (
        <details className="rounded-lg border border-amber-300 p-4">
          <summary className="cursor-pointer font-medium">
            {detail.conflicts.length} 項資料有差異，請核實
          </summary>
          <p className="my-2 text-sm">
            以下列出來源的不同內容。只有你修改的欄位才會套用到租售資料。
          </p>
          <dl className="space-y-3 text-sm">
            {detail.conflicts.map((c) => (
              <div key={c.field}>
                <dt className="font-medium">{labels[c.field] ?? c.field}</dt>
                <dd className="break-words whitespace-pre-wrap text-muted-foreground">
                  {c.values.join(" ／ ")}
                  {tab === "shared" && Object.hasOwn(shared, c.field) ? (
                    <label className="mt-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        disabled={!editable || busy || uploading}
                        checked={confirmedFields.includes(c.field)}
                        onChange={(e) =>
                          setConfirmedFields((keys) =>
                            e.target.checked
                              ? [...keys, c.field]
                              : keys.filter((key) => key !== c.field),
                          )
                        }
                      />
                      以目前表單的「{labels[c.field] ?? c.field}」統一此欄位（儲存後套用）
                    </label>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      {error ? (
        <div role="alert">
          <AdminError message={error} />
          <Button
            variant="outline"
            disabled={busy || uploading}
            onClick={() => setReloadConfirm(true)}
          >
            重新載入最新資料
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2" aria-label="管理範圍">
        {(["shared", "sale", "rent"] as const).map((t) => (
          <Button
            key={t}
            variant={tab === t ? "default" : "outline"}
            disabled={busy || uploading}
            aria-pressed={tab === t}
            onClick={() => {
              if (t !== tab) {
                if (dirty) setNextTab(t);
                else choose(t);
              }
            }}
          >
            {t === "shared" ? "共用資料與相片" : t === "sale" ? "出售設定" : "出租設定"}
          </Button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="rounded-xl border bg-card p-4 sm:p-6"
      >
        <fieldset disabled={!editable || busy} className="space-y-5">
          <legend className="mb-3 text-lg font-semibold">
            {tab === "shared" ? "共用物業資料" : tab === "sale" ? "出售設定" : "出租設定"}
          </legend>
          {!editable && detail.managementAvailable ? (
            <p className="text-sm text-muted-foreground">
              {refreshNeeded
                ? "請先重新載入最新資料。"
                : "你目前只有查閱權限，請由負責代理或管理員更新。"}
            </p>
          ) : null}
          {tab === "shared" ? (
            <>
              <p className="text-sm text-muted-foreground">
                相片、地址及屋苑資料共用。儲存只會更新本次修改的欄位。
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    "title_zh",
                    "title_en",
                    "address",
                    "floor",
                    "saleable_area",
                    "bedrooms",
                    "bathrooms",
                    "video_url",
                  ] as const
                ).map((key) => (
                  <label key={key} className="space-y-1 text-sm">
                    <span>{labels[key]}</span>
                    <Input
                      className="h-11"
                      type={
                        ["saleable_area", "bedrooms", "bathrooms"].includes(key) ? "number" : "text"
                      }
                      min="0"
                      step={key === "saleable_area" ? "any" : 1}
                      required={key === "title_zh"}
                      value={shared[key] ?? ""}
                      onChange={(e) =>
                        setShared((s) => ({
                          ...s,
                          [key]: ["saleable_area", "bedrooms", "bathrooms"].includes(key)
                            ? e.target.value === ""
                              ? null
                              : Number(e.target.value)
                            : e.target.value || (key === "title_zh" ? "" : null),
                        }))
                      }
                    />
                  </label>
                ))}
                <label className="space-y-1 text-sm">
                  <span>屋苑</span>
                  <select
                    className={control}
                    value={shared.estate_id ?? ""}
                    onChange={(e) =>
                      setShared((s) => ({ ...s, estate_id: e.target.value || null }))
                    }
                  >
                    <option value="">未指定屋苑</option>
                    {estates.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name_zh}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span>分區</span>
                  <select
                    className={control}
                    value={shared.district_slug}
                    onChange={(e) => setShared((s) => ({ ...s, district_slug: e.target.value }))}
                  >
                    <option value="">未指定分區</option>
                    {districts.map((d) => (
                      <option key={d.slug} value={d.slug}>
                        {d.name_zh}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span>物業介紹</span>
                <Textarea
                  rows={5}
                  value={shared.description ?? ""}
                  onChange={(e) =>
                    setShared((s) => ({ ...s, description: e.target.value || null }))
                  }
                />
              </label>
              <div>
                <label htmlFor="property-images" className="mb-2 block text-sm">
                  相片（第一張為封面）
                </label>
                <ImageUploader
                  inputId="property-images"
                  disabled={!editable || busy}
                  value={shared.images}
                  onUploadingChange={setUploading}
                  onChange={(value) =>
                    setShared((s) => ({
                      ...s,
                      images: typeof value === "function" ? value(s.images) : value,
                    }))
                  }
                />
              </div>
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  搜尋引擎設定（SEO）
                </summary>
                <div className="mt-3 space-y-3">
                  {(["seo_title", "seo_description"] as const).map((key) => (
                    <label key={key} className="block space-y-1 text-sm">
                      <span>{labels[key]}</span>
                      <Textarea
                        value={shared[key] ?? ""}
                        onChange={(e) =>
                          setShared((s) => ({ ...s, [key]: e.target.value || null }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {current ? "這些修改只套用到" : "儲存後會新增"}
                {tab === "sale" ? "出售" : "出租"}設定。{tab === "sale" ? "出租" : "出售"}
                價格及狀態保持獨立。
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span>{tab === "sale" ? "售價（港元）" : "月租（港元）"}</span>
                  <Input
                    className="h-11"
                    type="number"
                    min="0"
                    step="any"
                    value={offer.amount}
                    onChange={(e) => setOffer((s) => ({ ...s, amount: e.target.value }))}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span>{tab === "sale" ? "出售" : "出租"}狀態</span>
                  <select
                    className={control}
                    value={offer.status}
                    onChange={(e) => setOffer((s) => ({ ...s, status: e.target.value }))}
                  >
                    {[
                      "draft",
                      "active",
                      "offline",
                      ...(current?.status === "inactive" ? ["inactive"] : []),
                      tab === "sale" ? "sold" : "rented",
                    ].map((s) => (
                      <option key={s} value={s}>
                        {propertyStatusLabels[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span>負責代理</span>
                  <select
                    className={control}
                    value={offer.agentId}
                    onChange={(e) => setOffer((s) => ({ ...s, agentId: e.target.value }))}
                  >
                    <option value="">未分配</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name ?? a.email ?? "未命名代理"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span>{tab === "sale" ? "出售" : "出租"}補充說明</span>
                <Textarea
                  rows={5}
                  value={offer.description}
                  onChange={(e) => setOffer((s) => ({ ...s, description: e.target.value }))}
                />
              </label>
            </>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button
              type="submit"
              disabled={uploading || busy || (!dirty && (tab === "shared" || !!current))}
            >
              {busy
                ? "儲存中…"
                : uploading
                  ? "相片上載中…"
                  : tab === "shared"
                    ? "儲存共用資料"
                    : tab === "sale"
                      ? "儲存出售設定"
                      : "儲存出租設定"}
            </Button>
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {dirty ? "有未儲存修改" : "所有修改已儲存"}
            </span>
          </div>
        </fieldset>
      </form>
      <div className="flex flex-wrap gap-2">
        {(["sale", "rent"] as const).map((deal) =>
          detail.offerings[deal] ? (
            <Button
              key={deal}
              variant="outline"
              disabled={
                busy ||
                uploading ||
                dirty ||
                !detail.managementAvailable ||
                refreshNeeded ||
                !detail.offerings[deal]?.editable ||
                detail.offerings[deal]?.status === "offline"
              }
              onClick={() => setPending({ scope: deal, status: "offline" })}
            >
              下架{deal === "sale" ? "出售" : "出租"}
            </Button>
          ) : null,
        )}
        <Button
          variant="outline"
          disabled={
            busy ||
            uploading ||
            dirty ||
            !detail.managementAvailable ||
            refreshNeeded ||
            !detail.editableShared
          }
          onClick={() => setPending({ scope: "all", status: "offline" })}
        >
          全部下架
        </Button>
      </div>
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer font-medium">
          來源及歷史記錄（{detail.history.length}）
        </summary>
        <ul className="mt-3 divide-y text-sm">
          {detail.history.map((h) => (
            <li key={h.id} className="flex flex-wrap justify-between gap-2 py-3">
              <span className="break-all">
                {h.listingNo} · {h.dealType === "sale" ? "出售" : "出租"}
              </span>
              <span>
                {propertyStatusLabels[h.status] ?? h.status} · {h.current ? "目前版本" : "歷史記錄"}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <AdminConfirmDialog
        open={pending !== null}
        title={
          pending?.scope === "all"
            ? "確認全部下架？"
            : `確認下架${pending?.scope === "sale" ? "出售" : "出租"}？`
        }
        description={
          pending?.scope === "all"
            ? "此物業的出售和出租都會從公開網站移除。歷史記錄仍會保留。"
            : "只會下架所選類型，另一類型的狀態不變。"
        }
        confirmLabel="確認下架"
        confirmVariant="destructive"
        isPending={busy}
        error={error}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        onConfirm={() => {
          if (pending) void save(pending.scope, { status: pending.status });
        }}
      />
      <AdminConfirmDialog
        open={nextTab !== null}
        title="尚未儲存修改"
        description="切換管理範圍會放棄目前修改。你可以取消並先儲存。"
        confirmLabel="放棄修改並切換"
        onOpenChange={(open) => {
          if (!open) setNextTab(null);
        }}
        onConfirm={() => {
          if (nextTab) choose(nextTab);
        }}
      />
      <AdminConfirmDialog
        open={reloadConfirm}
        title="重新載入最新資料？"
        description="未儲存的修改會被最新資料取代。"
        confirmLabel="重新載入"
        isPending={busy}
        onOpenChange={setReloadConfirm}
        onConfirm={() => {
          setBusy(true);
          void reload()
            .then(() => setReloadConfirm(false))
            .catch((e) => setError(e instanceof Error ? e.message : "載入失敗"))
            .finally(() => setBusy(false));
        }}
      />
      {guard.dialog}
    </div>
  );
}
