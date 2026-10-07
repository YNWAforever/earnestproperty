import { expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  liveAgentPhoneErrorFromBody,
  liveAgentPhoneErrorMessage,
  validateHandoffPhone,
} from "@/lib/ai/live-agent";

import { LIVE_AGENT_REPLY_COPY, type LiveAgentCard } from "@/lib/ai/live-agent-reply";

import {
  LiveAgentHandoffPanel,
  LiveAgentReplyCards,
  nextHandoffOffered,
  readLiveAgentMessageResponse,
} from "./LiveAgentWidget";

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

// FX-11b: reply cards and the server-decided handoff offer.
function renderCards(cards: LiveAgentCard[]) {
  return load(renderToStaticMarkup(createElement(LiveAgentReplyCards, { cards })));
}

test("listing cards render internal links only", () => {
  const $ = renderCards([
    {
      type: "listing",
      title: "碧堤半島 2座 中層 A室",
      lines: ["售 $6.80M", "實用 600 呎", "2 房"],
      href: "/property/EP11001",
    },
    {
      type: "more",
      title: LIVE_AGENT_REPLY_COPY.more_link,
      lines: [],
      href: "/listings?deal=sale&bedrooms=2&estate=bellagio",
    },
  ]);

  const links = $("a");
  expect(links.length).toBe(2);
  expect(links.map((_, element) => $(element).attr("href")).get()).toEqual([
    "/property/EP11001",
    "/listings?deal=sale&bedrooms=2&estate=bellagio",
  ]);
  expect($(links[0]).text()).toBe("碧堤半島 2座 中層 A室");
  expect($(links[1]).text()).toBe("查看全部符合條件的盤源");
  for (const link of links.toArray()) {
    expect($(link).attr("target")).toBeUndefined();
  }
  const text = $("body").text();
  expect(text).toContain("售 $6.80M");
  expect(text).toContain("實用 600 呎");
  expect(text).toContain("2 房");
});

test("a card with an unsafe href renders as text", () => {
  for (const href of ["https://evil.test/x", "javascript:alert(1)", "//evil.test", "/admin"]) {
    const $ = renderCards([{ type: "listing", title: "外部連結測試", lines: ["一行"], href }]);
    expect($("a").length).toBe(0);
    expect($("body").text()).toContain("外部連結測試");
    expect($.html()).not.toContain("evil.test");
    expect($.html()).not.toContain("javascript:");
  }
});

test("an FAQ card shows the question and the answer verbatim", () => {
  const answer = "深井小學校網為 62 校網。<b>不是 HTML</b>";
  const $ = renderCards([
    { type: "faq", title: "深井屬於哪個校網？", lines: [answer], href: null },
  ]);

  expect($("a").length).toBe(0);
  expect($("li").length).toBe(1);
  expect($("li p").first().text()).toBe("深井屬於哪個校網？");
  expect($("li p").last().text()).toBe(answer);
  expect($("b").length).toBe(0);
});

test("no cards renders nothing", () => {
  expect(renderToStaticMarkup(createElement(LiveAgentReplyCards, { cards: [] }))).toBe("");
});

test("the panel opens when the server suggests a handoff and stays open", () => {
  expect(nextHandoffOffered(false, { handoffSuggested: true })).toBe(true);
  expect(nextHandoffOffered(true, { handoffSuggested: false })).toBe(true);
  expect(nextHandoffOffered(false, {})).toBe(false);
  expect(nextHandoffOffered(false, { handoffSuggested: "true" })).toBe(false);
});

test("the message response keeps well-formed cards and the reply text only", () => {
  const listing = (n: number): LiveAgentCard => ({
    type: "listing",
    title: `盤 ${n}`,
    lines: ["售 $1M"],
    href: `/property/EP1100${n}`,
  });
  const parsed = readLiveAgentMessageResponse({
    message: { message_text: "transcript text" },
    handoffSuggested: false,
    reply: {
      kind: "listings",
      text: LIVE_AGENT_REPLY_COPY.listings,
      cards: [
        listing(1),
        { type: "listing", title: 7, lines: [], href: null },
        { type: "script", title: "x", lines: [], href: null },
        { type: "faq", title: "問", lines: ["答", 3], href: null },
        null,
        listing(2),
        listing(3),
        listing(4),
        {
          type: "more",
          title: LIVE_AGENT_REPLY_COPY.more_link,
          lines: [],
          href: "/listings?deal=all",
        },
      ],
    },
  });

  expect(parsed.text).toBe(LIVE_AGENT_REPLY_COPY.listings);
  // At most three listing cards, plus the "more" link.
  expect(parsed.cards.map((card) => card.title)).toEqual([
    "盤 1",
    "盤 2",
    "盤 3",
    LIVE_AGENT_REPLY_COPY.more_link,
  ]);

  expect(readLiveAgentMessageResponse({ message: { message_text: "舊回覆" } }).text).toBe("舊回覆");
  expect(readLiveAgentMessageResponse({}).text).toBe("暫時未能回答，請稍後再試。");
  expect(readLiveAgentMessageResponse({}).cards).toEqual([]);
});
