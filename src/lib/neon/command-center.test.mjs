import assert from "node:assert/strict";
import test from "node:test";

import {
  HIGH_SCORE_THRESHOLD,
  computeLeadPriority,
  compareCommandCenterRows,
  resolveWhatsappStatus,
} from "./command-center.ts";

const baseSignals = {
  leadScore: null,
  analyzed: false,
  hasOverdueFollowup: false,
  recentHandoff: false,
  isUnassigned: false,
  activeWhatsapp: false,
};

test("computeLeadPriority: overdue follow-up wins regardless of score", () => {
  const p = computeLeadPriority({
    ...baseSignals,
    leadScore: 0,
    analyzed: true,
    hasOverdueFollowup: true,
  });
  assert.equal(p.bucket, 1);
  assert.equal(p.reasonCode, "OVERDUE_FOLLOWUP");
});

test("computeLeadPriority: recent handoff is bucket 2", () => {
  const p = computeLeadPriority({ ...baseSignals, recentHandoff: true });
  assert.equal(p.bucket, 2);
  assert.equal(p.reasonCode, "RECENT_HANDOFF");
});

test("computeLeadPriority: high-score unassigned is bucket 3", () => {
  const p = computeLeadPriority({
    ...baseSignals,
    analyzed: true,
    leadScore: HIGH_SCORE_THRESHOLD,
    isUnassigned: true,
  });
  assert.equal(p.bucket, 3);
  assert.equal(p.reasonCode, "HIGH_SCORE_UNASSIGNED");
});

test("computeLeadPriority: unanalyzed unassigned lead is NOT sunk to bucket 5", () => {
  const p = computeLeadPriority({ ...baseSignals, isUnassigned: true });
  assert.equal(p.bucket, 3);
  assert.equal(p.reasonCode, "NEW_UNASSIGNED_NEEDS_ANALYSIS");
});

test("computeLeadPriority: high-score active whatsapp is bucket 4", () => {
  const p = computeLeadPriority({
    ...baseSignals,
    analyzed: true,
    leadScore: 90,
    activeWhatsapp: true,
  });
  assert.equal(p.bucket, 4);
  assert.equal(p.reasonCode, "ACTIVE_WHATSAPP");
});

test("computeLeadPriority: analyzed low-score lead falls to bucket 5 BY_SCORE", () => {
  const p = computeLeadPriority({ ...baseSignals, analyzed: true, leadScore: 10 });
  assert.equal(p.bucket, 5);
  assert.equal(p.reasonCode, "BY_SCORE");
});

test("computeLeadPriority: unanalyzed quiet lead is bucket 5 NEEDS_ANALYSIS", () => {
  const p = computeLeadPriority({ ...baseSignals });
  assert.equal(p.bucket, 5);
  assert.equal(p.reasonCode, "NEEDS_ANALYSIS");
});

test("compareCommandCenterRows is deterministic and total", () => {
  const a = { id: "a", bucket: 1, leadScore: 50, overdueMs: 1000, lastActivityMs: 5 };
  const b = { id: "b", bucket: 1, leadScore: 90, overdueMs: 1, lastActivityMs: 5 };
  assert.ok(compareCommandCenterRows(a, b) > 0);
  const c = { id: "c", bucket: 2, leadScore: 50, overdueMs: 10, lastActivityMs: 5 };
  const d = { id: "d", bucket: 2, leadScore: 50, overdueMs: 99, lastActivityMs: 5 };
  assert.ok(compareCommandCenterRows(c, d) > 0);
  const e = { id: "e", bucket: 3, leadScore: 0, overdueMs: 0, lastActivityMs: 0 };
  const f = { id: "f", bucket: 3, leadScore: 0, overdueMs: 0, lastActivityMs: 0 };
  assert.ok(compareCommandCenterRows(e, f) < 0);
});

test("resolveWhatsappStatus: linked conversation reports canReply + blocked reason", () => {
  const now = new Date("2026-06-26T12:00:00.000Z");
  const linked = resolveWhatsappStatus({
    conversation: {
      id: "conv1",
      status: "open",
      lastInboundAt: "2026-06-26T11:00:00.000Z",
      lastDirection: "inbound",
      woztellMemberId: "m1",
      channelId: "ch1",
    },
    phone: "+852 6000 0000",
    optInWhatsapp: true,
    optedOutWhatsapp: false,
    woztellEnabled: true,
    now,
  });
  assert.equal(linked.linked, true);
  assert.equal(linked.canReply, true);
  assert.equal(linked.blockedReason, null);
  assert.equal(linked.hasMemberId, true);
});

test("resolveWhatsappStatus: unlinked blocked reasons in priority order", () => {
  const noPhone = resolveWhatsappStatus({
    conversation: null,
    phone: null,
    optInWhatsapp: true,
    optedOutWhatsapp: false,
    woztellEnabled: true,
  });
  assert.deepEqual(noPhone, { linked: false, blockedReason: "NO_PHONE" });

  const optedOut = resolveWhatsappStatus({
    conversation: null,
    phone: "68000000",
    optInWhatsapp: true,
    optedOutWhatsapp: true,
    woztellEnabled: true,
  });
  assert.equal(optedOut.blockedReason, "OPTED_OUT");

  const noOptIn = resolveWhatsappStatus({
    conversation: null,
    phone: "68000000",
    optInWhatsapp: false,
    optedOutWhatsapp: false,
    woztellEnabled: true,
  });
  assert.equal(noOptIn.blockedReason, "NO_OPT_IN");

  const noConv = resolveWhatsappStatus({
    conversation: null,
    phone: "68000000",
    optInWhatsapp: true,
    optedOutWhatsapp: false,
    woztellEnabled: true,
  });
  assert.equal(noConv.blockedReason, "NO_CONVERSATION");
});
