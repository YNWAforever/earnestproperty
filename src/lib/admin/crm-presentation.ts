export type LeadStage =
  | "new"
  | "contacted"
  | "viewing"
  | "negotiating"
  | "closed_won"
  | "closed_lost";
export const stageOptions: { value: LeadStage; label: string }[] = [
  { value: "new", label: "新查詢" },
  { value: "contacted", label: "已聯絡" },
  { value: "viewing", label: "已約睇樓" },
  { value: "negotiating", label: "商議中" },
  { value: "closed_won", label: "已成交" },
  { value: "closed_lost", label: "已結束（未成交）" },
];
export const stageLabels: Record<string, string> = Object.fromEntries(
  stageOptions.map(({ value, label }) => [value, label]),
);
export const intentLabels: Record<string, string> = {
  unknown: "待確認",
  buyer: "買樓",
  renter: "租樓",
  landlord: "放盤",
  seller: "放售",
  valuation: "估價",
};

export const intentOptions: { value: string; label: string }[] = Object.entries(intentLabels).map(
  ([value, label]) => ({ value, label }),
);

export const sourceLabels: Record<string, string> = {
  website: "網站",
  live_agent: "線上客服",
  whatsapp: "WhatsApp",
  phone: "電話",
  referral: "轉介",
  walk_in: "到店",
};

export function quickLeadFilter<T extends { stage: string; agent_id: string; cursor?: string }>(
  filters: T,
  quick: "new" | "unassigned",
): Omit<T, "cursor"> & { cursor?: string } {
  const next = { ...filters, ...(quick === "new" ? { stage: "new" } : { agent_id: "unassigned" }) };
  delete next.cursor;
  return next;
}
export function labeledFilterOptions(
  labels: Record<string, string>,
  values: string[],
  selected: string,
) {
  return [...new Set([...Object.keys(labels), ...values, selected])]
    .filter((value) => value && value !== "all")
    .map((value) => ({ value, label: labels[value] ?? value }));
}
export function aiScoreLabel(value: number | null | undefined) {
  return value == null ? "未知（未分析）" : String(value);
}
