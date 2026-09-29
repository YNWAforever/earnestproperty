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
}: {
  inquiryId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<ResolutionDraft>(emptyResolutionDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [generation, setGeneration] = useState(0);
  const savePending = useRef(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchWhatsappEnquiryDetail(inquiryId)
      .then((value) => {
        if (live) {
          setDetail(value);
          setLoading(false);
        }
      })
      .catch(() => {
        if (live) {
          setError("未能讀取本次查詢，或你沒有權限。");
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [inquiryId, generation]);
  async function save() {
    if (!detail?.access.canCorrect || savePending.current) return;
    let input;
    try {
      input = buildEnquiryCorrection(inquiryId, detail.context.version, draft);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "修正內容無效。");
      return;
    }
    savePending.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await correctWhatsappEnquiry(input);
      const readback = await fetchWhatsappEnquiryDetail(inquiryId);
      setDetail(readback);
      setDraft(emptyResolutionDraft);
      setConflict(false);
      setNotice(
        `已儲存本次查詢，版本 ${readback.context.version}。沒有發送訊息或改動整段對話分派。`,
      );
    } catch (failure) {
      const status =
        failure && typeof failure === "object" && "status" in failure
          ? Number(failure.status)
          : null;
      setConflict(status === 409 || /STALE|CONFLICT/i.test(String(failure)));
      setError(
        status === 403
          ? "權限已變更，未有儲存。"
          : status === 409
            ? "資料或核實映射已更新，請重新載入並檢查草稿。"
            : "未能儲存；草稿已保留，請檢查資料後重試。",
      );
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }
  return (
    <section className="space-y-3 rounded border p-3" aria-label="本次查詢例外修正">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">本次查詢例外修正</h4>
        <Button type="button" variant="outline" onClick={onClose}>
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
      {conflict ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setConflict(false);
            setGeneration((n) => n + 1);
          }}
        >
          重新載入版本（保留草稿）
        </Button>
      ) : null}
      {detail ? (
        <>
          <EnquiryResolutionReview context={detail.context} />
          {detail.access.canCorrect ? (
            <div className="grid gap-3">
              <p className="text-xs">
                選擇「不更改」會保留原欄位；儲存只影響本次查詢，供應商整段分派須另行核對。
              </p>
              <label className="grid gap-1 text-sm">
                MLS 樓盤
                <select
                  className="rounded border p-2"
                  value={draft.propertyId}
                  onChange={(e) => setDraft({ ...draft, propertyId: e.target.value })}
                >
                  <option value="unchanged">不更改</option>
                  <option value="none">待核實，清除本次修正</option>
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
                  className="rounded border p-2"
                  value={draft.requestedStaffId}
                  onChange={(e) => setDraft({ ...draft, requestedStaffId: e.target.value })}
                >
                  <option value="unchanged">不更改</option>
                  <option value="none">沒有已核實指定同事</option>
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
                  className="rounded border p-2"
                  value={draft.ownerStaffId}
                  onChange={(e) => setDraft({ ...draft, ownerStaffId: e.target.value })}
                >
                  <option value="unchanged">不更改</option>
                  <option value="none">待分派</option>
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
                  className="min-h-20 rounded border p-2"
                  maxLength={300}
                  value={draft.reason}
                  onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                />
              </label>
              <Button type="button" disabled={saving} onClick={() => void save()}>
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
