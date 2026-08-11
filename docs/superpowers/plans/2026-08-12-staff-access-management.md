# Staff Access Management & Admin Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins grant and revoke staff roles, and deactivate a departing colleague while handing over everything they own, then regroup the admin sidebar so nothing is duplicated or unreachable.

**Architecture:** Decision rules go in `staff-security-policy.ts` as pure functions (it already holds `decideAgentProfileMutation` and has a test file). The list of columns that constitute "ownership" goes in a new pure `staff-ownership.ts` module that generates SQL, so the "all five ownership columns, none of the historical ones" contract is asserted against data structures rather than by regex over SQL strings. Three admin-gated server functions in `admin-data.server.ts` consume both. Accounts listed in the existing `ADMIN_BOOTSTRAP_EMAILS` env var are protected: they cannot be demoted or deactivated through the UI by anyone, so the owner cannot be locked out of their own system. The UI is a new 權限 section at the bottom of the existing agent form, and the sidebar gains static group headings.

**Tech Stack:** TanStack Start, React 19, Neon serverless Postgres (raw SQL, no ORM), Zod, Tailwind + shadcn/ui. Tests: `node --test` for `.mjs` (which can import `.ts` directly via Node's type stripping), `bun test` for `.ts`/`.tsx`. There is no aggregate `npm test` — new tests must be wired into a named `test:*` script.

**Spec:** `docs/superpowers/specs/2026-08-12-staff-access-management-design.md`

---

## File Structure

**Create**

| File | Responsibility |
| --- | --- |
| `src/lib/neon/staff-ownership.ts` | The five ownership columns, the twelve historical column names, and pure SQL builders for counting and reassigning. No DB access. |
| `src/lib/neon/staff-ownership.test.mjs` | Asserts the generated SQL covers exactly the five ownership columns and mentions none of the historical ones. |

**Modify**

| File | Change |
| --- | --- |
| `src/lib/neon/staff-security-policy.ts` | Add `decideStaffRoleChange` and `decideStaffDeactivation` pure functions. |
| `src/lib/neon/staff-security-policy.test.mjs` | Tests for both new functions. |
| `src/lib/neon/admin-data.types.ts` | Add `StaffAccessRole`, `StaffOwnedCounts` and `StaffAccessSummary` types. |
| `src/lib/neon/admin-data.server.ts` | Add `fetchStaffAccessSummary`, `updateStaffRoles`, `setStaffActive`. |
| `src/lib/neon/admin-data.ts` | Three `createServerFn` wrappers, all `requireStaff(["admin"])`. |
| `src/components/admin/AgentProfileForm.tsx` | New 權限 section with role checkboxes and 停用帳戶. |
| `src/components/admin/AgentProfileForm.test.tsx` | Section renders for admin, hidden for manager. |
| `src/routes/admin.agents_.$id.tsx` | Load and pass the access summary. |
| `src/components/admin/AdminShell.tsx` | Group the sidebar; collapse the duplicate CMS entry; rename 經紀管理. |
| `src/routes/admin.routes.test.mjs` | Assert the three server fns are admin-gated and the nav is well-formed. |
| `src/lib/neon/auth.server.ts` | Export `bootstrapAllowlist` so protection can reuse it. |
| `.env.example` | Document `ADMIN_BOOTSTRAP_EMAILS`, which is currently undocumented. |
| `src/lib/control-plane/permissions.ts` | Delete the unenforced `staff.manage` permission. |
| `src/lib/control-plane/control-plane.test.mjs` | Update the permission-matrix expectations. |
| `package.json` | Wire new tests into `test:property-experience`. |

---

### Task 1: Ownership column registry

The five columns that mean "this person currently owns this row", and the twelve distinct column names that only record who did something once. Reassigning a historical column would falsify the record — `sent_by` would claim a different person sent a WhatsApp message.

**Files:**
- Create: `src/lib/neon/staff-ownership.ts`
- Test: `src/lib/neon/staff-ownership.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/lib/neon/staff-ownership.test.mjs`:

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import {
  STAFF_HISTORICAL_COLUMNS,
  STAFF_OWNERSHIP_COLUMNS,
  staffOwnershipCountSql,
  staffReassignStatements,
} from "./staff-ownership.ts";

test("ownership covers exactly the five current-assignment columns", () => {
  assert.deepEqual(
    STAFF_OWNERSHIP_COLUMNS.map((entry) => `${entry.table}.${entry.column}`).sort(),
    [
      "crm_contacts.assigned_agent_id",
      "crm_leads.assigned_agent_id",
      "inquiries.assigned_agent_id",
      "properties.agent_id",
      "whatsapp_conversations.assigned_agent_id",
    ],
  );
});

test("reassignment touches every ownership column and no historical column", () => {
  const statements = staffReassignStatements("from-id", "to-id");
  assert.equal(statements.length, STAFF_OWNERSHIP_COLUMNS.length);

  for (const { table, column } of STAFF_OWNERSHIP_COLUMNS) {
    const match = statements.find((entry) => entry.statement.includes(`UPDATE ${table}`));
    assert.ok(match, `${table} must be reassigned`);
    assert.match(match.statement, new RegExp(`SET ${column} = \\$2`));
    assert.match(match.statement, new RegExp(`WHERE ${column} = \\$1`));
    assert.deepEqual(match.params, ["from-id", "to-id"]);
  }

  // Rewriting any of these would falsify who did something.
  const allSql = statements.map((entry) => entry.statement).join("\n");
  for (const historical of STAFF_HISTORICAL_COLUMNS) {
    assert.doesNotMatch(
      allSql,
      new RegExp(`SET ${historical}\\b`),
      `${historical} records history and must never be reassigned`,
    );
  }
});

test("historical columns and ownership columns do not overlap", () => {
  const owned = new Set(STAFF_OWNERSHIP_COLUMNS.map((entry) => entry.column));
  for (const historical of STAFF_HISTORICAL_COLUMNS) {
    assert.equal(owned.has(historical), false, `${historical} cannot be both`);
  }
  // Twelve distinct names across eighteen FK occurrences -- several tables
  // share a name such as `created_by`.
  assert.equal(STAFF_HISTORICAL_COLUMNS.length, 12);
});

test("count SQL returns one labelled count per ownership column", () => {
  const { statement, params } = staffOwnershipCountSql("staff-id");
  assert.deepEqual(params, ["staff-id"]);
  for (const { table } of STAFF_OWNERSHIP_COLUMNS) {
    assert.match(statement, new RegExp(`FROM ${table}`));
    assert.match(statement, new RegExp(`AS ${table}`));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/neon/staff-ownership.test.mjs`
Expected: FAIL — `Cannot find module './staff-ownership.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/neon/staff-ownership.ts`:

```typescript
/**
 * Which columns mean "this staff member currently owns this row", and which
 * only record who did something once.
 *
 * Kept as data rather than inline SQL so the distinction is testable without a
 * database. Reassigning a historical column would falsify the record --
 * rewriting `sent_by` claims a different person sent a WhatsApp message, and
 * ops_audit_logs is append-only by trigger and must never be touched at all.
 */

export type StaffOwnershipColumn = { table: string; column: string };

/** Current assignment. These move when someone leaves. */
export const STAFF_OWNERSHIP_COLUMNS: readonly StaffOwnershipColumn[] = [
  { table: "properties", column: "agent_id" },
  { table: "crm_contacts", column: "assigned_agent_id" },
  { table: "crm_leads", column: "assigned_agent_id" },
  { table: "inquiries", column: "assigned_agent_id" },
  { table: "whatsapp_conversations", column: "assigned_agent_id" },
] as const;

/**
 * Authorship and audit. These never move. Listed so tests can assert exclusion.
 *
 * Twelve DISTINCT column names, spanning eighteen occurrences across the
 * schema -- several tables share a name such as `created_by`. Verify with:
 *   grep -rn "REFERENCES staff_users" neon/migrations/*.sql
 */
export const STAFF_HISTORICAL_COLUMNS: readonly string[] = [
  "actor_id",
  "actor_staff_id",
  "approved_by",
  "approved_by_staff_id",
  "author_id",
  "created_by",
  "decided_by",
  "executed_by_staff_id",
  "requested_by",
  "reviewed_by",
  "sent_by",
  "staff_user_id",
] as const;

/**
 * One row of counts, one column per ownership table, aliased by table name so
 * the caller can map results back without positional guessing.
 */
export function staffOwnershipCountSql(staffId: string) {
  const selects = STAFF_OWNERSHIP_COLUMNS.map(
    ({ table, column }) =>
      `(SELECT count(*)::int FROM ${table} WHERE ${column} = $1::uuid) AS ${table}`,
  ).join(",\n       ");
  return { statement: `SELECT ${selects}`, params: [staffId] };
}

/** One UPDATE per ownership column, for transactionRows. */
export function staffReassignStatements(fromStaffId: string, toStaffId: string) {
  return STAFF_OWNERSHIP_COLUMNS.map(({ table, column }) => ({
    statement: `UPDATE ${table} SET ${column} = $2::uuid WHERE ${column} = $1::uuid`,
    params: [fromStaffId, toStaffId] as unknown[],
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/neon/staff-ownership.test.mjs`
Expected: PASS — `# pass 4`, `# fail 0`

If the `STAFF_HISTORICAL_COLUMNS.length === 12` assertion fails, that is the test doing its job. Recount the DISTINCT names with:

```bash
grep -rn "REFERENCES staff_users" neon/migrations/*.sql | sed 's/.*: *//' | awk '{print $1}' | sort -u
```

That yields `agent_id` and `assigned_agent_id` (the two ownership names) plus the twelve historical ones. Correct the list to match the schema — do not just change the number.

- [ ] **Step 5: Commit**

```bash
git add src/lib/neon/staff-ownership.ts src/lib/neon/staff-ownership.test.mjs
git commit -m "feat(staff): register which columns are ownership and which are history"
```

---

### Task 2: Role-change and deactivation rules

Pure decision functions. No DB, no React.

**Files:**
- Modify: `src/lib/neon/staff-security-policy.ts`
- Test: `src/lib/neon/staff-security-policy.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/neon/staff-security-policy.test.mjs`:

```javascript
const roleChangeBase = {
  actorRoles: ["admin"],
  actorStaffId: "actor-1",
  targetStaffId: "target-1",
  currentRoles: ["agent"],
  nextRoles: ["manager"],
  otherAdminCount: 1,
  targetIsProtected: false,
};

test("only admins may change roles", () => {
  const { decideStaffRoleChange } = staffSecurityPolicy;
  assert.deepEqual(decideStaffRoleChange(roleChangeBase), { allowed: true });
  assert.deepEqual(decideStaffRoleChange({ ...roleChangeBase, actorRoles: ["manager"] }), {
    allowed: false,
    reason: "not-admin",
  });
  assert.deepEqual(decideStaffRoleChange({ ...roleChangeBase, actorRoles: ["agent"] }), {
    allowed: false,
    reason: "not-admin",
  });
});

test("an admin cannot remove their own admin role, but may drop their own manager role", () => {
  const { decideStaffRoleChange } = staffSecurityPolicy;
  const self = { ...roleChangeBase, targetStaffId: roleChangeBase.actorStaffId };

  assert.deepEqual(
    decideStaffRoleChange({
      ...self,
      currentRoles: ["admin", "manager"],
      nextRoles: ["manager"],
    }),
    { allowed: false, reason: "self-admin-removal" },
  );

  // Dropping your own non-admin role is fine -- the guard is about lockout.
  assert.deepEqual(
    decideStaffRoleChange({
      ...self,
      currentRoles: ["admin", "manager"],
      nextRoles: ["admin"],
    }),
    { allowed: true },
  );
});

// Accounts on ADMIN_BOOTSTRAP_EMAILS are the owner's own. Without this, a second
// admin could strip the owner's role or disable them and take over the system.
test("an allowlisted account cannot be demoted or deactivated by anyone", () => {
  const { decideStaffRoleChange, decideStaffDeactivation } = staffSecurityPolicy;

  assert.deepEqual(
    decideStaffRoleChange({
      ...roleChangeBase,
      currentRoles: ["admin"],
      nextRoles: ["manager"],
      targetIsProtected: true,
    }),
    { allowed: false, reason: "protected-account" },
  );

  // Adding a role to a protected account is still fine -- only losing admin is blocked.
  assert.deepEqual(
    decideStaffRoleChange({
      ...roleChangeBase,
      currentRoles: ["admin"],
      nextRoles: ["admin", "manager"],
      targetIsProtected: true,
    }),
    { allowed: true },
  );

  assert.deepEqual(
    decideStaffDeactivation({ ...deactivationBase, targetIsProtected: true }),
    { allowed: false, reason: "protected-account" },
  );
});

test("the last admin role in the system cannot be removed", () => {
  const { decideStaffRoleChange } = staffSecurityPolicy;
  assert.deepEqual(
    decideStaffRoleChange({
      ...roleChangeBase,
      currentRoles: ["admin"],
      nextRoles: ["manager"],
      otherAdminCount: 0,
    }),
    { allowed: false, reason: "last-admin" },
  );

  assert.deepEqual(
    decideStaffRoleChange({
      ...roleChangeBase,
      currentRoles: ["admin"],
      nextRoles: ["manager"],
      otherAdminCount: 1,
    }),
    { allowed: true },
  );
});

const deactivationBase = {
  actorRoles: ["admin"],
  actorStaffId: "actor-1",
  targetStaffId: "target-1",
  targetRoles: ["agent"],
  otherAdminCount: 1,
  ownedTotal: 0,
  reassignToStaffId: null,
  targetIsProtected: false,
};

test("deactivation requires admin, a different person, and a successor when they own work", () => {
  const { decideStaffDeactivation } = staffSecurityPolicy;

  assert.deepEqual(decideStaffDeactivation(deactivationBase), { allowed: true });

  assert.deepEqual(decideStaffDeactivation({ ...deactivationBase, actorRoles: ["manager"] }), {
    allowed: false,
    reason: "not-admin",
  });

  assert.deepEqual(
    decideStaffDeactivation({ ...deactivationBase, targetStaffId: "actor-1" }),
    { allowed: false, reason: "self" },
  );

  assert.deepEqual(
    decideStaffDeactivation({
      ...deactivationBase,
      targetRoles: ["admin"],
      otherAdminCount: 0,
    }),
    { allowed: false, reason: "last-admin" },
  );

  assert.deepEqual(
    decideStaffDeactivation({ ...deactivationBase, ownedTotal: 3 }),
    { allowed: false, reason: "successor-required" },
  );

  assert.deepEqual(
    decideStaffDeactivation({
      ...deactivationBase,
      ownedTotal: 3,
      reassignToStaffId: "target-1",
    }),
    { allowed: false, reason: "successor-is-target" },
  );

  assert.deepEqual(
    decideStaffDeactivation({
      ...deactivationBase,
      ownedTotal: 3,
      reassignToStaffId: "successor-1",
    }),
    { allowed: true },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/neon/staff-security-policy.test.mjs`
Expected: FAIL — `decideStaffRoleChange is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/neon/staff-security-policy.ts`:

```typescript
export type StaffRoleChangeDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "not-admin" | "self-admin-removal" | "last-admin" | "protected-account";
    };

export type StaffDeactivationDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "not-admin"
        | "self"
        | "last-admin"
        | "successor-required"
        | "successor-is-target"
        | "protected-account";
    };

function losesAdmin(current: readonly string[], next: readonly string[]) {
  return current.includes("admin") && !next.includes("admin");
}

/**
 * Role changes are privilege changes, so the guards are about lockout rather
 * than tidiness: you may drop your own `manager`, but never your own `admin`,
 * and the system must always retain at least one admin.
 *
 * `otherAdminCount` counts admins EXCLUDING the target, and must be read
 * server-side inside the same transaction as the write -- a client-supplied
 * count is a TOCTOU hole.
 */
export function decideStaffRoleChange(input: {
  actorRoles: readonly string[];
  actorStaffId: string;
  targetStaffId: string;
  currentRoles: readonly string[];
  nextRoles: readonly string[];
  otherAdminCount: number;
  /** True when the target's email is in ADMIN_BOOTSTRAP_EMAILS. */
  targetIsProtected: boolean;
}): StaffRoleChangeDecision {
  if (!input.actorRoles.includes("admin")) return { allowed: false, reason: "not-admin" };

  if (losesAdmin(input.currentRoles, input.nextRoles)) {
    // Owner accounts cannot be demoted by anyone, including another admin.
    // Gaining roles is still allowed -- only losing admin is blocked.
    if (input.targetIsProtected) return { allowed: false, reason: "protected-account" };
    if (input.actorStaffId === input.targetStaffId) {
      return { allowed: false, reason: "self-admin-removal" };
    }
    if (input.otherAdminCount < 1) return { allowed: false, reason: "last-admin" };
  }

  return { allowed: true };
}

export function decideStaffDeactivation(input: {
  actorRoles: readonly string[];
  actorStaffId: string;
  targetStaffId: string;
  targetRoles: readonly string[];
  otherAdminCount: number;
  ownedTotal: number;
  reassignToStaffId: string | null;
  /** True when the target's email is in ADMIN_BOOTSTRAP_EMAILS. */
  targetIsProtected: boolean;
}): StaffDeactivationDecision {
  if (!input.actorRoles.includes("admin")) return { allowed: false, reason: "not-admin" };
  if (input.targetIsProtected) return { allowed: false, reason: "protected-account" };
  if (input.actorStaffId === input.targetStaffId) return { allowed: false, reason: "self" };
  if (input.targetRoles.includes("admin") && input.otherAdminCount < 1) {
    return { allowed: false, reason: "last-admin" };
  }
  if (input.ownedTotal > 0) {
    if (!input.reassignToStaffId) return { allowed: false, reason: "successor-required" };
    if (input.reassignToStaffId === input.targetStaffId) {
      return { allowed: false, reason: "successor-is-target" };
    }
  }
  return { allowed: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/neon/staff-security-policy.test.mjs`
Expected: PASS — `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/lib/neon/staff-security-policy.ts src/lib/neon/staff-security-policy.test.mjs
git commit -m "feat(staff): add role-change and deactivation decision rules"
```

---

### Task 3: Access summary types

**Files:**
- Modify: `src/lib/neon/admin-data.types.ts`

- [ ] **Step 1: Add the types**

Append to `src/lib/neon/admin-data.types.ts`:

```typescript
export type StaffAccessRole = "admin" | "manager" | "agent";

export type StaffOwnedCounts = {
  properties: number;
  crm_contacts: number;
  crm_leads: number;
  inquiries: number;
  whatsapp_conversations: number;
};

export type StaffAccessSummary = {
  staffId: string;
  roles: StaffAccessRole[];
  active: boolean;
  /** True when the viewer is looking at their own record. */
  isSelf: boolean;
  /** True when removing this person's admin would leave the system with none. */
  isLastAdmin: boolean;
  /** True when this email is in ADMIN_BOOTSTRAP_EMAILS -- an owner account that
   * cannot be demoted or deactivated through the UI by anyone. */
  isProtected: boolean;
  owned: StaffOwnedCounts;
  ownedTotal: number;
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0, no output

- [ ] **Step 3: Commit**

```bash
git add src/lib/neon/admin-data.types.ts
git commit -m "feat(staff): add access summary types"
```

---

### Task 3a: Expose the protected-account allowlist

`ADMIN_BOOTSTRAP_EMAILS` already gates who may become the first admin, but
`bootstrapAllowlist()` is private and the variable is undocumented. Reuse it as
the protected-account list rather than hardcoding an address into source.

**Files:**
- Modify: `src/lib/neon/auth.server.ts`
- Modify: `.env.example`

- [ ] **Step 1: Export the allowlist and add a membership helper**

In `src/lib/neon/auth.server.ts`, change `function bootstrapAllowlist()` to
`export function bootstrapAllowlist()`, then add directly below it:

```typescript
/**
 * Owner accounts. An email on ADMIN_BOOTSTRAP_EMAILS cannot have its admin role
 * removed or its account deactivated through the admin UI, by anyone --
 * including another admin.
 *
 * Without this, a second admin could demote the owner and take over the system,
 * and the owner would have no way back in short of SQL against production. The
 * list is env-driven rather than hardcoded so it can hold more than one person
 * and never puts a personal address in shipped source.
 */
export function isProtectedStaffEmail(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return bootstrapAllowlist().has(normalized);
}
```

- [ ] **Step 2: Document the variable**

Append to `.env.example`:

```bash
# --- Admin bootstrap / owner accounts ---
# Comma-separated emails allowed to become the first admin when staff_users is
# empty. These accounts are ALSO protected: their admin role cannot be removed
# and they cannot be deactivated from the admin UI, so the owner cannot be
# locked out. Unset disables first-login bootstrap entirely (403 until staff are
# seeded out-of-band) and leaves no account protected.
ADMIN_BOOTSTRAP_EMAILS="willylai@fimmick.com"
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add src/lib/neon/auth.server.ts .env.example
git commit -m "feat(staff): expose the bootstrap allowlist as the protected-account list"
```

---

### Task 4: Server — read the access summary

**Files:**
- Modify: `src/lib/neon/admin-data.server.ts`

- [ ] **Step 1: Add the function**

Add to `src/lib/neon/admin-data.server.ts`, immediately after `export function agentScope(...)`:

```typescript
/**
 * Roles, active flag and per-table owned counts for one staff member.
 *
 * `isLastAdmin` is computed here rather than on the client: it decides whether
 * a privilege change is allowed, so it must come from the database at decision
 * time.
 */
export async function fetchStaffAccessSummary(
  input: { staffId: string },
  actor: StaffAccess,
): Promise<StaffAccessSummary> {
  const { STAFF_OWNERSHIP_COLUMNS, staffOwnershipCountSql } = await import("./staff-ownership");

  const { isProtectedStaffEmail } = await import("./auth.server");

  const roleRows = await queryRows(
    `SELECT s.active,
            s.email,
            COALESCE(
              array_to_json(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL)),
              '[]'::json
            ) AS roles,
            (
              SELECT count(*)::int
              FROM staff_roles other
              JOIN staff_users os ON os.id = other.staff_user_id
              WHERE other.role = 'admin'
                AND other.staff_user_id <> $1::uuid
                AND os.active = true
            ) AS other_admin_count
       FROM staff_users s
       LEFT JOIN staff_roles r ON r.staff_user_id = s.id
      WHERE s.id = $1::uuid
      GROUP BY s.id`,
    [input.staffId],
  );
  const row = roleRows[0];
  if (!row) throw new Response("Staff member not found.", { status: 404 });

  const roles = (Array.isArray(row.roles) ? row.roles : []).map(String) as StaffAccessRole[];
  const otherAdminCount = Number(row.other_admin_count ?? 0);

  const count = staffOwnershipCountSql(input.staffId);
  const countRows = await queryRows(count.statement, count.params);
  const countRow = countRows[0] ?? {};
  const owned = Object.fromEntries(
    STAFF_OWNERSHIP_COLUMNS.map(({ table }) => [table, Number(countRow[table] ?? 0)]),
  ) as StaffOwnedCounts;

  return {
    staffId: input.staffId,
    roles,
    active: row.active === true,
    isSelf: actor.staffId === input.staffId,
    isLastAdmin: roles.includes("admin") && otherAdminCount < 1,
    isProtected: isProtectedStaffEmail(stringOrNull(row.email)),
    owned,
    ownedTotal: Object.values(owned).reduce((total, value) => total + value, 0),
  };
}
```

Add to the type imports at the top of the file (the existing `import type { ... } from "./admin-data.types"` block):

```typescript
  StaffAccessRole,
  StaffAccessSummary,
  StaffOwnedCounts,
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/lib/neon/admin-data.server.ts
git commit -m "feat(staff): read roles, active state and owned counts"
```

---

### Task 5: Server — update roles

**Files:**
- Modify: `src/lib/neon/admin-data.server.ts`

- [ ] **Step 1: Add the function**

Add to `src/lib/neon/admin-data.server.ts`, directly below `fetchStaffAccessSummary`:

```typescript
const STAFF_ROLE_NAMES: readonly StaffAccessRole[] = ["admin", "manager", "agent"];

/**
 * Replace a staff member's role set.
 *
 * Roles were previously writable only by the first-admin bootstrap, so
 * promoting someone required SQL against production. The guards are re-run here
 * against freshly-read state: the client's view of who is an admin can be stale
 * or forged.
 */
export async function updateStaffRoles(
  input: { staffId: string; roles: StaffAccessRole[] },
  actor: StaffAccess,
) {
  const { decideStaffRoleChange } = await import("./staff-security-policy");

  const nextRoles = Array.from(new Set(input.roles)).filter((role) =>
    STAFF_ROLE_NAMES.includes(role),
  );
  if (nextRoles.length !== input.roles.length) {
    throw new Response("Unknown staff role.", { status: 400 });
  }

  const summary = await fetchStaffAccessSummary({ staffId: input.staffId }, actor);
  const otherAdminRows = await queryRows(
    `SELECT count(*)::int AS count
       FROM staff_roles r
       JOIN staff_users s ON s.id = r.staff_user_id
      WHERE r.role = 'admin' AND r.staff_user_id <> $1::uuid AND s.active = true`,
    [input.staffId],
  );

  const decision = decideStaffRoleChange({
    actorRoles: actor.roles,
    actorStaffId: actor.staffId,
    targetStaffId: input.staffId,
    currentRoles: summary.roles,
    nextRoles,
    otherAdminCount: Number(otherAdminRows[0]?.count ?? 0),
    targetIsProtected: summary.isProtected,
  });
  if (!decision.allowed) {
    const status = decision.reason === "not-admin" || decision.reason === "protected-account" ? 403 : 400;
    throw new Response(decision.reason, { status });
  }

  // Delete-then-insert inside one transaction: a role set is replaced whole, and
  // a half-applied change could leave someone with no roles at all.
  await transactionRows([
    { statement: `DELETE FROM staff_roles WHERE staff_user_id = $1::uuid`, params: [input.staffId] },
    ...nextRoles.map((role) => ({
      statement: `INSERT INTO staff_roles (staff_user_id, role) VALUES ($1::uuid, $2::staff_role)`,
      params: [input.staffId, role] as unknown[],
    })),
  ]);

  await writeAudit(actor.staffId, "staff.roles.update", "staff_user", input.staffId, {
    before: summary.roles,
    after: nextRoles,
  });
  return { ok: true as const, roles: nextRoles };
}
```

Confirm `transactionRows` is in the file's `./db.server` import. If not, add it:

```typescript
import { addParam, dateOrNull, queryRows, transactionRows /* ...existing */ } from "./db.server";
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/lib/neon/admin-data.server.ts
git commit -m "feat(staff): allow admins to grant and revoke roles"
```

---

### Task 6: Server — deactivate with handover

**Files:**
- Modify: `src/lib/neon/admin-data.server.ts`

- [ ] **Step 1: Add the function**

Add directly below `updateStaffRoles`:

```typescript
/**
 * Deactivate or reactivate a staff member.
 *
 * Deactivating also hands over everything they own. agentScope() hides rows
 * assigned to another agent, so leaving assignments behind makes a departing
 * colleague's leads and live WhatsApp threads invisible to everyone who should
 * now be working them.
 *
 * The reassignment and the active flag go in ONE transaction: a partial
 * handover would leave work stranded on a disabled account with no record of
 * what moved.
 */
export async function setStaffActive(
  input: { staffId: string; active: boolean; reassignToStaffId?: string | null },
  actor: StaffAccess,
) {
  const { decideStaffDeactivation } = await import("./staff-security-policy");
  const { staffReassignStatements } = await import("./staff-ownership");

  if (input.active) {
    if (input.reassignToStaffId) {
      throw new Response("Reactivation does not take a successor.", { status: 400 });
    }
    await queryRows(
      `UPDATE staff_users SET active = true, updated_at = now() WHERE id = $1::uuid`,
      [input.staffId],
    );
    await writeAudit(actor.staffId, "staff.reactivate", "staff_user", input.staffId, {});
    return { ok: true as const, reassigned: null };
  }

  const summary = await fetchStaffAccessSummary({ staffId: input.staffId }, actor);
  const otherAdminRows = await queryRows(
    `SELECT count(*)::int AS count
       FROM staff_roles r
       JOIN staff_users s ON s.id = r.staff_user_id
      WHERE r.role = 'admin' AND r.staff_user_id <> $1::uuid AND s.active = true`,
    [input.staffId],
  );
  const reassignToStaffId = input.reassignToStaffId?.trim() || null;

  const decision = decideStaffDeactivation({
    actorRoles: actor.roles,
    actorStaffId: actor.staffId,
    targetStaffId: input.staffId,
    targetRoles: summary.roles,
    otherAdminCount: Number(otherAdminRows[0]?.count ?? 0),
    ownedTotal: summary.ownedTotal,
    reassignToStaffId,
    targetIsProtected: summary.isProtected,
  });
  if (!decision.allowed) {
    const status = decision.reason === "not-admin" || decision.reason === "protected-account" ? 403 : 400;
    throw new Response(decision.reason, { status });
  }

  if (reassignToStaffId) {
    const successorRows = await queryRows(
      `SELECT id FROM staff_users WHERE id = $1::uuid AND active = true`,
      [reassignToStaffId],
    );
    if (!successorRows[0]) {
      throw new Response("The successor must be an active staff member.", { status: 400 });
    }
  }

  await transactionRows([
    ...(reassignToStaffId ? staffReassignStatements(input.staffId, reassignToStaffId) : []),
    {
      statement: `UPDATE staff_users SET active = false, updated_at = now() WHERE id = $1::uuid`,
      params: [input.staffId],
    },
  ]);

  await writeAudit(actor.staffId, "staff.deactivate", "staff_user", input.staffId, {
    successorStaffId: reassignToStaffId,
    counts: summary.owned,
  });
  return { ok: true as const, reassigned: summary.owned };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/lib/neon/admin-data.server.ts
git commit -m "feat(staff): deactivate with a transactional handover of owned work"
```

---

### Task 7: Client wrappers

**Files:**
- Modify: `src/lib/neon/admin-data.ts`

- [ ] **Step 1: Add the three wrappers**

Add to `src/lib/neon/admin-data.ts`, next to the other agent-profile wrappers:

```typescript
const fetchStaffAccessSummaryServer = createServerFn({ method: "GET" })
  .inputValidator((data: { staffId: string }) =>
    z.object({ staffId: z.string().trim().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin"]);
    const adminData = await import("./admin-data.server");
    return adminData.fetchStaffAccessSummary(data, staff);
  });

export async function fetchStaffAccessSummary(options: { data: { staffId: string } }) {
  return callStaffServerFn(async () =>
    fetchStaffAccessSummaryServer(await withStaffAuthHeaders(options)),
  );
}

const updateStaffRolesServer = createServerFn({ method: "POST" })
  .inputValidator((data: { staffId: string; roles: string[] }) =>
    z
      .object({
        staffId: z.string().trim().uuid(),
        roles: z.array(z.enum(["admin", "manager", "agent"])).max(3),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateStaffRoles(data, staff);
  });

export async function updateStaffRoles(options: {
  data: { staffId: string; roles: ("admin" | "manager" | "agent")[] };
}) {
  return callStaffServerFn(async () =>
    updateStaffRolesServer(await withStaffAuthHeaders(options)),
  );
}

const setStaffActiveServer = createServerFn({ method: "POST" })
  .inputValidator((data: { staffId: string; active: boolean; reassignToStaffId?: string | null }) =>
    z
      .object({
        staffId: z.string().trim().uuid(),
        active: z.boolean(),
        reassignToStaffId: z.string().trim().uuid().nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin"]);
    const adminData = await import("./admin-data.server");
    return adminData.setStaffActive(data, staff);
  });

export async function setStaffActive(options: {
  data: { staffId: string; active: boolean; reassignToStaffId?: string | null };
}) {
  return callStaffServerFn(async () => setStaffActiveServer(await withStaffAuthHeaders(options)));
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/lib/neon/admin-data.ts
git commit -m "feat(staff): expose admin-gated access management server functions"
```

---

### Task 8: Server-gating contract test

**Files:**
- Modify: `src/routes/admin.routes.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `src/routes/admin.routes.test.mjs`:

```javascript
// Roles and deactivation are privilege operations. Managers may edit an agent's
// public profile, but must never be able to escalate anyone -- including
// themselves -- so all three are admin-only at the server boundary.
test("staff access management server functions are admin-only", () => {
  const client = read("src/lib/neon/admin-data.ts");

  for (const name of [
    "fetchStaffAccessSummaryServer",
    "updateStaffRolesServer",
    "setStaffActiveServer",
  ]) {
    const start = client.indexOf(`const ${name} = createServerFn`);
    assert.notEqual(start, -1, `${name} must exist`);
    const body = client.slice(start, start + 900);
    assert.match(body, /requireStaff\(\["admin"\]\)/, `${name} must require admin`);
  }
});

// The owner must not be lockable out of their own system by a second admin.
test("protected accounts are enforced server-side, not just disabled in the UI", () => {
  const policy = read("src/lib/neon/staff-security-policy.ts");
  const server = read("src/lib/neon/admin-data.server.ts");
  const auth = read("src/lib/neon/auth.server.ts");

  assert.match(policy, /reason: "protected-account"/);
  assert.match(auth, /export function isProtectedStaffEmail/);
  // Both mutations must pass the flag through; a UI-only guard is bypassable.
  assert.equal((server.match(/targetIsProtected: summary\.isProtected/g) ?? []).length, 2);
  assert.match(server, /isProtected: isProtectedStaffEmail\(/);
});

test("deactivation reassigns and flips active in one transaction", () => {
  const server = read("src/lib/neon/admin-data.server.ts");
  const start = server.indexOf("export async function setStaffActive");
  const body = server.slice(start, server.indexOf("export async function", start + 10));

  assert.notEqual(start, -1);
  assert.match(body, /staffReassignStatements\(input\.staffId, reassignToStaffId\)/);
  // One transactionRows call covering both the handover and the flag.
  assert.equal((body.match(/await transactionRows\(/g) ?? []).length, 1);
  assert.match(body, /SET active = false/);
  assert.match(body, /writeAudit\(actor\.staffId, "staff\.deactivate"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/routes/admin.routes.test.mjs`
Expected: FAIL — `fetchStaffAccessSummaryServer must exist` (fails only if Tasks 5–7 were skipped; if they are done it should pass immediately, which is the point of writing it now)

- [ ] **Step 3: Run test to verify it passes**

Run: `node --test src/routes/admin.routes.test.mjs`
Expected: PASS — `# fail 0`

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.routes.test.mjs
git commit -m "test(staff): pin admin gating and transactional deactivation"
```

---

### Task 9: 權限 section in the agent form

The section renders only for admins and only when editing an existing person — a brand-new record has no id to attach roles to.

**Files:**
- Modify: `src/components/admin/AgentProfileForm.tsx`

- [ ] **Step 1: Add the props**

In `src/components/admin/AgentProfileForm.tsx`, change the component signature from:

```typescript
export function AgentProfileForm({
  profile,
  canManageIdentity,
  onSaved,
}: {
  profile?: AgentProfile;
  canManageIdentity: boolean;
  onSaved: (id: string) => void;
}) {
```

to:

```typescript
export function AgentProfileForm({
  profile,
  canManageIdentity,
  access,
  activeStaffOptions = [],
  onSaved,
  onAccessChanged,
}: {
  profile?: AgentProfile;
  canManageIdentity: boolean;
  /** Null for a new record, or when the viewer is not an admin. */
  access?: StaffAccessSummary | null;
  /** Active staff who can inherit work, excluding the person being edited. */
  activeStaffOptions?: { id: string; label: string }[];
  onSaved: (id: string) => void;
  onAccessChanged?: () => void;
}) {
```

Add the imports:

```typescript
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setStaffActive, updateStaffRoles } from "@/lib/neon/admin-data";
import type { StaffAccessSummary } from "@/lib/neon/admin-data.types";
```

- [ ] **Step 2: Add the section state and handlers**

Add inside the component, after the existing `useState` declarations:

```typescript
const ROLE_LABELS: { value: "admin" | "manager" | "agent"; label: string; hint: string }[] = [
  { value: "admin", label: "管理員", hint: "完整權限，包括權限管理及資料庫遷移" },
  { value: "manager", label: "主管", hint: "可查看所有同事的客戶及放盤" },
  { value: "agent", label: "經紀", hint: "只可查看自己的客戶及放盤" },
];

const [roleDraft, setRoleDraft] = useState<("admin" | "manager" | "agent")[]>(access?.roles ?? []);
const [roleConfirmOpen, setRoleConfirmOpen] = useState(false);
const [deactivateOpen, setDeactivateOpen] = useState(false);
const [successorId, setSuccessorId] = useState("");
const [accessPending, setAccessPending] = useState(false);

const roleDelta = useMemo(() => {
  const before = new Set(access?.roles ?? []);
  const after = new Set(roleDraft);
  const added = ROLE_LABELS.filter((r) => after.has(r.value) && !before.has(r.value));
  const removed = ROLE_LABELS.filter((r) => before.has(r.value) && !after.has(r.value));
  return { added, removed, changed: added.length > 0 || removed.length > 0 };
}, [access?.roles, roleDraft]);

function toggleRole(role: "admin" | "manager" | "agent", checked: boolean) {
  setRoleDraft((current) =>
    checked ? Array.from(new Set([...current, role])) : current.filter((r) => r !== role),
  );
}

async function confirmRoleChange() {
  if (!access) return;
  setAccessPending(true);
  try {
    await updateStaffRoles({ data: { staffId: access.staffId, roles: roleDraft } });
    setRoleConfirmOpen(false);
    toast.success("權限已更新");
    onAccessChanged?.();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err));
  } finally {
    setAccessPending(false);
  }
}

async function confirmDeactivate() {
  if (!access) return;
  setAccessPending(true);
  try {
    await setStaffActive({
      data: {
        staffId: access.staffId,
        active: false,
        reassignToStaffId: access.ownedTotal > 0 ? successorId : null,
      },
    });
    setDeactivateOpen(false);
    toast.success("帳戶已停用，工作已轉交");
    onAccessChanged?.();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err));
  } finally {
    setAccessPending(false);
  }
}
```

- [ ] **Step 3: Render the section**

Add immediately before the form's closing `</form>` tag:

```tsx
{access ? (
  <section className="mt-8 rounded-lg border border-destructive/30 p-4" aria-labelledby="access-heading">
    <h2 id="access-heading" className="text-base font-semibold">
      權限
    </h2>
    <p className="mt-1 text-sm text-muted-foreground">
      權限變更會即時生效，並記錄在審計記錄中。
    </p>

    <div className="mt-4 grid gap-3">
      {ROLE_LABELS.map((role) => (
        <label key={role.value} className="flex items-start gap-3 text-sm">
          <Checkbox
            checked={roleDraft.includes(role.value)}
            onCheckedChange={(checked) => toggleRole(role.value, checked === true)}
            aria-label={role.label}
          />
          <span>
            <span className="font-medium">{role.label}</span>
            <span className="block text-xs text-muted-foreground">{role.hint}</span>
          </span>
        </label>
      ))}
    </div>

    {access.isProtected ? (
      <p className="mt-3 rounded-md border border-muted bg-muted/40 p-3 text-sm text-muted-foreground">
        此帳戶已在 ADMIN_BOOTSTRAP_EMAILS 名單內，不可移除管理員權限或停用，以免無人可登入系統。
      </p>
    ) : access.isSelf && roleDraft.includes("admin") === false ? (
      <p className="mt-3 text-sm text-destructive">你不能移除自己的管理員權限。</p>
    ) : null}

    <div className="mt-4 flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={
          !roleDelta.changed ||
          accessPending ||
          (access.isProtected && !roleDraft.includes("admin"))
        }
        onClick={() => setRoleConfirmOpen(true)}
      >
        更新權限
      </Button>
      {access.active ? (
        <Button
          type="button"
          variant="destructive"
          disabled={access.isSelf || access.isLastAdmin || access.isProtected || accessPending}
          onClick={() => setDeactivateOpen(true)}
        >
          停用帳戶
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={accessPending}
          onClick={() =>
            void setStaffActive({ data: { staffId: access.staffId, active: true } }).then(() => {
              toast.success("帳戶已重新啟用");
              onAccessChanged?.();
            })
          }
        >
          重新啟用
        </Button>
      )}
    </div>
  </section>
) : null}

<AdminConfirmDialog
  open={roleConfirmOpen}
  title="確認變更權限？"
  description="權限變更會即時生效。"
  confirmLabel="確認變更"
  confirmVariant="destructive"
  isPending={accessPending}
  onOpenChange={(open) => {
    if (!accessPending) setRoleConfirmOpen(open);
  }}
  onConfirm={() => void confirmRoleChange()}
>
  <ul className="space-y-1 text-sm">
    {roleDelta.added.map((role) => (
      <li key={`add-${role.value}`}>＋ {role.label}</li>
    ))}
    {roleDelta.removed.map((role) => (
      <li key={`remove-${role.value}`}>－ {role.label}</li>
    ))}
  </ul>
</AdminConfirmDialog>

<AdminConfirmDialog
  open={deactivateOpen}
  title="停用帳戶並轉交工作？"
  description="停用後此同事無法登入。已指派的工作會轉交給你選擇的接手人。"
  confirmLabel="確認停用"
  confirmVariant="destructive"
  isPending={accessPending || (access ? access.ownedTotal > 0 && !successorId : false)}
  onOpenChange={(open) => {
    if (!accessPending) setDeactivateOpen(open);
  }}
  onConfirm={() => void confirmDeactivate()}
>
  {access && access.ownedTotal > 0 ? (
    <div className="space-y-3 text-sm">
      <dl className="grid gap-1 rounded-md border bg-muted/40 p-3">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">放盤</dt>
          <dd className="tabular-nums">{access.owned.properties}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">客戶</dt>
          <dd className="tabular-nums">{access.owned.crm_contacts}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Leads</dt>
          <dd className="tabular-nums">{access.owned.crm_leads}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">查詢</dt>
          <dd className="tabular-nums">{access.owned.inquiries}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">WhatsApp 對話</dt>
          <dd className="tabular-nums">{access.owned.whatsapp_conversations}</dd>
        </div>
      </dl>
      <div className="space-y-1.5">
        <Label htmlFor="successor">接手人</Label>
        <Select value={successorId} onValueChange={setSuccessorId}>
          <SelectTrigger id="successor" aria-label="接手人">
            <SelectValue placeholder="選擇接手同事" />
          </SelectTrigger>
          <SelectContent>
            {activeStaffOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">此同事沒有已指派的工作，可直接停用。</p>
  )}
</AdminConfirmDialog>
```

- [ ] **Step 4: Verify it compiles and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/AgentProfileForm.tsx
git commit -m "feat(staff): add the 權限 section with role checkboxes and handover"
```

---

### Task 10: Component test for the section

`AgentProfileForm.test.tsx` renders to a static HTML string with `renderToStaticMarkup` and queries it with cheerio — there is no DOM and no interaction, so assert on what is present in the markup.

**Files:**
- Modify: `src/components/admin/AgentProfileForm.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/components/admin/AgentProfileForm.test.tsx`:

```typescript
const accessSummary = {
  staffId: "22222222-2222-4222-8222-222222222222",
  roles: ["agent"] as ("admin" | "manager" | "agent")[],
  active: true,
  isSelf: false,
  isLastAdmin: false,
  isProtected: false,
  owned: {
    properties: 4,
    crm_contacts: 2,
    crm_leads: 12,
    inquiries: 1,
    whatsapp_conversations: 3,
  },
  ownedTotal: 22,
};

describe("權限 section", () => {
  test("renders role controls when an access summary is supplied", () => {
    const html = renderToStaticMarkup(
      createElement(AgentProfileForm, {
        profile: profileData,
        canManageIdentity: true,
        access: accessSummary,
        activeStaffOptions: [{ id: "33333333-3333-4333-8333-333333333333", label: "李小明" }],
        onSaved: () => {},
      }),
    );
    const $ = load(html);

    expect($("#access-heading").text()).toContain("權限");
    for (const label of ["管理員", "主管", "經紀"]) {
      expect($(`[aria-label="${label}"]`).length).toBe(1);
    }
    expect(html).toContain("停用帳戶");
  });

  test("a protected account explains why it cannot be demoted or deactivated", () => {
    const html = renderToStaticMarkup(
      createElement(AgentProfileForm, {
        profile: profileData,
        canManageIdentity: true,
        access: { ...accessSummary, roles: ["admin"], isProtected: true },
        onSaved: () => {},
      }),
    );

    expect(html).toContain("ADMIN_BOOTSTRAP_EMAILS");
    // The deactivate control is present but disabled rather than hidden, so the
    // reason is visible instead of the button silently vanishing.
    const $ = load(html);
    const deactivate = $("button").filter((_, el) => $(el).text().includes("停用帳戶"));
    expect(deactivate.attr("disabled")).toBeDefined();
  });

  // Managers may edit an agent's public profile but must never see a path to
  // escalate anyone. The route passes access: null for non-admins.
  test("is absent entirely when no access summary is supplied", () => {
    const html = renderToStaticMarkup(
      createElement(AgentProfileForm, {
        profile: profileData,
        canManageIdentity: false,
        access: null,
        onSaved: () => {},
      }),
    );

    expect(html).not.toContain("access-heading");
    expect(html).not.toContain("停用帳戶");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/admin/AgentProfileForm.test.tsx`
Expected: FAIL before Task 9 is applied; PASS after

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test src/components/admin/AgentProfileForm.test.tsx`
Expected: PASS — `0 fail`

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/AgentProfileForm.test.tsx
git commit -m "test(staff): assert the 權限 section renders only for admins"
```

---

### Task 11: Wire the section into the edit route

**Files:**
- Modify: `src/routes/admin.agents_.$id.tsx`

- [ ] **Step 1: Load the access summary alongside the profile**

In `src/routes/admin.agents_.$id.tsx`, add to the imports:

```typescript
import {
  fetchAdminAgentEditorContext,
  fetchAdminAgentProfile,
  fetchAdminAgents,
  fetchStaffAccessSummary,
} from "@/lib/neon/admin-data";
import type { AdminAgentProfileRow, StaffAccessSummary } from "@/lib/neon/admin-data.types";
```

Add state next to the existing `profile` state:

```typescript
const [access, setAccess] = useState<StaffAccessSummary | null>(null);
const [staffOptions, setStaffOptions] = useState<{ id: string; label: string }[]>([]);
const [accessVersion, setAccessVersion] = useState(0);
```

Add a second effect below the existing profile effect:

```typescript
// Only admins may read the access summary, so a manager simply gets null and
// the 權限 section does not render. A failure here must not break profile
// editing, which is why it is a separate effect from the profile load.
useEffect(() => {
  if (loading || !user || !editorContext.canManageIdentity) return;
  let cancelled = false;
  Promise.all([fetchStaffAccessSummary({ data: { staffId: id } }), fetchAdminAgents()])
    .then(([summary, agents]) => {
      if (cancelled) return;
      setAccess(summary as StaffAccessSummary);
      setStaffOptions(
        (agents as { id: string; name_zh?: string | null; name_en?: string | null }[])
          .filter((agent) => agent.id !== id)
          .map((agent) => ({
            id: agent.id,
            label: agent.name_zh || agent.name_en || agent.id,
          })),
      );
    })
    .catch(() => {
      if (!cancelled) setAccess(null);
    });
  return () => {
    cancelled = true;
  };
}, [id, loading, user, editorContext.canManageIdentity, accessVersion]);
```

- [ ] **Step 2: Pass the props to the form**

Find the `<AgentProfileForm ... />` usage and add:

```tsx
  access={access}
  activeStaffOptions={staffOptions}
  onAccessChanged={() => setAccessVersion((version) => version + 1)}
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.agents_.$id.tsx
git commit -m "feat(staff): load access summary into the agent editor"
```

---

### Task 12: Group the sidebar

**Files:**
- Modify: `src/components/admin/AdminShell.tsx`

- [ ] **Step 1: Replace navItems with grouped navigation**

In `src/components/admin/AdminShell.tsx`, replace the `const navItems = [...] as const;` block with:

```typescript
// Grouped rather than flat, and static rather than collapsible: with ten
// entries there is no vertical space worth reclaiming, and a collapsed group is
// how 媒體庫 became unreachable in the first place.
//
// /admin/cms previously had TWO entries differing only by search param -- one
// labelled "CMS / FAQ" that actually landed on 屋苑 SEO, and one labelled
// "AI Agent" that landed on FAQ 編輯 -- while 文章編輯, YouTube影片 and 媒體庫 had
// no entry at all. One honest entry now covers all five tabs.
const navGroups = [
  {
    heading: null,
    items: [{ to: "/admin", label: "總覽", icon: BarChart3 }],
  },
  {
    heading: "物業",
    items: [
      { to: "/admin/listings", label: "放盤", icon: Building2, activeExact: false },
      { to: "/admin/cms", label: "網站內容", icon: BookOpen, activeExact: false, includeSearch: false },
    ],
  },
  {
    heading: "客戶",
    items: [
      { to: "/admin/leads", label: "CRM", icon: ContactRound },
      { to: "/admin/leads/command-center", label: "Command Center", icon: Gauge },
      { to: "/admin/segments", label: "客戶分群", icon: Users },
    ],
  },
  {
    heading: "訊息",
    items: [
      { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle },
      { to: "/admin/blasts", label: "群發", icon: Send },
    ],
  },
  {
    heading: "系統",
    items: [
      // Renamed from 經紀管理: with roles attached this screen manages staff
      // access, not just public directory entries.
      { to: "/admin/agents", label: "員工管理", icon: UserRoundCog, activeExact: false },
      { to: "/admin/operations", label: "系統營運", icon: ServerCog, includeSearch: false },
    ],
  },
] as const;
```

Remove `FileQuestion` from the `lucide-react` import — it was only used by the deleted "AI Agent" entry.

- [ ] **Step 2: Render the groups**

Replace the body of `AdminNav` with:

```tsx
function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="後台選單" className="grid gap-4">
      {navGroups.map((group) => (
        <div key={group.heading ?? "root"} className="grid gap-1">
          {group.heading ? (
            <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.heading}
            </p>
          ) : null}
          {group.items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={`${item.to}-${item.label}`}
                to={item.to}
                activeOptions={{
                  exact: "activeExact" in item ? item.activeExact : true,
                  includeSearch: "includeSearch" in item ? item.includeSearch : true,
                  explicitUndefined: true,
                }}
                className={navLinkClassName}
                activeProps={navLinkActiveProps}
                onClick={onNavigate}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/AdminShell.tsx
git commit -m "feat(admin): group the sidebar and collapse the duplicate CMS entry"
```

---

### Task 13: Nav regression test

**Files:**
- Modify: `src/routes/admin.routes.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `src/routes/admin.routes.test.mjs`:

```javascript
// Two entries pointed at /admin/cms differing only by search param, with labels
// that named the wrong tab, while three of that screen's five tabs had no entry
// at all. A duplicate destination is the shape of that bug.
test("sidebar has no duplicate destinations and is fully grouped", () => {
  const shell = read("src/components/admin/AdminShell.tsx");

  const start = shell.indexOf("const navGroups = [");
  assert.notEqual(start, -1, "navGroups must exist");
  const block = shell.slice(start, shell.indexOf("] as const;", start));

  const destinations = [...block.matchAll(/to:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(
    new Set(destinations).size,
    destinations.length,
    `duplicate sidebar destination: ${destinations.join(", ")}`,
  );
  assert.equal(destinations.length, 10);

  for (const heading of ["物業", "客戶", "訊息", "系統"]) {
    assert.match(block, new RegExp(`heading: "${heading}"`), `missing group ${heading}`);
  }

  // The old duplicate + its misleading labels must not come back.
  assert.doesNotMatch(block, /search: \{ tab: "faqs" \}/);
  assert.doesNotMatch(block, /"AI Agent"/);
  assert.doesNotMatch(block, /"CMS \/ FAQ"/);
  assert.match(block, /"員工管理"/);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test src/routes/admin.routes.test.mjs`
Expected: PASS — `# fail 0`

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin.routes.test.mjs
git commit -m "test(admin): pin the grouped sidebar against duplicate destinations"
```

---

### Task 14: Delete the unenforced staff.manage permission

`staff.manage` is declared in the permission list but no code ever checks it. Since only `admin` holds it, the new functions gating on `requireStaff(["admin"])` behave identically — a permission that implies a check it never performs is worse than no permission.

**Files:**
- Modify: `src/lib/control-plane/permissions.ts`
- Modify: `src/lib/control-plane/control-plane.test.mjs`

- [ ] **Step 1: Confirm nothing enforces it**

Run: `grep -rn "staff.manage" src/ | grep -v permissions.ts`
Expected: no output

If there IS output, stop and skip this task — something now depends on it.

- [ ] **Step 2: Remove the permission**

In `src/lib/control-plane/permissions.ts`, delete the `"staff.manage",` line from the `controlPlanePermissions` array and the `"staff.manage",` entry from the `admin` set in `rolePermissions`.

- [ ] **Step 3: Update any test expectation**

Run: `node --test src/lib/control-plane/control-plane.test.mjs`

If a test asserts a permission count or an exact admin permission list, update it to match. If it passes unchanged, no edit is needed.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && node --test src/lib/control-plane/control-plane.test.mjs`
Expected: both exit 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/control-plane/permissions.ts src/lib/control-plane/control-plane.test.mjs
git commit -m "refactor(control-plane): drop the staff.manage permission nothing enforced"
```

---

### Task 15: Wire tests into a named script

There is no aggregate `npm test`. A test file not named in a `test:*` script is never run by anyone — this is exactly how a red test went unnoticed before.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the new files to test:property-experience**

In `package.json`, `test:property-experience` currently ends with:

```
... src/lib/neon/staff-security-policy.test.mjs src/lib/neon/website-inquiry.test.mjs
```

Append the new ownership test to the `node --test` list so it reads:

```
... src/lib/neon/staff-security-policy.test.mjs src/lib/neon/staff-ownership.test.mjs src/lib/neon/website-inquiry.test.mjs
```

`AgentProfileForm.test.tsx` and `staff-security-policy.test.mjs` are already listed. `admin.routes.test.mjs` is already covered by `test:woztell` and `test:operations`.

- [ ] **Step 2: Run the full script**

Run: `npm run test:property-experience`
Expected: PASS — bun reports `0 fail`, node reports `# fail 0`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test(staff): run the ownership registry test in CI"
```

---

### Task 16: Full verification

- [ ] **Step 1: Typecheck, lint, format**

```bash
npx tsc --noEmit && npm run lint && npx prettier --check src
```

Expected: all three exit 0.

- [ ] **Step 2: Run every test script**

```bash
for s in corridor seo blog mls listing-search cron contact estate-conversion neon-auth \
         command-center woztell operations control-plane property-experience \
         content-copilot migration; do
  printf '%-22s' "$s"
  npm run --silent test:$s >/dev/null 2>&1 && echo PASS || echo FAIL
done
```

Expected: every line PASS.

- [ ] **Step 3: Run every .mjs file, including any not wired into a script**

```bash
for f in $(find src -name '*.test.mjs'); do
  node --test "$f" >/dev/null 2>&1 || echo "FAIL: $f"
done
echo "sweep done"
```

Expected: only `sweep done`.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: exits 0 with `[nitro] ✔ You can preview this build`.

- [ ] **Step 5: Manual smoke check**

Start the dev server (`npm run dev`) and confirm, signed in as an admin:

1. The sidebar shows five groups with ten entries, one 網站內容 entry, and 員工管理 under 系統.
2. `/admin/cms` stays highlighted when switching between all five tabs.
3. Opening a colleague under 員工管理 shows the 權限 section with three role checkboxes.
4. Changing a role and pressing 更新權限 opens a confirm naming the delta.
5. 停用帳戶 lists the five owned counts and requires a successor before confirming.
6. Your own record shows 停用帳戶 disabled.
7. An account listed in `ADMIN_BOOTSTRAP_EMAILS` shows the protection notice, with
   both 更新權限 (when dropping admin) and 停用帳戶 disabled.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore(staff): verify access management and grouped navigation"
```

---

## Notes for the implementer

**Do not reassign historical columns.** `staff-ownership.ts` deliberately separates the five ownership columns from the twelve authorship column names. If you add a table, add it to the right list — `STAFF_HISTORICAL_COLUMNS` exists so the test can prove exclusion, not as documentation.

**Guards must be re-read server-side.** `isLastAdmin` and `otherAdminCount` come from the database at decision time. A client-supplied count is a TOCTOU hole: two admins demoting each other simultaneously could otherwise empty the admin set.

**Deactivation is one transaction.** The reassignment `UPDATE`s and the `active = false` flip go through a single `transactionRows` call. Splitting them allows a partial handover with no record of what moved.

**Protection is env-driven, never hardcoded.** `isProtectedStaffEmail` reads
`ADMIN_BOOTSTRAP_EMAILS`. Do not inline any address into source. If the variable
is unset, no account is protected and first-login bootstrap is also disabled --
that is the documented behaviour, not a bug, but it means production must set it.

**This repo has no aggregate `npm test`.** Any new test file must be named in a `test:*` script or it will never run.
