import type { AdminConversationRow } from "@/lib/neon/admin-data.types";

const nextActions: Record<NonNullable<AdminConversationRow["next_action"]>, string> = {
  review: "需要核實關聯",
  reply: "待回覆客戶",
  triage: "待分派跟進",
  follow_up: "查看下一步",
};

/** Server-resolved names and permissions only; provider IDs stay in support detail. */
export function NoLinkInboxSummary({ row }: { row: AdminConversationRow }) {
  if (!row.public_listing_no && !row.external_listing_id && !row.next_action) return null;
  return (
    <span className="grid gap-1 text-xs text-muted-foreground">
      <span className="truncate">
        {row.source_label && row.source_label !== "unknown" ? row.source_label : "來源待核實"}
        {row.public_listing_no ? ` · 樓盤 ${row.public_listing_no}` : ""}
        {row.external_listing_id ? ` · 平台編號 ${row.external_listing_id}` : ""}
      </span>
      <span className="truncate">
        指定：{row.requested_staff_name ?? "未核實"} · 查詢跟進：
        {row.confirmed_owner_name ?? "待確認"}
      </span>
      <span className="font-medium text-foreground">
        {row.next_action ? nextActions[row.next_action] : "查看查詢"}
      </span>
    </span>
  );
}
