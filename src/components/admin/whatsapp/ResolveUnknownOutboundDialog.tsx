import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { resolveAdminUnknownOutbound } from "@/lib/neon/admin-data";
import type { AdminConversationDetail } from "@/lib/neon/admin-data.types";
import { formatSafetyTime } from "./safety-time";

type Outcome = "resolved_sent" | "resolved_not_sent";

// Mirrors UNKNOWN_RESOLUTION_MIN_AGE_MINUTES (server-only module, so it cannot be imported here).
// Only used to word the "earliest" hint; the server enforces the real minimum.
const MIN_AGE_MS = 15 * 60 * 1000;

function resolveErrorText(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code.includes("OUTBOUND_ALREADY_RESOLVED")) return "已由其他同事核對。";
  if (code.includes("OUTBOUND_NOT_UNKNOWN")) return "此傳送已不是未確認狀態，請重新載入。";
  if (code.includes("OUTBOUND_RESOLUTION_TOO_EARLY")) return "傳送結果仍在確認中，請稍後再核對。";
  if (code.includes("Forbidden") || code.includes("OUTBOUND_NOT_FOUND_OR_FORBIDDEN"))
    return "你沒有權限核對此傳送。";
  return "未能記錄核對結果，請稍後重試。";
}

/** The dialog body. Presentational so the copy is testable without a portal. */
export function ResolveUnknownOutboundForm({
  kind,
  dispatchStartedAt,
  outcome,
  reason,
  busy,
  error,
  onOutcome,
  onReason,
  onSubmit,
}: {
  kind: "text" | "template";
  dispatchStartedAt: string | null;
  outcome: Outcome | null;
  reason: string;
  busy: boolean;
  error: string | null;
  onOutcome: (outcome: Outcome) => void;
  onReason: (reason: string) => void;
  onSubmit: () => void;
}) {
  const started = formatSafetyTime(dispatchStartedAt) ?? "未有記錄";
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        {`系統未能確認這則${kind === "template" ? "範本" : "文字訊息"}是否已送達（開始傳送：${started}）。請先在 WhatsApp 或 WozTell 核對，再選擇結果。此操作不會重新傳送任何訊息。`}
      </p>
      <RadioGroup
        value={outcome ?? ""}
        onValueChange={(value) => onOutcome(value as Outcome)}
        disabled={busy}
        aria-label="核對結果"
      >
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="resolved_sent" />
          已送達客戶
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="resolved_not_sent" />
          未有送出
        </label>
      </RadioGroup>
      <label className="grid gap-2 text-sm">
        原因（必填）
        <Textarea
          value={reason}
          disabled={busy}
          maxLength={500}
          onChange={(event) => onReason(event.target.value)}
          placeholder="例如：已在 WozTell 後台確認客戶收到"
        />
      </label>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        disabled={busy || !outcome || reason.trim().length < 5}
        onClick={onSubmit}
      >
        {busy ? "處理中…" : "記錄核對結果"}
      </Button>
    </div>
  );
}

/**
 * FX-08: a manager closes out a real `unknown` send. This only records what the manager
 * verified; it never sends, queues or resends anything.
 */
export function ResolveUnknownOutboundDialog({
  detail,
  onChanged,
}: {
  detail: AdminConversationDetail;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intent = detail.unknown_outbound;
  if (!detail.can_resolve_unknown_outbound || !intent) return null;

  if (!intent.resolvable) {
    const startedMs = intent.dispatch_started_at
      ? new Date(intent.dispatch_started_at).getTime()
      : NaN;
    const earliest = Number.isNaN(startedMs)
      ? null
      : formatSafetyTime(new Date(startedMs + MIN_AGE_MS));
    return (
      <>
        <Button type="button" variant="outline" size="sm" disabled>
          核對未確認傳送
        </Button>
        <p className="order-last basis-full text-sm text-muted-foreground">
          {earliest
            ? `傳送結果仍在確認中，最早可於 ${earliest} 核對。`
            : "傳送結果仍在確認中，請稍後再核對。"}
        </p>
      </>
    );
  }

  async function submit() {
    if (!outcome || !intent) return;
    setBusy(true);
    setError(null);
    try {
      await resolveAdminUnknownOutbound({
        data: {
          intentId: intent.id,
          conversationId: detail.id,
          outcome,
          reason: reason.trim(),
        },
      });
      toast.success("已記錄核對結果，對話已解鎖。系統沒有重新傳送；如需再發，請自行輸入新訊息。");
      setOpen(false);
      setOutcome(null);
      setReason("");
      onChanged();
    } catch (caught) {
      setError(resolveErrorText(caught));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        核對未確認傳送
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            if (!value) setError(null);
          }
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>核對未確認的傳送</DialogTitle>
          </DialogHeader>
          <ResolveUnknownOutboundForm
            kind={intent.kind}
            dispatchStartedAt={intent.dispatch_started_at}
            outcome={outcome}
            reason={reason}
            busy={busy}
            error={error}
            onOutcome={setOutcome}
            onReason={setReason}
            onSubmit={() => void submit()}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
