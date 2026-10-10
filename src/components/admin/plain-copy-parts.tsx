import type { AssignmentContextView } from "@/lib/whatsapp-enquiries/assignment-view.js";
import {
  countText,
  hkTime,
  linkReadinessText,
  placementSourceText,
  testAttemptStateText,
} from "@/lib/admin/plain-copy";

/** Presentational pieces for the WhatsApp admin screens (FX-17a G-11): no raw dates or codes. */
type Episode = AssignmentContextView["enquiries"][number];

export function EnquiryEpisodeSummary({ e, children }: { e: Episode; children?: React.ReactNode }) {
  return (
    <>
      <strong>
        {e.property ?? "一般查詢"} ·{" "}
        {e.dealType === "sale" ? "售" : e.dealType === "rent" ? "租" : "未指定交易"}
      </strong>{" "}
      · 來源：{placementSourceText(e.source)}
      {children}
      <p>
        首個人手回覆：{hkTime(e.firstResponseAt, "尚無合資格證據")} · 服務期限：
        {hkTime(e.dueAt, "尚未啟用服務政策")}
      </p>
    </>
  );
}

type LinkFacts = {
  opens: number | null;
  enquiries: number | null;
  sourcePlacementId?: string | null;
  placementVerifiedAt?: string | null;
  readiness: string;
  recentTest: { state: string; createdAt: string } | null;
};

export function LinkCardFacts({ link }: { link: LinkFacts }) {
  return (
    <>
      <p>
        開啟 {countText(link.opens)} · 帶來查詢 {countText(link.enquiries)}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer">投放與就緒詳情</summary>
        <p className="break-all">投放 ID：{link.sourcePlacementId ?? "未記錄"}</p>
        <p>核實：{hkTime(link.placementVerifiedAt, "未核實")}</p>
        <p>指派就緒：{linkReadinessText(link.readiness)}</p>
        <p>
          最近試送：
          {link.recentTest
            ? `${testAttemptStateText(link.recentTest.state)} · ${hkTime(link.recentTest.createdAt, "未有紀錄")}`
            : "未有紀錄"}
        </p>
      </details>
    </>
  );
}
