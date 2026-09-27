import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  enqueueStaffTestNotification,
  confirmStaffTestReceipt,
  findStaffTestNotificationByRequest,
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
  const [evidenceRef, setEvidenceRef] = useState("");
  const storageKey = `staff-test:${staffId}:${transport}`;
  useEffect(() => {
    const id = window.sessionStorage.getItem(storageKey);
    if (!id) return;
    let active = true;
    findStaffTestNotificationByRequest(id)
      .then((saved) => {
        if (!active) return;
        setRequestId(id);
        if (saved) {
          setStatus(saved);
          setOpen(true);
        } else {
          setError("先前提交的試送尚無紀錄；請核對狀態，不會自動重發。");
        }
      })
      .catch(() => {
        if (active) setError("未能查閱先前試送，請稍後重試。");
      });
    return () => {
      active = false;
    };
  }, [storageKey]);
  async function showPreview() {
    if (!endpointVersion) return;
    setBusy(true);
    setError("");
    setStatus(null);
    setRequestId(null);
    window.sessionStorage.removeItem(storageKey);
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
    window.sessionStorage.setItem(storageKey, id);
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
        {transport === "staff_whatsapp" ? "測試同事 WhatsApp" : "測試 Inbox 私有備註"}
      </Button>
      {open && (preview || status) ? (
        <section role="dialog" aria-label="同事通知試送" className="space-y-3 rounded border p-4">
          <h4 className="font-semibold">[測試] 同事通知</h4>
          {preview ? (
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
              <div>
                <dt className="inline">Inbox 映射版本：</dt>
                <dd className="inline">
                  {preview.mappingVersion ? `v${preview.mappingVersion}` : "未設定"}
                </dd>
              </div>
            </dl>
          ) : null}
          {preview ? (
            <p className="whitespace-pre-wrap rounded bg-muted p-2 text-sm">{preview.message}</p>
          ) : null}
          {preview?.reasons.length ? (
            <p role="alert">未可試送：{preview.reasons.join("、")}</p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          {status ? (
            <div role="status" className="text-sm">
              <p>
                狀態：
                {status.state === "accepted"
                  ? "供應商已接納，尚未核實送達"
                  : status.state === "unknown"
                    ? "結果不明，請核對；不會自動重發"
                    : status.state}
              </p>
              <p>
                供應商送達：{status.providerDeliveredAt ?? "未核實"}；同事收件確認：
                {status.recipientConfirmedAt ?? "未核實"}；接手確認：
                {status.acknowledgementAt ?? "未核實"}
              </p>
              <p>
                供應商接納：{status.providerAcceptedAt ?? "未核實"}；證據來源：
                {status.evidenceSource ?? "未有"}
              </p>
              <p>試送編號：{status.attemptId}</p>
              {status.recipientConfirmedAt ? (
                <p>同事已確認收件（人工紀錄）：{status.recipientConfirmedAt}</p>
              ) : status.state === "accepted" || status.state === "unknown" ? (
                <div className="space-y-2">
                  <label>
                    收件確認證據編號
                    <Input
                      value={evidenceRef}
                      maxLength={160}
                      onChange={(event) => setEvidenceRef(event.target.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || !evidenceRef.trim()}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await confirmStaffTestReceipt({
                          attemptId: status.attemptId,
                          evidenceRef: evidenceRef.trim(),
                        });
                        setStatus(await getStaffTestNotification(status.attemptId));
                      } catch {
                        setError("未能記錄人工收件確認；請核對證據編號與權限。");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    記錄同事收件確認
                  </Button>
                </div>
              ) : null}
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
              disabled={busy || !preview?.ready || Boolean(status)}
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
