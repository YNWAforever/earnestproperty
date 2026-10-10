import { LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS, type LeadStage } from "@/lib/admin/glossary";

// The stage and source labels live in the glossary (FX-17a G-12); these are re-exports.
export type { LeadStage };
export const stageOptions: { value: LeadStage; label: string }[] = (
  Object.entries(LEAD_STAGE_LABELS) as [LeadStage, string][]
).map(([value, label]) => ({ value, label }));
// The leads list filter only: "open" is a query over stages, never a stage a lead can be set to.
export const stageFilterOptions: { value: LeadStage | "open"; label: string }[] = [
  { value: "open", label: "開放（未完成）" },
  ...stageOptions,
];
export const stageLabels: Record<string, string> = Object.fromEntries(
  stageOptions.map(({ value, label }) => [value, label]),
);
stageLabels.open = stageFilterOptions[0].label;
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

export const sourceLabels: Record<string, string> = LEAD_SOURCE_LABELS;

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

/**
 * System rows that are not staff follow-up. A lead whose timeline holds only these still shows
 * 「未有跟進紀錄」, so a flagged lead is never read as already handled (FX-14 B-05).
 */
const NON_FOLLOW_UP_ACTIVITY_TYPES = new Set(["suspected_bot"]);

export function leadTimelineHasNoFollowUp(activities: ReadonlyArray<{ activity_type: string }>) {
  return activities.every((activity) => NON_FOLLOW_UP_ACTIVITY_TYPES.has(activity.activity_type));
}
