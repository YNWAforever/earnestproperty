import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchWhatsappEnquiryDetail, correctWhatsappEnquiry } from "@/lib/neon/enquiry-resolution";

export type ResolutionDraft = {
  propertyId: string;
  requestedStaffId: string;
  ownerStaffId: string;
  reason: string;
};
export const emptyResolutionDraft: ResolutionDraft = {
  propertyId: "unchanged",
  requestedStaffId: "unchanged",
  ownerStaffId: "unchanged",
  reason: "",
};
export function buildEnquiryCorrection(
  inquiryId: string,
  expectedVersion: number,
  draft: ResolutionDraft,
) {
  const change: {
    propertyId?: string | null;
    requestedStaffId?: string | null;
    ownerStaffId?: string | null;
  } = {};
  for (const key of ["propertyId", "requestedStaffId", "ownerStaffId"] as const) {
    if (draft[key] !== "unchanged") change[key] = draft[key] === "none" ? null : draft[key];
  }
  if (!Object.keys(change).length) throw Error("請選擇本次查詢要修正的資料。");
  if (draft.reason.trim().length < 3) throw Error("請填寫最少三個字的修正原因。");
  return { inquiryId, expectedVersion, ...change, reason: draft.reason.trim() };
}

type Detail = Awaited<ReturnType<typeof fetchWhatsappEnquiryDetail>>;
export function EnquiryResolutionReview({ context }: { context: Detail["context"] }) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        本次查詢 · 樓盤 {context.publicListingNo ?? "待核實"} · 版本 {context.version}
      </p>
      {context.references.length ? (
        <ul className="list-disc pl-5">
          {context.references.map((ref, index) => (
            <li key={index}>
              {ref.source} · 外部樓盤編號 {ref.externalListingId ?? "未提取"} ·{" "}
              {ref.dealType === "sale" ? "售" : ref.dealType === "rent" ? "租" : "交易待核實"}
            </li>
          ))}
        </ul>
      ) : (
        <p>沒有已提取的樓盤參照；先核對原文。</p>
      )}
      {context.providerThreadReview ? (
        <p role="status">供應商整段對話負責人仍需核對；本次修正不會轉走整段客戶關係。</p>
      ) : null}
    </div>
  );
}

export function EnquiryResolutionPanel({
  inquiryId,
  onClose,
  onBusyChange,
  onReadback,
}: {
  inquiryId: string;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
  onReadback?: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<ResolutionDraft>(emptyResolutionDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [needsReadback, setNeedsReadback] = useState(false);
  const [notice, setNotice] = useState("");
  const [generation, setGeneration] = useState(0);
  const savePending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onBusyChange?.(false);
    };
  }, [onBusyChange]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setDetail(null);
    setError("");
    if (generation > 0) {
      savePending.current = true;
      onBusyChange?.(true);
    }
    fetchWhatsappEnquiryDetail(inquiryId)
      .then((value) => {
        if (value.context.inquiryId !== inquiryId) throw Error("Enquiry readback mismatch");
        if (live) {
          setDetail(value);
          setNeedsReadback(false);
          if (generation > 0) onReadback?.();
        }
      })
      .catch(() => {
        if (live) {
          setError("未能讀取本次查詢，或權限已變更。草稿已保留，未有重送修正。");
          setNeedsReadback(true);
        }
      })
      .finally(() => {
        if (!live) return;
        setLoading(false);
        if (generation > 0) {
          savePending.current = false;
          onBusyChange?.(false);
        }
      });
    return () => {
      live = false;
    };
  }, [inquiryId, generation, onBusyChange, onReadback]);
  const keys = ["propertyId", "requestedStaffId", "ownerStaffId"] as const;
  const labels = {
    propertyId: "MLS 樓盤",
    requestedStaffId: "指定同事",
    ownerStaffId: "本次查詢負責同事",
  };
  const candidates = detail
    ? {
        propertyId: detail.context.propertyCandidates,
        requestedStaffId: detail.context.requestedStaffCandidates,
        ownerStaffId: detail.context.ownerCandidates,
      }
    : null;
  const unavailable = keys.filter(
    (key) =>
      candidates &&
      !["unchanged", "none"].includes(draft[key]) &&
      !candidates[key].some((item) => item.id === draft[key]),
  );
  const selected = keys.filter((key) => draft[key] !== "unchanged");
  const matchesCurrent =
    !!detail &&
    selected.length > 0 &&
    selected.every((key) => detail.context[key] === (draft[key] === "none" ? null : draft[key]));
  const locked = loading || saving || needsReadback;
  async function save() {
    if (
      !detail?.access.canCorrect ||
      savePending.current ||
      locked ||
      matchesCurrent ||
      unavailable.length
    )
      return;
    let input;
    try {
      input = buildEnquiryCorrection(inquiryId, detail.context.version, draft);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "修正內容無效。");
      return;
    }
    savePending.current = true;
    onBusyChange?.(true);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await correctWhatsappEnquiry(input);
      if (!mounted.current) return;
      const readback = await fetchWhatsappEnquiryDetail(inquiryId);
      if (!mounted.current) return;
      if (readback.context.inquiryId !== inquiryId) throw Error("Enquiry readback mismatch");
      setDetail(readback);
      setDraft(emptyResolutionDraft);
      setNeedsReadback(false);
      setNotice(
        `已儲存本次查詢，版本 ${readback.context.version}。沒有發送訊息或改動整段對話分派。`,
      );
      onReadback?.();
    } catch (failure) {
      if (!mounted.current) return;
      const status =
        failure && typeof failure === "object" && "status" in failure
          ? Number(failure.status)
          : null;
      setNeedsReadback(true);
      if (status === 403) setDetail(null);
      setError(
        status === 403
          ? "權限已變更；修正結果需要重新核對。"
          : status === 409
            ? "資料或核實映射已更新，請重新載入並檢查草稿。"
            : "修正結果未能確認；草稿已保留，請先重新載入核對。",
      );
    } finally {
      savePending.current = false;
      if (mounted.current) {
        setSaving(false);
        onBusyChange?.(false);
      }
    }
  }
  return (
    <section className="space-y-3 rounded border p-3" aria-label="本次查詢例外修正">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">本次查詢例外修正</h4>
        <Button
          type="button"
          variant="outline"
          disabled={saving || (loading && generation > 0)}
          onClick={onClose}
        >
          取消／關閉
        </Button>
      </div>
      {loading ? <p role="status">正在載入原始參照…</p> : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {needsReadback ? (
        <Button
          type="button"
          variant="outline"
          disabled={loading || saving}
          onClick={() => {
            savePending.current = true;
            onBusyChange?.(true);
            setLoading(true);
            setGeneration((n) => n + 1);
          }}
        >
          重新載入版本（保留草稿）
        </Button>
      ) : null}
      {detail ? (
        <>
          <EnquiryResolutionReview context={detail.context} />
          <section className="space-y-2 text-sm" aria-label="本次查詢原文">
            <h5 className="font-medium">本次查詢原文（最多 50 則已授權入站訊息）</h5>
            <div className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words">
              {detail.messages.length ? (
                detail.messages.map((message) => (
                  <p key={message.id}>{message.text ?? "非文字訊息"}</p>
                ))
              ) : (
                <p>未有可讀的本次查詢原文。</p>
              )}
            </div>
          </section>
          <dl className="grid gap-1 text-sm" aria-label="目前查詢資料">
            {keys.map((key) => (
              <div key={key} className="flex flex-wrap gap-2">
                <dt>{labels[key]}：</dt>
                <dd>
                  {detail.context[key]
                    ? (candidates?.[key].find((item) => item.id === detail.context[key])?.label ??
                      "資料待核實")
                    : "待核實／未指定"}
                </dd>
              </div>
            ))}
          </dl>
          {matchesCurrent ? (
            <p role="status">目前資料已符合草稿，未有重送修正；毋須再次保存相同資料。</p>
          ) : null}
          {unavailable.length ? (
            <p role="alert">
              先前選擇已不可用：{unavailable.map((key) => labels[key]).join("、")}
              。請重新選擇，草稿原因已保留。
            </p>
          ) : null}
          {detail.access.canCorrect ? (
            <div className="grid gap-3">
              <p className="text-xs">
                選擇「不更改」會保留原欄位；儲存只影響本次查詢，供應商整段分派須另行核對。
              </p>
              <label className="grid gap-1 text-sm">
                MLS 樓盤
                <select
                  aria-label="MLS 樓盤"
                  disabled={locked}
                  className="rounded border p-2"
                  value={draft.propertyId}
                  onChange={(e) => setDraft({ ...draft, propertyId: e.target.value })}
                >
                  <option value="unchanged">不更改</option>
                  <option value="none">待核實，清除本次修正</option>
                  {unavailable.includes("propertyId") ? (
                    <option value={draft.propertyId} disabled>
                      先前選擇已不可用
                    </option>
                  ) : null}
                  {detail.context.propertyCandidates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                指定同事（已核實外部映射）
                <select
                  aria-label="指定同事（已核實外部映射）"
                  disabled={locked}
                  className="rounded border p-2"
                  value={draft.requestedStaffId}
                  onChange={(e) => setDraft({ ...draft, requestedStaffId: e.target.value })}
                >
                  <option value="unchanged">不更改</option>
                  <option value="none">沒有已核實指定同事</option>
                  {unavailable.includes("requestedStaffId") ? (
                    <option value={draft.requestedStaffId} disabled>
                      先前選擇已不可用
                    </option>
                  ) : null}
                  {detail.context.requestedStaffCandidates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              {!detail.context.requestedStaffCandidates.length ? (
                <p className="text-xs">未有已核實的外部同事映射；請先在同事接收設定核實。</p>
              ) : null}
              <label className="grid gap-1 text-sm">
                本次查詢負責同事
                <select
                  aria-label="本次查詢負責同事"
                  disabled={locked}
                  className="rounded border p-2"
                  value={draft.ownerStaffId}
                  onChange={(e) => setDraft({ ...draft, ownerStaffId: e.target.value })}
                >
                  <option value="unchanged">不更改</option>
                  <option value="none">待分派</option>
                  {unavailable.includes("ownerStaffId") ? (
                    <option value={draft.ownerStaffId} disabled>
                      先前選擇已不可用
                    </option>
                  ) : null}
                  {detail.context.ownerCandidates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                修正原因
                <textarea
                  aria-label="修正原因"
                  disabled={locked}
                  className="min-h-20 rounded border p-2"
                  maxLength={300}
                  value={draft.reason}
                  onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                />
              </label>
              <Button
                type="button"
                disabled={locked || matchesCurrent || !!unavailable.length}
                onClick={() => void save()}
              >
                {saving ? "正在核對並儲存…" : "儲存本次查詢修正"}
              </Button>
            </div>
          ) : (
            <p className="text-sm">你可查看本次查詢，但沒有修正權限。</p>
          )}
        </>
      ) : null}
    </section>
  );
}
