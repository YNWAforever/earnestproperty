import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveLeadContact } from "@/lib/neon/forwarded-enquiries";
export function LeadContactEditor({
  leadId,
  name,
  email,
  onSaved,
}: {
  leadId: string;
  name: string | null;
  email: string | null;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState(name ?? "");
  const [draftEmail, setDraftEmail] = useState(email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setOpen(false);
    setDraftName(name ?? "");
    setDraftEmail(email ?? "");
    setError("");
  }, [leadId, name, email]);
  if (!open)
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        編輯姓名／電郵
      </Button>
    );
  return (
    <form
      className="mt-3 grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        void saveLeadContact({ leadId, name: draftName || null, email: draftEmail || null })
          .then(async () => {
            await onSaved();
            setOpen(false);
          })
          .catch(() => setError("未能儲存，可能是權限、資料格式或聯絡資料已變更。請檢查後重試。"))
          .finally(() => setBusy(false));
      }}
    >
      <p className="text-xs">
        只編輯姓名和電郵；電話、WhatsApp 身分、推廣同意及訊息時窗保持原有核實流程。
      </p>
      <label className="grid gap-1 text-sm">
        姓名
        <Input
          maxLength={160}
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        電郵
        <Input
          type="email"
          maxLength={254}
          value={draftEmail}
          onChange={(event) => setDraftEmail(event.target.value)}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "正在儲存…" : "儲存聯絡資料"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setDraftName(name ?? "");
            setDraftEmail(email ?? "");
          }}
        >
          取消
        </Button>
      </div>
    </form>
  );
}
