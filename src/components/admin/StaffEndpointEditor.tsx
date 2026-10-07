import { useWorkspaceCurrent } from "@/hooks/use-workspace-current";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  turnOffStaffEndpoint,
  fetchStaffEventReview,
  fetchStaffAttention,
  fetchStaffEndpoints,
  updateStaffEndpoint,
  fetchStaffNotificationHealth,
} from "@/lib/neon/staff-endpoints";
export function StaffEndpointEditor({
  agents,
  selectedStaffId,
  isWorkspaceCurrent,
}: {
  agents: { id: string; name: string | null; active: boolean }[];
  selectedStaffId?: string;
  isWorkspaceCurrent?: () => boolean;
}) {
  const isCurrent = useWorkspaceCurrent(isWorkspaceCurrent);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof fetchStaffEventReview>>>([]);
  const [attention, setAttention] = useState<Awaited<ReturnType<typeof fetchStaffAttention>>>([]);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchStaffEndpoints>>>([]),
    [health, setHealth] = useState<Record<string, number>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    staffId: "",
    transport: "inbox_private_note" as "inbox_private_note" | "staff_whatsapp",
    destinationReference: "",
    verificationRef: "",
    permissionRef: "",
    allowAllHours: false,
    enabled: false,
  });
  const [edit, setEdit] = useState<{ id: string; expectedVersion: number } | null>(null);
  useEffect(() => {
    if (!selectedStaffId) return;
    setEdit(null);
    setForm({
      staffId: selectedStaffId,
      transport: "inbox_private_note",
      destinationReference: "",
      verificationRef: "",
      permissionRef: "",
      allowAllHours: false,
      enabled: false,
    });
  }, [selectedStaffId]);
  useEffect(() => {
    let current = true;
    Promise.all([
      fetchStaffEndpoints(isCurrent),
      fetchStaffNotificationHealth(isCurrent),
      fetchStaffAttention(isCurrent),
      fetchStaffEventReview(isCurrent),
    ])
      .then(([r, h, a, ev]) => {
        if (current && isCurrent()) {
          setRows(r);
          setAttention(a);
          setEvents(ev);
          setHealth(h.counts);
        }
      })
      .catch(() => {
        if (current && isCurrent()) setError("未能載入，請核對管理權限及遷移。");
      });
    return () => {
      current = false;
    };
  }, [isCurrent]);
  return (
    <section id="staff-notifications" aria-label="同事通知設定" className="space-y-3 border-t pt-4">
      <h2 className="font-semibold">同事通知及待處理工作</h2>
      <p className="text-sm">
        同事手機通知是獨立可選功能，預設關閉。未設定不影響接收客戶查詢；只有核實目的地、同事授權及時段後才可啟用。
      </p>
      <dl className="flex flex-wrap gap-4">
        {Object.entries(health).map(([key, n]) => (
          <div key={key}>
            <dt>
              {{
                unacknowledged: "未確認接手",
                unknown: "發送結果不明",
                failed_or_suppressed: "失敗／已阻擋",
                lead_alerts_blocked: "新查詢通知未送出",
                routing_exceptions: "路由待核對",
                unattended_blockers: "未指定核對人",
                association_review: "訊息關聯待核對",
                oldest_queued_seconds: "最舊佇列秒數",
                help_requested: "要求協助",
              }[key] ?? key}
            </dt>
            <dd>{n}</dd>
          </div>
        ))}
      </dl>
      <h3 className="font-medium">待核對／協助要求（最早 100 項）</h3>
      {attention.map((a) => (
        <article key={a.kind + a.inquiryId} className="rounded border p-2">
          <p>
            {a.kind === "help" ? "同事要求協助" : "路由待核對"} · {a.propertyNo ?? "一般查詢"} ·{" "}
            {a.reason}
          </p>
          <a
            className="underline"
            href={`/admin/whatsapp?conversation=${encodeURIComponent(a.conversationId)}&enquiry=${encodeURIComponent(a.inquiryId)}`}
          >
            查看相關查詢
          </a>
        </article>
      ))}
      <h3 className="font-medium">同事／客戶訊息用途待核對（最早 100 項）</h3>
      <p className="text-sm">
        以下訊息已保存，尚未當作客戶查詢或內部接手確認。請由經理核實用途；不會自動重播或向客戶發送訊息。
      </p>
      {events.map((ev) => (
        <article key={ev.id} className="rounded border p-2">
          <p>
            {ev.kind} · {ev.createdAt}
          </p>
          <p className="whitespace-pre-wrap">{ev.text ?? "非文字內容，需核對原始紀錄"}</p>
          <p className="text-xs">核對紀錄：{ev.id}</p>
          {ev.conversationId ? (
            <a
              className="underline"
              href={`/admin/whatsapp?conversation=${encodeURIComponent(ev.conversationId)}`}
            >
              核對現有對話
            </a>
          ) : (
            <p>尚無客戶對話；需核實後處理。</p>
          )}
        </article>
      ))}
      {error ? <p role="alert">{error}</p> : null}
      <details className="rounded border p-3">
        <summary className="cursor-pointer font-medium">進階：由支援人員設定同事通知目的地</summary>
        <p className="mt-2 text-sm">
          一般接收查詢毋須設定同事手機通知。這是獨立可選功能；儲存設定不會試送。
        </p>
        <form
          className="mt-3 grid max-w-xl gap-2"
          onSubmit={async (e) => {
            if (!isCurrent()) return;
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await updateStaffEndpoint({ ...form, ...(edit ?? {}) }, isCurrent);
              if (!isCurrent()) return;
              const workspaceResult = await fetchStaffEndpoints(isCurrent);
              if (!isCurrent()) return;
              setRows(workspaceResult);
              setEdit(null);
            } catch {
              if (!isCurrent()) return;
              setError("未能儲存：請核對同事映射、目的地及版本，重新整理後再試。");
            } finally {
              if (isCurrent()) {
                setBusy(false);
              }
            }
          }}
        >
          <label className={selectedStaffId ? "hidden" : undefined}>
            同事
            <select
              required
              disabled={!!edit}
              value={form.staffId}
              onChange={(e) => setForm({ ...form, staffId: e.target.value })}
            >
              <option value="">選擇同事</option>
              {agents
                .filter((a) => a.active)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ?? a.id}
                  </option>
                ))}
            </select>
          </label>
          <label>
            通知方式
            <select
              value={form.transport}
              onChange={(e) =>
                setForm({ ...form, transport: e.target.value as typeof form.transport })
              }
            >
              <option value="inbox_private_note">私有 Inbox 備註</option>
              <option value="staff_whatsapp">同事 WhatsApp</option>
            </select>
          </label>
          {form.transport === "inbox_private_note" ? (
            <p className="text-sm">
              Inbox 目的地與核實證據由已核實同事映射取得；儲存時會綁定該映射版本。
            </p>
          ) : (
            <>
              <label>
                已核實同事 WhatsApp 收件 ID
                <Input
                  required
                  maxLength={256}
                  value={form.destinationReference}
                  onChange={(e) => setForm({ ...form, destinationReference: e.target.value })}
                />
              </label>
              <label>
                收件 ID 核實紀錄編號
                <Input
                  required
                  maxLength={160}
                  value={form.verificationRef}
                  onChange={(e) => setForm({ ...form, verificationRef: e.target.value })}
                />
              </label>
            </>
          )}
          <label>
            同事接收授權紀錄
            <Input
              required
              maxLength={160}
              value={form.permissionRef}
              onChange={(e) => setForm({ ...form, permissionRef: e.target.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.allowAllHours}
              onChange={(e) => setForm({ ...form, allowAllHours: e.target.checked })}
            />
            已批准此目的地全天候通知（未批准會阻擋發送）
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            啟用此目的地（仍受全域功能及傳送能力驗證限制）
          </label>
          <Button disabled={busy || !form.staffId}>
            {edit ? "儲存目的地新版本" : "建立通知目的地"}
          </Button>
        </form>
      </details>
      {rows
        .filter((r) => !selectedStaffId || r.staffId === selectedStaffId)
        .map((r) => (
          <article key={r.id} className="rounded border p-2">
            <p>
              {agents.find((a) => a.id === r.staffId)?.name ?? r.staffId} · {r.transport} · v
              {r.version} · {r.enabled ? "啟用" : "關閉"} · 目的地 {r.maskedDestination ?? "未設定"}
              {" · "}核實 {r.verifiedAt ?? "未核實"} · 權限{" "}
              {r.permissionGranted ? "已核實" : "未核實"}
            </p>
            <Button
              variant="outline"
              disabled={busy || r.retired}
              onClick={() => {
                setEdit({ id: r.id, expectedVersion: r.version });
                setForm({
                  staffId: r.staffId,
                  transport: r.transport as typeof form.transport,
                  destinationReference: "",
                  verificationRef: "",
                  permissionRef: "",
                  allowAllHours: false,
                  enabled: false,
                });
              }}
            >
              重新核實
            </Button>
            <Button
              variant="outline"
              disabled={busy || !r.enabled}
              onClick={async () => {
                if (!isCurrent()) return;
                setBusy(true);
                try {
                  await turnOffStaffEndpoint({ id: r.id, expectedVersion: r.version }, isCurrent);
                  if (!isCurrent()) return;
                  const workspaceResult = await fetchStaffEndpoints(isCurrent);
                  if (!isCurrent()) return;
                  setRows(workspaceResult);
                } catch {
                  if (!isCurrent()) return;
                  setError("關閉未完成，請重新整理版本後再試。");
                } finally {
                  if (isCurrent()) {
                    setBusy(false);
                  }
                }
              }}
            >
              關閉通知目的地
            </Button>
          </article>
        ))}
    </section>
  );
}
