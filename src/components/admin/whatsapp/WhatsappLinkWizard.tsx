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
import { expandBatchDraft, type ImportSource } from "@/lib/whatsapp-enquiries/link-batch-import";
import type { LinkOfferSelection } from "@/lib/admin/whatsapp-link-selection";
import {
  linkBatchProgressKey,
  knownFailedBatchRows,
  reconcileLinkBatch,
  runWhatsappLinkBatch,
  type LinkBatchProgress,
} from "@/lib/admin/whatsapp-link-batch-client";
import { WhatsappBatchResult } from "./WhatsappBatchResult";
import { WhatsappBatchImport } from "./WhatsappBatchImport";
import {
  clearDraft,
  loadDraft,
  prepareEligibleSubset,
  saveDraft,
} from "@/lib/admin/whatsapp-batch-draft";

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
  actorScope,
  onCreated,
  enableBatchImport = true,
  seedScope,
  onSeedConsumed,
}: {
  seed: LinkOfferSelection[];
  agents: Staff[];
  actorScope: string;
  onCreated: () => void;
  enableBatchImport?: boolean;
  seedScope?: string;
  onSeedConsumed?: () => void;
}) {
  const [step, setStep] = useState(1);
  const [draftId, setDraftId] = useState<string>(() => crypto.randomUUID());
  const [draftReady, setDraftReady] = useState(false);
  const [repairRows, setRepairRows] = useState<BatchRowDraft[] | null>(null);
  const [previewDirty, setPreviewDirty] = useState(false);
  const [selectedEligible, setSelectedEligible] = useState<string[]>([]);
  const [confirmSubset, setConfirmSubset] = useState(false);
  const [deferredCount, setDeferredCount] = useState(0);
  const [mode, setMode] = useState<"sales" | "reception">("sales");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<LinkOfferSelection[]>([]);
  const [selected, setSelected] = useState<LinkOfferSelection[]>([]);
  const [source, setSource] = useState<Source>("website");
  const [sources, setSources] = useState<ImportSource[]>(["website"]);
  const [importedRows, setImportedRows] = useState<BatchRowDraft[] | null>(null);
  const importSummary = useMemo(() => {
    const offers = (importedRows ?? []).filter((row) => row.input.entryPointType === "sales");
    return {
      offerCount: new Set(offers.map((row) => `${row.input.publicListingNo}:${row.input.dealType}`))
        .size,
      saleCount: new Set(
        offers
          .filter((row) => row.input.dealType === "sale")
          .map((row) => row.input.publicListingNo),
      ).size,
      rentCount: new Set(
        offers
          .filter((row) => row.input.dealType === "rent")
          .map((row) => row.input.publicListingNo),
      ).size,
      sourceCount: new Set((importedRows ?? []).map((row) => row.input.placementSource)).size,
    };
  }, [importedRows]);
  const [placement, setPlacement] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState(false);
  const [routing, setRouting] = useState<Routing>("reception");
  const [staffId, setStaffId] = useState("");
  const [perRowStaff, setPerRowStaff] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<LinkBatchProgress | null>(null);
  const [incomingPending, setIncomingPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = (offer: LinkOfferSelection) => offer.propertyId;
  useEffect(() => {
    if (seed.length) {
      setIncomingPending(true);
      setSelected(seed);
      setMode("sales");
    }
  }, [seed]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(linkBatchProgressKey(actorScope));
      if (!raw) return;
      const stored = JSON.parse(raw) as LinkBatchProgress;
      if (stored.batchId && Array.isArray(stored.rows) && Array.isArray(stored.chunkIds)) {
        setProgress(stored);
        setRepairRows(stored.rows);
        setSelectedEligible(
          stored.preview.rows.filter((row) => row.decision !== "blocked").map((row) => row.rowKey),
        );
        setStep(
          stored.nextChunk === 0 && !stored.uncertain && stored.completed.length === 0 ? 4 : 5,
        );
      }
    } catch {
      sessionStorage.removeItem(linkBatchProgressKey(actorScope));
    }
  }, [actorScope]);
  useEffect(() => {
    try {
      const pointerKey = `earnest:whatsapp-link-draft-active:v1:${encodeURIComponent(actorScope)}`;
      const pointer = localStorage.getItem(pointerKey);
      if (pointer) {
        const stored = loadDraft(actorScope, pointer);
        if (stored?.rows.length) {
          setDraftId(stored.draftId);
          setImportedRows(stored.rows);
          setMode("sales");
          setSelected([]);
          setVerified(false);
          if (!sessionStorage.getItem(linkBatchProgressKey(actorScope))) setStep(2);
        }
      }
    } catch {
      // A disabled or corrupt local store must not make the editor unusable.
    } finally {
      setDraftReady(true);
    }
  }, [actorScope]);
  const save = (next: LinkBatchProgress) => {
    sessionStorage.setItem(linkBatchProgressKey(actorScope), JSON.stringify(next));
    setProgress(next);
  };
  const expansion = useMemo(
    () =>
      mode === "sales" && !importedRows ? expandBatchDraft(selected, sources, placement) : null,
    [mode, importedRows, selected, sources, placement],
  );
  const rows = useMemo<BatchRowDraft[]>(() => {
    if (importedRows)
      return importedRows.map((row) => ({
        ...row,
        input: { ...row.input, placementVerified: verified },
      }));
    if (mode === "sales") {
      const byId = new Map(selected.map((offer) => [offer.propertyId, offer]));
      return (expansion?.rows ?? []).map((row) => {
        const offer = byId.get(row.input.propertyId ?? "");
        const requestedStaffId =
          routing === "property-agent"
            ? (offer?.agentId ?? null)
            : routing === "uniform"
              ? staffId || null
              : routing === "per-row"
                ? perRowStaff[row.input.propertyId ?? ""] || null
                : null;
        return {
          ...row,
          input: { ...row.input, requestedStaffId, placementVerified: verified },
        };
      });
    }
    const placementId = source === "website" ? "website:reception" : placement.reception || "";
    return [
      {
        rowKey: crypto.randomUUID(),
        placementId,
        input: {
          placementSource: source,
          entryPointType: "reception",
          propertyId: null,
          publicListingNo: null,
          dealType: null,
          requestedStaffId: routing === "uniform" ? staffId || null : null,
          referenceMappingId: null,
          externalListingId: source === "28hse" ? placementId : null,
          videoId: source === "youtube" ? placementId : null,
          placementVerified: verified,
          enabled: true,
        },
      },
    ];
  }, [
    mode,
    selected,
    source,
    placement,
    routing,
    staffId,
    perRowStaff,
    verified,
    importedRows,
    expansion,
  ]);
  useEffect(() => {
    if (!draftReady || progress || !rows.length) return;
    try {
      saveDraft(actorScope, { draftId, rows });
      localStorage.setItem(
        `earnest:whatsapp-link-draft-active:v1:${encodeURIComponent(actorScope)}`,
        draftId,
      );
    } catch {
      // The browser may disallow local storage; preview/commit still require server validation.
    }
  }, [actorScope, draftId, draftReady, progress, rows]);
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
    if (mode === "sales" && !selected.length && !importedRows)
      throw new Error("請先選擇至少一筆樓盤租售。");
    if (rows.length > 1000 || (expansion?.rowCount ?? 0) > 1000)
      throw new Error("最多 1000 筆，請縮小篩選。");
    if (expansion?.errors.length) throw new Error("有投放位置或來源錯誤，請在第二步逐行修正。");
    if (!rows.length) throw new Error("請先選擇來源及有效投放位置。");
    if (!verified) throw new Error("請先人工核對刊登位置。");
    if (rows.some((row) => !row.placementId)) throw new Error("每筆投放都需要來源識別碼。");
    if (!importedRows && routing === "property-agent" && selected.some((offer) => !offer.agentId))
      throw new Error("有樓盤未指派代理；請先補指派，或明確選總台。");
    if (!importedRows && routing === "uniform" && !staffId) throw new Error("請選擇指定同事。");
    if (!importedRows && routing === "per-row" && rows.some((row) => !row.input.requestedStaffId))
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
    setRepairRows(rows);
    setPreviewDirty(false);
    setSelectedEligible(
      preview.rows.filter((row) => row.decision !== "blocked").map((row) => row.rowKey),
    );
    setConfirmSubset(false);
    setIncomingPending(false);
    onSeedConsumed?.();
    setStep(4);
  }
  async function previewEdited(nextRows: BatchRowDraft[]) {
    if (!canReplace || progress?.nextChunk) throw new Error("請先查回現有批次結果。");
    const batchId = crypto.randomUUID();
    const preview = await api.preview({ batchId, rows: nextRows });
    const next: LinkBatchProgress = {
      batchId,
      rows: nextRows,
      preview,
      chunkIds: Array.from({ length: Math.ceil(nextRows.length / 50) }, () => crypto.randomUUID()),
      nextChunk: 0,
      completed: [],
      uncertain: false,
    };
    save(next);
    setRepairRows(nextRows);
    setPreviewDirty(false);
    setSelectedEligible(
      preview.rows.filter((row) => row.decision !== "blocked").map((row) => row.rowKey),
    );
    setConfirmSubset(false);
    setStep(4);
  }
  function patchRepairRow(
    rowKey: string,
    patch: Partial<BatchRowDraft["input"]> & { placementId?: string },
  ) {
    setRepairRows((current) =>
      (current ?? progress?.rows ?? []).map((row) => {
        if (row.rowKey !== rowKey) return row;
        const { placementId: editedPlacementId, ...inputPatch } = patch;
        const placementId = editedPlacementId ?? row.placementId;
        const source = patch.placementSource ?? row.input.placementSource;
        return {
          ...row,
          placementId,
          input: {
            ...row.input,
            ...inputPatch,
            placementSource: source,
            externalListingId: source === "28hse" ? placementId : null,
            videoId: source === "youtube" ? placementId : null,
            referenceMappingId:
              patch.requestedStaffId !== undefined &&
              patch.requestedStaffId !== row.input.requestedStaffId
                ? null
                : row.input.referenceMappingId,
            placementVerified:
              patch.placementId !== undefined || patch.placementSource !== undefined
                ? false
                : (patch.placementVerified ?? row.input.placementVerified),
          },
        };
      }),
    );
    setPreviewDirty(true);
  }
  async function previewSubset() {
    if (!progress || previewDirty || !confirmSubset)
      throw new Error("請先核對選取及重新預覽修正。");
    const subset = prepareEligibleSubset(progress.rows, progress.preview, selectedEligible);
    if (subset.rows.length === progress.rows.length) throw new Error("所有行均合格，請直接提交。");
    const excluded = progress.rows.filter((row) => subset.excludedRowKeys.includes(row.rowKey));
    setDeferredCount(excluded.length);
    saveDraft(actorScope, { draftId, rows: excluded });
    localStorage.setItem(
      `earnest:whatsapp-link-draft-active:v1:${encodeURIComponent(actorScope)}`,
      draftId,
    );
    await previewEdited(subset.rows);
  }
  function recoverEditableRows() {
    const previous = loadDraft(actorScope, draftId)?.rows ?? [];
    const current = repairRows ?? progress?.rows ?? [];
    const byKey = new Map(previous.map((row) => [row.rowKey, row]));
    for (const row of current) byKey.set(row.rowKey, row);
    return [...byKey.values()];
  }
  function returnToSettings() {
    if (!progress || !canReplace) return;
    const editable = recoverEditableRows();
    saveDraft(actorScope, { draftId, rows: editable });
    localStorage.setItem(
      `earnest:whatsapp-link-draft-active:v1:${encodeURIComponent(actorScope)}`,
      draftId,
    );
    sessionStorage.removeItem(linkBatchProgressKey(actorScope));
    const staff = editable.find((row) => row.input.requestedStaffId)?.input.requestedStaffId;
    const params = new URLSearchParams({ draftId });
    if (staff) params.set("staffId", staff);
    window.location.assign(`/admin/whatsapp-settings?${params.toString()}`);
  }
  function modifySettings() {
    if (!progress || !canReplace) return;
    const editable = recoverEditableRows();
    setImportedRows(editable);
    setMode("sales");
    setVerified(editable.every((row) => row.input.placementVerified));
    sessionStorage.removeItem(linkBatchProgressKey(actorScope));
    setProgress(null);
    setPreviewDirty(false);
    setStep(2);
  }
  async function submit() {
    if (!progress) return;
    if (previewDirty) throw new Error("行內內容已更改，請先重新預覽。");
    let current = progress;
    if (current.uncertain) {
      current = reconcileLinkBatch(current, (await api.read(current.batchId)).operations);
      save(current);
      if (current.uncertain)
        throw new Error("提交結果仍未確認；請稍後查回伺服器結果，不要重新送出。");
    }
    if (current.nextChunk === 0 || Date.parse(current.preview.expiresAt) <= Date.now() + 30_000) {
      const refreshed = await api.preview({ batchId: current.batchId, rows: current.rows });
      current = { ...current, preview: refreshed };
      save(current);
      setSelectedEligible(
        refreshed.rows.filter((row) => row.decision !== "blocked").map((row) => row.rowKey),
      );
      if (refreshed.counts.blocked) {
        setStep(4);
        throw new Error("資料已改變，請核對新的預覽阻止原因。");
      }
    }
    setStep(5);
    const result = await runWhatsappLinkBatch(current, api, save);
    save(result);
    setStep(5);
    if (result.completed.some((chunk) => chunk.state === "committed")) onCreated();
    if (
      !result.uncertain &&
      (result.nextChunk >= result.chunkIds.length ||
        result.completed.some((chunk) => chunk.state === "rejected"))
    ) {
      const successful = new Set(
        result.completed.flatMap((chunk) =>
          chunk.rows
            .filter((row) => row.outcome === "created" || row.outcome === "reused")
            .map((row) => row.rowKey),
        ),
      );
      const existing = loadDraft(actorScope, draftId)?.rows ?? [];
      const unfinished = [
        ...existing.filter((row) => !successful.has(row.rowKey)),
        ...result.rows.filter(
          (row) =>
            !successful.has(row.rowKey) && !existing.some((item) => item.rowKey === row.rowKey),
        ),
      ];
      if (unfinished.length) saveDraft(actorScope, { draftId, rows: unfinished });
      else {
        clearDraft(actorScope, draftId);
        localStorage.removeItem(
          `earnest:whatsapp-link-draft-active:v1:${encodeURIComponent(actorScope)}`,
        );
      }
    }
  }
  async function recover() {
    if (!progress) return;
    const result = reconcileLinkBatch(progress, (await api.read(progress.batchId)).operations);
    save(result);
  }
  const toggle = (offer: LinkOfferSelection) => {
    setImportedRows(null);
    setSelected((current) =>
      current.some((item) => item.propertyId === offer.propertyId)
        ? current.filter((item) => item.propertyId !== offer.propertyId)
        : [...current, offer],
    );
  };
  const hasActiveBatch = progress && progress.nextChunk < progress.chunkIds.length;
  const canReplace =
    !progress ||
    (!progress.uncertain &&
      (progress.nextChunk === 0 ||
        !hasActiveBatch ||
        progress.completed.some((chunk) => chunk.state === "rejected")));
  const conflict = incomingPending && seed.length > 0 && progress !== null;
  function useIncoming() {
    if (!canReplace || busy) return;
    sessionStorage.removeItem(linkBatchProgressKey(actorScope));
    setProgress(null);
    setSelected(seed);
    setMode("sales");
    setVerified(false);
    setPlacement({});
    setPerRowStaff({});
    setImportedRows(null);
    setError("");
    setStep(1);
  }
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
      {incomingPending && seed.length > 0 ? (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3" role="status">
          <p className="font-medium">已從物業管理帶入 {seed.length} 筆租售</p>
          {seedScope ? <p className="text-sm">{seedScope}</p> : null}
          <p className="text-sm">
            請核對樓盤 → 選擇來源及跟進路線 → 預覽 → 確認建立。此時尚未建立連結。
          </p>
          {conflict ? (
            <>
              <ul className="max-h-36 overflow-auto text-sm">
                {seed.map((offer) => (
                  <li key={offer.propertyId}>{label(offer)}</li>
                ))}
              </ul>
              <p className="text-sm">
                另有之前的批次。下方顯示之前批次；你可選擇使用這次樓盤選取。
              </p>
              {!canReplace ? (
                <p className="text-sm">
                  之前批次仍在提交或結果未確認，請先查回結果並繼續同一批次。
                </p>
              ) : null}
              <Button disabled={busy || !canReplace} onClick={useIncoming}>
                使用這次選擇
              </Button>
            </>
          ) : null}
        </div>
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
          {enableBatchImport ? (
            <WhatsappBatchImport
              disabled={busy || !canReplace}
              onImported={(result) => {
                setImportedRows(result.rows);
                setSelected(result.offers);
                setMode("sales");
                setRouting("reception");
                setVerified(false);
                setProgress(null);
                sessionStorage.removeItem(linkBatchProgressKey(actorScope));
                setIncomingPending(false);
                onSeedConsumed?.();
                setStep(2);
              }}
            />
          ) : null}
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
          {importedRows ? (
            <div className="space-y-2 rounded border p-3 text-sm">
              <p>
                已匯入 {importedRows.length} 行 · {importSummary?.offerCount ?? 0} 筆租售 （售{" "}
                {importSummary?.saleCount ?? 0}、租 {importSummary?.rentCount ?? 0}）·
                {importSummary?.sourceCount ?? 0} 個來源。
              </p>
              <p>每行保留原來來源與投放 ID；同事代碼只使用已核實的來源映射。</p>
              <Button
                variant="outline"
                onClick={() => {
                  setImportedRows(null);
                  setSelected([]);
                  setImportedRows(null);
                  setStep(1);
                }}
              >
                移除匯入批次
              </Button>
            </div>
          ) : mode === "sales" ? (
            <>
              <fieldset className="flex flex-wrap gap-3">
                <legend className="font-medium">刊登來源（可多選）</legend>
                {(["website", "28hse", "youtube", "other"] as const).map((option) => (
                  <label key={option} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={sources.includes(option)}
                      onChange={(event) =>
                        setSources((current) =>
                          event.target.checked
                            ? [...current, option]
                            : current.filter((item) => item !== option),
                        )
                      }
                    />
                    {option}
                  </label>
                ))}
              </fieldset>
              <p className="text-sm">
                已選 {selected.length} 筆租售 × {sources.length} 個來源＝
                {expansion?.rowCount ?? 0} 行（最多 1000 行）。
              </p>
              <div className="max-h-72 space-y-2 overflow-auto">
                {selected.flatMap((offer) =>
                  sources
                    .filter((item) => item !== "website")
                    .map((item) => (
                      <label key={offer.propertyId + ":" + item} className="block text-sm">
                        {label(offer)} · {item} 網址或投放 ID
                        <Input
                          value={placement[offer.propertyId + ":" + item] ?? ""}
                          onChange={(event) =>
                            setPlacement((current) => ({
                              ...current,
                              [offer.propertyId + ":" + item]: event.target.value,
                            }))
                          }
                        />
                      </label>
                    )),
                )}
              </div>
              {expansion?.errors.length ? (
                <ul role="alert" className="text-sm text-destructive">
                  {expansion.errors.slice(0, 30).map((item, index) => (
                    <li key={index}>
                      第 {item.row || "全部"} 筆 · {item.column}：
                      {(
                        {
                          BATCH_LIMIT: "最多 1000 行，請減少選取",
                          PLACEMENT_REQUIRED: "請輸入已核對的投放網址或 ID",
                          SOURCE_URL_MISMATCH: "網址與所選來源不符",
                          UNRECOGNIZED_URL: "未辨識網址，請核對原輸入",
                          DEAL_TYPE_MISMATCH: "28hse 網址的售租與樓盤不符",
                          DUPLICATE_SOURCE: "來源選取重複",
                        } as Record<string, string>
                      )[item.errorCode] ?? item.errorCode}
                      {item.value ? `（${item.value.slice(0, 80)}）` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <>
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
                <label className="block text-sm">
                  一般查詢 · 投放識別碼
                  <Input
                    value={placement.reception ?? ""}
                    onChange={(event) =>
                      setPlacement((current) => ({
                        ...current,
                        reception: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : null}
            </>
          )}
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
          {importedRows ? (
            <p className="text-sm">
              按匯入表格內已核實的來源同事映射；未提供同事代碼的行使用總台。每行可在預覽核對。
            </p>
          ) : (
            <>
              <label className="block text-sm">
                指定路線
                <select
                  className={control}
                  value={routing}
                  onChange={(event) => setRouting(event.target.value as Routing)}
                >
                  {mode === "sales" ? (
                    <option value="property-agent">跟樓盤已指派代理</option>
                  ) : null}
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
            </>
          )}
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
          {previewDirty ? (
            <p role="alert" className="text-sm text-amber-800">
              已修改行內資料；原有預覽已失效，須重新預覽才可提交。
            </p>
          ) : null}
          {deferredCount ? (
            <p className="text-sm">另有 {deferredCount} 行保留在草稿待修正。</p>
          ) : null}
          <ul className="max-h-96 space-y-2 overflow-auto text-sm">
            {progress.preview.rows.map((decision) => {
              const row = (repairRows ?? progress.rows).find(
                (item) => item.rowKey === decision.rowKey,
              );
              if (!row) return null;
              return (
                <li key={decision.rowKey} className="space-y-2 rounded border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>
                      {row.input.placementSource} · {row.input.publicListingNo ?? "一般查詢"} ·{" "}
                      {row.input.dealType ?? "—"}
                    </strong>
                    <span>{decision.decision}</span>
                    {decision.decision !== "blocked" ? (
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={selectedEligible.includes(row.rowKey)}
                          onChange={(event) =>
                            setSelectedEligible((current) =>
                              event.target.checked
                                ? [...current, row.rowKey]
                                : current.filter((key) => key !== row.rowKey),
                            )
                          }
                        />
                        合格子集
                      </label>
                    ) : null}
                  </div>
                  <label className="block">
                    投放 ID
                    <Input
                      value={row.placementId}
                      onChange={(event) =>
                        patchRepairRow(row.rowKey, { placementId: event.target.value })
                      }
                    />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label>
                      來源
                      <select
                        className={control}
                        value={row.input.placementSource}
                        onChange={(event) =>
                          patchRepairRow(row.rowKey, {
                            placementSource: event.target.value as Source,
                          })
                        }
                      >
                        <option value="website">網站</option>
                        <option value="28hse">28hse</option>
                        <option value="youtube">YouTube</option>
                        <option value="other">其他</option>
                      </select>
                    </label>
                    <label>
                      查詢路線
                      <select
                        className={control}
                        value={row.input.requestedStaffId ?? ""}
                        onChange={(event) =>
                          patchRepairRow(row.rowKey, {
                            requestedStaffId: event.target.value || null,
                          })
                        }
                      >
                        <option value="">總台／不指定同事</option>
                        {agents
                          .filter((agent) => agent.active !== false)
                          .map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name ?? agent.email ?? agent.id}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={row.input.placementVerified === true}
                      onChange={(event) =>
                        patchRepairRow(row.rowKey, {
                          placementVerified: event.target.checked,
                        })
                      }
                    />
                    已核對此行投放位置
                  </label>
                  {row.input.referenceMappingId ? (
                    <p className="text-xs">
                      同事來源映射已選；更改路線會清除映射，請重新匯入或核對。
                    </p>
                  ) : null}
                  {decision.reasons.length ? (
                    <p className="text-destructive">
                      {decision.reasons.map((reason) => reason.message).join("；")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || !canReplace} onClick={modifySettings}>
              修改設定
            </Button>
            <Button
              variant="outline"
              disabled={busy || !canReplace}
              onClick={() => void run(async () => returnToSettings())}
            >
              修正 Haze 設定
            </Button>
            <Button
              variant="outline"
              disabled={busy || !previewDirty}
              onClick={() => void run(() => previewEdited(repairRows ?? progress.rows))}
            >
              重新預覽修正
            </Button>
          </div>
          {progress.preview.counts.blocked || selectedEligible.length < progress.rows.length ? (
            <div className="space-y-2 rounded border p-3">
              <p>
                合格 {selectedEligible.length} 行；排除{" "}
                {progress.rows.length - selectedEligible.length} 行。排除行保留草稿。
              </p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={confirmSubset}
                  onChange={(event) => setConfirmSubset(event.target.checked)}
                />
                我已核對並確認只處理所選合格行
              </label>
              <Button
                disabled={busy || previewDirty || !confirmSubset || !selectedEligible.length}
                onClick={() => void run(previewSubset)}
              >
                只提交已核對的合格行：先重新預覽
              </Button>
            </div>
          ) : null}
          <Button
            disabled={busy || previewDirty || progress.preview.counts.blocked > 0}
            onClick={() => void run(submit)}
          >
            確認建立 {progress.rows.length} 筆
          </Button>
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
            {canReplace && knownFailedBatchRows(progress).length ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const failed = knownFailedBatchRows(progress);
                  setImportedRows(failed);
                  setSelected([]);
                  setVerified(false);
                  sessionStorage.removeItem(linkBatchProgressKey(actorScope));
                  setProgress(null);
                  setStep(2);
                }}
              >
                只修正已知失敗的 {knownFailedBatchRows(progress).length} 行
              </Button>
            ) : null}
            {canReplace && !conflict ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  sessionStorage.removeItem(linkBatchProgressKey(actorScope));
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
