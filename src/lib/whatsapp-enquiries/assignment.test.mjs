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

test("direct Inbox mapping accepts no chatbot node and keeps routing disabled", async () => {
  const { saveStaffChannel } = await import("./assignment.server.ts");
  const previous = process.env.EP_WA_COMPANY_CHANNEL_ID;
  process.env.EP_WA_COMPANY_CHANNEL_ID = "fixture-channel";
  const id = "11111111-1111-4111-8111-111111111111";
  let parameters;
  try {
    await saveStaffChannel(
      {
        staffId: id,
        inboxUserId: "inbox-user",
        folderId: "main",
        routingNodeId: "",
        branchId: null,
        verificationRef: "synthetic-readback",
        eligible: false,
        expectedVersion: null,
      },
      { staffId: id, roles: ["admin"] },
      {
        query: async (_sql, params) => {
          parameters = params;
          return [{ id, version: 1 }];
        },
        transaction: async () => {
          throw new Error("Unexpected transaction");
        },
      },
    );
    assert.equal(parameters[4], "");
    assert.equal(parameters[7], false);
    await assert.rejects(
      saveStaffChannel(
        {
          staffId: id,
          inboxUserId: "inbox-user",
          folderId: "",
          routingNodeId: "",
          branchId: null,
          verificationRef: "synthetic-readback",
          eligible: false,
          expectedVersion: null,
        },
        { staffId: id, roles: ["admin"] },
      ),
      /too_small/,
    );
  } finally {
    if (previous === undefined) delete process.env.EP_WA_COMPANY_CHANNEL_ID;
    else process.env.EP_WA_COMPANY_CHANNEL_ID = previous;
  }
});

test("same target stays idempotent while pending or unknown and can retry after failure", async () => {
  const { requestConversationAssignment } = await import("./assignment.server.ts");
  const conversationId = "33333333-3333-4333-8333-333333333333";
  const staffId = "22222222-2222-4222-8222-222222222222";
  const actor = { staffId: "11111111-1111-4111-8111-111111111111", roles: ["admin"] };
  let pendingId = null;
  let pendingStaffId = null;
  let pendingState = null;
  let assignmentVersion = 0;
  let requestCount = 0;
  const ports = {
    query: async () => {
      throw new Error("Unexpected standalone query");
    },
    transaction: async (statements) =>
      statements.map(({ statement, params }) => {
        if (statement.includes("set_config")) return [{}];
        if (statement.includes("FOR UPDATE OF w"))
          return [
            {
              pending_assignment_id: pendingId,
              assignment_version: assignmentVersion,
              assigned_agent_id: null,
            },
          ];
        if (!statement.includes("UPDATE whatsapp_conversations"))
          throw new Error("Unexpected assignment statement");
        if (
          statement.includes("r.state IN ('pending','executing','unknown')") &&
          pendingId &&
          pendingStaffId === params[1] &&
          ["pending", "executing", "unknown"].includes(pendingState)
        )
          return [];
        requestCount++;
        assignmentVersion++;
        pendingStaffId = params[1];
        pendingState = "pending";
        pendingId = `44444444-4444-4444-8444-${String(requestCount).padStart(12, "0")}`;
        return [
          {
            pending_assignment_id: pendingId,
            assignment_version: assignmentVersion,
            assigned_agent_id: null,
          },
        ];
      }),
  };
  const previousWakeFlag = process.env.OPS_EVENT_WAKE_ENABLED;
  process.env.OPS_EVENT_WAKE_ENABLED = "false";
  try {
    const request = () =>
      requestConversationAssignment({ conversationId, staffId, reason: "manual" }, actor, ports);
    const first = await request();
    const repeated = await request();
    assert.equal(repeated.assignment.pending_assignment_id, first.assignment.pending_assignment_id);
    assert.equal(repeated.assignment.assignment_version, first.assignment.assignment_version);
    assert.equal(requestCount, 1);

    pendingState = "unknown";
    const uncertain = await request();
    assert.equal(
      uncertain.assignment.pending_assignment_id,
      first.assignment.pending_assignment_id,
    );
    assert.equal(requestCount, 1);

    pendingState = "failed";
    const retried = await request();
    assert.notEqual(
      retried.assignment.pending_assignment_id,
      first.assignment.pending_assignment_id,
    );
    assert.equal(retried.assignment.assignment_version, 2);
    assert.equal(requestCount, 2);
  } finally {
    if (previousWakeFlag === undefined) delete process.env.OPS_EVENT_WAKE_ENABLED;
    else process.env.OPS_EVENT_WAKE_ENABLED = previousWakeFlag;
  }
});
