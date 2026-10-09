import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// FX-17a G-11: provider evidence on staff-notification attempts reaches admins only. The server
// strips it before the list leaves the handler; hiding it in the card is not the guard.
const staff = "7917a000-0000-4000-8000-000000000001";
const handler = "7917a000-0000-4000-8000-000000000002";
const row = {
  id: "7917a000-0000-4000-8000-000000000010",
  inquiry_id: "7917a000-0000-4000-8000-000000000011",
  conversation_id: "7917a000-0000-4000-8000-000000000012",
  assignment_version: 3,
  purpose: "action_required",
  work_state: "pending",
  requested_staff_id_snapshot: staff,
  requested_name: "合成同事甲",
  recipient_staff_id: handler,
  handler_name: "合成同事乙",
  mismatch_reason: null,
  public_listing_no: "A074714",
  deal_type: "sale",
  placement_source: "28hse",
  response_due_at: "2026-10-09T04:00:00Z",
  first_human_response_at: null,
  acknowledged_at: null,
  help_requested_at: null,
  created_at: "2026-10-09T03:00:00Z",
  can_act: true,
  attempts: [
    {
      transport: "inbox_private_note",
      state: "accepted",
      evidenceKind: "private_note_posted",
      error: "WOZTELL_PROVIDER_TIMEOUT",
      acceptedAt: "2026-10-09T03:01:00Z",
      acceptedSource: "woztell_send_responses",
      deliveredAt: "2026-10-09T03:02:00Z",
      deliveredSource: "woztell_webhook",
      readAt: "2026-10-09T03:03:00Z",
      readSource: "woztell_read_receipt",
    },
  ],
};
const DIAGNOSTIC_VALUES = [
  "private_note_posted",
  "WOZTELL_PROVIDER_TIMEOUT",
  "woztell_send_responses",
  "woztell_webhook",
  "woztell_read_receipt",
];
const DIAGNOSTIC_KEYS = ["evidenceKind", "acceptedSource", "deliveredSource", "readSource"];

async function listAs(roles) {
  const { handleStaffNotificationRequest } =
    await import("./staff-notification-handlers.server.ts");
  const query = async (sql) => {
    if (sql.includes("FROM staff_users s JOIN staff_roles")) return [{ id: handler }];
    if (sql.includes("to_regclass('staff_notification_intents')")) return [{ available: true }];
    if (sql.includes("FROM staff_notification_intents n")) return [structuredClone(row)];
    throw Error(`Unexpected SQL: ${sql.slice(0, 60)}`);
  };
  const request = new Request("http://127.0.0.1/_serverFn/list", { method: "GET" });
  return handleStaffNotificationRequest(
    request,
    "list",
    { status: "all" },
    {
      requireStaffAccess: async () => ({ staffId: handler, roles }),
      query,
      transaction: async () => {
        throw Error("list must not write");
      },
    },
  );
}

test("a non-admin list carries no evidence kind, source or error code on any attempt", async () => {
  for (const roles of [["agent"], ["manager"]]) {
    const page = await listAs(roles);
    const payload = JSON.stringify(page);
    for (const value of DIAGNOSTIC_VALUES)
      assert.ok(!payload.includes(value), `${roles}: ${value}`);
    for (const key of [...DIAGNOSTIC_KEYS, "error"])
      assert.ok(!payload.includes(`"${key}":`), `${roles}: ${key}`);
    const [attempt] = page.items[0].attempts;
    assert.deepEqual(Object.keys(attempt).sort(), [
      "acceptedAt",
      "deliveredAt",
      "readAt",
      "state",
      "transport",
    ]);
    assert.equal(page.items[0].diagnostics, null);
  }
});

test("no role's list carries a colleague's staff id (fix round 1, I-1)", async () => {
  // requestedStaffId and handlerStaffId are read by no screen, so they leave the server for no
  // one, admin included. The payload holds neither UUID nor either key.
  for (const roles of [["agent"], ["manager"], ["admin"]]) {
    const payload = JSON.stringify(await listAs(roles));
    for (const uuid of [staff, handler])
      assert.ok(!payload.includes(uuid), `${roles}: staff id ${uuid}`);
    for (const key of ["requestedStaffId", "handlerStaffId"])
      assert.ok(!payload.includes(`"${key}":`), `${roles}: ${key}`);
  }
});

test("the view is an allowlist: an unknown server field reaches no role", async () => {
  const { toStaffNotificationView } = await import("./staff-notification-view.js");
  for (const diagnostics of [false, true]) {
    const view = toStaffNotificationView(
      { id: "n", futureSecret: "x", attempts: [{ transport: "t", state: "s", futureSecret: "y" }] },
      { diagnostics },
    );
    assert.ok(!JSON.stringify(view).includes("futureSecret"), `diagnostics=${diagnostics}`);
  }
});

test("an admin list keeps every attempt's evidence under diagnostics", async () => {
  const page = await listAs(["admin"]);
  const [attempt] = page.items[0].attempts;
  assert.equal(attempt.evidenceKind, undefined);
  assert.deepEqual(page.items[0].diagnostics, {
    attempts: [
      {
        evidenceKind: "private_note_posted",
        error: "WOZTELL_PROVIDER_TIMEOUT",
        acceptedSource: "woztell_send_responses",
        deliveredSource: "woztell_webhook",
        readSource: "woztell_read_receipt",
      },
    ],
  });
});

test("the action ids survive for every role", async () => {
  for (const roles of [["agent"], ["manager"], ["admin"]]) {
    const [item] = (await listAs(roles)).items;
    assert.equal(item.id, row.id, `${roles}`);
    assert.equal(item.inquiryId, row.inquiry_id, `${roles}`);
    assert.equal(item.conversationId, row.conversation_id, `${roles}`);
    assert.equal(item.assignmentVersion, 3, `${roles}`);
    assert.equal(item.canAct, true, `${roles}`);
    assert.equal(item.attempts[0].transport, "inbox_private_note");
    assert.equal(item.attempts[0].state, "accepted");
    assert.equal(item.attempts[0].acceptedAt, "2026-10-09T03:01:00Z");
  }
});

test("toStaffNotificationView is pure and leaves the input untouched", async () => {
  const { toStaffNotificationView } = await import("./staff-notification-view.js");
  const item = { id: "n", attempts: [{ ...row.attempts[0] }] };
  const before = structuredClone(item);
  const view = toStaffNotificationView(item, { diagnostics: false });
  assert.deepEqual(item, before);
  assert.equal(view.diagnostics, null);
  assert.equal(JSON.stringify(view).includes("woztell_"), false);
  const empty = toStaffNotificationView({ id: "n", attempts: null }, { diagnostics: false });
  assert.equal(empty.id, "n");
  assert.deepEqual(empty.attempts, []);
  assert.equal(empty.diagnostics, null);
});

test("the handler's list branch maps through toStaffNotificationView with canReadDiagnostics", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/neon/staff-notification-handlers.server.ts"),
    "utf8",
  );
  assert.match(
    source,
    /toStaffNotificationView\(item, \{\s*diagnostics: canReadDiagnostics\(actor\.roles\)/,
  );
  assert.match(source, /from "\.\.\/control-plane\/permissions\.ts"/);
});
