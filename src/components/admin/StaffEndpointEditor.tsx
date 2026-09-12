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
}: {
  agents: { id: string; name: string | null; active: boolean }[];
}) {
  const [events, setEvents] = useState<Awaited<ReturnType<typeof fetchStaffEventReview>>>([]);
  const [attention, setAttention] = useState<Awaited<ReturnType<typeof fetchStaffAttention>>>([]);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchStaffEndpoints>>>([]),
    [health, setHealth] = useState<Record<string, number>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    staffId: "",
    transport: "inbox_private_note" as "inbox_private_note" | "staff_whatsapp",
    channelId: "",
    destinationReference: "",
    verificationRef: "",
    permissionRef: "",
    allowAllHours: false,
    enabled: false,
  });
  const [edit, setEdit] = useState<{ id: string; expectedVersion: number } | null>(null);
  useEffect(() => {
    let current = true;
    Promise.all([
      fetchStaffEndpoints(),
      fetchStaffNotificationHealth(),
      fetchStaffAttention(),
      fetchStaffEventReview(),
    ])
      .then(([r, h, a, ev]) => {
        if (current) {
          setRows(r);
          setAttention(a);
          setEvents(ev);
          setHealth(h.counts);
        }
      })
      .catch(() => {
        if (current) setError("未能載入，請核對管理權限及遷移。");
      });
    return () => {
      current = false;
    };
  }, []);
  return (
    <section aria-label="同事通知設定" className="space-y-3 border-t pt-4">
      <h2 className="font-semibold">同事通知及待處理工作</h2>
      <p className="text-sm">
        此處記錄獨立通知目的地及核實證據。私有 Inbox 目的地必須是該同事的已核實 Inbox ID；WhatsApp
        使用另外核實的同事收件 ID。儲存設定不代表已送達裝置。
      </p>
      <dl className="flex flex-wrap gap-4">
        {Object.entries(health).map(([key, n]) => (
          <div key={key}>
            <dt>
              {{
                unacknowledged: "未確認接手",
                unknown: "發送結果不明",
                failed_or_suppressed: "失敗／已阻擋",
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
      <form
        className="grid max-w-xl gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await updateStaffEndpoint({ ...form, ...(edit ?? {}) });
            setRows(await fetchStaffEndpoints());
            setEdit(null);
          } catch {
            setError("未能儲存：請核對同事映射、目的地及版本，重新整理後再試。");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
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
        {(
          [
            ["channelId", "公司頻道 ID"],
            ["destinationReference", "已核實收件 ID"],
            ["verificationRef", "核實紀錄編號"],
            ["permissionRef", "同事接收授權紀錄"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <Input
              required
              maxLength={key === "destinationReference" ? 256 : 160}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </label>
        ))}
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
        <Button disabled={busy}>{edit ? "儲存目的地新版本" : "建立通知目的地"}</Button>
      </form>
      {rows.map((r) => (
        <article key={r.id} className="rounded border p-2">
          <p>
            {agents.find((a) => a.id === r.staffId)?.name ?? r.staffId} · {r.transport} · v
            {r.version} · {r.enabled ? "啟用" : "關閉"}
          </p>
          <Button
            variant="outline"
            disabled={busy || r.retired}
            onClick={() => {
              setEdit({ id: r.id, expectedVersion: r.version });
              setForm({
                staffId: r.staffId,
                transport: r.transport as typeof form.transport,
                channelId: r.channelId,
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
              setBusy(true);
              try {
                await turnOffStaffEndpoint({ id: r.id, expectedVersion: r.version });
                setRows(await fetchStaffEndpoints());
              } catch {
                setError("關閉未完成，請重新整理版本後再試。");
              } finally {
                setBusy(false);
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
