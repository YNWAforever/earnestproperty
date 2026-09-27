import type {
  InboxCandidate,
  InboxFolder,
  InboxSelectionReview,
} from "@/lib/neon/inbox-directory.types";

type Mapping = {
  id: string;
  version: number;
  inbox_user_id: string;
  folder_id: string;
  eligible: boolean;
  review_basis?: string;
  review_enforced?: boolean;
  verified_at: string | null;
  retired_at?: string | null;
};
export function StaffConnectionSummary({
  mapping,
  review,
  candidate,
  folder,
}: {
  mapping: Mapping | null;
  review: InboxSelectionReview | null;
  candidate: InboxCandidate | null;
  folder: InboxFolder | null;
}) {
  const saved = mapping?.eligible && !mapping.retired_at;
  const reviewed =
    saved && mapping?.review_enforced && mapping?.review_basis === "provider_verified";
  return (
    <section aria-label="Inbox 連接摘要" className="space-y-2 rounded border p-3 text-sm">
      <h3 className="font-medium">Inbox 連接摘要</h3>
      <p>
        現有映射：
        {reviewed ? "已核實，可接單" : saved ? "舊人工紀錄，待供應商核實" : "未核實／未接單"}
        {mapping ? " · 版本 " + mapping.version : ""}
      </p>
      {candidate ? (
        <p>
          選擇帳戶：{candidate.displayName} · {candidate.email ?? "未提供電郵"}
        </p>
      ) : null}
      {folder ? <p>選擇 Folder：{folder.displayName}</p> : null}
      <p>
        本次連接檢查：
        {review?.result === "verified"
          ? "已核實"
          : review?.result === "denied"
            ? "無權限／不符"
            : "未核實"}
        {review ? " · 到期 " + review.expiresAt : ""}
      </p>
      {review?.reasons.length ? <p role="alert">{review.reasons.join("、")}</p> : null}
      {mapping ? (
        <details>
          <summary>進階映射識別資料</summary>
          Inbox User ID：{mapping.inbox_user_id} · Folder ID：{mapping.folder_id} · 最後核實：
          {mapping.verified_at ?? "未核實"}
        </details>
      ) : null}
    </section>
  );
}
