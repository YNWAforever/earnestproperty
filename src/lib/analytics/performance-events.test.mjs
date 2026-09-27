import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecordPerformanceEventQuery,
  performanceEventKey,
  validatePerformanceEvent,
} from "./performance-events.mjs";
const id = "00000000-0000-4000-8000-000000000001";
test("source identity is deterministic and retries share one key", () => {
  assert.equal(
    performanceEventKey("viewing_completed", id),
    performanceEventKey("viewing_completed", id),
  );
  assert.notEqual(
    performanceEventKey("viewing_completed", id),
    performanceEventKey("lead_qualified", id),
  );
});
test("event input cannot label a bot message as human response", () => {
  assert.throws(
    () =>
      validatePerformanceEvent({
        type: "human_response",
        source: "automated_outbound:" + id,
        inquiryId: id,
        occurredAt: "2026-09-27T01:00:00.000Z",
        quality: "production",
      }),
    /source/i,
  );
});

test("reconciliation reads trusted source rows and cannot set production quality", () => {
  const event = {
    type: "viewing_completed",
    source: "crm_activity:" + id,
    leadId: id,
    occurredAt: "2026-09-27T01:00:00.000Z",
    quality: "unknown",
  };
  const query = buildRecordPerformanceEventQuery(event);
  assert.match(query.statement, /activity_type='viewing'/);
  assert.match(query.statement, /completed_at IS NOT NULL/);
  assert.equal(query.params[0], "viewing_completed:" + id);
  assert.throws(
    () => buildRecordPerformanceEventQuery({ ...event, quality: "production" }),
    /correction/,
  );
  assert.throws(
    () => validatePerformanceEvent({ ...event, idempotencyKey: "forged" }),
    /idempotency/,
  );
});
