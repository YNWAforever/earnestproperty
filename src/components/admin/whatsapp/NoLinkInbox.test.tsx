import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoLinkInboxSummary } from "./NoLinkInbox";
import type { AdminConversationRow } from "@/lib/neon/admin-data.types";

const row: AdminConversationRow = {
  id: "synthetic-conversation",
  status: "open",
  last_message_at: "2026-09-30T02:00:00Z",
  last_inbound_at: "2026-09-30T02:00:00Z",
  name: "客戶甲",
  phone: "61234567",
  opted_out_whatsapp: false,
  last_text: "想了解更多",
  last_direction: "inbound",
  customer_display_name: "客戶甲",
  public_listing_no: "A074714",
  source_label: "28hse",
  external_listing_id: "4033349",
  requested_staff_name: "鄧錦雄",
  confirmed_owner_name: "同事乙",
  next_action: "review",
  capabilities: { canReply: false, canCorrect: true },
};

test("inbox row names listing, requested colleague, confirmed owner and action without UUID", () => {
  const html = renderToStaticMarkup(createElement(NoLinkInboxSummary, { row }));
  for (const text of ["28hse", "A074714", "4033349", "鄧錦雄", "同事乙", "需要核實關聯"])
    expect(html).toContain(text);
  expect(html).not.toContain("synthetic-conversation");
});

test("missing mapping is presented as triage, not a made-up colleague", () => {
  const html = renderToStaticMarkup(
    createElement(NoLinkInboxSummary, {
      row: {
        ...row,
        requested_staff_name: null,
        confirmed_owner_name: null,
        next_action: "triage",
      },
    }),
  );
  expect(html).toContain("未核實");
  expect(html).toContain("待確認");
  expect(html).toContain("待分派跟進");
});
