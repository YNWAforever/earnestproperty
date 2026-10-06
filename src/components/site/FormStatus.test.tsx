import { expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FormStatus, type FormStatusState } from "./FormStatus";

/**
 * FormStatus is the inline, always-visible result line under a public form's
 * submit button. The sonner toast is transient, so this is what a visitor (and
 * a screen reader, via role) can rely on to know whether the enquiry was sent.
 */
function render(state: FormStatusState, id?: string) {
  return renderToStaticMarkup(createElement(FormStatus, { state, id }));
}

test("idle renders nothing", () => {
  expect(render({ kind: "idle" })).toBe("");
});

test("error renders role=alert with the message text", () => {
  const $ = load(render({ kind: "error", message: "提交失敗，請稍後再試。" }));
  const alert = $("[role='alert']");
  expect(alert.length).toBe(1);
  expect(alert.text()).toBe("提交失敗，請稍後再試。");
  expect($("[role='status']").length).toBe(0);
  expect(alert.attr("class")).toContain("text-destructive");
  expect(alert.attr("class")).toContain("bg-destructive/10");
});

test("success renders role=status with the message text", () => {
  const $ = load(render({ kind: "success", message: "已收到你的查詢。" }));
  const status = $("[role='status']");
  expect(status.length).toBe(1);
  expect(status.text()).toBe("已收到你的查詢。");
  expect($("[role='alert']").length).toBe(0);
  expect(status.attr("class")).toContain("text-primary");
  expect(status.attr("class")).toContain("bg-primary/10");
});

test("passes id through", () => {
  const error = load(render({ kind: "error", message: "失敗" }, "enquiry-status"));
  expect(error("#enquiry-status").attr("role")).toBe("alert");

  const success = load(render({ kind: "success", message: "成功" }, "enquiry-status"));
  expect(success("#enquiry-status").attr("role")).toBe("status");
});
