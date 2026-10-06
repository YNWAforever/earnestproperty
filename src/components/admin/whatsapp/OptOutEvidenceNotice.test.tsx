import { test, expect } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminConversationDetail } from "@/lib/neon/admin-data.types";
import { OptOutEvidenceNotice } from "./OptOutEvidenceNotice";
import { nearMissConsentPreset } from "./safety-copy";

const MIN = 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function detail(overrides: Partial<AdminConversationDetail>): AdminConversationDetail {
  return {
    id: "c1",
    name: "合成客戶",
    status: "open",
    phone: null,
    last_message_at: iso(-10 * MIN),
    last_inbound_at: iso(-10 * MIN),
    opted_out_whatsapp: false,
    last_text: null,
    last_direction: null,
    contact_id: "9d0c0000-0000-4000-8000-000000000001",
    assigned_agent_id: null,
    woztell_member_id: "m",
    messages: [],
    can_clear_opt_out: false,
    ...overrides,
  } as AdminConversationDetail;
}
const render = (d: AdminConversationDetail) =>
  renderToStaticMarkup(createElement(OptOutEvidenceNotice, { detail: d, onChanged: () => {} }));

test("shows the quoted message and time for a customer opt-out, with no clear button", () => {
  const html = render(
    detail({
      opted_out_whatsapp: true,
      opted_out_at: iso(-60 * MIN),
      opted_out_text: "退訂",
      opted_out_source: "customer_message",
      can_clear_opt_out: true,
    }),
  );
  expect(html).toContain("已退訂推廣");
  expect(html).toContain("客戶於");
  expect(html).toContain("傳送「退訂」，系統已停止範本、推廣及問卷。");
  expect(html).not.toContain("清除誤判");
});

test("a customer opt-out with no saved text never shows an empty quote", () => {
  for (const text of [null, undefined, "", "   "]) {
    const html = render(
      detail({
        opted_out_whatsapp: true,
        opted_out_at: iso(-60 * MIN),
        opted_out_text: text as string | null,
        opted_out_source: "customer_message",
      }),
    );
    expect(html).toContain("已退訂推廣");
    expect(html).not.toContain("「」");
    expect(html).not.toContain("「   」");
    expect(html).toContain("未有保存原文");
    expect(html).toContain("系統已停止範本、推廣及問卷。");
  }
  const noTime = render(
    detail({
      opted_out_whatsapp: true,
      opted_out_at: null,
      opted_out_text: null,
      opted_out_source: "customer_message",
    }),
  );
  expect(noTime).not.toContain("「」");
  expect(noTime).toContain("未有保存原文");
});

test("shows 清除誤判 only to managers on legacy rows", () => {
  const legacy = {
    opted_out_whatsapp: true,
    opted_out_at: iso(-60 * MIN),
    opted_out_text: null,
    opted_out_source: "legacy" as const,
  };
  const asManager = render(detail({ ...legacy, can_clear_opt_out: true }));
  expect(asManager).toContain("舊系統於");
  expect(asManager).toContain("如屬誤判，經理可清除。");
  expect(asManager).toContain("清除誤判");
  const asAgent = render(detail({ ...legacy, can_clear_opt_out: false }));
  expect(asAgent).toContain("舊系統於");
  expect(asAgent).not.toContain("清除誤判");
  const staff = render(
    detail({
      opted_out_whatsapp: true,
      opted_out_at: iso(-60 * MIN),
      opted_out_source: "staff_recorded",
      can_clear_opt_out: true,
    }),
  );
  expect(staff).toContain("同事於");
  expect(staff).toContain("記錄客戶拒收推廣。");
  expect(staff).not.toContain("清除誤判");
});

test("shows the reopened line only after a strictly newer inbound", () => {
  const base = {
    opted_out_whatsapp: true,
    opted_out_at: iso(-60 * MIN),
    opted_out_source: "customer_message" as const,
    opted_out_text: "stop",
  };
  const newer = render(detail({ ...base, last_inbound_at: iso(-5 * MIN) }));
  expect(newer).toContain("再次來訊，現可在 24 小時內以文字回覆；範本仍然停用。");
  const older = render(detail({ ...base, last_inbound_at: iso(-90 * MIN) }));
  expect(older).not.toContain("再次來訊");
  const same = render(detail({ ...base, last_inbound_at: base.opted_out_at }));
  expect(same).not.toContain("再次來訊");
});

test("renders nothing when not opted out and there is no near-miss", () => {
  expect(render(detail({}))).toBe("");
  expect(render(detail({ opt_out_near_miss: null }))).toBe("");
});

const nearMiss = {
  messageId: "7a000000-0000-4000-8000-0000000000aa",
  text: "我要退訂",
  at: iso(-3 * MIN),
};

test("near-miss: managers get 確認退訂 and 不是退訂", () => {
  const html = render(detail({ opt_out_near_miss: nearMiss, can_clear_opt_out: true }));
  expect(html).toContain("可能要求退訂");
  expect(html).toContain("傳送「我要退訂」，可能想停止接收訊息。系統未有自動退訂，請核實。");
  expect(html).toContain("確認退訂");
  expect(html).toContain("不是退訂");
  expect(html).not.toContain("請通知經理處理");
  expect(html).not.toContain("已退訂推廣");
});

test("near-miss: the confirm path presets the consent dialog to 客戶拒收要求 with the message ref", () => {
  expect(nearMissConsentPreset(nearMiss.messageId)).toEqual({
    optedIn: false,
    evidenceSource: "customer_opt_out",
    evidenceRef: "near-miss:" + nearMiss.messageId,
  });
  expect(nearMissConsentPreset(nearMiss.messageId).evidenceRef).toMatch(
    /^[A-Za-z0-9:_./-]{1,120}$/,
  );
});

test("an exact stop word (history import) is named plainly, not as a 'maybe'", () => {
  const exact = { ...nearMiss, text: "退訂", exact: true };
  const html = render(detail({ opt_out_near_miss: exact, can_clear_opt_out: true }));
  expect(html).toContain("客戶要求退訂");
  expect(html).toContain("客戶曾傳送退訂字眼「退訂」（由舊紀錄匯入，系統未有自動退訂），請核實。");
  expect(html).not.toContain("可能要求退訂");
  expect(html).not.toContain("可能想停止接收訊息");
  expect(html).toContain("確認退訂");
  expect(html).toContain("不是退訂");
});

test("near-miss: agents see only 請通知經理處理", () => {
  const html = render(detail({ opt_out_near_miss: nearMiss, can_clear_opt_out: false }));
  expect(html).toContain("可能要求退訂");
  expect(html).toContain("請通知經理處理。");
  expect(html).not.toContain("確認退訂");
  expect(html).not.toContain("不是退訂");
});

test("near-miss is not shown when the contact is already opted out", () => {
  const html = render(
    detail({
      opted_out_whatsapp: true,
      opted_out_at: iso(-60 * MIN),
      opted_out_source: "customer_message",
      opted_out_text: "退訂",
      opt_out_near_miss: nearMiss,
      can_clear_opt_out: true,
    }),
  );
  expect(html).toContain("已退訂推廣");
  expect(html).not.toContain("可能要求退訂");
  expect(html).not.toContain("不是退訂");
});
