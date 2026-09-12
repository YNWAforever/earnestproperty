import test from "node:test";
import assert from "node:assert/strict";
import {
  selectAssignment,
  classifyAssignmentExecution,
  selectResponseEnquiry,
} from "./assignment-policy.ts";
test("AT28/30 protected coordinator precedes requested and unavailable mappings cannot route", () => {
  const eligible = new Set(["owner", "requested", "duty"]);
  assert.deepEqual(
    selectAssignment({ protectedStaffId: "owner", requestedStaffId: "requested" }, eligible),
    { staffId: "owner", reason: "protected_owner" },
  );
  assert.deepEqual(
    selectAssignment({ requestedStaffId: "missing", dutyStaffIds: ["duty"] }, eligible),
    { staffId: "duty", reason: "duty_pool" },
  );
  assert.deepEqual(selectAssignment({ requestedStaffId: "missing" }, eligible), {
    staffId: null,
    reason: "routing_exception",
  });
});
test("AT29 execution acceptance is never remote confirmation", () => {
  assert.equal(classifyAssignmentExecution({ accepted: true }), "unknown");
  assert.equal(
    classifyAssignmentExecution({ accepted: false, definitivelyRefused: true }),
    "failed",
  );
  assert.equal(classifyAssignmentExecution({ accepted: false }), "unknown");
});
test("AT35 only an explicit valid association or one active episode receives response credit", () => {
  assert.equal(selectResponseEnquiry(["a"], "a"), "a");
  assert.equal(selectResponseEnquiry(["a"]), "a");
  assert.equal(selectResponseEnquiry(["a", "b"]), null);
  assert.equal(selectResponseEnquiry(["a"], "b"), null);
});

import { conversationAttention } from "../neon/admin-workflow.ts";
import { buildAdminPageQuery } from "../neon/admin-pagination-query.ts";
test("AT36 bot outbound does not clear qualified waiting enquiry", () => {
  assert.equal(
    conversationAttention({
      lastDirection: "outbound",
      lastInboundAt: null,
      awaitingHumanResponse: true,
    }).awaitingReply,
    true,
  );
  assert.equal(
    conversationAttention({
      lastDirection: "inbound",
      lastInboundAt: null,
      awaitingHumanResponse: false,
    }).awaitingReply,
    false,
  );
  const sql = buildAdminPageQuery(
    { resource: "conversations", status: "awaiting" },
    { staffId: "00000000-0000-4000-8000-000000000001", roles: ["admin"] },
    { enquiries: true },
  ).statement;
  assert.match(sql, /bool_or\(i.first_human_response_at IS NULL\)/);
  assert.match(sql, /awaiting_human_response/);
});

test("AT30 unavailable or missing protected owner never falls through to requested staff", () => {
  assert.deepEqual(
    selectAssignment(
      { protectedStaffId: "disabled", requestedStaffId: "requested" },
      new Set(["requested"]),
    ),
    { staffId: null, reason: "protected_owner_unavailable" },
  );
  assert.deepEqual(
    selectAssignment({ protected: true, requestedStaffId: "requested" }, new Set(["requested"])),
    { staffId: null, reason: "protected_owner_unavailable" },
  );
});
