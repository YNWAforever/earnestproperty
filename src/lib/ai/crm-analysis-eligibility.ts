import type { CrmActionType, CrmAnalysis } from "./crm-analysis-contract";
export type CrmActionContext = {
  isTest: boolean;
  hasVerifiedContact: boolean;
  sourceVerified: boolean;
  serviceReplyAllowed: boolean;
  marketingEligible: boolean;
};
export function allowedCrmActions(context: CrmActionContext): readonly CrmActionType[] {
  if (context.isTest) return ["mark_test"];
  if (!context.hasVerifiedContact) return ["complete_contact", "review_enquiry"];
  if (!context.sourceVerified) return ["verify_source", "review_enquiry"];
  return [
    "review_enquiry",
    ...(context.serviceReplyAllowed ? ["service_reply" as const] : []),
    ...(context.marketingEligible ? ["marketing_review" as const] : []),
  ];
}
const actionLabels: Record<CrmActionType, string> = {
  mark_test: "標記為測試記錄，退出銷售跟進。",
  complete_contact: "先補齊並核實客戶聯絡資料。",
  verify_source: "先核實查詢來源及相關紀錄。",
  review_enquiry: "先覆核查詢內容及跟進資格。",
  service_reply: "覆核客戶入站查詢及服務回覆時段，再由同事確認回覆。",
  marketing_review: "覆核推廣同意、目的地及已批範本，再另行確認推廣。",
};
export function crmActionLabel(type: CrmActionType) {
  return actionLabels[type];
}
export function fallbackCrmAnalysis(context: CrmActionContext): CrmAnalysis {
  const type = allowedCrmActions(context)[0];
  return {
    summary: context.isTest
      ? "測試記錄，請勿作銷售跟進。"
      : context.hasVerifiedContact
        ? "資料未經模型驗證，請由同事覆核。"
        : "未有核實聯絡資料，請先補資料。",
    urgency: "normal",
    timeline: null,
    action: { type, reason: crmActionLabel(type) },
    suggested_tags: [],
  };
}
