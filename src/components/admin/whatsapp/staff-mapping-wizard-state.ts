import type { InboxSelectionReview } from "@/lib/neon/inbox-directory.types";

export type ConnectionDraft = {
  staffId: string;
  userId: string;
  folderKey: string;
  review: InboxSelectionReview | null;
  dirty: boolean;
};
export function switchWizardStaff(_current: ConnectionDraft, staffId: string): ConnectionDraft {
  return { staffId, userId: "", folderKey: "", review: null, dirty: false };
}
export function applyMappingConflict(
  current: ConnectionDraft,
  _latestVersion: number,
): ConnectionDraft {
  return { ...current, review: null, dirty: true };
}
export function canSaveReviewedMapping(
  draft: ConnectionDraft,
  reviewedVersion: number | null,
  currentVersion: number | null,
  now: string,
) {
  return !!(
    draft.staffId &&
    draft.userId &&
    draft.folderKey &&
    draft.review?.result === "verified" &&
    reviewedVersion === currentVersion &&
    Date.parse(draft.review.expiresAt) > Date.parse(now)
  );
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseWhatsappSettingsSearch(search: Record<string, unknown>) {
  const result: { staffId?: string; step?: number; draftId?: string } = {};
  if (typeof search.staffId === "string" && uuid.test(search.staffId))
    result.staffId = search.staffId;
  const step = Number(search.step);
  if (search.step !== undefined && Number.isInteger(step) && step >= 0 && step <= 3)
    result.step = step;
  if (typeof search.draftId === "string" && uuid.test(search.draftId))
    result.draftId = search.draftId;
  return result;
}
