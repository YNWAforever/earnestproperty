/** Known raw error messages mapped to something a non-technical staff member
 * can act on.
 *
 * `AdminError` is the error surface for every admin page and used to render the
 * exception text verbatim, so staff saw things like `Not found` or a raw
 * Postgres constraint violation. Anything unrecognised is still shown rather
 * than swallowed -- an unhelpful message beats a silent failure -- but it is
 * framed as a failure with a next step.
 *
 * Lives beside AdminShell rather than inside it so the shell file exports only
 * components (react-refresh/only-export-components).
 */
const ADMIN_ERROR_MESSAGES: Record<string, string> = {
  "Not found": "找不到資料，可能已被刪除，請重新載入頁面。",
  Unauthorized: "登入狀態已過期，請重新登入。",
  Forbidden: "你的帳戶沒有權限查看這項資料，請聯絡系統管理員。",
  "staff-email-unverified":
    "你的登入電郵尚未完成驗證，帳戶未連結職員記錄。請先完成電郵驗證，然後重新登入；如沒有驗證途徑，請聯絡管理員。",
  "Failed to fetch": "無法連線到伺服器，請檢查網絡後重試。",
};

export function adminErrorText(message: string) {
  const mapped = ADMIN_ERROR_MESSAGES[message.trim()];
  if (mapped) return mapped;
  if (/duplicate key|violates .* constraint/i.test(message)) {
    return "資料重複，未能儲存。請檢查是否已有相同記錄。";
  }
  return message;
}

/**
 * Existing zh-HK copy only (admin-data.ts, TransactionAttributionEditor.tsx, and the
 * ADMIN_ERROR_MESSAGES "Not found" entry above for 404); no new strings.
 */
const STAFF_ACTION_STATUS_MESSAGES: Record<number, string> = {
  401: "登入已失效，請重新登入後再試。",
  403: "你沒有權限進行此操作。",
  404: ADMIN_ERROR_MESSAGES["Not found"],
  409: "資料版本已變更，請重新載入並核對後再儲存。",
};

/**
 * Plain-Error codes (no status) that reach the WhatsApp link screens. Existing copy only:
 * the 409 string above, and the batch reason text in whatsapp-link-batches.server.ts.
 * Codes with no existing zh-HK copy (WA_LINK_STAFF_UNAVAILABLE,
 * WA_LINK_OFFER_CONTEXT_REQUIRED, WA_LINK_VERSION_REQUIRED, SERVICE_COPY_UNAPPROVED,
 * WA_POLICY_UNAPPROVED) are left for an owner copy pass.
 */
const STAFF_ACTION_CODE_MESSAGES: Record<string, string> = {
  WA_LINK_VERSION_CONFLICT: STAFF_ACTION_STATUS_MESSAGES[409],
  STAFF_REFERENCE_CONFLICT_OR_EXPIRED: "同事來源代碼已過期或衝突",
  WA_LINK_PUBLIC_OFFER_UNAVAILABLE: "目前租售盤已下架或版本改變",
};

/**
 * For a failed staff ACTION or load. A status-bearing error (ServerFnResponseError, a
 * thrown Response, or any `{ status: number }`) maps 401/403/404/409 to existing copy and
 * every other status to the screen's own `fallback` -- never a raw code such as
 * `Forbidden` or `BATCH_PREVIEW_EXPIRED`. A plain Error (local validation, network)
 * keeps its text through adminErrorText; anything else gets `fallback`.
 */
export function staffActionErrorText(error: unknown, fallback: string): string {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status: unknown }).status
      : undefined;
  if (typeof status === "number") return STAFF_ACTION_STATUS_MESSAGES[status] ?? fallback;
  if (error instanceof Error) {
    const coded = STAFF_ACTION_CODE_MESSAGES[error.message.trim()];
    return coded ?? (adminErrorText(error.message) || fallback);
  }
  return fallback;
}
