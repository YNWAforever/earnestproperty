import assert from "node:assert/strict";
import test from "node:test";
import { classifyWoztellEvent } from "./event-classification.ts";
const now = new Date("2026-09-12T04:00:00Z");
const incoming = {
  type: "TEXT",
  timestamp: now.getTime(),
  data: { text: "Synthetic enquiry" },
  member: "fixture-member",
  channel: "fixture-channel",
  app: "fixture-app",
};
test("AT-08 unknown, control and note events never become customer messages", () => {
  for (const [payload, kind] of [
    [{}, "unsupported"],
    [{ ...incoming, eventType: "NODE_TRIGGER" }, "control_event"],
    [{ ...incoming, type: "NOTE" }, "internal_note"],
    [{ ...incoming, type: "READ" }, "delivery_receipt"],
  ])
    assert.equal(classifyWoztellEvent(payload, { now }).kind, kind);
  assert.equal(classifyWoztellEvent(incoming, { now }).kind, "customer_message");
  assert.equal(
    classifyWoztellEvent({ ...incoming, eventType: "NEW_UNKNOWN_EVENT" }, { now }).kind,
    "unsupported",
  );
});
test("AT-09 MANUAL and payload staff claims alone do not establish authorship", () => {
  const p = {
    type: "MANUAL",
    messageEvent: incoming,
    meta: { agentUserId: "user", source: { integrationId: "inbox" } },
    staffId: "forged",
  };
  assert.equal(classifyWoztellEvent(p, { now }).kind, "unverified_outbound");
  assert.equal(classifyWoztellEvent(p, { now, verifiedStaffId: "staff" }).kind, "staff_outbound");
  assert.equal(
    classifyWoztellEvent({ ...p, meta: {} }, { now, verifiedStaffId: "staff" }).kind,
    "unverified_outbound",
  );
  assert.equal(classifyWoztellEvent({ ...p, type: "BOT" }, { now }).kind, "automated_outbound");
});
test("Survey candidates cannot silently fall through as ordinary enquiries", () => {
  const r = classifyWoztellEvent(
    { ...incoming, type: "BUTTON", data: { payload: "unverified" } },
    { now },
  );
  assert.equal(r.surveyCandidate, true);
  assert.equal(r.kind, "unsupported");
});
test("Workflow timing never substitutes receipt time for missing or invalid provider time", () => {
  for (const timestamp of [undefined, "bad", 1e30]) {
    const r = classifyWoztellEvent({ ...incoming, timestamp }, { now });
    assert.equal(r.occurredAt, null);
    assert.equal(r.timing, "invalid_or_missing");
  }
  assert.equal(
    classifyWoztellEvent({ ...incoming, timestamp: now.getTime() + 3600000 }, { now }).timing,
    "future",
  );
  assert.equal(
    classifyWoztellEvent(
      { ...incoming, timestamp: now.getTime() - 86400000 },
      { now, maxAgeMs: 60000 },
    ).timing,
    "stale",
  );
});

test("Unknown history sender cannot create an inbound lead", async () => {
  const { chatNodeToEvent } = await import("../woztell/woztell-history.server.ts");
  const event = chatNodeToEvent({ from: "unrecognized", messageEvent: incoming });
  assert.equal(classifyWoztellEvent(event.payload, { now }).kind, "unsupported");
});

test("Unknown outer wrapper cannot turn nested content into customer intake", () => {
  for (const outer of ["UNRECOGNIZED", "INTERNAL_ACTION"]) {
    assert.equal(
      classifyWoztellEvent({ type: outer, messageEvent: incoming }, { now }).kind,
      "unsupported",
    );
  }
  assert.equal(classifyWoztellEvent({ messageEvent: incoming }, { now }).kind, "customer_message");
});
