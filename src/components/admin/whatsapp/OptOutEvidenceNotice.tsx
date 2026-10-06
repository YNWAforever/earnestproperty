import { useState } from "react";
import { toast } from "sonner";

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { WhatsappConsentDialog } from "@/components/admin/WhatsappConsentDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { clearAccidentalWhatsappOptOut, dismissOptOutNearMiss } from "@/lib/neon/admin-data";
import type { AdminConversationDetail } from "@/lib/neon/admin-data.types";
import { optOutReplyState } from "@/lib/neon/admin-workflow";
import { nearMissConsentPreset } from "./safety-copy";
import { formatSafetyTime } from "./safety-time";

function statusOf(error: unknown) {
  return error instanceof Error ? error.message : "";
}

function clearErrorText(error: unknown) {
  const code = statusOf(error);
  if (code.includes("OPT_OUT_GENUINE_USE_CONSENT"))
    return "客戶曾明確要求退訂，不能清除；如客戶重新同意，請用「管理 WhatsApp 推廣同意」記錄憑證。";
  if (code.includes("OPT_OUT_CHANGED") || code.includes("CONTACT_NOT_OPTED_OUT"))
    return "退訂狀態剛有更新，請重新載入後再核對。";
  if (code.includes("Forbidden")) return "你沒有權限清除此退訂。";
  return "未能清除，請稍後重試。";
}

function evidenceLine(detail: AdminConversationDetail) {
  const at = formatSafetyTime(detail.opted_out_at);
  if (detail.opted_out_source === "customer_message") {
    const text = detail.opted_out_text;
    // No saved text (should not happen for a customer message): legacy-style wording, never 「」.
    if (!text?.trim())
      return `客戶於 ${at ?? "較早前"} 要求退訂（未有保存原文），系統已停止範本、推廣及問卷。`;
    return `客戶於 ${at ?? "較早前"} 傳送「${text}」，系統已停止範本、推廣及問卷。`;
  }
  if (detail.opted_out_source === "staff_recorded") {
    return `同事於 ${at ?? "較早前"} 記錄客戶拒收推廣。`;
  }
  // legacy, or an opted-out contact with no evidence recorded at all.
  return at
    ? `舊系統於 ${at} 或之前判定為拒收（未有保存原文）。如屬誤判，經理可清除。`
    : "舊系統判定為拒收（未有保存原文，亦無記錄時間）。如屬誤判，經理可清除。";
}

function ClearAccidentalOptOutDialog({
  detail,
  onChanged,
}: {
  detail: AdminConversationDetail;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = reason.trim();

  async function submit() {
    if (!detail.contact_id) return;
    setBusy(true);
    setError(null);
    try {
      await clearAccidentalWhatsappOptOut({
        data: {
          contactId: detail.contact_id,
          reason: trimmed,
          // The exact microsecond version from the detail read; a millisecond string is rejected.
          expectedOptedOutAt: detail.opted_out_version ?? null,
        },
      });
      toast.success("已清除誤判，紀錄已保留。");
      setOpen(false);
      setReason("");
      onChanged();
    } catch (caught) {
      setError(clearErrorText(caught));
      if (statusOf(caught).includes("OPT_OUT_CHANGED")) onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setOpen(value);
          if (!value) setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          清除誤判
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>清除誤判的退訂</DialogTitle>
          <DialogDescription>
            只適用於系統誤判（例如客戶回覆「唔要」）。原有紀錄會保留，並記入審計紀錄。不會更改推廣同意。
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-2 text-sm">
          原因（必填）
          <Textarea
            value={reason}
            disabled={busy}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：客戶只是回答「唔要車位」"
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
        <Button type="button" disabled={busy || trimmed.length < 5} onClick={() => void submit()}>
          {busy ? "處理中…" : "清除誤判"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function DismissNearMissButton({
  detail,
  messageId,
  onChanged,
}: {
  detail: AdminConversationDetail;
  messageId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!detail.contact_id) return;
    setBusy(true);
    setError(null);
    try {
      await dismissOptOutNearMiss({
        data: {
          conversationId: detail.id,
          contactId: detail.contact_id,
          messageId,
          reason: reason.trim() || undefined,
        },
      });
      toast.success("已隱藏提示，並記入審計紀錄。");
      setOpen(false);
      setReason("");
      onChanged();
    } catch {
      setError("未能隱藏提示，請重新載入後再試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        不是退訂
      </Button>
      <AdminConfirmDialog
        open={open}
        title="不是退訂要求？"
        description="只會隱藏這則提示，不會更改客戶的推廣同意。之後如客戶再傳類似訊息，系統會再次提示。此操作會記入審計紀錄。"
        confirmLabel="不是退訂"
        isPending={busy}
        error={error}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setError(null);
        }}
        onConfirm={() => void submit()}
      >
        <Textarea
          value={reason}
          disabled={busy}
          maxLength={200}
          aria-label="備註（選填）"
          onChange={(event) => setReason(event.target.value)}
          placeholder="備註（選填），例如：客戶只是問「可唔可以停一停先」"
        />
      </AdminConfirmDialog>
    </>
  );
}

/**
 * FX-08: the opt-out evidence (badge + one line of why), the manager's 清除誤判 for a legacy
 * misread, and the 「可能要求退訂」 near-miss flag. Rendered as siblings inside the
 * conversation header's flex-wrap row; the evidence line takes its own row at the end.
 * Server-side checks remain the boundary; the buttons only mirror them.
 */
export function OptOutEvidenceNotice({
  detail,
  onChanged,
}: {
  detail: AdminConversationDetail;
  onChanged: () => void;
}) {
  if (detail.opted_out_whatsapp) {
    const reopened =
      optOutReplyState({
        optedOut: true,
        optedOutAt: detail.opted_out_at ?? null,
        lastInboundAt: detail.last_inbound_at,
      }) === "reopened";
    const canClear =
      detail.can_clear_opt_out && detail.opted_out_source === "legacy" && !!detail.contact_id;
    return (
      <>
        <Badge variant="destructive">已退訂推廣</Badge>
        {canClear ? <ClearAccidentalOptOutDialog detail={detail} onChanged={onChanged} /> : null}
        <div className="order-last basis-full space-y-1 text-sm text-muted-foreground">
          <p>{evidenceLine(detail)}</p>
          {reopened ? (
            <p>
              {`客戶於 ${formatSafetyTime(detail.last_inbound_at)} 再次來訊，現可在 24 小時內以文字回覆；範本仍然停用。`}
            </p>
          ) : null}
        </div>
      </>
    );
  }

  const nearMiss = detail.opt_out_near_miss;
  if (!nearMiss) return null;
  const at = formatSafetyTime(nearMiss.at);
  return (
    <>
      <Badge variant="outline">可能要求退訂</Badge>
      {detail.can_clear_opt_out && detail.contact_id ? (
        <>
          <WhatsappConsentDialog
            key={nearMiss.messageId}
            contactId={detail.contact_id}
            onSaved={onChanged}
            preset={nearMissConsentPreset(nearMiss.messageId)}
            triggerLabel="確認退訂"
          />
          <DismissNearMissButton
            key={"dismiss-" + nearMiss.messageId}
            detail={detail}
            messageId={nearMiss.messageId}
            onChanged={onChanged}
          />
        </>
      ) : null}
      <div className="order-last basis-full space-y-1 text-sm text-muted-foreground">
        <p>{`客戶於 ${at} 傳送「${nearMiss.text}」，可能想停止接收訊息。系統未有自動退訂，請核實。`}</p>
        {detail.can_clear_opt_out ? null : <p>請通知經理處理。</p>}
      </div>
    </>
  );
}
