import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWoztellEvent } from "./woztell.server.ts";
import { ingestWoztellEvent } from "./woztell-ingest.server.ts";

test("delivery receipt does not create a contact, conversation or inbound message", async () => {
  const event = normalizeWoztellEvent({
    type: "DELIVERED",
    messageId: "provider-id",
    data: { messageId: "provider-id" },
    member: "member",
    channel: "channel",
    from: "85260000000",
    timestamp: 1700000000,
  });
  const calls = [];
  const result = await ingestWoztellEvent(event, async (statements) => {
    calls.push(...statements);
    return statements.map(() => [{ contact_id: null, conversation_id: null, inserted: false }]);
  });
  assert.equal(result.messageInserted, false);
  assert.equal(result.skipped, "status-event");
  assert.ok(calls.some((s) => s.statement.includes("whatsapp_delivery_events")));
  assert.ok(calls.every((s) => !s.statement.includes("INSERT INTO crm_contacts")));
});
test("wrapped provider error is a receipt, not an UNKNOWN content bubble", async () => {
  const event = normalizeWoztellEvent({
    type: "BOT",
    memberId: "member",
    channelId: "channel",
    messageEvent: {
      messageId: "failed-id",
      error: { code: 131047, message: "private provider content" },
      timestamp: 1700000000,
    },
  });
  const calls = [];
  const result = await ingestWoztellEvent(event, async (statements) => {
    calls.push(...statements);
    return statements.map(() => []);
  });
  assert.equal(result.skipped, "status-event");
  assert.ok(calls.every((s) => !s.statement.includes("INSERT INTO crm_contacts")));
});
