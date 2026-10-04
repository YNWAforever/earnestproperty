import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WhatsappAiSuggestions } from "./WhatsappAiSuggestions";
describe("optional WhatsApp suggestions", () => {
  test("keeps AI secondary and labels it as an unconfirmed draft", () => {
    const html = renderToStaticMarkup(
      createElement(WhatsappAiSuggestions, {
        loading: false,
        summary: "Synthetic summary",
        suggestedReply: "Synthetic reply",
        intentLabel: "待確認",
        urgencyLabel: "一般",
        onUseSuggestedReply: () => {},
      }),
    );
    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*\bopen/);
    expect(html).toContain("方法未核實");
    expect(html).toContain("核對後才傳送");
    expect(html).toContain("套用至回覆草稿");
    expect(html).not.toContain("Synthetic reply</button>");
  });
  test("missing analysis is not fabricated", () => {
    const html = renderToStaticMarkup(
      createElement(WhatsappAiSuggestions, { loading: false, onUseSuggestedReply: () => {} }),
    );
    expect(html).toContain("暫未有建議");
    expect(html).not.toContain("套用至回覆草稿");
  });
  test("deterministic summary has no model-success or probability claim", () => {
    const html = renderToStaticMarkup(
      createElement(WhatsappAiSuggestions, {
        loading: false,
        summary: "三則寒暄",
        method: "deterministic_rules",
        checkedAt: "2026-10-03T00:00:00Z",
        onUseSuggestedReply: () => {},
      }),
    );
    expect(html).toContain("規則提示");
    expect(html).toContain("2026-10-03");
    expect(html).not.toContain("AI 判斷");
    expect(html).not.toContain("查看 AI 建議");
    expect(html).toContain("費用：未提供");
  });
});
