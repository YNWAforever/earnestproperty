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
    "你的登入電郵尚未完成驗證，帳戶未連結職員記錄。請聯絡管理員在「團隊成員」為你連結帳戶。",
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
