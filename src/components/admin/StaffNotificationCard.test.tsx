import { test, expect } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaffNotificationCard } from "./StaffNotificationCard";
import type { StaffNotificationItem } from "@/lib/neon/staff-notifications.types";
const item: StaffNotificationItem = {
  id: "n",
  inquiryId: "e",
  conversationId: "c",
  assignmentVersion: 1,
  purpose: "action_required",
  workState: "pending",
  requestedStaffId: "A",
  requestedName: "Agent A",
  handlerStaffId: "B",
  handlerName: "Agent B",
  mismatchReason: "protected_assignment",
  publicListingNo: "SYNTHETIC",
  dealType: "sale",
  source: "28hse",
  responseDueAt: "2026-09-12T12:00:00Z",
  firstHumanResponseAt: null,
  acknowledgedAt: null,
  helpRequestedAt: null,
  createdAt: "2026-09-12T11:00:00Z",
  canAct: true,
  attempts: [
    {
      transport: "inbox_private_note",
      state: "accepted",
      evidenceKind: "private_note_posted",
      error: null,
      acceptedAt: "2026-09-12T11:01:00Z",
      acceptedSource: "woztell_send_responses",
      deliveredAt: null,
      deliveredSource: null,
      readAt: null,
      readSource: null,
    },
  ],
};
const render = (patch: Partial<StaffNotificationItem> = {}) =>
  renderToStaticMarkup(
    createElement(StaffNotificationCard, {
      item: { ...item, ...patch },
      busy: false,
      onOpen: () => {
        throw Error("render cannot act");
      },
      onConfirm: () => {
        throw Error("render cannot acknowledge");
      },
      onHelp: () => {
        throw Error("render cannot mutate");
      },
    }),
  );
test("NT-09/15 requested and actual identities, transport and customer obligation remain distinct", () => {
  const html = render();
  for (const text of [
    "Agent A",
    "Agent B",
    "protected_assignment",
    "仍待人手回覆",
    "private_note_posted",
    "確認接手不代表已回覆客戶",
    "2026-09-12T12:00:00Z",
  ])
    expect(html).toContain(text);
  expect(html).toContain(">確認接手</button>");
});
test("NT-13/14/21 rendering FYI or stale work creates no acceptance action", () => {
  for (const patch of [{ purpose: "fyi" }, { canAct: false }, { workState: "superseded" as const }])
    expect(render(patch)).not.toContain(">確認接手</button>");
});
test("NT-15 accepted transport and explicit acknowledgement never fabricate customer response", () => {
  const html = render({ workState: "acknowledged", acknowledgedAt: "2026-09-12T11:05:00Z" });
  expect(html).toContain("仍待人手回覆");
  expect(html).toContain("未證實送達");
  expect(html).not.toContain("已有核實人手回覆");
});
test("NT-24 response resolution does not invent acknowledgement", () => {
  const html = render({
    workState: "resolved",
    canAct: false,
    firstHumanResponseAt: "2026-09-12T11:05:00Z",
  });
  expect(html).toContain("已有核實人手回覆");
  expect(html).toContain("尚未確認");
});
