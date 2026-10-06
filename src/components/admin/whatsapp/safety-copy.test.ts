import { test, expect } from "bun:test";
import {
  MANAGER_RESOLVED_READBACK_NOTICE,
  dismissReasonError,
  nearMissConsentPreset,
  optOutReviewFlagCopy,
  outboundReadbackOutcome,
  resolveUnknownSuccessNotice,
  shouldClearDraftAfterReadback,
} from "./safety-copy";

test("R1: a confirmed-sent draft is cleared; a confirmed-not-sent draft is kept", () => {
  expect(shouldClearDraftAfterReadback("resolved_sent")).toBe(true);
  expect(shouldClearDraftAfterReadback("queued")).toBe(true);
  expect(shouldClearDraftAfterReadback("accepted")).toBe(true);
  expect(shouldClearDraftAfterReadback("resolved_not_sent")).toBe(false);
  expect(shouldClearDraftAfterReadback("failed")).toBe(false);
  expect(shouldClearDraftAfterReadback("cancelled")).toBe(false);
  expect(shouldClearDraftAfterReadback("unknown")).toBe(false);
});

test("R2: an exact stop word gets its own badge and line; a near-miss keeps the original copy", () => {
  expect(optOutReviewFlagCopy({ text: "退訂", at: "時間", exact: true })).toEqual({
    badge: "客戶要求退訂",
    line: "客戶曾傳送退訂字眼「退訂」（由舊紀錄匯入，系統未有自動退訂），請核實。",
  });
  expect(optOutReviewFlagCopy({ text: "我要退訂", at: "時間", exact: false })).toEqual({
    badge: "可能要求退訂",
    line: "客戶於 時間 傳送「我要退訂」，可能想停止接收訊息。系統未有自動退訂，請核實。",
  });
});

test("R2: dismissing an exact stop word needs a reason of at least 5 characters", () => {
  for (const reason of ["", "   ", "短短", "1234"])
    expect(dismissReasonError(reason, true)).toBe("請填寫原因");
  expect(dismissReasonError("客戶其後已重新同意", true)).toBeNull();
  expect(dismissReasonError("", false)).toBeNull();
});

test("a manager's resolution is a final readback outcome for the sender's tab", () => {
  expect(outboundReadbackOutcome("resolved_sent")).toBe("manager_resolved");
  expect(outboundReadbackOutcome("resolved_not_sent")).toBe("manager_resolved");
  expect(MANAGER_RESOLVED_READBACK_NOTICE).toBe("經理已核對此傳送；沒有重送。");
  // Unchanged outcomes.
  expect(outboundReadbackOutcome("queued")).toBe("sent_or_queued");
  expect(outboundReadbackOutcome("accepted")).toBe("sent_or_queued");
  expect(outboundReadbackOutcome("failed")).toBe("not_completed");
  expect(outboundReadbackOutcome("cancelled")).toBe("not_completed");
  // Still unconfirmed: the journal is kept and nothing is resent.
  expect(outboundReadbackOutcome("unknown")).toBe("pending");
  expect(outboundReadbackOutcome("dispatching")).toBe("pending");
  expect(outboundReadbackOutcome("something_new")).toBe("pending");
});

test("the resolve toast says the conversation is unlocked only when it is", () => {
  expect(resolveUnknownSuccessNotice(true)).toContain("對話已解鎖");
  expect(resolveUnknownSuccessNotice(true)).toContain("系統沒有重新傳送");
  expect(resolveUnknownSuccessNotice(false)).toBe(
    "已記錄核對結果。對話仍有其他未確認傳送，暫時未能解鎖。",
  );
  expect(resolveUnknownSuccessNotice(false)).not.toContain("已解鎖");
});

test("the near-miss consent preset records a customer opt-out naming the message", () => {
  expect(nearMissConsentPreset("7a000000-0000-4000-8000-000000000001")).toEqual({
    optedIn: false,
    evidenceSource: "customer_opt_out",
    evidenceRef: "near-miss:7a000000-0000-4000-8000-000000000001",
  });
});
