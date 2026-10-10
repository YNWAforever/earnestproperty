import { expect, test } from "bun:test";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { formatHkDateTime } from "@/lib/format";
import { ASSIGNMENT_STATE_LABELS, PLACEMENT_SOURCE_LABELS } from "@/lib/admin/glossary";
import { toStaffNotificationView } from "@/lib/neon/staff-notification-view.js";
import type { StaffNotificationItem } from "@/lib/neon/staff-notifications.types";
import { EnquiryEpisodeSummary, LinkCardFacts } from "./plain-copy-parts";
import { enquiryQueueRowText } from "@/lib/admin/plain-copy";
import { StaffNotificationCard } from "./StaffNotificationCard";

// FX-17a G-11: plain zh-HK. Fixtures are synthetic.
const read = (path: string) => readFileSync(path, "utf8");
const ISO = /\d{4}-\d\d-\d\dT/;
const RAW_WORDS = [
  "unknown",
  "private_note_posted",
  "woztell_send_responses",
  "website",
  "28hse",
  "youtube",
];

function expectPlain(html: string) {
  expect(html).not.toMatch(ISO);
  for (const word of RAW_WORDS) expect(html).not.toContain(word);
}

const episode = {
  id: "e1",
  property: "SYNTHETIC",
  dealType: "sale",
  source: "website",
  requested: true,
  requestedStaffName: "Agent A",
  review: false,
  firstResponseAt: "2026-09-12T11:05:00Z",
  dueAt: "2026-09-12T12:00:00Z",
} as never;

const link = {
  id: "l1",
  code: "abc",
  publicListingNo: "SYNTHETIC",
  dealType: "sale",
  placementSource: "28hse",
  enabled: true,
  version: 1,
  requestedStaffName: null,
  opens: null,
  enquiries: null,
  sourcePlacementId: null,
  placementVerifiedAt: "2026-09-12T10:00:00Z",
  readiness: "unknown",
  recentTest: { state: "accepted", createdAt: "2026-09-12T11:00:00Z" },
} as never;

const notification: StaffNotificationItem = {
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
  mismatchReason: null,
  publicListingNo: "SYNTHETIC",
  dealType: "sale",
  source: "28hse",
  responseDueAt: "2026-09-12T12:00:00Z",
  firstHumanResponseAt: null,
  acknowledgedAt: "2026-09-12T11:05:00Z",
  helpRequestedAt: null,
  createdAt: "2026-09-12T11:00:00Z",
  canAct: true,
  attempts: [
    {
      transport: "staff_whatsapp",
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

test("no ISO timestamp or raw code renders in the enquiry context, link cards or notification card", () => {
  const episodeHtml = renderToStaticMarkup(createElement(EnquiryEpisodeSummary, { e: episode }));
  expectPlain(episodeHtml);
  expect(episodeHtml).toContain(`來源：${PLACEMENT_SOURCE_LABELS.website}`);
  expect(episodeHtml).toContain(
    `首個人手回覆：${formatHkDateTime("2026-09-12T11:05:00Z")} · 服務期限：${formatHkDateTime("2026-09-12T12:00:00Z")}`,
  );

  const rowText = enquiryQueueRowText({
    public_listing_no: "SYNTHETIC",
    confirmed: false,
    association_review: false,
    assignment_state: "executing",
    response_due_at: "2026-09-12T12:00:00Z",
  });
  expectPlain(rowText);
  expect(rowText).toContain(ASSIGNMENT_STATE_LABELS.executing);
  expect(rowText).toContain(`期限 ${formatHkDateTime("2026-09-12T12:00:00Z")}`);

  const linkHtml = renderToStaticMarkup(createElement(LinkCardFacts, { link }));
  expectPlain(linkHtml);
  expect(linkHtml).toContain("開啟 未有數據 · 帶來查詢 未有數據");
  expect(linkHtml).toContain(`核實：${formatHkDateTime("2026-09-12T10:00:00Z")}`);
  expect(linkHtml).toContain(
    `最近試送：已交 WhatsApp 發送（未確認送達） · ${formatHkDateTime("2026-09-12T11:00:00Z")}`,
  );
  const noTest = renderToStaticMarkup(
    createElement(LinkCardFacts, { link: { ...(link as object), recentTest: null } as never }),
  );
  expect(noTest).toContain("最近試送：未有紀錄");

  const cardHtml = renderToStaticMarkup(
    createElement(StaffNotificationCard, {
      item: toStaffNotificationView(notification, { diagnostics: false }),
      busy: false,
      onOpen: () => {},
      onConfirm: () => {},
      onHelp: () => {},
    }),
  );
  expectPlain(cardHtml);
  expect(cardHtml).toContain("已交 WhatsApp 發送（未確認送達）");
  expect(cardHtml).toContain(`回覆限時：${formatHkDateTime("2026-09-12T12:00:00Z")}`);
  expect(cardHtml).toContain(`接手確認：${formatHkDateTime("2026-09-12T11:05:00Z")}`);
});

test("the provider-acceptance wording is the approved text on every screen", () => {
  const files = [
    "src/components/admin/StaffNotificationCard.tsx",
    "src/components/admin/whatsapp/StaffTestNotificationDialog.tsx",
    "src/routes/admin.whatsapp.tsx",
  ];
  for (const file of files) {
    const text = read(file);
    for (const old of [
      "供應商已接納（未證實送達）",
      "供應商已接納（未確認送達）",
      "供應商已接納，尚未核實送達",
      "供應商已接納傳送要求，尚未證實送達或已讀。",
    ])
      expect(text).not.toContain(old);
  }
  const inbox = read("src/routes/admin.whatsapp.tsx");
  expect(inbox).toContain("HANDED_TO_WHATSAPP");
  expect(inbox).toContain("HANDED_TO_WHATSAPP_NOTICE");
});

test("operations no-permission text names a role, not a permission", () => {
  const ops = read("src/routes/admin.operations.tsx");
  expect(ops).not.toMatch(/需要 \$\{TAB_PERMISSIONS/);
  expect(ops).not.toContain("（需要 ${TAB_PERMISSIONS");
  expect(ops).not.toContain("請聯絡系統管理員");
  expect(ops).toContain("只供經理或管理員使用");
  expect(ops).toContain("只供管理員使用");
  expect(ops).toContain("。如需要，請聯絡管理員。");
});

test("the link table and enquiry context do not print raw values", () => {
  const table = read("src/components/admin/whatsapp/WhatsappLinksTable.tsx");
  expect(table).not.toContain('?? "unknown"');
  expect(table).not.toContain("{link.placementSource}");
  const context = read("src/components/admin/WhatsappEnquiryContext.tsx");
  expect(context).not.toContain("{e.source}");
  expect(context).not.toContain("String(r.response_due_at)");
  expect(context).not.toContain("String(r.assignment_state");
});
