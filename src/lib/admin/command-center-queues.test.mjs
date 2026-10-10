import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  COMMAND_CENTER_QUEUES,
  commandCenterKpis,
  matchesCommandCenterQueue,
} from "./command-center-queues.js";

function row(over = {}) {
  return {
    lead_score: null,
    assigned_agent_id: "agent-1",
    handoff_status: null,
    has_overdue_followup: false,
    priority: { bucket: 5 },
    whatsapp: { linked: true, canReply: true, blockedReason: null },
    ...over,
  };
}

// 20 synthetic rows; each predicate is hit by at least one row and missed by others.
const ROWS = [
  row({ lead_score: 60 }),
  row({ lead_score: 59 }),
  row({ lead_score: 95, assigned_agent_id: null }),
  row({ lead_score: null }),
  row({ has_overdue_followup: true }),
  row({ has_overdue_followup: true, priority: { bucket: 1 } }),
  row({ priority: { bucket: 2 } }),
  row({ priority: { bucket: 3 } }),
  row({ assigned_agent_id: null }),
  row({ assigned_agent_id: null, handoff_status: "pending" }),
  row({ handoff_status: "pending" }),
  row({ handoff_status: "resolved" }),
  row({ handoff_status: "active", lead_score: 80 }),
  row({ whatsapp: { linked: false, canReply: false, blockedReason: "NO_PHONE" } }),
  row({ whatsapp: { linked: true, canReply: false, blockedReason: "OUTSIDE_24_HOUR_WINDOW" } }),
  row({ whatsapp: { linked: true, canReply: true, blockedReason: null }, lead_score: 61 }),
  row({ whatsapp: { linked: false, canReply: true, blockedReason: "NO_CONVERSATION" } }),
  row({ lead_score: 10, assigned_agent_id: null, has_overdue_followup: true }),
  row({ lead_score: 70, whatsapp: { linked: false, canReply: false, blockedReason: "NO_PHONE" } }),
  row(),
];

const count = (key) => ROWS.filter((r) => matchesCommandCenterQueue(r, key)).length;

test("queues are in button order and unique", () => {
  assert.deepEqual(
    COMMAND_CENTER_QUEUES.map((q) => q.key),
    [
      "today",
      "high_score",
      "overdue",
      "unassigned",
      "live_agent",
      "whatsapp_blocked",
      "whatsapp",
      "all",
    ],
  );
  for (const q of COMMAND_CENTER_QUEUES) assert.ok(q.label.length > 0);
});

test("each queue predicate matches the behaviour the board had", () => {
  assert.equal(ROWS.length, 20);
  assert.equal(count("today"), 4);
  assert.equal(count("high_score"), 5);
  assert.equal(count("overdue"), 3);
  assert.equal(count("unassigned"), 4);
  assert.equal(count("live_agent"), 4);
  assert.equal(count("whatsapp_blocked"), 4);
  assert.equal(count("whatsapp"), 17);
  assert.equal(count("all"), 20);
});

test("each KPI equals the number of rows its tile's queue shows", () => {
  const kpis = commandCenterKpis(ROWS);
  assert.deepEqual(kpis, {
    hot: count("high_score"),
    overdue: count("overdue"),
    unassigned: count("unassigned"),
    handoffs: count("live_agent"),
    whatsapp_blocked: count("whatsapp_blocked"),
  });
});

test("admin-data.server.ts computes KPIs only through commandCenterKpis", () => {
  const src = readFileSync("src/lib/neon/admin-data.server.ts", "utf8");
  assert.match(src, /commandCenterKpis\(mapped\.map\(\(m\) => m\.row\)\)/);
  assert.doesNotMatch(src, /hot:\s*mapped\.filter/);
  assert.doesNotMatch(src, /handoffs:\s*mapped\.filter/);
});
