import { expect, mock, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The view under test is pure; only the loader component reaches the server function, which
// pulls in the TanStack Start runtime. Replace the module so the import stays inert.
mock.module("@/lib/neon/admin-data", () => ({ fetchLeadLiveAgentTranscript: async () => [] }));

const { LeadChatTranscriptView } = await import("./LeadChatTranscript");

type State = Parameters<typeof LeadChatTranscriptView>[0]["state"];

function render(state: State) {
  return renderToStaticMarkup(createElement(LeadChatTranscriptView, { state, onRetry: () => {} }));
}

test("loading state shows 載入中…", () => {
  const $ = load(render({ kind: "loading" }));
  expect($("section").attr("aria-label")).toBe("網站問樓助手對話");
  expect($("h3").text()).toBe("網站問樓助手對話");
  expect($("section").text()).toContain("載入中…");
  expect($("ol").length).toBe(0);
});

test("error state shows role=alert copy and a 重新載入 button", () => {
  const $ = load(render({ kind: "error" }));
  const alert = $("p[role='alert']");
  expect(alert.length).toBe(1);
  expect(alert.text()).toContain("未能載入網站對話紀錄。");
  const button = alert.find("button");
  expect(button.length).toBe(1);
  expect(button.attr("type")).toBe("button");
  expect(button.text()).toBe("重新載入");
});

test("empty ready state shows 沒有網站對話紀錄", () => {
  const $ = load(render({ kind: "ready", messages: [] }));
  expect($("section").text()).toContain("沒有網站對話紀錄");
  expect($("ol").length).toBe(0);
});

test("messages render in given order with role labels 訪客 / 問樓助手 / 系統 and the heading", () => {
  const $ = load(
    render({
      kind: "ready",
      messages: [
        { role: "visitor", text: "想問屋苑", created_at: "2026-10-05T01:02:03.000Z" },
        { role: "assistant", text: "合成答案", created_at: "2026-10-05T01:02:04.000Z" },
        { role: "system", text: "已轉交代理", created_at: "2026-10-05T01:02:05.000Z" },
        { role: "staff", text: "同事跟進", created_at: "2026-10-05T01:02:06.000Z" },
      ],
    }),
  );
  expect($("h3").text()).toBe("網站問樓助手對話");
  const items = $("ol > li");
  expect(items.length).toBe(4);
  const text = (index: number) => items.eq(index).text();
  expect(text(0)).toContain("訪客");
  expect(text(0)).toContain("想問屋苑");
  expect(text(1)).toContain("問樓助手");
  expect(text(1)).toContain("合成答案");
  expect(text(2)).toContain("系統");
  expect(text(2)).toContain("已轉交代理");
  expect(text(3)).toContain("同事");
  expect(text(3)).toContain("同事跟進");
  // formatHkDateTime renders Hong Kong time: 01:02 UTC is 09:02 in Hong Kong.
  expect(text(0)).toContain("09:02");
  expect(items.eq(0).find(".whitespace-pre-wrap").text()).toBe("想問屋苑");
});

test("message text is escaped, not HTML", () => {
  const html = render({
    kind: "ready",
    messages: [{ role: "visitor", text: "<b>x</b>", created_at: "2026-10-05T01:02:03.000Z" }],
  });
  expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  const $ = load(html);
  expect($("b").length).toBe(0);
});
