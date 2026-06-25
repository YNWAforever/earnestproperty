# Lead Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin/manager-only Lead Command Center at `/admin/leads/command-center` that shows prioritized, explainable lead queues with linked Woztell/WhatsApp status and manual staff actions, reading from Neon via one guarded set-based query.

**Architecture:** A pure, unit-tested logic module (`command-center.ts`) computes lead priority and WhatsApp link/blocked status from plain inputs. One staff-guarded server function (`listCommandCenter`) runs a single set-based SQL query (LEFT JOINs + LATERAL subqueries, capped) and maps rows through the pure module, computing KPIs from the same dataset. A TanStack Router route renders a KPI strip, segmented filters, a dense table, and a detail drawer, reusing existing admin components and existing guarded mutations.

**Tech Stack:** TanStack Start (`createServerFn`) + TanStack Router (file-based) · React 19 · Neon serverless (`@neondatabase/serverless`, HTTP driver) · shadcn/ui · Tailwind · tests via `node --test` (node:test + node:assert/strict).

**Resolved decisions (from spec review):**
1. **Audience:** admin/manager only. The route's server functions guard with `requireStaff(["admin", "manager"])`. Plain agents are not authorized (they keep `/admin/leads`). Because `agentScope` returns `null` for admin/manager, the read query needs no row scoping.
2. **Priority:** a deterministic pure function (Task 1). Unanalyzed (`未分析`) leads are **not** sunk — overdue follow-ups and recent handoffs rank by signal regardless of score, and unanalyzed leads surface a `需 AI 分析` reason.
3. **Read model:** one set-based query, capped at `COMMAND_CENTER_ROW_LIMIT = 200`; KPIs computed in JS from the same rows so they always match.

**Testing reality:** This repo has no React test harness — only `node --test`. So TDD fully covers the pure module and (via contract tests that read source text, like the existing `admin-data.contract.test.mjs`) the data layer's exports/guards. UI tasks are verified by `npm run build` + `npm run lint` + a route-registration contract test + manual smoke. Do not introduce Vitest/RTL.

**All paths are relative to the worktree root** `/Users/willylai/Documents/Earnestproperty/.worktrees/admin-cms-crm-whatsapp-mvp`.

---

## File Structure

- **Create** `src/lib/neon/command-center.ts` — pure logic: constants, types, `computeLeadPriority`, `compareCommandCenterRows`, `resolveWhatsappStatus`. No DB, no I/O.
- **Create** `src/lib/neon/command-center.test.mjs` — node:test unit tests for the pure module.
- **Modify** `src/lib/neon/admin-data.types.ts` — add wire DTOs: `CommandCenterRow`, `CommandCenterKpis`, `CommandCenterData`, `CommandCenterFilterKey`.
- **Modify** `src/lib/neon/admin-data.server.ts` — add `listCommandCenter(actor)` (set-based read) and `completeAdminLeadActivity(input, actor)` (mark follow-up complete).
- **Modify** `src/lib/neon/admin-data.ts` — add client wrappers `fetchCommandCenter()` and `completeAdminLeadActivity(options)`.
- **Modify** `src/lib/neon/admin-data.contract.test.mjs` — assert the new exports + admin/manager guard on the read.
- **Create** `src/routes/admin.leads_.command-center.tsx` — the route (KPI strip, filters, table, drawer).
- **Modify** `src/components/admin/AdminShell.tsx` — add a Command Center nav item.
- **Modify** `src/routes/admin.leads.tsx` — add a prominent link to the command center.
- **Modify** `src/routes/admin.routes.test.mjs` — assert the new route file is registered/guarded.
- **Modify** `package.json` — add `test:command-center` script.

---

## Task 1: Pure priority + WhatsApp-status module

**Files:**
- Create: `src/lib/neon/command-center.ts`
- Test: `src/lib/neon/command-center.test.mjs`

This module is pure (mirrors `src/lib/neon/admin-workflow.ts`). It reuses `canReplyToConversation` and `normalizeAdminPhone` from `./admin-workflow`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/neon/command-center.test.mjs`:

```js
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
  const p = computeLeadPriority({ ...baseSignals, leadScore: 0, analyzed: true, hasOverdueFollowup: true });
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
  const p = computeLeadPriority({ ...baseSignals, analyzed: true, leadScore: 90, activeWhatsapp: true });
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
  // same bucket -> higher score first
  assert.ok(compareCommandCenterRows(a, b) > 0);
  // tie on bucket+score -> more overdue first
  const c = { id: "c", bucket: 2, leadScore: 50, overdueMs: 10, lastActivityMs: 5 };
  const d = { id: "d", bucket: 2, leadScore: 50, overdueMs: 99, lastActivityMs: 5 };
  assert.ok(compareCommandCenterRows(c, d) > 0);
  // full tie -> stable by id asc
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
    conversation: null, phone: null, optInWhatsapp: true, optedOutWhatsapp: false, woztellEnabled: true,
  });
  assert.deepEqual(noPhone, { linked: false, blockedReason: "NO_PHONE" });

  const optedOut = resolveWhatsappStatus({
    conversation: null, phone: "68000000", optInWhatsapp: true, optedOutWhatsapp: true, woztellEnabled: true,
  });
  assert.equal(optedOut.blockedReason, "OPTED_OUT");

  const noOptIn = resolveWhatsappStatus({
    conversation: null, phone: "68000000", optInWhatsapp: false, optedOutWhatsapp: false, woztellEnabled: true,
  });
  assert.equal(noOptIn.blockedReason, "NO_OPT_IN");

  const noConv = resolveWhatsappStatus({
    conversation: null, phone: "68000000", optInWhatsapp: true, optedOutWhatsapp: false, woztellEnabled: true,
  });
  assert.equal(noConv.blockedReason, "NO_CONVERSATION");
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test src/lib/neon/command-center.test.mjs`
Expected: FAIL — `Cannot find module './command-center.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/neon/command-center.ts`:

```ts
import { canReplyToConversation, normalizeAdminPhone } from "./admin-workflow";

export const HIGH_SCORE_THRESHOLD = 60;
export const HANDOFF_RECENT_HOURS = 72;
export const WHATSAPP_ACTIVE_HOURS = 72;
export const COMMAND_CENTER_ROW_LIMIT = 200;

export type PriorityReasonCode =
  | "OVERDUE_FOLLOWUP"
  | "RECENT_HANDOFF"
  | "HIGH_SCORE_UNASSIGNED"
  | "NEW_UNASSIGNED_NEEDS_ANALYSIS"
  | "ACTIVE_WHATSAPP"
  | "BY_SCORE"
  | "NEEDS_ANALYSIS";

export type LeadPrioritySignals = {
  leadScore: number | null;
  analyzed: boolean;
  hasOverdueFollowup: boolean;
  recentHandoff: boolean;
  isUnassigned: boolean;
  activeWhatsapp: boolean;
};

export type LeadPriority = {
  bucket: 1 | 2 | 3 | 4 | 5;
  reasonCode: PriorityReasonCode;
};

export function computeLeadPriority(input: LeadPrioritySignals): LeadPriority {
  const highScore = (input.leadScore ?? 0) >= HIGH_SCORE_THRESHOLD;
  // Unanalyzed leads are treated as "needs attention", never silently low.
  const hotSignal = highScore || !input.analyzed;

  if (input.hasOverdueFollowup) return { bucket: 1, reasonCode: "OVERDUE_FOLLOWUP" };
  if (input.recentHandoff) return { bucket: 2, reasonCode: "RECENT_HANDOFF" };
  if (input.isUnassigned && hotSignal) {
    return {
      bucket: 3,
      reasonCode: input.analyzed ? "HIGH_SCORE_UNASSIGNED" : "NEW_UNASSIGNED_NEEDS_ANALYSIS",
    };
  }
  if (input.activeWhatsapp && hotSignal) return { bucket: 4, reasonCode: "ACTIVE_WHATSAPP" };
  return { bucket: 5, reasonCode: input.analyzed ? "BY_SCORE" : "NEEDS_ANALYSIS" };
}

export type CommandCenterSortKey = {
  id: string;
  bucket: number;
  leadScore: number | null;
  overdueMs: number;
  lastActivityMs: number;
};

export function compareCommandCenterRows(a: CommandCenterSortKey, b: CommandCenterSortKey): number {
  if (a.bucket !== b.bucket) return a.bucket - b.bucket;
  const sa = a.leadScore ?? -1;
  const sb = b.leadScore ?? -1;
  if (sa !== sb) return sb - sa;
  if (a.overdueMs !== b.overdueMs) return b.overdueMs - a.overdueMs;
  if (a.lastActivityMs !== b.lastActivityMs) return b.lastActivityMs - a.lastActivityMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type WhatsappBlockedReason =
  | "WOZTELL_DISABLED"
  | "CONTACT_OPTED_OUT"
  | "OUTSIDE_24_HOUR_WINDOW"
  | "NO_PHONE"
  | "NO_OPT_IN"
  | "OPTED_OUT"
  | "NO_CONVERSATION";

export type WhatsappLinkStatus =
  | {
      linked: true;
      conversationId: string;
      status: string;
      lastInboundAt: string | null;
      lastDirection: "inbound" | "outbound" | null;
      canReply: boolean;
      blockedReason: WhatsappBlockedReason | null;
      hasMemberId: boolean;
      hasChannelId: boolean;
    }
  | { linked: false; blockedReason: Extract<WhatsappBlockedReason, "NO_PHONE" | "NO_OPT_IN" | "OPTED_OUT" | "NO_CONVERSATION"> };

export function resolveWhatsappStatus(input: {
  conversation: {
    id: string;
    status: string;
    lastInboundAt: string | null;
    lastDirection: "inbound" | "outbound" | null;
    woztellMemberId: string | null;
    channelId: string | null;
  } | null;
  phone: string | null;
  optInWhatsapp: boolean;
  optedOutWhatsapp: boolean;
  woztellEnabled: boolean;
  now?: Date;
}): WhatsappLinkStatus {
  if (input.conversation) {
    const reply = canReplyToConversation({
      woztellEnabled: input.woztellEnabled,
      optedOut: input.optedOutWhatsapp,
      lastInboundAt: input.conversation.lastInboundAt,
      now: input.now,
    });
    return {
      linked: true,
      conversationId: input.conversation.id,
      status: input.conversation.status,
      lastInboundAt: input.conversation.lastInboundAt,
      lastDirection: input.conversation.lastDirection,
      canReply: reply.ok,
      blockedReason: reply.ok ? null : (reply.reason as WhatsappBlockedReason),
      hasMemberId: Boolean(input.conversation.woztellMemberId),
      hasChannelId: Boolean(input.conversation.channelId),
    };
  }
  if (!normalizeAdminPhone(input.phone)) return { linked: false, blockedReason: "NO_PHONE" };
  if (input.optedOutWhatsapp) return { linked: false, blockedReason: "OPTED_OUT" };
  if (!input.optInWhatsapp) return { linked: false, blockedReason: "NO_OPT_IN" };
  return { linked: false, blockedReason: "NO_CONVERSATION" };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test src/lib/neon/command-center.test.mjs`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/neon/command-center.ts src/lib/neon/command-center.test.mjs
git commit -m "feat: add pure lead command center priority + whatsapp status logic"
```

---

## Task 2: Command Center wire DTOs

**Files:**
- Modify: `src/lib/neon/admin-data.types.ts` (append at end of file)

- [ ] **Step 1: Add the types**

Append to `src/lib/neon/admin-data.types.ts`:

```ts
import type { LeadPriority, WhatsappLinkStatus } from "./command-center";

export type CommandCenterFilterKey =
  | "today"
  | "high_score"
  | "unassigned"
  | "live_agent"
  | "whatsapp"
  | "all";

export type CommandCenterRow = {
  lead_id: string;
  contact_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  stage: string;
  intent: string | null;
  budget_min: number | null;
  budget_max: number | null;
  preferred_estates: string[];
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  lead_score: number | null;
  urgency: string | null;
  timeline: string | null;
  budget_band: string | null;
  summary: string | null;
  next_best_action: string | null;
  last_analyzed_at: string | null;
  has_overdue_followup: boolean;
  next_followup_due_at: string | null;
  last_activity_at: string | null;
  handoff_status: string | null;
  handoff_at: string | null;
  whatsapp: WhatsappLinkStatus;
  priority: LeadPriority;
};

export type CommandCenterKpis = {
  hot: number;
  overdue: number;
  unassigned: number;
  handoffs: number;
  whatsapp_blocked: number;
};

export type CommandCenterData = {
  rows: CommandCenterRow[];
  kpis: CommandCenterKpis;
  generated_at: string;
  woztell_enabled: boolean;
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `admin-data.types.ts` or `command-center`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/neon/admin-data.types.ts
git commit -m "feat: add command center wire DTO types"
```

---

## Task 3: Staff-guarded server read model

**Files:**
- Modify: `src/lib/neon/admin-data.server.ts` (add `listCommandCenter` and `completeAdminLeadActivity`; add an import)
- Test: `src/lib/neon/admin-data.contract.test.mjs`

The query is one set-based read (LEFT JOIN + LATERAL), capped at `COMMAND_CENTER_ROW_LIMIT`. Priority/whatsapp are computed in JS; KPIs are derived from the same rows.

- [ ] **Step 1: Write the failing contract test**

In `src/lib/neon/admin-data.contract.test.mjs`, add this test below the existing one:

```js
test("command center read model is guarded and set-based", () => {
  const server = read("src/lib/neon/admin-data.server.ts");
  const client = read("src/lib/neon/admin-data.ts");

  // server-side read + new mutation exist
  assert.match(server, /export\s+async\s+function\s+listCommandCenter\b/);
  assert.match(server, /export\s+async\s+function\s+completeAdminLeadActivity\b/);
  // single set-based query (LATERAL), capped
  assert.match(server, /LEFT JOIN LATERAL/);
  assert.match(server, /COMMAND_CENTER_ROW_LIMIT/);

  // client wrappers exist and the read is admin/manager-only (NOT agent)
  assert.match(client, /export\s+async\s+function\s+fetchCommandCenter\b/);
  assert.match(client, /export\s+async\s+function\s+completeAdminLeadActivity\b/);
  assert.match(
    client,
    /fetchCommandCenterServer[\s\S]*?requireStaff\(\["admin", "manager"\]\)/,
  );
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test src/lib/neon/admin-data.contract.test.mjs`
Expected: FAIL — `listCommandCenter` not found.

- [ ] **Step 3: Add the import**

At the top of `src/lib/neon/admin-data.server.ts`, in the existing `from "./admin-workflow"` import group, replace:

```ts
import {
  canPrepareAdminCampaignQueue,
  canQueueAdminCampaign,
  normalizeAdminPhone,
} from "./admin-workflow";
```

with:

```ts
import {
  canPrepareAdminCampaignQueue,
  canQueueAdminCampaign,
  normalizeAdminPhone,
} from "./admin-workflow";
import {
  COMMAND_CENTER_ROW_LIMIT,
  HANDOFF_RECENT_HOURS,
  WHATSAPP_ACTIVE_HOURS,
  compareCommandCenterRows,
  computeLeadPriority,
  resolveWhatsappStatus,
} from "./command-center";
import { woztellEnabled } from "../woztell/woztell.server";
import type {
  CommandCenterData,
  CommandCenterKpis,
  CommandCenterRow,
} from "./admin-data.types";
```

- [ ] **Step 4: Add `listCommandCenter` and `completeAdminLeadActivity`**

Insert directly **after** `createAdminLeadActivity` (after line ~993, before `listAdminConversations`):

```ts
export async function completeAdminLeadActivity(
  input: { activity_id: string; lead_id: string },
  actor: StaffAccess,
) {
  const rows = await queryRows(
    `UPDATE crm_activities SET completed_at = now()
     WHERE id = $1 AND completed_at IS NULL
     RETURNING id`,
    [input.activity_id],
  );
  if (!rows[0]) return { ok: false as const, error: "Not found or already complete" };
  await writeAudit(actor.staffId, "lead.activity.complete", "lead", input.lead_id, {
    activityId: input.activity_id,
  });
  return { ok: true as const };
}

export async function listCommandCenter(actor: StaffAccess): Promise<CommandCenterData> {
  void actor; // admin/manager only; agentScope(actor) is null, so no row scoping needed
  const enabled = woztellEnabled();
  const rows = await queryRows(
    `
    SELECT
      l.id AS lead_id,
      l.stage,
      l.intent,
      l.budget_min,
      l.budget_max,
      l.preferred_estates,
      l.assigned_agent_id,
      l.created_at,
      l.updated_at,
      c.id AS contact_id,
      c.name,
      c.phone,
      c.email,
      c.opt_in_whatsapp,
      c.opted_out_whatsapp,
      ap.lead_score,
      ap.urgency,
      ap.timeline,
      ap.budget_band,
      ap.summary,
      ap.next_best_action,
      ap.last_analyzed_at,
      COALESCE(sa.name_zh, sa.name_en) AS assigned_agent_name,
      fa.next_followup_due_at,
      la.last_activity_at,
      las.session_status AS handoff_status,
      las.session_created_at AS handoff_at,
      wc.id AS conversation_id,
      wc.status AS conversation_status,
      wc.last_inbound_at,
      wc.woztell_member_id,
      wc.channel_id,
      wm.direction AS last_direction
    FROM crm_leads l
    LEFT JOIN crm_contacts c ON c.id = l.contact_id
    LEFT JOIN staff_users sa ON sa.id = l.assigned_agent_id
    LEFT JOIN LATERAL (
      SELECT lead_score, urgency, timeline, budget_band, summary, next_best_action, last_analyzed_at
      FROM crm_ai_profiles
      WHERE lead_id = l.id
      ORDER BY updated_at DESC
      LIMIT 1
    ) ap ON true
    LEFT JOIN LATERAL (
      SELECT min(due_at) AS next_followup_due_at
      FROM crm_activities
      WHERE lead_id = l.id AND completed_at IS NULL AND due_at < now()
    ) fa ON true
    LEFT JOIN LATERAL (
      SELECT max(created_at) AS last_activity_at
      FROM crm_activities
      WHERE lead_id = l.id
    ) la ON true
    LEFT JOIN LATERAL (
      SELECT status AS session_status, created_at AS session_created_at
      FROM live_agent_sessions
      WHERE lead_id = l.id
      ORDER BY created_at DESC
      LIMIT 1
    ) las ON true
    LEFT JOIN LATERAL (
      SELECT id, status, last_inbound_at, woztell_member_id, channel_id
      FROM whatsapp_conversations
      WHERE contact_id = c.id
      ORDER BY last_message_at DESC NULLS LAST
      LIMIT 1
    ) wc ON true
    LEFT JOIN LATERAL (
      SELECT direction
      FROM whatsapp_messages
      WHERE conversation_id = wc.id
      ORDER BY created_at DESC
      LIMIT 1
    ) wm ON true
    ORDER BY l.updated_at DESC, l.created_at DESC
    LIMIT ${COMMAND_CENTER_ROW_LIMIT}
    `,
    [],
  );

  const now = new Date();
  const handoffWindowMs = HANDOFF_RECENT_HOURS * 60 * 60 * 1000;
  const whatsappWindowMs = WHATSAPP_ACTIVE_HOURS * 60 * 60 * 1000;

  const mapped = rows.map((row) => {
    const analyzed = row.last_analyzed_at != null;
    const leadScore = analyzed ? numberOrNull(row.lead_score) : null;
    const overdueDue = dateOrNull(row.next_followup_due_at);
    const lastActivity = dateOrNull(row.last_activity_at);
    const handoffAt = dateOrNull(row.handoff_at);
    const lastInbound = dateOrNull(row.last_inbound_at);

    const recentHandoff =
      (row.handoff_status === "handoff_requested" || row.handoff_status === "handoff_completed") &&
      handoffAt != null &&
      now.getTime() - new Date(handoffAt).getTime() <= handoffWindowMs;

    const activeWhatsapp =
      row.conversation_id != null &&
      lastInbound != null &&
      now.getTime() - new Date(lastInbound).getTime() <= whatsappWindowMs;

    const whatsapp = resolveWhatsappStatus({
      conversation: row.conversation_id
        ? {
            id: stringOrEmpty(row.conversation_id),
            status: stringOrEmpty(row.conversation_status),
            lastInboundAt: lastInbound,
            lastDirection:
              row.last_direction === "inbound" || row.last_direction === "outbound"
                ? row.last_direction
                : null,
            woztellMemberId: stringOrNull(row.woztell_member_id),
            channelId: stringOrNull(row.channel_id),
          }
        : null,
      phone: stringOrNull(row.phone),
      optInWhatsapp: row.opt_in_whatsapp === true,
      optedOutWhatsapp: row.opted_out_whatsapp === true,
      woztellEnabled: enabled,
      now,
    });

    const priority = computeLeadPriority({
      leadScore,
      analyzed,
      hasOverdueFollowup: overdueDue != null,
      recentHandoff,
      isUnassigned: row.assigned_agent_id == null,
      activeWhatsapp,
    });

    const mappedRow: CommandCenterRow = {
      lead_id: stringOrEmpty(row.lead_id),
      contact_id: stringOrNull(row.contact_id),
      name: stringOrNull(row.name),
      phone: stringOrNull(row.phone),
      email: stringOrNull(row.email),
      stage: stringOrEmpty(row.stage),
      intent: stringOrNull(row.intent),
      budget_min: numberOrNull(row.budget_min),
      budget_max: numberOrNull(row.budget_max),
      preferred_estates: Array.isArray(row.preferred_estates)
        ? row.preferred_estates.map(String)
        : [],
      assigned_agent_id: stringOrNull(row.assigned_agent_id),
      assigned_agent_name: stringOrNull(row.assigned_agent_name),
      lead_score: leadScore,
      urgency: stringOrNull(row.urgency),
      timeline: stringOrNull(row.timeline),
      budget_band: stringOrNull(row.budget_band),
      summary: stringOrNull(row.summary),
      next_best_action: stringOrNull(row.next_best_action),
      last_analyzed_at: dateOrNull(row.last_analyzed_at),
      has_overdue_followup: overdueDue != null,
      next_followup_due_at: overdueDue,
      last_activity_at: lastActivity,
      handoff_status: stringOrNull(row.handoff_status),
      handoff_at: handoffAt,
      whatsapp,
      priority,
    };

    const sortKey = {
      id: mappedRow.lead_id,
      bucket: priority.bucket,
      leadScore,
      overdueMs: overdueDue ? now.getTime() - new Date(overdueDue).getTime() : 0,
      lastActivityMs: lastActivity ? new Date(lastActivity).getTime() : 0,
    };

    return { row: mappedRow, sortKey, recentHandoff };
  });

  mapped.sort((a, b) => compareCommandCenterRows(a.sortKey, b.sortKey));

  const kpis: CommandCenterKpis = {
    hot: mapped.filter((m) => m.row.priority.bucket <= 2).length,
    overdue: mapped.filter((m) => m.row.has_overdue_followup).length,
    unassigned: mapped.filter((m) => m.row.assigned_agent_id == null).length,
    handoffs: mapped.filter((m) => m.recentHandoff).length,
    whatsapp_blocked: mapped.filter(
      (m) => m.row.whatsapp.linked === false || m.row.whatsapp.canReply === false,
    ).length,
  };

  return {
    rows: mapped.map((m) => m.row),
    kpis,
    generated_at: now.toISOString(),
    woztell_enabled: enabled,
  };
}
```

> Note: `queryRows`, `addParam`, `stringOrEmpty`, `stringOrNull`, `numberOrNull`, `dateOrNull`, `writeAudit`, and `StaffAccess` are all already defined/imported in `admin-data.server.ts` (see `fetchAdminLead` and `createAdminLeadActivity` for usage). Do not redefine them.

- [ ] **Step 5: Run the contract test (server half)**

Run: `node --test src/lib/neon/admin-data.contract.test.mjs`
Expected: still FAIL on the `client` assertions (`fetchCommandCenter` not yet added) — that's Task 4. The server-side `assert.match` lines should now pass. Confirm the failure message is only about the client wrapper.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `admin-data.server.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/neon/admin-data.server.ts src/lib/neon/admin-data.contract.test.mjs
git commit -m "feat: add command center server read model + complete-activity mutation"
```

---

## Task 4: Client data wrappers

**Files:**
- Modify: `src/lib/neon/admin-data.ts` (add wrappers near the other lead wrappers, after `fetchAdminConversations` ~line 286)

- [ ] **Step 1: Add the wrappers**

Insert after the `fetchAdminConversations` export (~line 286) in `src/lib/neon/admin-data.ts`:

```ts
const fetchCommandCenterServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.listCommandCenter(staff);
});

export async function fetchCommandCenter() {
  return callStaffServerFn(async () => fetchCommandCenterServer(await withStaffAuthHeaders()));
}

const completeAdminLeadActivityServer = createServerFn({ method: "POST" })
  .inputValidator((data: { activity_id: string; lead_id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.completeAdminLeadActivity(data, staff);
  });

export async function completeAdminLeadActivity(options: {
  data: { activity_id: string; lead_id: string };
}) {
  return callStaffServerFn(async () =>
    completeAdminLeadActivityServer(await withStaffAuthHeaders(options)),
  );
}
```

- [ ] **Step 2: Run the full contract test — now green**

Run: `node --test src/lib/neon/admin-data.contract.test.mjs`
Expected: PASS (both server and client assertions).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/neon/admin-data.ts
git commit -m "feat: add command center client data wrappers"
```

---

## Task 5: Route shell — KPI strip + segmented filters + data load

**Files:**
- Create: `src/routes/admin.leads_.command-center.tsx`

This task renders the page chrome, loads data with the `admin.listings.tsx` refresh pattern, shows KPIs and segmented filters, and an empty table placeholder. Rows + drawer come in Tasks 6–7.

- [ ] **Step 1: Create the route file**

Create `src/routes/admin.leads_.command-center.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { fetchCommandCenter } from "@/lib/neon/admin-data";
import type {
  CommandCenterData,
  CommandCenterFilterKey,
  CommandCenterRow,
} from "@/lib/neon/admin-data.types";

export const Route = createFileRoute("/admin/leads_/command-center")({
  head: () => ({
    meta: [{ title: "Lead Command Center｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: CommandCenter,
});

const FILTERS: { key: CommandCenterFilterKey; label: string }[] = [
  { key: "today", label: "今日要跟" },
  { key: "high_score", label: "高分 Leads" },
  { key: "unassigned", label: "未分配" },
  { key: "live_agent", label: "Live Agent" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "all", label: "全部" },
];

function matchesFilter(row: CommandCenterRow, key: CommandCenterFilterKey): boolean {
  switch (key) {
    case "today":
      return row.has_overdue_followup || row.priority.bucket <= 2;
    case "high_score":
      return (row.lead_score ?? 0) >= 60;
    case "unassigned":
      return row.assigned_agent_id == null;
    case "live_agent":
      return row.handoff_status != null;
    case "whatsapp":
      return row.whatsapp.linked === true;
    case "all":
    default:
      return true;
  }
}

function CommandCenter() {
  const { user } = useNeonAuth();
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [filter, setFilter] = useState<CommandCenterFilterKey>("today");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const result = (await fetchCommandCenter()) as CommandCenterData;
      if (requestId !== requestIdRef.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(errorText(err));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const visibleRows = useMemo(
    () => (data ? data.rows.filter((row) => matchesFilter(row, filter)) : []),
    [data, filter],
  );

  return (
    <AdminShell title="Lead Command Center" description="每日跟進工作台：誰要跟、為何重要、下一步、WhatsApp 狀態。">
      {data ? <KpiStrip data={data} /> : null}

      <AdminToolbar
        filters={
          <>
            {FILTERS.map((item) => (
              <Button
                key={item.key}
                type="button"
                size="sm"
                variant={filter === item.key ? "default" : "outline"}
                className="h-9"
                onClick={() => setFilter(item.key)}
              >
                {item.label}
              </Button>
            ))}
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm" className="h-9">
            <Link to="/admin/leads">返回 CRM 列表</Link>
          </Button>
        }
      />

      {error ? <AdminError message={error} /> : null}
      {loading && !data ? <Skeleton className="h-72 w-full" /> : null}
      {data && visibleRows.length === 0 ? (
        <AdminEmptyState title="此佇列暫無 Leads" description="切換上方分段或選「全部」查看所有 Leads。" />
      ) : null}
      {data && visibleRows.length > 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {visibleRows.length} leads — 表格於下一步加入。
          </CardContent>
        </Card>
      ) : null}
    </AdminShell>
  );
}

function KpiStrip({ data }: { data: CommandCenterData }) {
  const items = [
    { label: "Hot leads", value: data.kpis.hot },
    { label: "逾期跟進", value: data.kpis.overdue },
    { label: "未分配", value: data.kpis.unassigned },
    { label: "新 Live Agent", value: data.kpis.handoffs },
    { label: "WhatsApp 受阻", value: data.kpis.whatsapp_blocked },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{item.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
```

- [ ] **Step 2: Generate the route tree + build**

Run: `npm run build`
Expected: build succeeds. The TanStack Router plugin regenerates the route tree and picks up `/admin/leads_/command-center`. If the generator rewrites the `createFileRoute(...)` argument, accept its version.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors in the new file.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.leads_.command-center.tsx src/routeTree.gen.ts
git commit -m "feat: add command center route shell with KPIs and filters"
```

---

## Task 6: Dense table with AI score, reason, and WhatsApp status

**Files:**
- Modify: `src/routes/admin.leads_.command-center.tsx`

- [ ] **Step 1: Add label maps + the table, replacing the placeholder Card**

At the top of the file (after `FILTERS`), add label maps:

```tsx
const STAGE_LABELS: Record<string, string> = {
  new: "新客",
  contacted: "已聯絡",
  viewing: "睇樓",
  negotiating: "傾緊",
  closed_won: "成交",
  closed_lost: "失單",
};

const REASON_LABELS: Record<string, string> = {
  OVERDUE_FOLLOWUP: "逾期跟進",
  RECENT_HANDOFF: "新 Live Agent 轉介",
  HIGH_SCORE_UNASSIGNED: "高分・未分配",
  NEW_UNASSIGNED_NEEDS_ANALYSIS: "新客・未分配・需 AI 分析",
  ACTIVE_WHATSAPP: "WhatsApp 進行中",
  BY_SCORE: "依分數排序",
  NEEDS_ANALYSIS: "需 AI 分析",
};

const WHATSAPP_BLOCKED_LABELS: Record<string, string> = {
  WOZTELL_DISABLED: "未設定 Woztell",
  CONTACT_OPTED_OUT: "客戶已 opt-out",
  OUTSIDE_24_HOUR_WINDOW: "逾 24 小時窗口",
  NO_PHONE: "缺少電話",
  NO_OPT_IN: "未有 WhatsApp opt-in",
  OPTED_OUT: "客戶已 opt-out",
  NO_CONVERSATION: "未連接 WhatsApp",
};
```

Then replace the placeholder Card block:

```tsx
      {data && visibleRows.length > 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {visibleRows.length} leads — 表格於下一步加入。
          </CardContent>
        </Card>
      ) : null}
```

with:

```tsx
      {data && visibleRows.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3">Lead</th>
                    <th className="p-3">意向 / 預算</th>
                    <th className="p-3">階段</th>
                    <th className="p-3">負責</th>
                    <th className="p-3">AI 分數・原因</th>
                    <th className="p-3">下一步</th>
                    <th className="p-3">WhatsApp</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr
                      key={row.lead_id}
                      className="border-b align-top last:border-b-0 hover:bg-accent/40"
                    >
                      <td className="p-3">
                        <p className="font-medium">{row.name ?? "未命名"}</p>
                        <p className="text-xs text-muted-foreground">{row.phone ?? "—"}</p>
                      </td>
                      <td className="p-3">
                        <p>{row.intent ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{formatBudget(row)}</p>
                      </td>
                      <td className="p-3">{STAGE_LABELS[row.stage] ?? row.stage}</td>
                      <td className="p-3">{row.assigned_agent_name ?? "未分配"}</td>
                      <td className="p-3">
                        <span className="font-semibold tabular-nums">
                          {row.lead_score ?? "未分析"}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {REASON_LABELS[row.priority.reasonCode] ?? row.priority.reasonCode}
                        </p>
                      </td>
                      <td className="max-w-[16rem] p-3 text-xs">{row.next_best_action ?? "—"}</td>
                      <td className="p-3 text-xs">{whatsappLabel(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
```

Add these helpers near `errorText`:

```tsx
function formatBudget(row: CommandCenterRow) {
  if (row.budget_band) return row.budget_band;
  const min = row.budget_min ? `$${Number(row.budget_min).toLocaleString()}` : null;
  const max = row.budget_max ? `$${Number(row.budget_max).toLocaleString()}` : null;
  if (min && max) return `${min} – ${max}`;
  return min ?? max ?? "—";
}

function whatsappLabel(row: CommandCenterRow): string {
  if (row.whatsapp.linked === false) {
    return WHATSAPP_BLOCKED_LABELS[row.whatsapp.blockedReason] ?? row.whatsapp.blockedReason;
  }
  if (!row.whatsapp.canReply && row.whatsapp.blockedReason) {
    return `已連接・${WHATSAPP_BLOCKED_LABELS[row.whatsapp.blockedReason] ?? row.whatsapp.blockedReason}`;
  }
  return "可回覆";
}
```

- [ ] **Step 2: Build + lint**

Run: `npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin.leads_.command-center.tsx
git commit -m "feat: render command center lead table with priority + whatsapp"
```

---

## Task 7: Detail drawer + row actions

**Files:**
- Modify: `src/routes/admin.leads_.command-center.tsx`

Reuses `AdminDetailPanel` (a shadcn Sheet) and existing guarded mutations: `updateAdminLead`, `createAdminLeadActivity`, `completeAdminLeadActivity`, `analyzeAdminLeadAiProfile`. Opening the linked WhatsApp conversation links to `/admin/whatsapp`.

- [ ] **Step 1: Add imports**

Add to the existing imports:

```tsx
import { toast } from "sonner";

import { AdminDetailPanel } from "@/components/admin/AdminDetailPanel";
import {
  analyzeAdminLeadAiProfile,
  completeAdminLeadActivity,
  fetchCommandCenter,
} from "@/lib/neon/admin-data";
```

(Replace the existing single-line `fetchCommandCenter` import with the grouped one above.)

- [ ] **Step 2: Add drawer state + a row click + the panel**

Inside `CommandCenter`, add state after `requestIdRef`:

```tsx
  const [selected, setSelected] = useState<CommandCenterRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function runAnalysis(row: CommandCenterRow) {
    setBusy(true);
    try {
      await analyzeAdminLeadAiProfile({ data: { leadId: row.lead_id } });
      toast.success("已重新分析");
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  }
```

Make each `<tr>` open the drawer by adding `onClick={() => setSelected(row)}` and `className="... cursor-pointer ..."` to the row element (keep the existing classes, append `cursor-pointer`).

Before the final closing `</AdminShell>`, add:

```tsx
      <AdminDetailPanel
        open={selected != null}
        onOpenChange={(open) => (open ? null : setSelected(null))}
        title={selected?.name ?? "Lead"}
        description={selected ? `${STAGE_LABELS[selected.stage] ?? selected.stage}・${selected.phone ?? "—"}` : ""}
        footer={
          selected ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/leads">開啟完整 Lead</Link>
              </Button>
              {selected.whatsapp.linked ? (
                <Button asChild size="sm">
                  <Link to="/admin/whatsapp">開啟 WhatsApp 對話</Link>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => selected && runAnalysis(selected)}
              >
                重新 AI 分析
              </Button>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-4 text-sm">
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">AI 摘要</h3>
              <p className="mt-1">{selected.summary ?? "未分析"}</p>
            </section>
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">下一步建議</h3>
              <p className="mt-1">{selected.next_best_action ?? "—"}</p>
            </section>
            <section className="grid grid-cols-2 gap-2">
              <Detail label="AI 分數" value={selected.lead_score == null ? "未分析" : String(selected.lead_score)} />
              <Detail label="緊急度" value={selected.urgency ?? "—"} />
              <Detail label="時間線" value={selected.timeline ?? "—"} />
              <Detail label="預算" value={formatBudget(selected)} />
              <Detail label="WhatsApp" value={whatsappLabel(selected)} />
              <Detail label="逾期跟進" value={selected.has_overdue_followup ? "是" : "否"} />
            </section>
          </div>
        ) : null}
      </AdminDetailPanel>
```

Add the `Detail` helper near `errorText`:

```tsx
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5">{value}</p>
    </div>
  );
}
```

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.leads_.command-center.tsx
git commit -m "feat: add command center detail drawer with AI summary + actions"
```

---

## Task 8: Navigation entry + link from CRM list

**Files:**
- Modify: `src/components/admin/AdminShell.tsx`
- Modify: `src/routes/admin.leads.tsx`

- [ ] **Step 1: Add the nav item**

In `src/components/admin/AdminShell.tsx`, add `Gauge` to the `lucide-react` import line, then add to `navItems` (after the CRM entry on line 25):

```tsx
  { to: "/admin/leads/command-center", label: "Command Center", icon: Gauge },
```

- [ ] **Step 2: Add a prominent link from /admin/leads**

Open `src/routes/admin.leads.tsx`, find the `AdminShell` opening tag in the page component, and add a toolbar/header button linking to the command center. Locate the first `<AdminToolbar` (or the header area) and add, as an `actions` button or near the top:

```tsx
            <Button asChild size="sm" className="h-9">
              <Link to="/admin/leads/command-center">前往 Command Center</Link>
            </Button>
```

(Ensure `Button` and `Link` are already imported in `admin.leads.tsx`; both are used elsewhere in that file.)

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: both succeed; the nav shows "Command Center".

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/AdminShell.tsx src/routes/admin.leads.tsx
git commit -m "feat: link command center from admin nav and CRM list"
```

---

## Task 9: Route-registration test + test script + final verification

**Files:**
- Modify: `src/routes/admin.routes.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add a route-registration assertion**

In `src/routes/admin.routes.test.mjs`, mirror the existing style and assert the new route file exists and is `noindex` + uses the correct route id. Add:

```js
test("command center route is registered, noindex, and admin-guarded", () => {
  const route = read("src/routes/admin.leads_.command-center.tsx");
  assert.match(route, /createFileRoute\("\/admin\/leads_\/command-center"\)/);
  assert.match(route, /robots".*noindex/s);
  assert.match(route, /fetchCommandCenter/);
});
```

(If `read`/`root` helpers are not present in this file, copy them from `admin-data.contract.test.mjs` lines 6-7.)

- [ ] **Step 2: Add the test script**

In `package.json` `scripts`, add:

```json
    "test:command-center": "node --test src/lib/neon/command-center.test.mjs src/lib/neon/admin-data.contract.test.mjs src/routes/admin.routes.test.mjs",
```

- [ ] **Step 3: Run the command-center test suite**

Run: `npm run test:command-center`
Expected: all tests PASS.

- [ ] **Step 4: Full verification**

Run: `npm run build && npm run lint && npx tsc --noEmit`
Expected: all succeed with no errors.

- [ ] **Step 5: Manual smoke (record results)**

Run: `npm run dev`, sign in as an admin/manager, visit `/admin/leads/command-center`. Verify:
- KPI strip numbers are present and the "全部" filter count is ≥ each other filter.
- Switching segments changes the visible rows.
- A row with no phone shows `缺少電話`; an opted-out lead shows `客戶已 opt-out`.
- Clicking a row opens the drawer; "開啟 WhatsApp 對話" only appears when linked.
- Network tab shows **no** call to `/api/admin/woztell/send` or `/api/admin/jobs/send-queue`.
- As a plain `agent`, the read returns 403 (route shows the admin error), confirming admin/manager-only.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin.routes.test.mjs package.json
git commit -m "test: add command center route registration test + test script"
```

---

## Self-Review (completed during planning)

**Spec coverage check** — every spec section maps to a task:
- Prioritized queues / sort order → Task 1 (`computeLeadPriority`, `compareCommandCenterRows`) + Task 5 filters.
- Woztell linkage (contact_id → conversation; status; last inbound; direction; opt-out; member/channel availability; open link) → Task 1 (`resolveWhatsappStatus`) + Task 3 (LATERAL `whatsapp_conversations`/`whatsapp_messages`) + Tasks 6–7 (display + open link). Fallback #2 (phone match) intentionally omitted per spec-review correction (contact_id is always populated at webhook time).
- AI fields (`lead_score`, `urgency`, `timeline`, `budget_band`, `summary`, `next_best_action`, `last_analyzed_at`) → Task 3 query + Tasks 6–7 display.
- Manual staff actions: assign/stage/note/create-activity/approve-reject-tags reuse existing guarded mutations; **complete follow-up** is new (Tasks 3–4 `completeAdminLeadActivity`); run AI analysis wired in Task 7. (Assign/stage/note/tag wiring reuse the existing `updateAdminLead` / `createAdminLeadActivity` / `approveAdminAiTag` / `rejectAdminAiTag` wrappers — add them to the drawer as a follow-on if richer in-drawer editing is wanted; the spec's MVP surfaces them via "開啟完整 Lead".)
- Route + nav → Tasks 5 & 8. KPI strip + segmented filters + table + drawer → Tasks 5–7. Data flow (guarded server fn, single query, audit on writes) → Tasks 3–4. Error handling (not-signed-in via AdminShell; unauthorized via 403→AdminError; missing AI profile shows 未分析; missing Woztell config via `WOZTELL_DISABLED`) → Tasks 5–7. Testing → Tasks 1, 3, 9. Rollout order preserved (pure tests → read model → route → drawer/actions → links → verify).

**Placeholder scan:** none — every code step contains complete code. The one deliberate scope note (richer in-drawer assign/stage editing) is called out, not hidden.

**Type consistency:** `CommandCenterRow`, `CommandCenterData`, `CommandCenterKpis`, `CommandCenterFilterKey`, `LeadPriority`, `WhatsappLinkStatus` names match across `command-center.ts`, `admin-data.types.ts`, `admin-data.server.ts`, and the route. `completeAdminLeadActivity` has identical input shape (`{ activity_id, lead_id }`) in server and client. Reason codes in `computeLeadPriority` match `REASON_LABELS` keys in Task 6.
