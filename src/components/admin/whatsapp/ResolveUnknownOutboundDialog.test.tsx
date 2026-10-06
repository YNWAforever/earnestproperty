import { test, expect } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminConversationDetail } from "@/lib/neon/admin-data.types";
import {
  ResolveUnknownOutboundDialog,
  ResolveUnknownOutboundForm,
} from "./ResolveUnknownOutboundDialog";

const MIN = 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const intent = (over: Record<string, unknown> = {}) => ({
  id: "7b000000-0000-4000-8000-000000000001",
  kind: "text" as const,
  actor_type: "staff" as const,
  dispatch_started_at: iso(-30 * MIN),
  error: "WOZTELL_DELIVERY_UNKNOWN",
  resolvable: true,
  ...over,
});
function detail(over: Partial<AdminConversationDetail>): AdminConversationDetail {
  return {
    id: "7c000000-0000-4000-8000-000000000001",
    contact_id: null,
    messages: [],
    can_clear_opt_out: true,
    ...over,
  } as unknown as AdminConversationDetail;
}
const render = (d: AdminConversationDetail) =>
  renderToStaticMarkup(
    createElement(ResolveUnknownOutboundDialog, { detail: d, onChanged: () => {} }),
  );

test("hidden for agents and when there is no unknown intent", () => {
  expect(render(detail({ can_resolve_unknown_outbound: false, unknown_outbound: intent() }))).toBe(
    "",
  );
  expect(render(detail({ can_resolve_unknown_outbound: true, unknown_outbound: null }))).toBe("");
  expect(render(detail({ unknown_outbound: intent() }))).toBe("");
});

test("shows an enabled trigger to a manager when the send can be resolved", () => {
  const html = render(detail({ can_resolve_unknown_outbound: true, unknown_outbound: intent() }));
  expect(html).toContain("核對未確認傳送");
  expect(html).not.toMatch(/ disabled(=|>| )/);
});

test("disabled with the earliest time before 15 minutes", () => {
  const html = render(
    detail({
      can_resolve_unknown_outbound: true,
      unknown_outbound: intent({ dispatch_started_at: iso(-4 * MIN), resolvable: false }),
    }),
  );
  expect(html).toContain("核對未確認傳送");
  expect(html).toMatch(/ disabled(=|>| )/);
  expect(html).toContain("傳送結果仍在確認中，最早可於");
  expect(html).toContain("核對。");
});

test("copy states nothing is resent and offers exactly two outcomes", () => {
  const html = renderToStaticMarkup(
    createElement(ResolveUnknownOutboundForm, {
      kind: "template",
      dispatchStartedAt: iso(-30 * MIN),
      outcome: null,
      reason: "",
      busy: false,
      error: null,
      onOutcome: () => {},
      onReason: () => {},
      onSubmit: () => {},
    }),
  );
  expect(html).toContain("此操作不會重新傳送任何訊息");
  expect(html).toContain("這則範本");
  expect(html).toContain("已送達客戶");
  expect(html).toContain("未有送出");
  expect((html.match(/role="radio"/g) ?? []).length).toBe(2);
  expect(html).not.toMatch(/重新傳送<|重發<|立即傳送<|再次傳送</);
});
