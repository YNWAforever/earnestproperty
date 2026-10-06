export const LEAD_CHANGED_MESSAGE = "此客戶查詢已被其他同事更新，請重新載入後再儲存。";
/** Shown when the same 儲存 had already written the pending follow-up note before the 409. */
export const LEAD_CHANGED_NOTE_SAVED_MESSAGE = `${LEAD_CHANGED_MESSAGE}你輸入的跟進備註已儲存，但欄位修改尚未儲存。`;

const CODE_MESSAGES: Record<string, string> = {
  LEAD_CHANGED: LEAD_CHANGED_MESSAGE,
  LEAD_VERSION_REQUIRED: "頁面版本已過舊，請重新整理頁面後再儲存。",
  ASSIGNEE_INACTIVE: "所選同事已停用，不能指派客戶查詢。請選擇其他同事。",
};

function readError(error: unknown): { status?: unknown; message?: unknown } {
  return typeof error === "object" && error !== null ? error : {};
}

/** status 409 and message LEAD_CHANGED. Duck-typed on { status, message } so the fixture's error counts too. */
export function isLeadChangedError(error: unknown): boolean {
  const { status, message } = readError(error);
  return status === 409 && message === "LEAD_CHANGED";
}

/** LEAD_CHANGED, LEAD_VERSION_REQUIRED, ASSIGNEE_INACTIVE → zh-HK copy; otherwise the error's message. */
export function leadSaveErrorMessage(error: unknown): string {
  const { message } = readError(error);
  if (typeof message === "string") return CODE_MESSAGES[message] ?? message;
  return typeof error === "string" ? error : String(error);
}
