import { test, expect, mock, beforeEach } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StaffNotificationItem } from "@/lib/neon/staff-notifications.types";
import type { StaffSession } from "@/lib/neon/admin-data.types";
import { formatHkDateTime } from "@/lib/format";
// The card reads the signed-in staff session from the shared store; feed it a synthetic one.
let session: StaffSession = {
  status: "ok",
  staffId: "s",
  email: null,
  name: null,
  roles: ["agent"],
};
mock.module("@/lib/neon/admin-data", () => ({ fetchStaffSession: async () => session }));
const { staffSessionStore } = await import("./staff-session");
const { StaffNotificationCard } = await import("./StaffNotificationCard");
const { toStaffNotificationView } = await import("@/lib/neon/staff-notification-view.js");
async function signInAs(role: "admin" | "manager" | "agent") {
  session = { status: "ok", staffId: "s", email: null, name: null, roles: [role] };
  staffSessionStore.reset();
  await staffSessionStore.refresh("user");
}
beforeEach(() => signInAs("agent"));
const raw: StaffNotificationItem = {
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
const item = toStaffNotificationView(raw, { diagnostics: false });
const render = (patch: Partial<typeof item> = {}, base = item) =>
  renderToStaticMarkup(
    createElement(StaffNotificationCard, {
      item: { ...base, ...patch },
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
    "確認接手不代表已回覆客戶",
    formatHkDateTime("2026-09-12T12:00:00Z") ?? "",
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
  expect(html).toContain("未確認送達");
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

test("internal Inbox note is never presented as a colleague phone delivery", () => {
  const html = render({
    attempts: [{ ...item.attempts[0], state: "delivered", deliveredAt: "2026-09-12T11:02:00Z" }],
  });
  expect(html).toContain("Inbox 內部備註（不代表同事手機通知）");
  expect(html).toContain("不是手機送達");
  expect(html).not.toContain("同事手機送達有簽名收據");
});

test("FX-17a the attempt line shows transport, state and HK times only, for every role", async () => {
  for (const role of ["agent", "manager", "admin"] as const) {
    await signInAs(role);
    const html = render();
    expect(html).toContain("Inbox 內部備註（不代表同事手機通知）");
    expect(html).toContain(`接納 ${formatHkDateTime("2026-09-12T11:01:00Z")}`);
    for (const raw of ["2026-09-12T11:01:00Z", "private_note_posted", "woztell_send_responses"])
      expect(html).not.toContain(raw);
  }
});

test("FX-17a 技術資料 is absent without diagnostics, even for an admin session", async () => {
  for (const role of ["agent", "manager", "admin"] as const) {
    await signInAs(role);
    const html = render();
    expect(html).not.toContain("技術資料");
    expect(html).not.toContain("接手支援診斷");
    expect(html).not.toContain("分派版本");
  }
});

test("FX-17a an admin's 技術資料 holds evidence kind, sources, error code and the ids", async () => {
  await signInAs("admin");
  const admin = toStaffNotificationView(
    { ...raw, attempts: [{ ...raw.attempts[0], error: "WOZTELL_PROVIDER_TIMEOUT" }] },
    { diagnostics: true },
  );
  // Closed by default: the trigger renders, the rows mount when opened.
  const html = render({}, admin);
  expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>技術資料/);
  expect(html).not.toContain("證據類型");
  const { AdminTechnicalDetails } = await import("./AdminTechnicalDetails");
  const open = renderToStaticMarkup(
    createElement(AdminTechnicalDetails, {
      defaultOpen: true,
      rows: [
        { label: "證據類型", value: "private_note_posted" },
        { label: "接納來源", value: "woztell_send_responses" },
      ],
    }),
  );
  expect(open).toContain("證據類型：private_note_posted");
  expect(open).toContain("接納來源：woztell_send_responses");
  // A non-admin session renders nothing even when handed data.
  await signInAs("manager");
  expect(
    renderToStaticMarkup(
      createElement(AdminTechnicalDetails, {
        defaultOpen: true,
        rows: [{ label: "證據類型", value: "x" }],
      }),
    ),
  ).toBe("");
  expect(render({}, admin)).not.toContain("技術資料");
  await signInAs("admin");
  expect(
    renderToStaticMarkup(createElement(AdminTechnicalDetails, { defaultOpen: true, rows: null })),
  ).toBe("");
});
