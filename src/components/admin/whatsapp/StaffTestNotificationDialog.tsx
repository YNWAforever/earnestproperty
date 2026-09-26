import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  enqueueStaffTestNotification,
  getStaffTestNotification,
  previewStaffTestNotification,
} from "@/lib/neon/whatsapp-test-notification";

type Transport = "inbox_private_note" | "staff_whatsapp";
type Preview = Awaited<ReturnType<typeof previewStaffTestNotification>>;
type Status = Awaited<ReturnType<typeof getStaffTestNotification>>;

export function StaffTestNotificationDialog({
  staffId,
  transport,
  endpointVersion,
}: {
  staffId: string;
  transport: Transport;
  endpointVersion: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function showPreview() {
    if (!endpointVersion) return;
    setBusy(true);
    setError("");
    setStatus(null);
    setRequestId(null);
    try {
      setPreview(await previewStaffTestNotification({ staffId, transport, endpointVersion }));
      setOpen(true);
    } catch {
      setError("未能建立試送預覽，請核對權限、目的地及服務狀態。");
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!preview?.ready || !preview.previewToken || !endpointVersion) return;
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    setBusy(true);
    setError("");
    try {
      const queued = await enqueueStaffTestNotification({
        staffId,
        transport,
        endpointVersion,
        previewToken: preview.previewToken,
        requestId: id,
      });
      setStatus(await getStaffTestNotification(queued.attemptId));
    } catch {
      setError("試送未能提交；如頁面曾中斷，請保留此視窗並用同一請求編號重試。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={!endpointVersion || busy}
        onClick={showPreview}
      >
        預覽同事通知試送
      </Button>
      {open && preview ? (
        <section role="dialog" aria-label="同事通知試送" className="space-y-3 rounded border p-4">
          <h4 className="font-semibold">[測試] 同事通知</h4>
          <dl className="grid gap-1 text-sm">
            <div>
              <dt className="inline">同事：</dt>
              <dd className="inline">{preview.staffName}</dd>
            </div>
            <div>
              <dt className="inline">方式：</dt>
              <dd className="inline">
                {transport === "staff_whatsapp" ? "同事 WhatsApp" : "Inbox 私有備註"}
              </dd>
            </div>
            <div>
              <dt className="inline">收件端：</dt>
              <dd className="inline">{preview.maskedDestination ?? "未設定"}</dd>
            </div>
            <div>
              <dt className="inline">端點版本：</dt>
              <dd className="inline">v{endpointVersion}</dd>
            </div>
          </dl>
          <p className="whitespace-pre-wrap rounded bg-muted p-2 text-sm">{preview.message}</p>
          {preview.reasons.length ? (
            <p role="alert">未可試送：{preview.reasons.join("、")}</p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          {status ? (
            <div role="status" className="text-sm">
              <p>
                狀態：
                {status.state === "accepted"
                  ? "供應商已接納，等待手機送達核對"
                  : status.state === "unknown"
                    ? "結果不明，請核對；不會自動重發"
                    : status.state}
              </p>
              <p>
                送達：{status.deliveredAt ?? "未核實"}；已讀：{status.readAt ?? "未核實"}
              </p>
              <p>試送編號：{status.attemptId}</p>
              <Button
                type="button"
                variant="outline"
                onClick={async () => setStatus(await getStaffTestNotification(status.attemptId))}
              >
                重新查閱結果
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy || !preview.ready || Boolean(status)}
              onClick={send}
            >
              明確提交試送
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              關閉
            </Button>
          </div>
          {requestId ? <p className="text-xs">請求編號：{requestId}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
