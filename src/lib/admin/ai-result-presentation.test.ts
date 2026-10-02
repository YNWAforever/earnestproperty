import { describe, expect, test } from "bun:test";
import { aiResultPresentation, conversationDeadline } from "./ai-result-presentation";
import { shouldOfferHumanHandoff } from "../ai/live-agent";
describe("truthful AI results", () => {
  test("source availability drives handoff without an invented probability", () => {
    expect(
      shouldOfferHumanHandoff({ confidence: 0, answerAvailable: true, userAskedForHuman: false }),
    ).toBe(false);
    expect(
      shouldOfferHumanHandoff({ confidence: 0, answerAvailable: false, userAskedForHuman: false }),
    ).toBe(true);
    expect(
      shouldOfferHumanHandoff({ confidence: 0, answerAvailable: true, userAskedForHuman: true }),
    ).toBe(true);
  });
  test("disabled, empty and legacy results never claim model success", () => {
    expect(aiResultPresentation({}).label).toBe("方法未核實");
    expect(aiResultPresentation({ method: "fallback" }).label).toBe("備用摘要");
    expect(aiResultPresentation({ method: "deterministic_rules" }).label).toBe("規則提示");
    expect(aiResultPresentation({ method: "model_validated" }).label).toBe("模型建議");
  });
  test("unknown cost remains unknown, including missing currency", () => {
    expect(aiResultPresentation({}).cost).toBe("未提供");
    expect(aiResultPresentation({ costAmount: 0 }).cost).toBe("未提供");
    expect(aiResultPresentation({ costAmount: 0, costCurrency: "USD" }).cost).toBe("0 USD");
  });
  test("stale, denied and cancelled results block application", () => {
    for (const status of ["stale", "denied", "cancelled", "failed", "running"]) {
      expect(aiResultPresentation({ status, method: "model_validated" }).canApply).toBe(false);
    }
    expect(aiResultPresentation({ status: "stale", method: "model_validated" }).label).toBe(
      "未能完成",
    );
    expect(aiResultPresentation({ status: "cancelled" }).blocker).toContain("不等於停止計費");
  });
  test("greetings and message count are not a deadline", () => {
    expect(conversationDeadline("你好 多謝 早晨")).toBeNull();
    expect(conversationDeadline("急，想了解資料")).toBeNull();
    expect(conversationDeadline("請今日五點前回覆買樓資料")).toBe("請今日五點前回覆買樓資料");
  });
});
