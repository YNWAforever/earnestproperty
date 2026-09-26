import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { withStaffAuthHeaders } from "@/auth";
import { searchWhatsappLinkOffers } from "@/lib/neon/whatsapp-enquiries";
import {
  previewWhatsappLinkBatch,
  commitWhatsappLinkChunk,
  getWhatsappLinkBatchResult,
} from "@/lib/neon/whatsapp-link-batches";
import type { BatchRowDraft } from "@/lib/whatsapp-enquiries/link-batch-policy";
import type { LinkOfferSelection } from "@/lib/admin/whatsapp-link-selection";
import {
  linkBatchProgressKey,
  reconcileLinkBatch,
  runWhatsappLinkBatch,
  type LinkBatchProgress,
} from "@/lib/admin/whatsapp-link-batch-client";
import { WhatsappBatchResult } from "./WhatsappBatchResult";

type Staff = { id: string; name: string | null; email: string | null; active?: boolean };
type Source = BatchRowDraft["input"]["placementSource"];
type Routing = "property-agent" | "uniform" | "per-row" | "reception";
const control = "min-h-11 w-full rounded-md border bg-background px-3 text-sm";
const label = (offer: LinkOfferSelection) =>
  `${offer.publicListingNo} · ${offer.dealType === "sale" ? "售" : "租"} · ${offer.title} · ${offer.price == null ? "價格待核實" : offer.price.toLocaleString("en-HK")}`;
const api = {
  preview: previewWhatsappLinkBatch,
  commit: commitWhatsappLinkChunk,
  read: getWhatsappLinkBatchResult,
};

export function WhatsappLinkWizard({
  seed,
  agents,
  onCreated,
}: {
  seed: LinkOfferSelection[];
  agents: Staff[];
  onCreated: () => void;
}) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<"sales" | "reception">("sales");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<LinkOfferSelection[]>([]);
  const [selected, setSelected] = useState<LinkOfferSelection[]>([]);
  const [source, setSource] = useState<Source>("website");
  const [placement, setPlacement] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState(false);
  const [routing, setRouting] = useState<Routing>("reception");
  const [staffId, setStaffId] = useState("");
  const [perRowStaff, setPerRowStaff] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<LinkBatchProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = (offer: LinkOfferSelection) => offer.propertyId;
  useEffect(() => {
    if (seed.length) {
      setSelected(seed);
      setMode("sales");
    }
  }, [seed]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(linkBatchProgressKey);
      if (!raw) return;
      const stored = JSON.parse(raw) as LinkBatchProgress;
      if (stored.batchId && Array.isArray(stored.rows) && Array.isArray(stored.chunkIds)) {
        setProgress(stored);
        setStep(5);
      }
    } catch {
      sessionStorage.removeItem(linkBatchProgressKey);
    }
  }, []);
  const save = (next: LinkBatchProgress) => {
    sessionStorage.setItem(linkBatchProgressKey, JSON.stringify(next));
    setProgress(next);
  };
  const rows = useMemo<BatchRowDraft[]>(() => {
    const offers = mode === "reception" ? [null] : selected;
    return offers.map((offer) => {
      const placementId = offer
        ? source === "website"
          ? "website:primary"
          : source === "other"
            ? placement[key(offer)] || "other:primary"
            : placement[key(offer)] || ""
        : source === "website"
          ? "website:reception"
          : placement.reception || "";
      const requestedStaffId =
        routing === "property-agent"
          ? offer?.agentId || null
          : routing === "uniform"
            ? staffId || null
            : routing === "per-row"
              ? perRowStaff[offer ? key(offer) : "reception"] || null
              : null;
      return {
        rowKey: crypto.randomUUID(),
        placementId,
        input: {
          placementSource: source,
          entryPointType: mode,
          propertyId: offer?.propertyId ?? null,
          publicListingNo: offer?.publicListingNo ?? null,
          dealType: offer?.dealType ?? null,
          requestedStaffId,
          referenceMappingId: null,
          externalListingId: source === "28hse" ? placementId : null,
          videoId: source === "youtube" ? placementId : null,
          placementVerified: verified,
          enabled: true,
        },
      };
    });
  }, [mode, selected, source, placement, routing, staffId, perRowStaff, verified]);
  // rowKey must remain stable between dry-run and commit; preview stores this immutable copy.
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作未完成，請重試。");
    } finally {
      setBusy(false);
    }
  }
  async function dryRun() {
    if (mode === "sales" && !selected.length) throw new Error("請先選擇至少一筆樓盤租售。");
    if (rows.length > 1000) throw new Error("最多 1000 筆，請縮小篩選。");
    if (!verified) throw new Error("請先人工核對刊登位置。");
    if (rows.some((row) => !row.placementId)) throw new Error("每筆投放都需要來源識別碼。");
    if (routing === "property-agent" && selected.some((offer) => !offer.agentId))
      throw new Error("有樓盤未指派代理；請先補指派，或明確選總台。");
    if (routing === "uniform" && !staffId) throw new Error("請選擇指定同事。");
    if (routing === "per-row" && rows.some((row) => !row.input.requestedStaffId))
      throw new Error("請逐行選擇同事。");
    const batchId = crypto.randomUUID();
    const preview = await api.preview({ batchId, rows });
    const next: LinkBatchProgress = {
      batchId,
      rows,
      preview,
      chunkIds: Array.from({ length: Math.ceil(rows.length / 50) }, () => crypto.randomUUID()),
      nextChunk: 0,
      completed: [],
      uncertain: false,
    };
    save(next);
    setStep(4);
  }
  async function submit() {
    if (!progress) return;
    let current = progress;
    if (current.uncertain) {
      current = reconcileLinkBatch(current, (await api.read(current.batchId)).operations);
      save(current);
    }
    if (Date.parse(current.preview.expiresAt) <= Date.now() + 30_000) {
      const refreshed = await api.preview({ batchId: current.batchId, rows: current.rows });
      current = { ...current, preview: refreshed };
      save(current);
      if (refreshed.counts.blocked) {
        setStep(4);
        throw new Error("資料已改變，請核對新的預覽阻止原因。");
      }
    }
    const result = await runWhatsappLinkBatch(current, api, save);
    save(result);
    setStep(5);
    onCreated();
  }
  async function recover() {
    if (!progress) return;
    const result = reconcileLinkBatch(progress, (await api.read(progress.batchId)).operations);
    save(result);
  }
  const toggle = (offer: LinkOfferSelection) =>
    setSelected((current) =>
      current.some((item) => item.propertyId === offer.propertyId)
        ? current.filter((item) => item.propertyId !== offer.propertyId)
        : [...current, offer],
    );
  const hasActiveBatch = progress && progress.nextChunk < progress.chunkIds.length;
  return (
    <section aria-label="建立 WhatsApp 連結" className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">建立 WhatsApp 連結</h2>
      <p className="text-sm text-muted-foreground">
        第 {step}／5 步：
        {["選擇樓盤", "來源與投放", "跟進路線", "預覽核對", "提交與結果"][step - 1]}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {step === 1 ? (
        <div className="space-y-3">
          <fieldset className="flex flex-wrap gap-4">
            <legend className="font-medium">查詢入口</legend>
            <label>
              <input type="radio" checked={mode === "sales"} onChange={() => setMode("sales")} />{" "}
              樓盤查詢
            </label>
            <label>
              <input
                type="radio"
                checked={mode === "reception"}
                onChange={() => setMode("reception")}
              />{" "}
              公司一般查詢
            </label>
          </fieldset>
          {mode === "sales" ? (
            <>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () =>
                    setFound(
                      await searchWhatsappLinkOffers(
                        await withStaffAuthHeaders({ data: { q: query } }),
                      ),
                    ),
                  );
                }}
              >
                <Input
                  aria-label="搜尋公開樓編或物業"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="公開樓編或名稱"
                />
                <Button disabled={busy}>搜尋</Button>
              </form>
              <ul className="max-h-64 space-y-1 overflow-auto">
                {found.map((offer) => (
                  <li key={offer.propertyId}>
                    <label className="flex min-h-11 items-center gap-2 rounded border p-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.some((item) => item.propertyId === offer.propertyId)}
                        onChange={() => toggle(offer)}
                      />{" "}
                      {label(offer)}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-sm">
                已選 {selected.length} 筆租售。搜尋結果每次最多 50 筆；從物業管理可選更多。
              </p>
              <ul className="max-h-36 overflow-auto text-sm">
                {selected.map((offer) => (
                  <li key={offer.propertyId} className="py-1">
                    {label(offer)}{" "}
                    <button type="button" className="underline" onClick={() => toggle(offer)}>
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm">
              此入口沒有指定樓盤；只有明確選擇「公司一般查詢」才會建立一般連結。
            </p>
          )}
          <Button
            disabled={busy || (mode === "sales" && !selected.length)}
            onClick={() => setStep(2)}
          >
            下一步：來源
          </Button>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="space-y-3">
          <label className="block text-sm">
            刊登來源
            <select
              className={control}
              value={source}
              onChange={(event) => {
                setSource(event.target.value as Source);
                setPlacement({});
              }}
            >
              <option value="website">網站</option>
              <option value="28hse">28hse</option>
              <option value="youtube">YouTube</option>
              <option value="other">其他</option>
            </select>
          </label>
          {source !== "website" ? (
            <div className="max-h-72 space-y-2 overflow-auto">
              {(mode === "sales" ? selected : [null]).map((offer) => {
                const offerKey = offer ? key(offer) : "reception";
                return (
                  <label key={offerKey} className="block text-sm">
                    {offer ? label(offer) : "一般查詢"} ·{" "}
                    {source === "28hse"
                      ? "28hse 廣告 ID"
                      : source === "youtube"
                        ? "YouTube 影片 ID"
                        : "投放識別碼"}
                    <Input
                      value={placement[offerKey] ?? ""}
                      onChange={(event) =>
                        setPlacement((current) => ({ ...current, [offerKey]: event.target.value }))
                      }
                    />
                  </label>
                );
              })}
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={verified}
              onChange={(event) => setVerified(event.target.checked)}
            />{" "}
            已人工核對刊登位置
          </label>
          <p className="text-xs text-muted-foreground">建立連結不會自動刊登到外部平台。</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>
              上一步
            </Button>
            <Button onClick={() => setStep(3)}>下一步：跟進</Button>
          </div>
        </div>
      ) : null}
      {step === 3 ? (
        <div className="space-y-3">
          <label className="block text-sm">
            指定路線
            <select
              className={control}
              value={routing}
              onChange={(event) => setRouting(event.target.value as Routing)}
            >
              {mode === "sales" ? <option value="property-agent">跟樓盤已指派代理</option> : null}
              <option value="uniform">全部指定同一同事</option>
              {mode === "sales" ? <option value="per-row">逐行指定同事</option> : null}
              <option value="reception">總台／不指定同事</option>
            </select>
          </label>
          {routing === "property-agent" ? (
            <ul className="text-sm">
              {selected.map((offer) => (
                <li key={offer.propertyId}>
                  {offer.publicListingNo} {offer.dealType}：
                  {offer.agentName ?? "未指派代理（會被阻止）"}
                </li>
              ))}
            </ul>
          ) : null}
          {routing === "uniform" ? (
            <label className="block text-sm">
              指定同事
              <select
                className={control}
                value={staffId}
                onChange={(event) => setStaffId(event.target.value)}
              >
                <option value="">請選擇</option>
                {agents
                  .filter((agent) => agent.active !== false)
                  .map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name ?? agent.email ?? agent.id}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          {routing === "per-row" ? (
            <div className="max-h-72 space-y-2 overflow-auto">
              {selected.map((offer) => (
                <label key={offer.propertyId} className="block text-sm">
                  {label(offer)}
                  <select
                    className={control}
                    value={perRowStaff[offer.propertyId] ?? ""}
                    onChange={(event) =>
                      setPerRowStaff((current) => ({
                        ...current,
                        [offer.propertyId]: event.target.value,
                      }))
                    }
                  >
                    <option value="">請選擇</option>
                    {agents
                      .filter((agent) => agent.active !== false)
                      .map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name ?? agent.email ?? agent.id}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            指定同事只表示查詢路線；Inbox 指派與手機送達另有獨立證據。
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>
              上一步
            </Button>
            <Button disabled={busy} onClick={() => void run(dryRun)}>
              預覽核對
            </Button>
          </div>
        </div>
      ) : null}
      {step === 4 && progress ? (
        <div className="space-y-3">
          <p className="text-sm">
            預計建立 {progress.preview.counts.create} · 重用 {progress.preview.counts.reuse} · 阻止{" "}
            {progress.preview.counts.blocked}；預覽有效至{" "}
            {new Date(progress.preview.expiresAt).toLocaleString("zh-HK")}
          </p>
          <ul className="max-h-72 space-y-1 overflow-auto text-sm">
            {progress.preview.rows.map((row, index) => (
              <li key={row.rowKey} className="rounded border p-2">
                {progress.rows[index]?.input.publicListingNo ?? "一般查詢"} ·{" "}
                {progress.rows[index]?.input.dealType ?? "—"} · {row.decision}
                {row.reasons.length
                  ? `：${row.reasons.map((reason) => reason.message).join("；")}`
                  : ""}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                sessionStorage.removeItem(linkBatchProgressKey);
                setProgress(null);
                setStep(3);
              }}
            >
              修改設定
            </Button>
            <Button
              disabled={busy || progress.preview.counts.blocked > 0}
              onClick={() => void run(submit)}
            >
              確認建立 {progress.rows.length} 筆
            </Button>
          </div>
        </div>
      ) : null}
      {step === 5 && progress ? (
        <div className="space-y-3">
          <WhatsappBatchResult progress={progress} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void run(recover)}>
              查回伺服器結果
            </Button>
            {hasActiveBatch ? (
              <Button
                disabled={busy || progress.completed.some((chunk) => chunk.state === "rejected")}
                onClick={() => void run(submit)}
              >
                繼續同一批次
              </Button>
            ) : null}
            {!hasActiveBatch ? (
              <Button
                variant="outline"
                onClick={() => {
                  sessionStorage.removeItem(linkBatchProgressKey);
                  setProgress(null);
                  setSelected([]);
                  setStep(1);
                }}
              >
                開始新批次
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            結果由 Batch ID 查回；不能把未確認的提交當成成功。
          </p>
        </div>
      ) : null}
    </section>
  );
}
