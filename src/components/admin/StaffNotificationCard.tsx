import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { StaffNotificationItem } from "@/lib/neon/staff-notifications.types";
const states: Record<string, string> = {
  pending: "待確認接手",
  acknowledged: "已確認接手",
  resolved: "跟進已完成",
  superseded: "已轉交",
  cancelled: "已取消",
};
export function StaffNotificationCard({
  item,
  busy,
  onOpen,
  onConfirm,
  onHelp,
}: {
  item: StaffNotificationItem;
  busy: boolean;
  onOpen: () => void;
  onConfirm: () => void;
  onHelp: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <article className="space-y-2 rounded border p-3" data-notification-id={item.id}>
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-semibold">
          {item.publicListingNo ?? "待核對物業"} ·{" "}
          {item.dealType === "rent" ? "租盤" : item.dealType === "sale" ? "售盤" : "一般查詢"}
        </h3>
        <span>{states[item.workState] ?? item.workState}</span>
      </div>
      <p className="text-sm">
        指定：{item.requestedName ?? "未核實"} · 供應商確認處理：{item.handlerName ?? "未命名同事"}
      </p>
      {item.mismatchReason ? (
        <p className="text-sm">處理人不同原因：{item.mismatchReason}</p>
      ) : null}
      <p className="text-sm">來源：{item.source ?? "未核實"}</p>
      <p className="text-sm">
        客戶回覆：{item.firstHumanResponseAt ? "已有核實人手回覆" : "仍待人手回覆"} · 回覆限時：
        {item.responseDueAt ?? "政策待核實"}
      </p>
      <p className="text-xs">
        接手確認：{item.acknowledgedAt ?? "尚未確認"}。確認接手不代表已回覆客戶。
      </p>
      <ul className="text-xs">
        {item.attempts.length ? (
          item.attempts.map((a, i) => (
            <li key={i}>
              {a.transport === "inbox_private_note"
                ? "Inbox 內部備註（不代表同事手機通知）"
                : a.transport === "staff_whatsapp"
                  ? "同事 WhatsApp 手機通知"
                  : a.transport}
              ：
              {a.state === "accepted"
                ? "供應商已接納（未證實送達）"
                : a.state === "delivered"
                  ? a.transport === "inbox_private_note"
                    ? "內部備註狀態已核實（不是手機送達）"
                    : "同事手機送達有簽名收據"
                  : a.state === "unknown"
                    ? "發送結果不明（需核對）"
                    : a.state}
              {a.evidenceKind ? ` · ${a.evidenceKind}` : ""}
              {a.acceptedAt ? ` · 接納 ${a.acceptedAt}（${a.acceptedSource ?? "來源未核實"}）` : ""}
              {a.deliveredAt
                ? ` · 送達 ${a.deliveredAt}（${a.deliveredSource ?? "來源未核實"}）`
                : ""}
              {a.readAt ? ` · 已讀 ${a.readAt}（${a.readSource ?? "來源未核實"}）` : ""}
              {a.error ? ` · ${a.error}` : ""}
            </li>
          ))
        ) : (
          <li>工作已記錄；未有外部通知證據。</li>
        )}
      </ul>
      <details className="text-xs">
        <summary className="cursor-pointer">接手支援診斷</summary>
        <p>查詢：{item.inquiryId}</p>
        <p>
          接手工作：{item.id} · 分派版本：{item.assignmentVersion}
        </p>
      </details>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onOpen}>
          查看查詢
        </Button>
        {item.canAct && item.purpose === "action_required" && item.workState === "pending" ? (
          <Button disabled={busy} onClick={onConfirm}>
            確認接手
          </Button>
        ) : null}
      </div>
      {item.canAct && item.purpose === "action_required" ? (
        <div className="flex flex-wrap gap-2">
          <Textarea
            aria-label="需要協助原因"
            placeholder="需要協助的原因"
            maxLength={500}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={busy || !reason.trim() || !!item.helpRequestedAt}
            onClick={() => onHelp(reason.trim())}
          >
            {item.helpRequestedAt ? "已記錄協助要求" : "需要協助"}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
