/**
 * Maps a failed 「可能重複客戶」 resolve to the dialog's error line. Existing copy only:
 *  - REVIEW_CHANGED (new messages kept arriving while the manager resolved): the admin 409
 *    version line (admin-error-text.ts), since nobody else handled the item;
 *  - REVIEW_ALREADY_RESOLVED and any other 409: the plan's 此項目已由其他同事處理 line;
 *  - REVIEW_ACTION_NOT_ALLOWED: the plan's 此操作不適用於這個項目 line;
 *  - anything else: the shared submit-failed line, and the dialog stays usable.
 * Lives beside the list rather than inside it so the component file exports only components
 * (react-refresh/only-export-components).
 */
const VERSION_CHANGED = "資料版本已變更，請重新載入並核對後再儲存。";
const ALREADY_RESOLVED = "此項目已由其他同事處理，請重新載入。";
const NOT_ALLOWED = "此操作不適用於這個項目。";
const SUBMIT_FAILED = "提交失敗，請稍後再試。";

export type IdentityReviewResolveError = { message: string; reload: boolean };

export function identityReviewResolveError(error: unknown): IdentityReviewResolveError {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status: unknown }).status
      : undefined;
  const code = error instanceof Error ? error.message.trim() : "";
  if (code === "REVIEW_CHANGED") return { message: VERSION_CHANGED, reload: true };
  if (status === 409 || code === "REVIEW_ALREADY_RESOLVED")
    return { message: ALREADY_RESOLVED, reload: true };
  if (code === "REVIEW_ACTION_NOT_ALLOWED") return { message: NOT_ALLOWED, reload: true };
  return { message: SUBMIT_FAILED, reload: false };
}
