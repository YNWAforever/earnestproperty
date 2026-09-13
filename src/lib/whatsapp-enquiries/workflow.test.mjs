import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWoztellEvent } from "../woztell/woztell.server.ts";
import { ingestWoztellEvent } from "../woztell/woztell-ingest.server.ts";
const event = normalizeWoztellEvent({
  type: "TEXT",
  messageId: "fixture-id",
  member: "fixture-member",
  channel: "fixture-channel",
  app: "fixture-app",
  timestamp: 1789185600,
  data: { text: "Synthetic" },
});
test("AT-14 off ingestion has no dependency on new schema", async () => {
  let calls = [];
  await ingestWoztellEvent(
    event,
    "live_webhook",
    async (s) => {
      calls = s;
      return s.map(() => [{ contact_id: "c", conversation_id: "v", inserted: true }]);
    },
    { mode: "off" },
  );
  assert.ok(calls.some((s) => s.statement.includes("INSERT INTO whatsapp_messages")));
  assert.ok(calls.every((s) => !s.statement.includes("whatsapp_enquiry_events")));
});
test("AT-11 history never captures live workflow even when observation enabled", async () => {
  let calls = [];
  await ingestWoztellEvent(
    event,
    "history_import",
    async (s) => {
      calls = s;
      return s.map(() => [{ contact_id: "c", conversation_id: "v", inserted: false }]);
    },
    { mode: "observe" },
  );
  assert.ok(calls.every((s) => !s.statement.includes("whatsapp_enquiry_events")));
});
test("AT-14 observe requires new schema before business mutations", async () => {
  let writes = 0;
  await assert.rejects(
    ingestWoztellEvent(
      event,
      "live_webhook",
      async () => {
        writes++;
        return [];
      },
      { mode: "observe", schemaAvailable: async () => false },
    ),
    /WA_ENQUIRY_SCHEMA_REQUIRED/,
  );
  assert.equal(writes, 0);
});
test("AT-10/12 qualified event and validated job participate in transcript transaction regardless of insertion result", async () => {
  let calls = [];
  await ingestWoztellEvent(
    event,
    "live_webhook",
    async (s) => {
      calls = s;
      return s.map(() => [{ contact_id: "c", conversation_id: "v", inserted: false }]);
    },
    { mode: "observe", schemaAvailable: async () => true },
  );
  assert.ok(calls.some((s) => s.statement.includes("INSERT INTO whatsapp_enquiry_events")));
  assert.ok(calls.some((s) => s.statement.includes("INSERT INTO ops_jobs")));
  assert.ok(
    calls.findIndex((s) => s.statement.includes("INSERT INTO whatsapp_messages")) <
      calls.findIndex((s) => s.statement.includes("INSERT INTO whatsapp_enquiry_events")),
  );
});

test("Job statement builder rejects unregistered versions and arbitrary payload fields", async () => {
  const { buildEnqueueJobStatement } = await import("../control-plane/jobs.server.ts");
  const base = {
    jobType: "woztell.enquiry.process",
    payloadVersion: 1,
    payload: { eventId: "11111111-1111-4111-8111-111111111111" },
    idempotencyKey: "test",
  };
  assert.throws(() => buildEnqueueJobStatement({ ...base, payloadVersion: 99 }));
  assert.throws(() =>
    buildEnqueueJobStatement({ ...base, payload: { ...base.payload, phone: "forged" } }),
  );
  assert.ok(
    buildEnqueueJobStatement(base, { requireEnquiryEvent: true }).statement.includes(
      "WHERE EXISTS",
    ),
  );
});

test("A survey candidate is captured without effect eligibility or keyword authority", async () => {
  const candidate = normalizeWoztellEvent({
    ...event.payload,
    type: "BUTTON",
    eventType: "INBOUND",
    data: { payload: "unverified" },
  });
  let calls = [];
  await ingestWoztellEvent(
    candidate,
    "live_webhook",
    async (s) => {
      calls = s;
      return s.map(() => [{ contact_id: "c", conversation_id: "v", inserted: true }]);
    },
    { mode: "observe", schemaAvailable: async () => true },
  );
  assert.ok(calls.some((s) => s.statement.includes("INSERT INTO whatsapp_messages")));
  const captured = calls.find((s) => s.statement.includes("INSERT INTO whatsapp_enquiry_events"));
  assert.ok(captured);
  assert.equal(captured.params[6], "customer_survey_answer");
  assert.ok(captured.statement.includes("'observe',false"));
});
test("Active mode is explicit and invalid modes fail closed", async () => {
  const { enquiryMode } = await import("./contracts.ts");
  assert.equal(enquiryMode("off"), "off");
  assert.equal(enquiryMode("observe"), "observe");
  assert.equal(enquiryMode("active"), "active");
  assert.throws(() => enquiryMode("arbitrary"), /supports/);
});

test("live workflow wake follows commit even in a history/live transcript race", async () => {
  const order = [];
  await ingestWoztellEvent(
    event,
    "live_webhook",
    async (statements) => {
      order.push("commit");
      return statements.map(() => [{ contact_id: "c", conversation_id: "v", inserted: false }]);
    },
    { mode: "observe", schemaAvailable: async () => true, wake: () => order.push("wake") },
  );
  assert.deepEqual(order, ["commit", "wake"]);
});
test("failed commit and history imports never wake live enquiry processing", async () => {
  let wakes = 0;
  const options = { mode: "observe", schemaAvailable: async () => true, wake: () => wakes++ };
  await assert.rejects(
    ingestWoztellEvent(
      event,
      "live_webhook",
      async () => {
        throw new Error("rollback");
      },
      options,
    ),
    /rollback/,
  );
  await ingestWoztellEvent(
    event,
    "history_import",
    async (statements) =>
      statements.map(() => [{ contact_id: "c", conversation_id: "v", inserted: true }]),
    options,
  );
  assert.equal(wakes, 0);
});
