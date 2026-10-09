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

/** CMS revision-engine codes. Moved here from admin.cms.tsx and AdminEstateEditorForm.tsx. */
const CMS_ERROR_MESSAGES: Record<string, string> = {
  CMS_REVISION_CONFLICT: "此草稿的發布版本已被其他人更新。本機修改已保留，請使用比較目前發布版本。",
  CMS_REVISION_NOT_FOUND: "找不到此版本，可能已被更新，請重新載入頁面。",
  CMS_REVISION_MISMATCH: "版本資料不符，請重新載入頁面後再試一次。",
  CMS_RESOURCE_NOT_FOUND: "找不到此資源，可能已被其他人刪除或封存，請重新載入頁面。",
  CMS_MEDIA_IN_USE: "此媒體仍被其他內容使用，未能封存。",
};

/** Campaign server refusal codes, moved here from admin.blasts.tsx. The generic
 * "Not found" key stays out: here it would re-word every screen's 404 text as a
 * campaign message. admin.blasts.tsx keeps that one alias locally. */
const CAMPAIGN_ERROR_MESSAGES: Record<string, string> = {
  NOTHING_TO_RETRY: "沒有可重新發送的失敗收件人，請重新整理。",
  // A stale 發送中 row with no live job also keeps a campaign busy (FX-10b
  // Task 3 review M2), so staff are told where to look if it never clears.
  CAMPAIGN_STILL_SENDING:
    "Campaign 仍在發送中，請待發送完成或暫停後再試。如長時間仍顯示此訊息，請到「系統營運」核對發送工作。",
  CAMPAIGN_NOT_RETRYABLE: "此 Campaign 目前的狀態不可重新發送。",
  CAMPAIGN_HAS_DELIVERY_HISTORY:
    "此 Campaign 已開始發送，不可更改範本或收件群組；如需不同內容，請建立新 Campaign。",
  "Campaign not found": "找不到此 campaign，請重新整理後再試",
  RETRY_COUNT_CHANGED: "可重新發送的人數已改變，未有重新排入任何人。請核對最新數字後再確認。",
  TEMPLATE_NOT_ACTIVE: "範本未核准或無法讀取，請先核實",
  NO_ELIGIBLE_RECIPIENTS: "收件人預覽已過期或沒有合資格收件人，請重新預覽",
  INVALID_CAMPAIGN_STATUS: "目前 Campaign 狀態不能加入發送佇列",
  CAMPAIGN_NOT_ELIGIBLE: "目前 Campaign 狀態不能加入發送佇列",
  AUDIENCE_NOT_FOUND: "此 campaign 未設定收件群組",
  CAMPAIGN_CANCEL_NOT_ELIGIBLE: "此 Campaign 目前的狀態不可取消，請重新整理。",
  // FX-10b final fix wave: the 發送… approval count and the finish action.
  SEND_COUNT_CHANGED: "尚待發送人數已改變，未有加入發送佇列。請核對最新數字後再確認。",
  CAMPAIGN_NOT_FINISHABLE: "此 Campaign 目前的狀態不可結束，請重新整理。",
  CAMPAIGN_HAS_SENDABLE: "仍有尚待發送的收件人，請按「發送…」發送，或重新整理。",
  FINISH_STATE_CHANGED: "Campaign 資料剛有變更，未有結束。請核對最新數字後再試。",
};

/** The single list of known server codes and their zh-HK text. */
export const ADMIN_ERROR_CODES: Readonly<Record<string, string>> = {
  ...STAFF_ACTION_CODE_MESSAGES,
  ...CMS_ERROR_MESSAGES,
  ...CAMPAIGN_ERROR_MESSAGES,
};

/** The one fallback: existing copy (WhatsappLinksTable.tsx). */
export const ADMIN_GENERIC_ERROR = "操作未完成，請重試。";

const CJK = /[㐀-鿿]/;

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const status = (error as { status: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function messageOf(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    return typeof message === "string" ? message : undefined;
  }
  return undefined;
}

function warnRaw(error: unknown) {
  if (!import.meta.env?.DEV) return;
  console.warn("[admin-error] unmapped error shown as fallback:", error);
}

/**
 * The one rule for any failed staff action or load. Never returns English, SQL or a stack.
 * 1. A status-bearing error (ServerFnResponseError, a thrown Response, any `{ status }`)
 *    maps 401/403/404/409 to existing copy, else its body code through ADMIN_ERROR_CODES,
 *    else `fallback`.
 * 2. A message (Error, string or `{ message }`) maps as a known code, then the legacy
 *    ADMIN_ERROR_MESSAGES / duplicate-key rule (Error and `{ message }` only), then passes
 *    through when it contains CJK (our own zh-HK), else `fallback`.
 * 3. Anything else is `fallback`.
 */
export function adminErrorMessage(error: unknown, fallback: string = ADMIN_GENERIC_ERROR): string {
  const message = messageOf(error)?.trim();
  const status = statusOf(error);
  if (status !== undefined) {
    const mapped = STAFF_ACTION_STATUS_MESSAGES[status] ?? (message && ADMIN_ERROR_CODES[message]);
    if (mapped) return mapped;
    warnRaw(error);
    return fallback;
  }
  if (message) {
    const coded = ADMIN_ERROR_CODES[message];
    if (coded) return coded;
    if (typeof error !== "string") {
      const legacy = adminErrorText(message);
      if (legacy !== message) return legacy;
    }
    if (CJK.test(message)) return message;
  }
  warnRaw(error);
  return fallback;
}

/** @deprecated alias kept for FX-10a callers */
export function staffActionErrorText(error: unknown, fallback: string): string {
  return adminErrorMessage(error, fallback);
}
