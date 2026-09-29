import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveForwardedEnquiry } from "@/lib/neon/forwarded-enquiries";
import type { ForwardedEnquiryInput } from "@/lib/whatsapp-enquiries/forwarded-enquiries";

export function ForwardedEnquiryForm({
  agents,
  onSaved,
  onCancel,
}: {
  agents: { id: string; name: string | null; active: boolean }[];
  onSaved: (leadId: string) => void;
  onCancel: () => void;
}) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [text, setText] = useState("");
  const [businessSource, setBusinessSource] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [originalCustomerContact, setOriginalCustomerContact] = useState("");
  const [originalReceivedAt, setOriginalReceivedAt] = useState("");
  const [note, setNote] = useState("");
  const [followUpTitle, setFollowUpTitle] = useState("");
  const [followUpDueAt, setFollowUpDueAt] = useState("");
  const [responsibleStaffId, setResponsibleStaffId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const input: ForwardedEnquiryInput = {
        requestId,
        text,
        businessSource,
        sourceUrl: sourceUrl || null,
        originalCustomerContact: originalCustomerContact || null,
        originalReceivedAt: originalReceivedAt ? new Date(originalReceivedAt).toISOString() : null,
        note: note || null,
        followUpTitle: followUpTitle || null,
        followUpDueAt: followUpDueAt ? new Date(followUpDueAt).toISOString() : null,
        responsibleStaffId: responsibleStaffId || null,
      };
      const result = await saveForwardedEnquiry(input);
      setRequestId(crypto.randomUUID());
      onSaved(result.leadId);
    } catch {
      setError("未能保存；原文及請求編號已保留。請核對權限、內容及到期時間後再試。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="space-y-3" onSubmit={(event) => void save(event)}>
      <p className="text-sm">
        此為人工轉交，不是原客戶 WhatsApp
        對話接駁。轉交者不是原客戶；未核實聯絡方式不可用來直接回覆、開啟訊息時窗或作推廣同意。
      </p>
      <label className="grid gap-1 text-sm">
        原文／轉交內容
        <textarea
          required
          maxLength={4000}
          className="min-h-28 rounded border p-2"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        業務來源
        <Input
          required
          maxLength={80}
          value={businessSource}
          onChange={(event) => setBusinessSource(event.target.value)}
          placeholder="例如：同事轉交的 28Hse 查詢"
        />
      </label>
      <label className="grid gap-1 text-sm">
        來源網址（選填）
        <Input
          type="url"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="https://"
        />
      </label>
      <label className="grid gap-1 text-sm">
        原客戶聯絡線索（選填，未核實）
        <Input
          maxLength={200}
          value={originalCustomerContact}
          onChange={(event) => setOriginalCustomerContact(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        原來收到時間（選填）
        <Input
          type="datetime-local"
          value={originalReceivedAt}
          onChange={(event) => setOriginalReceivedAt(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        內部備註（選填）
        <textarea
          maxLength={1000}
          className="min-h-20 rounded border p-2"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <fieldset className="space-y-2 rounded border p-3">
        <legend>下一步（選填，使用現有 CRM 跟進紀錄）</legend>
        <label className="grid gap-1 text-sm">
          事項
          <Input
            maxLength={200}
            value={followUpTitle}
            onChange={(event) => setFollowUpTitle(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          到期時間
          <Input
            type="datetime-local"
            value={followUpDueAt}
            onChange={(event) => setFollowUpDueAt(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          負責同事（留空為自己）
          <select
            className="rounded border p-2"
            value={responsibleStaffId}
            onChange={(event) => setResponsibleStaffId(event.target.value)}
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
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "正在保存…" : "保存人工轉交查詢"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}
