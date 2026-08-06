/** Budget-range validation for the CRM lead detail panel.
 *
 * Lives here rather than in admin.leads.tsx so that file exports only
 * components (react-refresh/only-export-components), and so the rule that gates
 * a save is unit-testable.
 *
 * A reversed or negative range used to be accepted and saved silently, then fed
 * straight into the segment and audience filters that decide who receives a
 * WhatsApp blast.
 */
export function leadBudgetError(min: number | null, max: number | null) {
  if ((min !== null && min < 0) || (max !== null && max < 0)) {
    return "預算不可為負數。";
  }
  if (min !== null && max !== null && min > max) {
    return "最低預算不可高於最高預算。";
  }
  return null;
}
