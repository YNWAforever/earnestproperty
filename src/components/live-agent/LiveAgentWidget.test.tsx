import { expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  liveAgentPhoneErrorFromBody,
  liveAgentPhoneErrorMessage,
  validateHandoffPhone,
} from "@/lib/ai/live-agent";

import { LiveAgentHandoffPanel } from "./LiveAgentWidget";

type PanelProps = Parameters<typeof LiveAgentHandoffPanel>[0];

const noop = () => {};

// The panel is a controlled view over the widget's state, so every case renders it with no-op
// handlers and asserts the markup the visitor would get for that state.
function render(overrides: Partial<PanelProps> = {}) {
  const props: PanelProps = {
    phone: "",
    phoneTouched: false,
    consent: false,
    loading: false,
    serverError: null,
    onPhoneChange: noop,
    onPhoneBlur: noop,
    onConsentChange: noop,
    onSubmit: noop,
    ...overrides,
  };
  return load(renderToStaticMarkup(createElement(LiveAgentHandoffPanel, props)));
}

function handoffButton($: ReturnType<typeof render>) {
  return $("button").filter((_, element) => $(element).text().includes("轉介代理"));
}

test("button disabled for a 7-digit number and no preview", () => {
  const $ = render({ phone: "9123456", phoneTouched: false });

  expect(handoffButton($).length).toBe(1);
  expect(handoffButton($).attr("disabled")).toBeDefined();
  expect($("#live-agent-handoff-phone-preview").length).toBe(0);
  expect($("body").text()).not.toContain("代理會用");
});

test("blank phone keeps the button disabled without an alert", () => {
  const $ = render({ phone: "", phoneTouched: true });

  expect(handoffButton($).attr("disabled")).toBeDefined();
  expect($("[role='alert']").length).toBe(0);
  expect($("#live-agent-handoff-phone-preview").length).toBe(0);
  expect($("input[autocomplete='tel']").attr("aria-invalid")).not.toBe("true");
});

test("valid HK number enables the button and previews +852 9123 4567", () => {
  const $ = render({ phone: "9123 4567", phoneTouched: true });

  expect(handoffButton($).attr("disabled")).toBeUndefined();
  const preview = $("#live-agent-handoff-phone-preview");
  expect(preview.length).toBe(1);
  expect(preview.text()).toBe("代理會用 +852 9123 4567 聯絡你");
  expect($("[role='alert']").length).toBe(0);
  expect($("input[autocomplete='tel']").attr("aria-describedby")).toBe(
    "live-agent-handoff-phone-preview",
  );
  expect($("input[autocomplete='tel']").attr("aria-invalid")).not.toBe("true");
});

test("international number previews +447700900123", () => {
  const $ = render({ phone: "+44 7700 900123", phoneTouched: false });

  expect(handoffButton($).attr("disabled")).toBeUndefined();
  expect($("#live-agent-handoff-phone-preview").text()).toBe("代理會用 +447700900123 聯絡你");
});

test("touched invalid number shows the INVALID copy in role=alert and aria-invalid=true", () => {
  const $ = render({ phone: "12345", phoneTouched: true });

  const alert = $("p[role='alert']");
  expect(alert.length).toBe(1);
  expect(alert.attr("id")).toBe("live-agent-handoff-phone-error");
  expect(alert.text()).toBe(liveAgentPhoneErrorMessage("LIVE_AGENT_PHONE_INVALID"));
  expect(alert.text()).toBe("電話號碼格式不正確，請輸入 8 位香港手機號碼，或連國家碼的號碼。");

  const input = $("input[autocomplete='tel']");
  expect(input.attr("aria-invalid")).toBe("true");
  expect(input.attr("aria-describedby")).toBe("live-agent-handoff-phone-error");
  expect($("#live-agent-handoff-phone-preview").length).toBe(0);
  expect(handoffButton($).attr("disabled")).toBeDefined();
});

test("untouched invalid number shows no alert until the field is blurred", () => {
  const $ = render({ phone: "12345", phoneTouched: false });

  expect($("[role='alert']").length).toBe(0);
  expect($("input[autocomplete='tel']").attr("aria-invalid")).not.toBe("true");
  expect(handoffButton($).attr("disabled")).toBeDefined();
});

test("server 400 phone error is shown in role=alert", () => {
  const serverError = liveAgentPhoneErrorFromBody({
    code: "LIVE_AGENT_PHONE_REQUIRED",
    error: "raw",
  });
  const $ = render({ phone: "9123 4567", phoneTouched: true, serverError });

  const alert = $("p[role='alert']");
  expect(alert.length).toBe(1);
  expect(alert.text()).toBe("請輸入電話號碼，方便代理聯絡你。");
  expect($.html()).not.toContain("raw");
  // The error replaces the preview, and the input points at the error.
  expect($("#live-agent-handoff-phone-preview").length).toBe(0);
  expect($("input[autocomplete='tel']").attr("aria-invalid")).toBe("true");
  expect($("input[autocomplete='tel']").attr("aria-describedby")).toBe(
    "live-agent-handoff-phone-error",
  );
});

test("loading disables the button even with a valid number", () => {
  const $ = render({ phone: "9123 4567", phoneTouched: true, loading: true });

  expect(handoffButton($).attr("disabled")).toBeDefined();
});

test("keeps the zh-HK aria-labels for phone and consent", () => {
  const $ = render();

  const phone = $("input[aria-label='轉接 WhatsApp 電話']");
  expect(phone.length).toBe(1);
  expect(phone.attr("placeholder")).toBe("WhatsApp 電話");
  expect(phone.attr("autocomplete")).toBe("tel");
  expect(phone.attr("inputmode")).toBe("tel");
  expect($("[aria-label='同意 WhatsApp 跟進聯絡']").length).toBe(1);
  expect($("label").text()).toContain("我同意 Earnest Property 透過 WhatsApp 聯絡我跟進今次查詢。");
});

test("the button agrees with validateHandoffPhone for the same inputs", () => {
  const inputs = [
    "",
    "9123456",
    "9123 4567",
    "3123 4567",
    "+852 9123 4567",
    "+852 2123 4567",
    "0044 7700 900123",
    "+44 7700 900123",
    "(852) 9123 4567",
    "abc",
  ];

  for (const phone of inputs) {
    const $ = render({ phone, phoneTouched: true });
    const enabled = handoffButton($).attr("disabled") === undefined;
    expect({ phone, enabled }).toEqual({ phone, enabled: validateHandoffPhone(phone).ok });
  }
});
