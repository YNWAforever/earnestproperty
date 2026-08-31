# P6a — RBAC permission-consistency foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the "declared in `permissions.ts` but enforced with a plain role array" gap for every existing admin surface, and add a real, assignable, read-only `viewer` role — so every P6b–P6e route can be built directly on `requireStaffPermission` from day one instead of inventing a fourth enforcement style.

**Architecture:** No new tables, no new routes. This phase only touches `src/lib/control-plane/permissions.ts`, the two files it wraps (`auth.server.ts`'s `StaffRole` type, `admin-team.ts`'s role assignment), the UI that lets a human actually assign a role (`admin.team.tsx`), and the enforcement call sites for `ai.draft.generate` / `cms.publish` / `ai.knowledge.rebuild` that currently bypass the permission map. Every migrated call site keeps its exact current effective-role set — this is a mechanism swap, not a behavior change, verified per-task below.

**Tech Stack:** TypeScript, `node:test` (`.contract.test.mjs` source-shape assertions — this codebase's established pattern for asserting server-only enforcement without a build step), `bun test` for `.tsx`.

---

## 0. Why this phase exists (read before starting)

`src/lib/control-plane/permissions.ts` declares `ai.draft.generate`, `cms.publish`, and `ai.knowledge.rebuild` as permissions with a role→permission map. But three real call sites don't consult that map at all — they hardcode `["admin", "manager", "agent"]` or `["admin", "manager"]` directly:

| Function | File | Current enforcement | Effective roles today |
| --- | --- | --- | --- |
| `generateServer`, `decideServer` | `src/lib/ai/content-copilot-admin.ts:20,28` | `requireStaffAccess(getRequest(), ["admin","manager","agent"])` | admin, manager, agent |
| `saveAdminEstateServer`, `saveAdminArticleServer`, `saveAdminFaqServer`, `saveAdminCmsVideoServer`, `deleteAdminFaqServer`, `updateAdminMediaAssetServer`, `checkAdminFaqConflictsServer` | `src/lib/neon/admin-data.ts` (via `requireStaff(["admin","manager"])`, defined at line ~29) | plain role array | admin, manager |
| `rebuildAdminAiKnowledgeServer` | `src/lib/neon/admin-data.ts:457-461` | `requireStaff(["admin","manager"])` | admin, manager |

`rolePermissions` in `permissions.ts` today grants exactly the same effective roles for each of these permissions (`ai.draft.generate`: agent/manager/admin; `cms.publish`: manager/admin; `ai.knowledge.rebuild`: manager/admin) — confirmed by reading the file. So migrating these call sites to `requireStaffPermission()` is a **pure enforcement-mechanism swap with zero behavior change today**, but it means a future change to `rolePermissions` (e.g. P6c/d/e granting a new surface to `agent`) actually takes effect everywhere instead of silently missing these seven call sites.

Separately, `api.admin.ai.rebuild-knowledge.ts` is a real, correctly-`requireStaffPermission`-gated route with a working async job handler (`job-handlers.server.ts:115`, job type `"ai.knowledge.rebuild"`) — but nothing calls it; the CMS "重建索引" button calls `rebuildAdminAiKnowledge` instead, which runs the rebuild synchronously inline. **Do not delete or wire that route in this phase** — converting the CMS button to the async job (with status polling) is a UI-behavior change that belongs with P6b's CMS revision-engine rework, not this permissions-only phase. This phase only fixes `rebuildAdminAiKnowledgeServer`'s enforcement mechanism, leaving its synchronous behavior untouched.

**Deliberate scope boundary — do not expand:** many other admin-data read/list functions (`fetchAdminCms`, `fetchAdminMediaAssets`, etc.) also use plain `requireStaff([...])` role arrays that don't include `"viewer"`. Do **not** retrofit them in this phase. `viewer` becomes real and testable via the two routes in Task 1 that already use `requireStaffPermission` (`/api/admin/control-plane/health`, `/api/admin/control-plane/audit`); every future P6b–P6e route should be built on `requireStaffPermission` from the start (granting `viewer` read access where the spec calls for it), rather than retrofitting today's routes speculatively.

---

## Task 1: Add a real, assignable `viewer` role

**Files:**
- Modify: `src/lib/neon/auth.server.ts:6`
- Modify: `src/lib/control-plane/permissions.ts`
- Modify: `src/lib/neon/admin-team.ts:21`
- Modify: `src/routes/admin.team.tsx:69,470,476`
- Create: `src/lib/control-plane/permissions.test.mjs`
- Modify: `src/lib/neon/admin-team.contract.test.mjs`
- Modify: `src/components/admin/team/AdminTeam.test.tsx` (find this file's existing role-selector test first — see Step 6)
- Modify: `package.json` (add the new test file to `test:control-plane`)

- [ ] **Step 1: Write the failing test for the permission map**

Create `src/lib/control-plane/permissions.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "src/lib/control-plane/permissions.ts"), "utf8");

test("StaffRole includes viewer and rolePermissions grants it read-only permissions", () => {
  assert.match(source, /viewer: new Set\(\[\s*"system\.health\.read",\s*"audit\.read",?\s*\]\)/);
});

test("hasPermission's role-literal check includes viewer", () => {
  assert.match(
    source,
    /role === "admin" \|\| role === "manager" \|\| role === "agent" \|\| role === "viewer"/,
  );
});

test("requireStaffPermission admits viewer into requireStaffAccess's allowed-role list", () => {
  assert.match(
    source,
    /requireStaffAccess\(request, \["admin", "manager", "agent", "viewer"\]\)/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/control-plane/permissions.test.mjs`
Expected: all 3 tests FAIL (source doesn't contain `viewer` yet).

- [ ] **Step 3: Add `viewer` to `StaffRole`**

In `src/lib/neon/auth.server.ts`, change line 6:

```typescript
export type StaffRole = "admin" | "manager" | "agent" | "viewer";
```

- [ ] **Step 4: Add `viewer` to the permission map**

In `src/lib/control-plane/permissions.ts`, replace the whole file's `rolePermissions`, `hasPermission`, and `requireStaffPermission` with:

```typescript
const rolePermissions: Record<StaffRole, ReadonlySet<ControlPlanePermission>> = {
  agent: new Set(["ai.draft.generate", "system.health.read"]),
  manager: new Set([
    "ai.draft.generate",
    "ai.knowledge.rebuild",
    "campaign.queue",
    "cms.publish",
    "system.health.read",
    "system.jobs.read",
    "system.jobs.retry",
    "system.jobs.cancel",
    "audit.read",
  ]),
  admin: new Set(controlPlanePermissions),
  // Read-only reviewer: sees operations health and the audit log, cannot
  // mutate anything and cannot generate/publish content.
  viewer: new Set(["system.health.read", "audit.read"]),
};

export function hasPermission(roles: readonly string[], permission: ControlPlanePermission) {
  return roles.some((role) =>
    role === "admin" || role === "manager" || role === "agent" || role === "viewer"
      ? rolePermissions[role].has(permission)
      : false,
  );
}

export async function requireStaffPermission(
  request: Request,
  permission: ControlPlanePermission,
): Promise<StaffAccess> {
  const { requireStaffAccess } = await import("../neon/auth.server.ts");
  const staff = await requireStaffAccess(request, ["admin", "manager", "agent", "viewer"]);
  if (!hasPermission(staff.roles, permission)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return staff;
}
```

(Only the type signature's `Record<StaffRole, ...>` needs to compile against the now-4-member `StaffRole` union — the `agent`/`manager`/`admin` entries above are unchanged from today.)

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test src/lib/control-plane/permissions.test.mjs`
Expected: all 3 tests PASS.

- [ ] **Step 6: Make `viewer` assignable — server-side schema**

In `src/lib/neon/admin-team.ts:21`, change:

```typescript
const staffRoleSchema = z.enum(["admin", "manager", "agent", "viewer"]);
```

Read the surrounding ~30 lines (context around line 131/141) to confirm this schema is what actually validates an invite/role-change payload — if the invite/role-change server functions there use `requireAccess(request, ["admin", "manager"])` or `requireAccess(request, ["admin"])` to decide *who can assign roles*, leave those untouched (an admin/manager assigning `viewer` to someone else is already covered — this step only widens what value is accepted, not who can set it).

- [ ] **Step 7: Make `viewer` assignable — UI role selector**

In `src/routes/admin.team.tsx`:
- Line 69: extend `["admin", "manager", "agent"].includes(String(search.role))` to `["admin", "manager", "agent", "viewer"].includes(String(search.role))`.
- Line 470: extend `(["admin", "manager", "agent"] as StaffRole[]).map((role) => ...)` to `(["admin", "manager", "agent", "viewer"] as StaffRole[]).map((role) => ...)`.
- Line 476: extend the label ternary. Current: `role === "admin" ? "管理員" : role === "manager" ? "主管" : "經紀"`. New: `role === "admin" ? "管理員" : role === "manager" ? "主管" : role === "agent" ? "經紀" : "唯讀"`.

- [ ] **Step 8: Extend the admin-team contract test**

Open `src/lib/neon/admin-team.contract.test.mjs` and find the assertions around lines 12, 36, 76, 130 that check the accepted-roles set (e.g. `roles: ["admin", "manager"]` fixtures feeding `staffRoleSchema`/the invite path). Add a case asserting `staffRoleSchema.parse("viewer")` succeeds and a case asserting the invite/role-change path accepts `"viewer"` as a target role, following the existing fixtures' shape in this file exactly (do not invent a new fixture style).

- [ ] **Step 9: Extend the AdminTeam UI test**

Open `src/components/admin/team/AdminTeam.test.tsx`, find its existing role-selector-rendering test (search for `"經紀"` or `"管理員"` to locate it), and add a `"唯讀"` option to whatever assertion enumerates the rendered `<option>`/label list.

- [ ] **Step 10: Register the new test file**

In `package.json`, add `src/lib/control-plane/permissions.test.mjs` to the `test:control-plane` script's file list (after `control-plane.test.mjs`).

- [ ] **Step 11: Run the full affected suites**

Run: `npm run test:control-plane && npm run test:team`
Expected: all PASS.

- [ ] **Step 12: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (the `StaffRole` union widening must not break any exhaustive `switch`/object-literal elsewhere — if it does, add the missing `viewer` arm rather than casting it away).

- [ ] **Step 13: Commit**

```bash
git add src/lib/neon/auth.server.ts src/lib/control-plane/permissions.ts src/lib/control-plane/permissions.test.mjs src/lib/neon/admin-team.ts src/lib/neon/admin-team.contract.test.mjs src/routes/admin.team.tsx src/components/admin/team/AdminTeam.test.tsx package.json
git commit -m "feat(admin): add read-only viewer staff role"
```

---

## Task 2: Migrate `ai.draft.generate` enforcement

**Files:**
- Modify: `src/lib/ai/content-copilot-admin.ts:20,28`
- Modify: `src/lib/ai/content-copilot-admin.contract.test.mjs`

- [ ] **Step 1: Update the (currently-passing) contract test to expect the new call**

`src/lib/ai/content-copilot-admin.contract.test.mjs` line 8 currently asserts:

```javascript
assert.match(source, /requireStaffAccess\(getRequest\(\), \["admin", "manager", "agent"\]\)/);
```

Change it to:

```javascript
assert.match(source, /requireStaffPermission\(getRequest\(\), "ai\.draft\.generate"\)/);
```

- [ ] **Step 2: Run test to verify it now fails**

Run: `node --test src/lib/ai/content-copilot-admin.contract.test.mjs`
Expected: FAIL (source still has the old call).

- [ ] **Step 3: Migrate the two call sites**

In `src/lib/ai/content-copilot-admin.ts`:
- Add the import: `import { requireStaffPermission } from "../control-plane/permissions";`
- Line 20 (`generateServer`'s handler): replace
  `const actor = await requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);`
  with
  `const actor = await requireStaffPermission(getRequest(), "ai.draft.generate");`
- Line 28 (`decideServer`'s handler): same replacement.
- Remove the now-unused `requireStaffAccess` import if nothing else in the file uses it (check first — `getRequest` stays).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/ai/content-copilot-admin.contract.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full content-copilot suite**

Run: `npm run test:content-copilot`
Expected: PASS (this exercises `generateAdminContentProposal`/decide end-to-end at the service layer — confirms the effective-role behavior really is unchanged for admin/manager/agent).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/content-copilot-admin.ts src/lib/ai/content-copilot-admin.contract.test.mjs
git commit -m "refactor(admin): enforce ai.draft.generate via permission map, not a hardcoded role array"
```

---

## Task 3: Migrate `cms.publish` enforcement (all 6 CMS-write functions)

**Files:**
- Modify: `src/lib/neon/admin-data.ts` (7 call sites: `saveAdminEstateServer`, `saveAdminArticleServer`, `saveAdminFaqServer`, `saveAdminCmsVideoServer`, `deleteAdminFaqServer`, `updateAdminMediaAssetServer`, `checkAdminFaqConflictsServer`)
- Create: `src/lib/neon/admin-data-permissions.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/lib/neon/admin-data-permissions.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "src/lib/neon/admin-data.ts"), "utf8");

// Every CMS-write server fn must gate on the declared cms.publish permission,
// not a hardcoded ["admin", "manager"] array -- see P6a plan §0 for why.
const CMS_WRITE_FUNCTIONS = [
  "saveAdminEstateServer",
  "saveAdminArticleServer",
  "saveAdminFaqServer",
  "saveAdminCmsVideoServer",
  "deleteAdminFaqServer",
  "updateAdminMediaAssetServer",
  "checkAdminFaqConflictsServer",
];

for (const fnName of CMS_WRITE_FUNCTIONS) {
  test(`${fnName} enforces cms.publish via requireStaffPermission`, () => {
    const start = source.indexOf(`const ${fnName} = createServerFn`);
    assert.notEqual(start, -1, `${fnName} not found in admin-data.ts`);
    const handlerSlice = source.slice(start, start + 400);
    assert.match(
      handlerSlice,
      /requireStaffPermission\(getRequest\(\), "cms\.publish"\)/,
      `${fnName} must call requireStaffPermission(getRequest(), "cms.publish")`,
    );
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/neon/admin-data-permissions.test.mjs`
Expected: all 7 FAIL.

- [ ] **Step 3: Migrate the 7 call sites**

In `src/lib/neon/admin-data.ts`, add the import `import { requireStaffPermission } from "../control-plane/permissions";` near the top (alongside the existing imports). For each of the 7 functions listed above, replace its body's `const staff = await requireStaff(["admin", "manager"]);` (variable name may be `staff` or `actor` depending on the function — keep whatever name it already uses) with:

```typescript
const staff = await requireStaffPermission(getRequest(), "cms.publish");
```

(`getRequest` is already imported in this file — confirm before adding a duplicate import.)

Do **not** touch `requireStaff` itself (line ~29) or any other call site that uses it — only these 7 functions are in `cms.publish`'s declared scope for this phase.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/neon/admin-data-permissions.test.mjs`
Expected: all 7 PASS.

- [ ] **Step 5: Run the CMS and command-center suites**

Run: `npm run test:cms && npm run test:command-center`
Expected: PASS — these exercise the actual save/delete/update flows end-to-end and confirm admin/manager still work and agent is still rejected.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/neon/admin-data.ts src/lib/neon/admin-data-permissions.test.mjs
git commit -m "refactor(admin): enforce cms.publish via permission map on all 6 CMS-write functions"
```

---

## Task 4: Migrate `ai.knowledge.rebuild` enforcement (backend only)

**Files:**
- Modify: `src/lib/neon/admin-data.ts:457-461` (`rebuildAdminAiKnowledgeServer`)
- Modify: `src/lib/neon/admin-data-permissions.test.mjs` (extend, from Task 3)

- [ ] **Step 1: Extend the failing test**

Add one more case to `src/lib/neon/admin-data-permissions.test.mjs` (same file from Task 3):

```javascript
test("rebuildAdminAiKnowledgeServer enforces ai.knowledge.rebuild via requireStaffPermission", () => {
  const start = source.indexOf("const rebuildAdminAiKnowledgeServer = createServerFn");
  assert.notEqual(start, -1);
  const handlerSlice = source.slice(start, start + 300);
  assert.match(handlerSlice, /requireStaffPermission\(getRequest\(\), "ai\.knowledge\.rebuild"\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/neon/admin-data-permissions.test.mjs`
Expected: this new case FAILs, the other 7 still PASS.

- [ ] **Step 3: Migrate the call site**

In `src/lib/neon/admin-data.ts`, in `rebuildAdminAiKnowledgeServer`'s handler, replace `const staff = await requireStaff(["admin", "manager"]);` with `const staff = await requireStaffPermission(getRequest(), "ai.knowledge.rebuild");`. Do not touch anything else in this function or its sibling `fetchAdminAiKnowledgeStatusServer` (that one stays on `requireStaff(["admin", "manager"])` — it's a read, not in this phase's scope).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/neon/admin-data-permissions.test.mjs`
Expected: all 8 cases PASS.

- [ ] **Step 5: Run the CMS suite**

Run: `npm run test:cms`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/neon/admin-data.ts src/lib/neon/admin-data-permissions.test.mjs
git commit -m "refactor(admin): enforce ai.knowledge.rebuild via permission map"
```

---

## Task 5: Prove `viewer` actually works end-to-end against the two already-permission-gated routes

**Files:**
- Modify: `src/routes/control-plane.routes.test.mjs` (find this file's existing role-matrix tests for `/api/admin/control-plane/health` and `/api/admin/control-plane/audit` first)

- [ ] **Step 1: Read the existing test file**

Open `src/routes/control-plane.routes.test.mjs`, locate the existing test(s) covering `api.admin.control-plane.health.ts` and `api.admin.control-plane.audit.ts` (search for `system.health.read` / `audit.read` / `requireStaffPermission`). These tests already exercise `hasPermission`/`requireStaffPermission` with a stubbed `roles` array for admin/manager/agent — follow their exact existing pattern (do not invent a new mocking style).

- [ ] **Step 2: Write the failing test**

Add a case (per route) asserting that a staff object with `roles: ["viewer"]` is granted access (200 / calls through) to both routes, and a case asserting `roles: ["viewer"]` is still rejected (403) by any route in this file gated on a permission `viewer` does NOT hold (e.g. `system.jobs.retry` if that route is covered here).

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test src/routes/control-plane.routes.test.mjs`
Expected: FAIL before Tasks 1-4 land — but since this task runs after them in sequence, run it now to confirm it actually needs Task 1's changes (i.e. temporarily re-verify by checking it would have failed on the pre-Task-1 code, per this plan's own before/after evidence — this is a sanity check, not a real revert).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/routes/control-plane.routes.test.mjs`
Expected: PASS (Task 1 already made this true; this task only adds the missing regression coverage).

- [ ] **Step 5: Run the full control-plane suite**

Run: `npm run test:control-plane`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/control-plane.routes.test.mjs
git commit -m "test(admin): cover viewer role against control-plane health/audit routes"
```

---

## Final verification for P6a

Run: `npm run test:cms && npm run test:command-center && npm run test:operations && npm run test:control-plane && npm run test:team && npm run test:content-copilot && npx tsc --noEmit && npm run lint`

All must pass, and `tsc --noEmit`'s error count must be at or below this repo's current recorded baseline (check `CHANGELOG.md` for the last recorded number before this phase).

## Acceptance

- `viewer` is a real `StaffRole`: assignable via `/admin/team`'s role selector (labeled 唯讀), accepted by `staffRoleSchema`, and granted exactly `system.health.read` + `audit.read`.
- `ai.draft.generate`, `cms.publish`, `ai.knowledge.rebuild` are enforced via `requireStaffPermission` at every call site named above — zero hardcoded role-array checks remain for these three permissions.
- No behavior change for admin/manager/agent on any of these 8 migrated functions (proven by the existing `test:cms`/`test:content-copilot` suites still passing unmodified in their assertions about who can/can't call each function).
- `api.admin.ai.rebuild-knowledge.ts` is untouched — still orphaned, still correctly permissioned, explicitly deferred to P6b.
