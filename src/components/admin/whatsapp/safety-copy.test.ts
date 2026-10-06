import { test, expect } from "bun:test";
import {
  MANAGER_RESOLVED_READBACK_NOTICE,
  nearMissConsentPreset,
  outboundReadbackOutcome,
  resolveUnknownSuccessNotice,
} from "./safety-copy";

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
