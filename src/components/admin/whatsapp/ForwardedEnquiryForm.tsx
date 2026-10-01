import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveForwardedEnquiry } from "@/lib/neon/forwarded-enquiries";
import {
  validateForwardedEnquiry,
  type ForwardedEnquiryInput,
} from "@/lib/whatsapp-enquiries/forwarded-enquiries";

type DraftFields = {
  requestId: string;
  text: string;
  businessSource: string;
  sourceUrl: string;
  originalCustomerContact: string;
  originalReceivedAt: string;
  note: string;
  followUpTitle: string;
  followUpDueAt: string;
  responsibleStaffId: string;
};
const uncertainMessage =
  "尚未核實保存結果；原文及請求編號已保留。請沿用此內容核對並重試，避免重複建檔。";
const corruptMessage = "保存草稿受損或未能讀取；請保持此紀錄並聯絡支援核對已有查詢，勿另建新請求。";
const storageKey = (actor: string) => `ep-forwarded-enquiry-draft:v1:${actor}`;
function restoreDraft(actor?: string): {
  fields: DraftFields;
  pending: ForwardedEnquiryInput | null;
  recoveryError: boolean;
} {
  const fields: DraftFields = {
    requestId: crypto.randomUUID(),
    text: "",
    businessSource: "",
    sourceUrl: "",
    originalCustomerContact: "",
    originalReceivedAt: "",
    note: "",
    followUpTitle: "",
    followUpDueAt: "",
    responsibleStaffId: "",
  };
  if (actor && typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem(storageKey(actor));
      if (raw === null) return { fields, pending: null, recoveryError: false };
      const saved = JSON.parse(raw);
      if (
        saved?.version === 1 &&
        Object.keys(fields).every((key) => typeof saved.fields?.[key] === "string") &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          saved.fields.requestId,
        )
      ) {
        if (saved.pending !== null && (typeof saved.pending !== "object" || !saved.pending))
          throw Error("Invalid request journal");
        const pending = saved.pending ? validateForwardedEnquiry(saved.pending) : null;
        if (pending && pending.requestId !== saved.fields.requestId)
          return { fields, pending: null, recoveryError: true };
        return { fields: saved.fields, pending, recoveryError: false };
      }
      return { fields, pending: null, recoveryError: true };
    } catch {
      return { fields, pending: null, recoveryError: true };
    }
  }
  return { fields, pending: null, recoveryError: false };
}
function persistDraft(
  actor: string | undefined,
  fields: DraftFields,
  pending: ForwardedEnquiryInput | null,
) {
  if (actor)
    sessionStorage.setItem(storageKey(actor), JSON.stringify({ version: 1, fields, pending }));
}

export function ForwardedEnquiryForm({
  agents,
  onSaved,
  onCancel,
  draftKey,
  onBusyChange,
}: {
  agents: { id: string; name: string | null; active: boolean }[];
  onSaved: (leadId: string) => void;
  onCancel: () => void;
  draftKey?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [restored] = useState(() => restoreDraft(draftKey));
  const [fields, setFields] = useState(restored.fields);
  const [pending, setPending] = useState(restored.pending);
  const {
    requestId,
    text,
    businessSource,
    sourceUrl,
    originalCustomerContact,
    originalReceivedAt,
    note,
    followUpTitle,
    followUpDueAt,
    responsibleStaffId,
  } = fields;
  const change = (key: keyof DraftFields, value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    restored.recoveryError ? corruptMessage : restored.pending ? uncertainMessage : "",
  );
  const inFlight = useRef(false);
  const completed = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onBusyChange?.(false);
    };
  }, [onBusyChange]);
  useEffect(() => {
    if (completed.current || restored.recoveryError) return;
    try {
      persistDraft(draftKey, fields, pending);
    } catch {
      setError("此瀏覽器未能保存請求草稿；請保持頁面，核對瀏覽器儲存設定後再試。");
    }
  }, [draftKey, fields, pending, restored.recoveryError]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || restored.recoveryError) return;
    setError("");
    let input: ForwardedEnquiryInput;
    try {
      input =
        pending ??
        validateForwardedEnquiry({
          requestId,
          text,
          businessSource,
          sourceUrl: sourceUrl || null,
          originalCustomerContact: originalCustomerContact || null,
          originalReceivedAt: originalReceivedAt
            ? new Date(originalReceivedAt).toISOString()
            : null,
          note: note || null,
          followUpTitle: followUpTitle || null,
          followUpDueAt: followUpDueAt ? new Date(followUpDueAt).toISOString() : null,
          responsibleStaffId: responsibleStaffId || null,
        });
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "請核對表單內容。");
      return;
    }
    try {
      persistDraft(draftKey, fields, input);
    } catch {
      setError("此瀏覽器未能保存請求草稿；未有送出查詢。請核對瀏覽器儲存設定後再試。");
      return;
    }
    inFlight.current = true;
    setPending(input);
    setBusy(true);
    onBusyChange?.(true);
    try {
      const result = await saveForwardedEnquiry(input);
      completed.current = true;
      if (draftKey) sessionStorage.removeItem(storageKey(draftKey));
      if (mounted.current) onSaved(result.leadId);
    } catch {
      if (mounted.current) setError(uncertainMessage);
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  }
  return (
    <form className="space-y-3" onSubmit={(event) => void save(event)}>
      <p className="text-sm">
        此為人工轉交，不是原客戶 WhatsApp
        對話接駁。轉交者不是原客戶；未核實聯絡方式不可用來直接回覆、開啟訊息時窗或作推廣同意。
      </p>
      <fieldset className="space-y-3" disabled={busy || Boolean(pending) || restored.recoveryError}>
        <label className="grid gap-1 text-sm">
          原文／轉交內容
          <textarea
            required
            maxLength={4000}
            className="min-h-28 rounded border p-2"
            value={text}
            onChange={(event) => change("text", event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          業務來源
          <Input
            required
            maxLength={80}
            value={businessSource}
            onChange={(event) => change("businessSource", event.target.value)}
            placeholder="例如：同事轉交的 28Hse 查詢"
          />
        </label>
        <label className="grid gap-1 text-sm">
          來源網址（選填）
          <Input
            type="url"
            value={sourceUrl}
            onChange={(event) => change("sourceUrl", event.target.value)}
            placeholder="https://"
          />
        </label>
        <label className="grid gap-1 text-sm">
          原客戶聯絡線索（選填，未核實）
          <Input
            maxLength={200}
            value={originalCustomerContact}
            onChange={(event) => change("originalCustomerContact", event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          原來收到時間（選填）
          <Input
            type="datetime-local"
            value={originalReceivedAt}
            onChange={(event) => change("originalReceivedAt", event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          內部備註（選填）
          <textarea
            maxLength={1000}
            className="min-h-20 rounded border p-2"
            value={note}
            onChange={(event) => change("note", event.target.value)}
          />
        </label>
        <fieldset className="space-y-2 rounded border p-3">
          <legend>下一步（選填，使用現有 CRM 跟進紀錄）</legend>
          <label className="grid gap-1 text-sm">
            事項
            <Input
              maxLength={200}
              value={followUpTitle}
              onChange={(event) => change("followUpTitle", event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            到期時間
            <Input
              type="datetime-local"
              value={followUpDueAt}
              onChange={(event) => change("followUpDueAt", event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            負責同事（留空為自己）
            <select
              className="rounded border p-2"
              value={responsibleStaffId}
              onChange={(event) => change("responsibleStaffId", event.target.value)}
            >
              <option value="">由我跟進</option>
              {agents
                .filter((agent) => agent.active)
                .map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name ?? "未命名同事"}
                  </option>
                ))}
            </select>
          </label>
        </fieldset>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || restored.recoveryError}>
          {restored.recoveryError
            ? "請先核對草稿"
            : busy
              ? "正在保存…"
              : pending
                ? "核對並重試保存"
                : "保存人工轉交查詢"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (!pending && !restored.recoveryError) {
              completed.current = true;
              if (draftKey) sessionStorage.removeItem(storageKey(draftKey));
            }
            onCancel();
          }}
        >
          {pending || restored.recoveryError ? "關閉，稍後核對" : "取消"}
        </Button>
      </div>
    </form>
  );
}
