export type ForwardedEnquiryInput = {
  requestId: string;
  text: string;
  businessSource: string;
  sourceUrl: string | null;
  originalCustomerContact: string | null;
  originalReceivedAt: string | null;
  note: string | null;
  followUpTitle: string | null;
  followUpDueAt: string | null;
  responsibleStaffId: string | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type LeadContactUpdateInput = {
  leadId: string;
  name: string | null;
  email: string | null;
  expectedContactId: string;
  expectedName: string | null;
  expectedEmail: string | null;
};
export function validateLeadContactUpdate(input: LeadContactUpdateInput): LeadContactUpdateInput {
  if (!input || !uuid.test(input.leadId) || !uuid.test(input.expectedContactId))
    throw Error("客戶資料無效，請重新載入後再編輯。");
  for (const [value, limit] of [
    [input.name, 160],
    [input.email, 254],
    [input.expectedName, 160],
    [input.expectedEmail, 254],
  ] as const) {
    if (value !== null && (typeof value !== "string" || value.length > limit))
      throw Error("客戶資料無效，請重新載入後再編輯。");
  }
  const name = input.name?.trim() || null;
  const email = input.email?.trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error("電郵格式無效。");
  return { ...input, name, email };
}
const clean = (value: string | null, limit: number) => {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length > limit) throw Error("欄位過長。");
  return trimmed || null;
};
export function validateForwardedEnquiry(input: ForwardedEnquiryInput): ForwardedEnquiryInput {
  if (!uuid.test(input.requestId)) throw Error("請求編號無效。");
  const text = input.text.trim();
  const businessSource = input.businessSource.trim();
  if (!text || text.length > 4000 || businessSource.length < 2 || businessSource.length > 80)
    throw Error("請填寫原文及業務來源。");
  const sourceUrl = clean(input.sourceUrl, 1000);
  if (sourceUrl) {
    let url: URL;
    try {
      url = new URL(sourceUrl);
    } catch {
      throw Error("來源網址無效。");
    }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password)
      throw Error("來源網址只接受安全 HTTPS 網址。");
  }
  const originalReceivedAt = clean(input.originalReceivedAt, 80);
  const followUpDueAt = clean(input.followUpDueAt, 80);
  if (
    (originalReceivedAt && Number.isNaN(Date.parse(originalReceivedAt))) ||
    (followUpDueAt && Number.isNaN(Date.parse(followUpDueAt)))
  )
    throw Error("時間無效。");
  const followUpTitle = clean(input.followUpTitle, 200);
  if (Boolean(followUpTitle) !== Boolean(followUpDueAt))
    throw Error("跟進事項及到期時間須一同填寫。");
  if (input.responsibleStaffId && !uuid.test(input.responsibleStaffId))
    throw Error("負責同事無效。");
  return {
    ...input,
    text,
    businessSource,
    sourceUrl,
    originalCustomerContact: clean(input.originalCustomerContact, 200),
    originalReceivedAt,
    note: clean(input.note, 1000),
    followUpTitle,
    followUpDueAt,
  };
}
