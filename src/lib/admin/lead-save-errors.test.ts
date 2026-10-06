import { describe, expect, test } from "bun:test";

import {
  LEAD_CHANGED_MESSAGE,
  LEAD_CHANGED_NOTE_SAVED_MESSAGE,
  isLeadChangedError,
  leadSaveErrorMessage,
} from "./lead-save-errors";

const httpError = (message: string, status: number) =>
  Object.assign(new Error(message), { status });

describe("lead save errors", () => {
  test("maps the three codes to zh-HK copy and passes other messages through", () => {
    expect(LEAD_CHANGED_MESSAGE).toBe("此客戶查詢已被其他同事更新，請重新載入後再儲存。");
    expect(leadSaveErrorMessage(httpError("LEAD_CHANGED", 409))).toBe(LEAD_CHANGED_MESSAGE);
    expect(leadSaveErrorMessage(httpError("LEAD_VERSION_REQUIRED", 400))).toBe(
      "頁面版本已過舊，請重新整理頁面後再儲存。",
    );
    expect(leadSaveErrorMessage(httpError("ASSIGNEE_INACTIVE", 400))).toBe(
      "所選同事已停用，不能指派客戶查詢。請選擇其他同事。",
    );
    expect(leadSaveErrorMessage(new Error("x"))).toBe("x");
    expect(leadSaveErrorMessage("plain")).toBe("plain");
  });

  test("only a 409 with the LEAD_CHANGED body is a lead conflict", () => {
    expect(isLeadChangedError(httpError("LEAD_CHANGED", 409))).toBe(true);
    expect(isLeadChangedError(httpError("something else", 409))).toBe(false);
    expect(isLeadChangedError(httpError("LEAD_CHANGED", 500))).toBe(false);
    expect(isLeadChangedError(new Error("LEAD_CHANGED"))).toBe(false);
    expect(isLeadChangedError(null)).toBe(false);
  });

  test("the note-saved variant keeps the conflict copy and says the note was saved", () => {
    expect(LEAD_CHANGED_NOTE_SAVED_MESSAGE.startsWith(LEAD_CHANGED_MESSAGE)).toBe(true);
    expect(LEAD_CHANGED_NOTE_SAVED_MESSAGE).toContain("跟進備註已儲存");
  });
});
