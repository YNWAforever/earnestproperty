import { describe, expect, mock, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The table is pure. The list's server calls are never reached by a static render.
mock.module("@/lib/neon/contact-identity-review", () => ({
  fetchContactIdentityReviews: async () => ({ rows: [], nextCursor: null, openCount: 0 }),
  resolveContactIdentityReviewItem: async () => ({ ok: true }),
}));

const { ContactIdentityReviewTable } = await import("./ContactIdentityReviewList");
type Row = Parameters<typeof ContactIdentityReviewTable>[0]["rows"][number];

// Ids without an 8-digit run, so the masked-phone check below is meaningful.
const contact = (
  id: string,
  name: string | null,
  maskedPhone: string | null,
): NonNullable<Row["a"]> => ({
  id,
  name,
  maskedPhone,
  hasWhatsapp: true,
  optedOut: false,
  openLeadIds: [],
  leadCount: 0,
});
const conflict: Row = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1",
  reason: "whatsapp_identity_conflict",
  status: "open",
  a: contact("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeea1", "陳太", "•••• 0101"),
  b: contact("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeb1", "陳生", "•••• 0102"),
  conversationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeec1",
  messageCount: 2,
  lastMessageAt: "2026-10-08T02:00:00.000Z",
  createdAt: "2026-10-08T01:00:00.000Z",
  resolvedAt: null,
  resolvedByName: null,
  note: null,
};
const duplicate: Row = {
  ...conflict,
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2",
  reason: "phone_format_duplicate",
  conversationId: null,
  messageCount: 0,
  lastMessageAt: null,
};
const render = (rows: Row[]) =>
  load(
    renderToStaticMarkup(createElement(ContactIdentityReviewTable, { rows, onAction: () => {} })),
  );
const buttons = ($: ReturnType<typeof load>) =>
  $("button")
    .map((_, el) => $(el).text().trim())
    .get();

describe("ContactIdentityReviewList", () => {
  test("renders masked phones only", () => {
    const html = render([conflict, duplicate]).html();
    expect(html).toContain("•••• 0101");
    expect(html).not.toMatch(/\d{8}/);
  });

  test("a conflict row offers the three link actions and no duplicate actions", () => {
    const $ = render([conflict]);
    expect($.text()).toContain("身分待核對");
    expect($.text()).toContain(
      "此 WhatsApp 訊息的帳戶與電話分屬不同客戶記錄。訊息已保存，請選擇正確客戶。",
    );
    expect(buttons($)).toEqual([
      "連結到「陳太」客戶 A · •••• 0101",
      "連結到「陳生」客戶 B · •••• 0102",
      "建立新客戶",
    ]);
  });

  test("a conflict row with no member owner offers no link to the missing side", () => {
    const $ = render([{ ...conflict, a: null }]);
    expect(buttons($)).toEqual(["連結到「陳生」客戶 B · •••• 0102", "建立新客戶"]);
  });

  test("two unnamed sides get link buttons that name the side and the masked digits", () => {
    const $ = render([
      {
        ...conflict,
        a: { ...conflict.a!, name: null },
        b: { ...conflict.b!, name: null },
      },
    ]);
    const [linkA, linkB] = buttons($);
    expect(linkA).toBe("連結到「未命名客戶」客戶 A · •••• 0101");
    expect(linkB).toBe("連結到「未命名客戶」客戶 B · •••• 0102");
    expect(linkA).not.toBe(linkB);
  });

  test("a duplicate row offers 同一客戶（暫不合併）, 不同客戶 and 略過 and no link action", () => {
    const $ = render([duplicate]);
    expect($.text()).toContain("電話格式重複");
    expect(buttons($)).toEqual(["同一客戶（暫不合併）", "不同客戶", "略過"]);
    expect($.text()).not.toContain("連結到");
  });

  test("the empty state shows the empty copy", () => {
    const $ = render([]);
    expect($.text()).toContain("暫時沒有需要核對的客戶記錄。");
    expect($("button").length).toBe(0);
  });
});
