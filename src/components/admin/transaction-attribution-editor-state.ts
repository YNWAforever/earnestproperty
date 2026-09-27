import type {
  AgentCredit,
  TransactionAttributionStatus,
  TransactionPerformance,
  TransactionPerformanceInput,
} from "@/lib/neon/transaction-performance.types";

export type CreditField = {
  staffId: string;
  branchIdAtClose: string | null;
  shareBps: string;
  label?: string;
  branchName?: string | null;
};
export type FormState = {
  status: TransactionAttributionStatus;
  leadId: string;
  publicListingNo: string;
  confirmedAt: string;
  receivable: string;
  received: string;
  reason: string;
  credits: CreditField[];
};
export const emptyForm: FormState = {
  status: "draft",
  leadId: "",
  publicListingNo: "",
  confirmedAt: "",
  receivable: "",
  received: "",
  reason: "",
  credits: [],
};
const moneyPattern = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function cents(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function buildAttributionInput(
  form: FormState,
  context: { transactionId: string; dealType: "sale" | "rent"; version: number },
): TransactionPerformanceInput {
  const credits: AgentCredit[] = form.credits.map((credit) => ({
    staffId: credit.staffId,
    branchIdAtClose: credit.branchIdAtClose,
    shareBps: Number(credit.shareBps),
  }));
  const total = credits.reduce((sum, credit) => sum + credit.shareBps, 0);
  if (
    credits.some(
      (credit) =>
        !uuidPattern.test(credit.staffId) ||
        !Number.isSafeInteger(credit.shareBps) ||
        credit.shareBps < 1 ||
        credit.shareBps > 10000,
    )
  )
    throw new Error("請檢查同事及分配比例");
  if (new Set(credits.map((credit) => credit.staffId)).size !== credits.length)
    throw new Error("同一同事不能重複分配");
  if (form.status === "verified_attributed" && (credits.length === 0 || total !== 10000))
    throw new Error("完整歸因必須分配 100%");
  if (form.status === "draft" && total > 10000) throw new Error("分配比例不能超過 100%");
  if (["verified_unattributed", "cancelled"].includes(form.status) && credits.length)
    throw new Error("未歸因或取消成交不能分配同事");
  if (form.status !== "draft" && !form.confirmedAt) throw new Error("內部核實需要成交確認日期");
  const money = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!moneyPattern.test(trimmed)) throw new Error("佣金須為非負港元金額，最多兩位小數");
    return trimmed;
  };
  const commissionReceivable = money(form.receivable);
  const commissionReceived = money(form.received);
  if (
    commissionReceived !== null &&
    (commissionReceivable === null || cents(commissionReceived) > cents(commissionReceivable))
  )
    throw new Error("已收佣金不能大於應收佣金");
  if (!form.reason.trim()) throw new Error("請輸入建立、核實、取消或更正原因");
  return {
    transactionId: context.transactionId,
    expectedVersion: context.version,
    leadId: form.leadId || null,
    publicListingNo: form.publicListingNo || null,
    dealType: context.dealType,
    confirmedAt: form.confirmedAt
      ? new Date(form.confirmedAt + "T00:00:00+08:00").toISOString()
      : null,
    commissionReceivable,
    commissionReceived,
    credits,
    attributionStatus: form.status,
    reason: form.reason.trim(),
  };
}
export function performanceDateInHongKong(value: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return part("year") + "-" + part("month") + "-" + part("day");
}
export function fromPerformance(value: TransactionPerformance | null): FormState {
  if (!value) return emptyForm;
  return {
    status: value.attributionStatus,
    leadId: value.leadId ?? "",
    publicListingNo: value.publicListingNo ?? "",
    confirmedAt: value.confirmedAt ? performanceDateInHongKong(value.confirmedAt) : "",
    receivable: value.commissionReceivable ?? "",
    received: value.commissionReceived ?? "",
    reason: "",
    credits: value.credits.map((credit) => ({
      staffId: credit.staffId,
      branchIdAtClose: credit.branchIdAtClose,
      shareBps: String(credit.shareBps),
      label: credit.staffName ?? undefined,
      branchName: credit.branchName,
    })),
  };
}
