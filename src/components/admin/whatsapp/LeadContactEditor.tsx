import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveLeadContact } from "@/lib/neon/forwarded-enquiries";
import { validateLeadContactUpdate } from "@/lib/whatsapp-enquiries/forwarded-enquiries";
export function LeadContactEditor({
  leadId,
  contactId,
  name,
  email,
  onReload,
  disabled = false,
}: {
  leadId: string;
  contactId: string;
  name: string | null;
  email: string | null;
  onReload: () => Promise<boolean>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState(name ?? "");
  const [draftEmail, setDraftEmail] = useState(email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsReadback, setNeedsReadback] = useState(false);
  const [snapshot, setSnapshot] = useState({
    expectedContactId: contactId,
    expectedName: name,
    expectedEmail: email,
  });
  const live = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function reload() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      if ((await onReload()) && live.current) {
        setOpen(false);
        setNeedsReadback(false);
        setError("");
      }
    } catch {
      if (live.current) setError("未能重新載入聯絡資料。請再次核對，未有重送修改。");
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }
  if (!open)
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setDraftName(name ?? "");
          setDraftEmail(email ?? "");
          setSnapshot({ expectedContactId: contactId, expectedName: name, expectedEmail: email });
          setError("");
          setNeedsReadback(false);
          setOpen(true);
        }}
      >
        編輯姓名／電郵
      </Button>
    );
  return (
    <form
      aria-label="編輯聯絡資料"
      className="mt-3 grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending.current || disabled || needsReadback) return;
        let input;
        try {
          input = validateLeadContactUpdate({
            leadId,
            name: draftName || null,
            email: draftEmail || null,
            ...snapshot,
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : "聯絡資料格式無效。");
          return;
        }
        pending.current = true;
        setBusy(true);
        setError("");
        void saveLeadContact(input)
          .then(async () => {
            if (!live.current) return;
            if ((await onReload()) && live.current) setOpen(false);
          })
          .catch(() => {
            if (!live.current) return;
            setNeedsReadback(true);
            setError("儲存結果未能確認，或聯絡資料已變更。請先重新載入核對，再決定是否修改。");
          })
          .finally(() => {
            pending.current = false;
            if (live.current) setBusy(false);
          });
      }}
    >
      <p className="text-xs">
        只編輯姓名和電郵；電話、WhatsApp 身分、推廣同意及訊息時窗保持原有核實流程。
      </p>
      <label className="grid gap-1 text-sm">
        姓名
        <Input
          maxLength={160}
          disabled={busy || disabled || needsReadback}
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        電郵
        <Input
          type="email"
          maxLength={254}
          disabled={busy || disabled || needsReadback}
          value={draftEmail}
          onChange={(event) => setDraftEmail(event.target.value)}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || disabled || needsReadback}>
          {busy ? "正在儲存…" : "儲存聯絡資料"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || needsReadback}
          onClick={() => {
            setOpen(false);
            setDraftName(name ?? "");
            setDraftEmail(email ?? "");
          }}
        >
          取消
        </Button>
        {needsReadback ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void reload()}>
            {busy ? "正在核對…" : "重新載入聯絡資料"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
