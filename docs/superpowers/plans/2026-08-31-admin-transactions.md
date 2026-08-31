# Admin Transactions (create/verify/publish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff a way to log the agency's own closed deals into `transactions`, so the already-built public `/transactions` page, district transaction chart, and estate transaction tables — which have been querying a table nothing has ever written to — finally have real rows to show.

**Architecture:** Mirrors the existing `properties` admin CRUD exactly: three `admin-data.server.ts` SQL functions (list/get/save) with the same `agentScope()` row-ownership guard `saveAdminProperty` already uses, three thin `createServerFn` wrappers in `admin-data.ts`, and three route files (list, new, edit) following `admin.listings.tsx`'s shape. A single new `TransactionForm` component (mirroring `PropertyForm.tsx`'s zod-schema + `Field`/`Section` pattern, much shorter — 9 fields vs. 22) is shared by both the new and edit routes.

**Tech Stack:** TanStack Start `createServerFn`, raw SQL via `queryRows`/`addParam` (no ORM), Zod validation, shadcn/ui form primitives, `node --test` contract tests using this repo's transpile-and-inline-as-data-URL harness (same technique as `transaction-search.contract.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-08-31-admin-transactions-design.md`

---

## Reference implementation (read before starting)

Every task below mirrors an existing file. Read the referenced lines first —
this plan does not repeat code that's already correct in the codebase, only
what's different for transactions.

- **SQL layer pattern**: `src/lib/neon/admin-data.server.ts:936-1140` (`listAdminListings`, `getAdminProperty`, `saveAdminProperty`), `:113-116` (`agentScope`), `:3353-3374` (`writeAudit`), `:795-797` (`rowDate`).
- **Server-fn wrapper pattern**: `src/lib/neon/admin-data.ts:382-408` (`fetchAdminProperty`/`saveAdminProperty`), `:1004-1016` (`fetchAdminListingsFiltered`).
- **Route pattern**: `src/routes/admin.listings.tsx` (list), `src/routes/admin.listings_.new.tsx`, `src/routes/admin.listings_.$id.tsx`.
- **Form pattern**: `src/components/dashboard/PropertyForm.tsx` (zod schema, `Field`/`Section` local helpers, submit handler, error mapping).
- **Nav config**: `src/components/admin/AdminShell.tsx:29-53` (`navGroups`).
- **Stale-hash-recovery test that needs a new entry**: `src/routes/admin.routes.test.mjs:211-237`.

The `transactions` table's real columns (from `neon/migrations/20260622060000_public_content.sql` and `20260830140000_transaction_provenance.sql`):
`id, estate_id, unit, deal_type, price, saleable_area, saleable_psf, deal_date, created_at, source, source_url, verification_state (enum: unverified/pending/verified), verified_at, agent_id, published, block, floor_band, social_state`.

---

## Task 1: Types — `admin-data.types.ts`

**Files:**
- Modify: `src/lib/neon/admin-data.types.ts`

- [ ] **Step 1: Add the three new types**

Add near `AdminListingRow`/`AdminListingFiltersInput` (around line 38-53):

```typescript
export type AdminTransactionRow = {
  id: string;
  estate_id: string | null;
  estate_name_zh: string | null;
  deal_type: string;
  price: number | null;
  saleable_area: number | null;
  saleable_psf: number | null;
  deal_date: string | null;
  unit: string | null;
  block: string | null;
  floor_band: string | null;
  source: string | null;
  source_url: string | null;
  verification_state: string;
  published: boolean;
  agent_id: string | null;
  agent_name: string | null;
};

export type AdminTransactionInput = {
  id?: string;
  estate_id: string;
  deal_type: "sale" | "rent";
  price: number;
  saleable_area: number;
  deal_date: string;
  unit: string | null;
  block: string | null;
  floor_band: string | null;
  source: string | null;
  source_url: string | null;
  verified: boolean;
};

export type AdminTransactionFiltersInput = {
  q?: string;
  deal_type?: "sale" | "rent" | "all";
  estate_id?: string;
  verification_state?: "unverified" | "pending" | "verified" | "all";
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (the types aren't consumed anywhere yet, so this only checks the file itself is syntactically valid TypeScript).

- [ ] **Step 3: Commit**

```bash
git add src/lib/neon/admin-data.types.ts
git commit -m "feat(admin): add AdminTransaction types"
```

---

## Task 2: SQL layer — `admin-data.server.ts`

**Files:**
- Modify: `src/lib/neon/admin-data.server.ts`
- Test: `src/lib/neon/admin-transactions.contract.test.mjs` (new)

- [ ] **Step 1: Write the failing contract test**

This mirrors `transaction-search.contract.test.mjs`'s harness exactly (transpile `admin-data.server.ts` to a `data:` URL module with `getSql()` stubbed to a recorder, so the real SQL string/param array run with no live Neon connection).

Create `src/lib/neon/admin-transactions.contract.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

function inlineRelativeImports(source, dir) {
  return source.replace(/from "\.\/([\w.-]+?)(?:\.js)?"/g, (match, name) => {
    for (const candidate of [`${name}.ts`, `${name}.js`]) {
      const path = join(root, dir, candidate);
      if (!existsSyncSafe(path)) continue;
      const code = readFileSync(path, "utf8");
      return `from "${dataUrl(candidate.endsWith(".ts") ? transpile(code) : code)}"`;
    }
    return match;
  });
}

function existsSyncSafe(path) {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

function recorder() {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params: params ?? [] });
    return [];
  };
  return { calls, query };
}

async function loadAdminDataServerWithInjectedQuery(query) {
  globalThis.__adminTransactionsContractQuery = query;
  const dbUrl = dataUrl(
    "export const getSql = () => ({ query: (...args) => globalThis.__adminTransactionsContractQuery(...args) });",
  );
  const executable = inlineRelativeImports(
    transpile(read("src/lib/neon/admin-data.server.ts"))
      .replace('import "@tanstack/react-start/server-only";', "")
      .replace('from "./db.server"', `from "${dbUrl}"`),
    "src/lib/neon",
  );
  return import(dataUrl(executable));
}

const AGENT_ACTOR = { staffId: "agent-1", roles: ["agent"] };
const ADMIN_ACTOR = { staffId: "admin-1", roles: ["admin"] };

test("listAdminTransactions scopes an agent to their own rows, admin sees all", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);

  await server.listAdminTransactions({}, AGENT_ACTOR);
  assert.match(calls[0].text, /t\.agent_id = \$1/);
  assert.deepEqual(calls[0].params, ["agent-1"]);

  await server.listAdminTransactions({}, ADMIN_ACTOR);
  assert.doesNotMatch(calls[1].text, /t\.agent_id = \$1/);
});

test("saveAdminTransaction computes and stores saleable_psf from price/saleable_area", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);

  await server.saveAdminTransaction(
    {
      estate_id: "estate-1",
      deal_type: "sale",
      price: 10_000_000,
      saleable_area: 500,
      deal_date: "2026-08-01",
      unit: null,
      block: null,
      floor_band: null,
      source: "Test Agent",
      source_url: null,
      verified: false,
    },
    AGENT_ACTOR,
  );

  const call = calls[0];
  assert.match(call.text, /INSERT INTO transactions/);
  assert.ok(call.params.includes(20_000), "saleable_psf should be price / saleable_area = 20000");
});

test("saveAdminTransaction attributes a new (INSERT) transaction to whoever creates it", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);

  await server.saveAdminTransaction(
    {
      estate_id: "estate-1",
      deal_type: "sale",
      price: 10_000_000,
      saleable_area: 500,
      deal_date: "2026-08-01",
      unit: null,
      block: null,
      floor_band: null,
      source: null,
      source_url: null,
      verified: false,
    },
    AGENT_ACTOR,
  );

  assert.match(calls[0].text, /INSERT INTO transactions/);
  assert.ok(calls[0].params.includes("agent-1"), "agent_id param should be the acting agent's own id");
});

test("saveAdminTransaction never reassigns agent_id on UPDATE, even when a manager edits an agent's transaction", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);

  await server.saveAdminTransaction(
    {
      id: "txn-1",
      estate_id: "estate-1",
      deal_type: "sale",
      price: 10_000_000,
      saleable_area: 500,
      deal_date: "2026-08-01",
      unit: null,
      block: null,
      floor_band: null,
      source: null,
      source_url: null,
      verified: false,
    },
    { staffId: "manager-1", roles: ["manager"] },
  );

  assert.match(calls[0].text, /UPDATE transactions/);
  assert.doesNotMatch(calls[0].text, /agent_id\s*=\s*\$/, "agent_id must never appear in the UPDATE SET clause");
  assert.ok(
    !calls[0].params.includes("manager-1"),
    "the editing manager's own id must never be written as agent_id",
  );
});

test("the verified checkbox sets BOTH verification_state='verified' and published=true, never independently", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);

  await server.saveAdminTransaction(
    {
      estate_id: "estate-1",
      deal_type: "sale",
      price: 10_000_000,
      saleable_area: 500,
      deal_date: "2026-08-01",
      unit: null,
      block: null,
      floor_band: null,
      source: null,
      source_url: null,
      verified: true,
    },
    ADMIN_ACTOR,
  );

  const call = calls[0];
  assert.ok(call.params.includes("verified"), "verification_state param should be 'verified'");
  assert.ok(call.params.includes(true), "published param should be true");
});

test("unverified (default) leaves verification_state='unverified' and published=false", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);

  await server.saveAdminTransaction(
    {
      estate_id: "estate-1",
      deal_type: "sale",
      price: 10_000_000,
      saleable_area: 500,
      deal_date: "2026-08-01",
      unit: null,
      block: null,
      floor_band: null,
      source: null,
      source_url: null,
      verified: false,
    },
    ADMIN_ACTOR,
  );

  const call = calls[0];
  assert.ok(call.params.includes("unverified"));
  assert.ok(call.params.includes(false));
});

test("getAdminTransaction adds an agent_id scope predicate for a scoped agent, not for admin/manager", async () => {
  const { calls, query } = recorder();
  const server = await loadAdminDataServerWithInjectedQuery(query);

  await server.getAdminTransaction("txn-1", AGENT_ACTOR);
  assert.match(calls[0].text, /agent_id = \$2/);
  assert.deepEqual(calls[0].params, ["txn-1", "agent-1"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/neon/admin-transactions.contract.test.mjs`
Expected: FAIL — `listAdminTransactions`/`saveAdminTransaction`/`getAdminTransaction` are not exported from `admin-data.server.ts` yet.

- [ ] **Step 3: Implement the three functions**

Add to `src/lib/neon/admin-data.server.ts`, right after `deleteAdminProperty` (after line 1167, before `fetchAdminAgents`):

```typescript
export async function listAdminTransactions(
  input: AdminTransactionFiltersInput = {},
  actor?: StaffAccess,
): Promise<AdminTransactionRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];

  const scope = actor ? agentScope(actor) : null;
  if (scope !== null) {
    where.push(`t.agent_id = ${addParam(params, scope)}`);
  }

  if (input.q?.trim()) {
    where.push(`e.name_zh ILIKE ${addParam(params, `%${input.q.trim()}%`)}`);
  }
  if (input.deal_type && input.deal_type !== "all") {
    where.push(`t.deal_type = ${addParam(params, input.deal_type)}::deal_type`);
  }
  if (input.estate_id && input.estate_id !== "all") {
    where.push(`t.estate_id = ${addParam(params, input.estate_id)}`);
  }
  if (input.verification_state && input.verification_state !== "all") {
    where.push(
      `t.verification_state = ${addParam(params, input.verification_state)}::transaction_verification_state`,
    );
  }

  const rows = await queryRows(
    `
    SELECT
      t.id, t.estate_id, t.deal_type, t.price, t.saleable_area, t.saleable_psf,
      t.deal_date, t.unit, t.block, t.floor_band, t.source, t.source_url,
      t.verification_state, t.published, t.agent_id,
      e.name_zh AS estate_name_zh,
      s.name_zh AS agent_name_zh,
      s.name_en AS agent_name_en
    FROM transactions t
    LEFT JOIN estates e ON e.id = t.estate_id
    LEFT JOIN staff_users s ON s.id = t.agent_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY t.deal_date DESC NULLS LAST, t.created_at DESC
    LIMIT 200
    `,
    params,
  );
  return rows.map((row) => ({
    id: stringOrEmpty(row.id),
    estate_id: stringOrNull(row.estate_id),
    estate_name_zh: stringOrNull(row.estate_name_zh),
    deal_type: stringOrEmpty(row.deal_type),
    price: numberOrNull(row.price),
    saleable_area: numberOrNull(row.saleable_area),
    saleable_psf: numberOrNull(row.saleable_psf),
    deal_date: dateOrNull(row.deal_date),
    unit: stringOrNull(row.unit),
    block: stringOrNull(row.block),
    floor_band: stringOrNull(row.floor_band),
    source: stringOrNull(row.source),
    source_url: stringOrNull(row.source_url),
    verification_state: stringOrEmpty(row.verification_state),
    published: booleanOrFalse(row.published),
    agent_id: stringOrNull(row.agent_id),
    agent_name: stringOrNull(row.agent_name_zh) ?? stringOrNull(row.agent_name_en),
  }));
}

export async function getAdminTransaction(
  id: string,
  actor?: StaffAccess,
): Promise<AdminTransactionRow | null> {
  const scope = actor ? agentScope(actor) : null;
  const rows = await queryRows(
    `
    SELECT
      t.id, t.estate_id, t.deal_type, t.price, t.saleable_area, t.saleable_psf,
      t.deal_date, t.unit, t.block, t.floor_band, t.source, t.source_url,
      t.verification_state, t.published, t.agent_id,
      e.name_zh AS estate_name_zh,
      s.name_zh AS agent_name_zh,
      s.name_en AS agent_name_en
    FROM transactions t
    LEFT JOIN estates e ON e.id = t.estate_id
    LEFT JOIN staff_users s ON s.id = t.agent_id
    WHERE t.id = $1${scope !== null ? " AND t.agent_id = $2" : ""}
    LIMIT 1
    `,
    scope !== null ? [id, scope] : [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: stringOrEmpty(row.id),
    estate_id: stringOrNull(row.estate_id),
    estate_name_zh: stringOrNull(row.estate_name_zh),
    deal_type: stringOrEmpty(row.deal_type),
    price: numberOrNull(row.price),
    saleable_area: numberOrNull(row.saleable_area),
    saleable_psf: numberOrNull(row.saleable_psf),
    deal_date: dateOrNull(row.deal_date),
    unit: stringOrNull(row.unit),
    block: stringOrNull(row.block),
    floor_band: stringOrNull(row.floor_band),
    source: stringOrNull(row.source),
    source_url: stringOrNull(row.source_url),
    verification_state: stringOrEmpty(row.verification_state),
    published: booleanOrFalse(row.published),
    agent_id: stringOrNull(row.agent_id),
    agent_name: stringOrNull(row.agent_name_zh) ?? stringOrNull(row.agent_name_en),
  };
}

export async function saveAdminTransaction(input: AdminTransactionInput, actor: StaffAccess) {
  const scope = agentScope(actor);
  const saleablePsf =
    input.saleable_area > 0 ? Math.round(input.price / input.saleable_area) : null;
  const verificationState = input.verified ? "verified" : "unverified";
  const published = input.verified;

  // Shared by both branches -- but agent_id is deliberately NOT one of them.
  // Unlike saveAdminProperty, AdminTransactionInput has no agent_id field at
  // all (no form control to assign a transaction to someone else): on
  // INSERT it's set once to whoever is creating it; on UPDATE it must stay
  // untouched, or an admin/manager editing another agent's transaction
  // would silently reassign authorship to themselves.
  const params = [
    input.estate_id,
    input.deal_type,
    input.price,
    input.saleable_area,
    saleablePsf,
    input.deal_date,
    input.unit,
    input.block,
    input.floor_band,
    input.source,
    input.source_url,
    verificationState,
    published,
  ];

  const rows = input.id
    ? await queryRows(
        `
        UPDATE transactions SET
          estate_id = $1,
          deal_type = $2::deal_type,
          price = $3,
          saleable_area = $4,
          saleable_psf = $5,
          deal_date = $6,
          unit = $7,
          block = $8,
          floor_band = $9,
          source = $10,
          source_url = $11,
          verification_state = $12::transaction_verification_state,
          published = $13,
          verified_at = CASE WHEN $13 THEN now() ELSE NULL END
        WHERE id = $14${scope !== null ? " AND agent_id = $15" : ""}
        RETURNING id
        `,
        scope !== null ? [...params, input.id, scope] : [...params, input.id],
      )
    : await queryRows(
        `
        INSERT INTO transactions (
          estate_id, deal_type, price, saleable_area, saleable_psf, deal_date,
          unit, block, floor_band, source, source_url, verification_state,
          published, verified_at, agent_id
        )
        VALUES ($1, $2::deal_type, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::transaction_verification_state, $13, CASE WHEN $13 THEN now() ELSE NULL END, $14)
        RETURNING id
        `,
        [...params, actor.staffId],
      );

  if (input.id && !rows[0]) {
    if (scope !== null) throw new Response("Forbidden", { status: 403 });
    return { id: "", error: "Not found" };
  }
  const id = stringOrEmpty(rows[0]?.id);
  await writeAudit(
    actor.staffId,
    input.id ? "transaction.update" : "transaction.create",
    "transaction",
    id,
  );
  return { id };
}
```

Add the new type imports to the existing `import type { ... } from "./admin-data.types"` block near the top of the file (alongside `AdminListingFiltersInput` etc.):

```typescript
  AdminTransactionFiltersInput,
  AdminTransactionInput,
  AdminTransactionRow,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/neon/admin-transactions.contract.test.mjs`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/neon/admin-data.server.ts src/lib/neon/admin-transactions.contract.test.mjs
git commit -m "feat(admin): add listAdminTransactions/getAdminTransaction/saveAdminTransaction

Mirrors saveAdminProperty's agentScope() row-ownership guard. The
verified checkbox sets verification_state='verified' AND published=true
together, never independently, per the design doc's single-checkbox
decision (docs/superpowers/specs/2026-08-31-admin-transactions-design.md)."
```

---

## Task 3: Server-fn wrappers — `admin-data.ts`

**Files:**
- Modify: `src/lib/neon/admin-data.ts`
- Modify: `src/routes/admin.routes.test.mjs`

- [ ] **Step 1: Add the three wrapper functions**

Add to `src/lib/neon/admin-data.ts`, right after the `updateAdminPropertyStatus` block (after line 1032):

```typescript
const fetchAdminTransactionsFilteredServer = createServerFn({ method: "GET" })
  .inputValidator((data: AdminTransactionFiltersInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.listAdminTransactions(data, staff);
  });

export async function fetchAdminTransactionsFiltered(options: {
  data: AdminTransactionFiltersInput;
}) {
  return callStaffServerFn(async () =>
    fetchAdminTransactionsFilteredServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminTransactionServer = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.getAdminTransaction(data.id, staff);
  });

export async function fetchAdminTransaction(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    fetchAdminTransactionServer(await withStaffAuthHeaders(options)),
  );
}

const saveAdminTransactionServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminTransactionInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminTransaction(data, staff);
  });

export async function saveAdminTransaction(options: { data: AdminTransactionInput }) {
  return callStaffServerFn(async () =>
    saveAdminTransactionServer(await withStaffAuthHeaders(options)),
  );
}
```

Add the three new types to the existing `import type { ... } from "./admin-data.types"` block near the top of the file:

```typescript
  AdminTransactionFiltersInput,
  AdminTransactionInput,
```

(`AdminTransactionRow` isn't needed in this file — it's only consumed by route components, which import it directly from `admin-data.types`.)

- [ ] **Step 2: Update the stale-hash-recovery test's protected-function list**

In `src/routes/admin.routes.test.mjs`, the `protectedFetches` array (line 219-231) checks that every listed admin server function uses `callStaffServerFn`. Add the three new functions:

```javascript
  const protectedFetches = [
    "fetchAdminOverview",
    "fetchAdminListings",
    "fetchAdminEstateOptions",
    "fetchAdminProperty",
    "saveAdminProperty",
    "deleteAdminProperty",
    "fetchAdminCms",
    "fetchAdminLeads",
    "fetchAdminConversations",
    "fetchAdminCampaigns",
    "updateAdminInquiryStatus",
    "fetchAdminTransactionsFiltered",
    "fetchAdminTransaction",
    "saveAdminTransaction",
  ];
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `node --test src/routes/admin.routes.test.mjs`
Expected: PASS — the new functions are already written using `callStaffServerFn` from Step 1, so this should pass immediately (this step is a regression guard, not new-behavior TDD; there's no meaningful "watch it fail first" here since Step 1 already wrote the correct pattern).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/neon/admin-data.ts src/routes/admin.routes.test.mjs
git commit -m "feat(admin): wire fetchAdminTransactionsFiltered/fetchAdminTransaction/saveAdminTransaction server functions"
```

---

## Task 4: Transaction form component

**Files:**
- Create: `src/components/dashboard/TransactionForm.tsx`

- [ ] **Step 1: Write the component**

Mirrors `PropertyForm.tsx`'s pattern (zod schema, local `Field`/`Section` helpers, submit handler, error mapping) at roughly a third of the size — no image uploader, no content copilot, no leave-guard (not in scope per the design doc).

```typescript
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fetchAdminEstateOptions, saveAdminTransaction } from "@/lib/neon/admin-data";
import type { AdminTransactionInput, AdminTransactionRow } from "@/lib/neon/admin-data.types";

// The create route has nothing to pass (undefined); the edit route passes
// the real AdminTransactionRow fetched from the server -- NOT
// AdminTransactionInput, which is the write shape (has `verified: boolean`,
// not `published`/`verification_state`). Typing this as
// `Partial<AdminTransactionInput>` would silently accept the wrong shape,
// since AdminTransactionRow.deal_type is plain `string` (from the DB row
// mapper), not the narrower "sale" | "rent" union -- a real assignability
// error if the two are conflated.
type Transaction = AdminTransactionRow;
type Estate = { id: string; name_zh: string; district_slug: string };

const blankToNull = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
};

const optionalText = z.preprocess(blankToNull, z.string().trim().max(60).nullable());

const schema = z.object({
  estate_id: z.string().uuid("請選擇屋苑"),
  deal_type: z.enum(["sale", "rent"], { message: "請選擇買賣或租賃" }),
  price: z.coerce.number({ invalid_type_error: "請輸入數字" }).positive("請輸入大於 0 的數字"),
  saleable_area: z.coerce
    .number({ invalid_type_error: "請輸入數字" })
    .positive("請輸入大於 0 的數字"),
  deal_date: z.string().trim().min(1, "請輸入成交日期"),
  unit: optionalText,
  block: optionalText,
  floor_band: optionalText,
  source: optionalText,
  source_url: z
    .string()
    .trim()
    .url("請輸入有效連結")
    .max(500)
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  verified: z.boolean(),
});

function createInitialForm(transaction?: Transaction, staffName?: string) {
  return {
    estate_id: transaction?.estate_id ?? "",
    deal_type: (transaction?.deal_type === "rent" ? "rent" : "sale") as "sale" | "rent",
    price: transaction?.price?.toString() ?? "",
    saleable_area: transaction?.saleable_area?.toString() ?? "",
    deal_date: transaction?.deal_date ?? "",
    unit: transaction?.unit ?? "",
    block: transaction?.block ?? "",
    floor_band: transaction?.floor_band ?? "",
    source: transaction?.source ?? staffName ?? "",
    source_url: transaction?.source_url ?? "",
    verified: transaction?.published ?? false,
  };
}

type FormState = ReturnType<typeof createInitialForm>;

function mapTransactionSaveError(error: string): string {
  if (/^not found$/i.test(error.trim())) {
    return "找不到此成交記錄，可能已被刪除或你沒有權限編輯。";
  }
  return `儲存失敗，請稍後再試。（${error}）`;
}

type Props = {
  transaction?: Transaction;
  staffName?: string;
  onSaved: (id: string) => void;
};

export function TransactionForm({ transaction, staffName, onSaved }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [estates, setEstates] = useState<Estate[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(() => createInitialForm(transaction, staffName));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  useEffect(() => {
    fetchAdminEstateOptions()
      .then((data) => setEstates(data as Estate[]))
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
  }, []);

  function focusField(field: string) {
    if (!field) return;
    const control = formRef.current?.elements.namedItem(field);
    if (control instanceof HTMLElement) control.focus();
  }

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((current) => {
      if (!current[k]) return current;
      const next = { ...current };
      delete next[k];
      return next;
    });
  }

  function fieldProps(k: keyof FormState) {
    const error = fieldErrors[k];
    return {
      name: k,
      "aria-invalid": Boolean(error),
      "aria-describedby": error ? `${k}-error` : undefined,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const nextErrors: Partial<Record<keyof FormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && key in form && !nextErrors[key as keyof FormState]) {
          nextErrors[key as keyof FormState] = issue.message;
        }
      }
      setFieldErrors(nextErrors);
      toast.error("請檢查輸入資料");
      focusField(String(parsed.error.issues[0]?.path[0] ?? ""));
      return;
    }

    setFieldErrors({});
    const d = parsed.data;
    const payload: AdminTransactionInput = {
      id: transaction?.id,
      estate_id: d.estate_id,
      deal_type: d.deal_type,
      price: d.price,
      saleable_area: d.saleable_area,
      deal_date: d.deal_date,
      unit: d.unit,
      block: d.block,
      floor_band: d.floor_band,
      source: d.source,
      source_url: d.source_url,
      verified: d.verified,
    };

    setSubmitting(true);
    const result = await saveAdminTransaction({ data: payload }).catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
      id: null,
    }));
    setSubmitting(false);

    if ("error" in result && result.error) {
      toast.error(mapTransactionSaveError(result.error));
      return;
    }
    toast.success(transaction ? "已更新" : "已新增");
    if (result.id) onSaved(result.id);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6" noValidate>
      <Section title="成交資料">
        <Field label="屋苑 *" htmlFor="estate_id" error={fieldErrors.estate_id}>
          <Select value={form.estate_id} onValueChange={(v) => set("estate_id", v)}>
            <SelectTrigger id="estate_id" {...fieldProps("estate_id")}>
              <SelectValue placeholder="請選擇屋苑" />
            </SelectTrigger>
            <SelectContent>
              {estates.map((estate) => (
                <SelectItem key={estate.id} value={estate.id}>
                  {estate.name_zh}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="類型 *" htmlFor="deal_type" error={fieldErrors.deal_type}>
          <Select
            value={form.deal_type}
            onValueChange={(v) => set("deal_type", v as "sale" | "rent")}
          >
            <SelectTrigger id="deal_type" {...fieldProps("deal_type")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sale">買賣</SelectItem>
              <SelectItem value="rent">租賃</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          label={form.deal_type === "rent" ? "月租 *" : "成交價 *"}
          htmlFor="price"
          error={fieldErrors.price}
        >
          <Input
            id="price"
            type="number"
            min="0"
            {...fieldProps("price")}
            value={form.price}
            onChange={(e) => set("price", e.target.value)}
            required
          />
        </Field>
        <Field label="實用面積（呎）*" htmlFor="saleable_area" error={fieldErrors.saleable_area}>
          <Input
            id="saleable_area"
            type="number"
            min="0"
            {...fieldProps("saleable_area")}
            value={form.saleable_area}
            onChange={(e) => set("saleable_area", e.target.value)}
            required
          />
        </Field>
        <Field label="成交日期 *" htmlFor="deal_date" error={fieldErrors.deal_date}>
          <Input
            id="deal_date"
            type="date"
            {...fieldProps("deal_date")}
            value={form.deal_date}
            onChange={(e) => set("deal_date", e.target.value)}
            required
          />
        </Field>
        <Field label="座數" htmlFor="block" error={fieldErrors.block}>
          <Input
            id="block"
            {...fieldProps("block")}
            value={form.block}
            onChange={(e) => set("block", e.target.value)}
            maxLength={60}
          />
        </Field>
        <Field label="單位" htmlFor="unit" error={fieldErrors.unit}>
          <Input
            id="unit"
            {...fieldProps("unit")}
            value={form.unit}
            onChange={(e) => set("unit", e.target.value)}
            maxLength={60}
          />
        </Field>
        <Field label="樓層" htmlFor="floor_band" error={fieldErrors.floor_band}>
          <Input
            id="floor_band"
            {...fieldProps("floor_band")}
            value={form.floor_band}
            onChange={(e) => set("floor_band", e.target.value)}
            maxLength={60}
            placeholder="例：高層 / 中層 / 低層"
          />
        </Field>
        <Field label="來源" htmlFor="source" error={fieldErrors.source}>
          <Input
            id="source"
            {...fieldProps("source")}
            value={form.source}
            onChange={(e) => set("source", e.target.value)}
            maxLength={60}
          />
        </Field>
        <Field label="來源連結" htmlFor="source_url" error={fieldErrors.source_url}>
          <Input
            id="source_url"
            {...fieldProps("source_url")}
            value={form.source_url}
            onChange={(e) => set("source_url", e.target.value)}
            maxLength={500}
          />
        </Field>
        <Field label="已核實並發布" htmlFor="verified" error={fieldErrors.verified}>
          <div className="flex h-10 items-center">
            <Switch
              id="verified"
              {...fieldProps("verified")}
              checked={form.verified}
              onCheckedChange={(v) => set("verified", v)}
            />
          </div>
        </Field>
      </Section>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={submitting}>
          {submitting ? "儲存中…" : transaction ? "更新成交" : "建立成交"}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
  error,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-1.5 block">
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/TransactionForm.tsx
git commit -m "feat(admin): add TransactionForm component"
```

---

## Task 5: List route — `admin.transactions.tsx`

**Files:**
- Create: `src/routes/admin.transactions.tsx`
- Test: `src/routes/admin.transactions.routes.test.mjs` (new)

- [ ] **Step 1: Write the failing test**

Source-scan style, matching this repo's established pattern for route files with no render harness (e.g. `admin.estates.routes.test.mjs`).

Create `src/routes/admin.transactions.routes.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("admin.transactions.tsx lists transactions, links to new/edit, and applies agent scoping server-side", () => {
  const source = read("src/routes/admin.transactions.tsx");
  assert.match(source, /fetchAdminTransactionsFiltered/);
  assert.match(source, /to="\/admin\/transactions\/new"/);
  assert.match(source, /to="\/admin\/transactions\/\$id"/);
});

test("admin.transactions.tsx shows verification/publish status per row", () => {
  const source = read("src/routes/admin.transactions.tsx");
  assert.match(source, /verification_state/);
  assert.match(source, /published/);
});

test("admin.transactions.tsx route is registered with noindex", () => {
  const source = read("src/routes/admin.transactions.tsx");
  assert.match(source, /content: "noindex"/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/routes/admin.transactions.routes.test.mjs`
Expected: FAIL — `src/routes/admin.transactions.tsx` doesn't exist yet.

- [ ] **Step 3: Write the route**

Create `src/routes/admin.transactions.tsx`:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Pencil, Plus } from "lucide-react";

import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { fetchAdminEstateOptions, fetchAdminTransactionsFiltered } from "@/lib/neon/admin-data";
import type { AdminTransactionFiltersInput, AdminTransactionRow } from "@/lib/neon/admin-data.types";

type Estate = { id: string; name_zh: string; district_slug: string };
type TransactionFilters = {
  q: string;
  deal_type: "all" | "sale" | "rent";
  estate_id: string;
  verification_state: "all" | "unverified" | "pending" | "verified";
};

const defaultFilters: TransactionFilters = {
  q: "",
  deal_type: "all",
  estate_id: "all",
  verification_state: "all",
};

const verificationLabels: Record<string, string> = {
  unverified: "未核實",
  pending: "審核中",
  verified: "已核實",
};

export const Route = createFileRoute("/admin/transactions")({
  head: () => ({
    meta: [{ title: "成交管理｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminTransactions,
});

function AdminTransactions() {
  const { user } = useNeonAuth();
  const [rows, setRows] = useState<AdminTransactionRow[] | null>(null);
  const [estates, setEstates] = useState<Estate[]>([]);
  const [filters, setFilters] = useState<TransactionFilters>(defaultFilters);
  const [error, setError] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const requestIdRef = useRef(0);

  const refreshTransactions = useCallback(async () => {
    if (!user) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoadingRows(true);
    try {
      const data = await fetchAdminTransactionsFiltered({
        data: filters as AdminTransactionFiltersInput,
      });
      if (requestId !== requestIdRef.current) return;
      setRows(data as AdminTransactionRow[]);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestId === requestIdRef.current) setLoadingRows(false);
    }
  }, [filters, user]);

  useEffect(() => {
    if (!user) return;
    fetchAdminEstateOptions()
      .then((data) => setEstates(data as Estate[]))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [user]);

  useEffect(() => {
    refreshTransactions();
  }, [refreshTransactions]);

  return (
    <AdminShell title="成交管理" description="登記、核實及發布晉誠地產自己促成的成交記錄。">
      <AdminToolbar
        filters={
          <>
            <Input
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="搜尋屋苑"
              aria-label="搜尋成交"
              className="h-11 w-full sm:w-56 lg:h-9"
            />
            <Select
              value={filters.deal_type}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, deal_type: v as TransactionFilters["deal_type"] }))
              }
            >
              <SelectTrigger className="h-11 w-[7rem] lg:h-9" aria-label="類型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部類型</SelectItem>
                <SelectItem value="sale">買賣</SelectItem>
                <SelectItem value="rent">租賃</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.estate_id}
              onValueChange={(v) => setFilters((f) => ({ ...f, estate_id: v }))}
            >
              <SelectTrigger className="h-11 w-[10rem] lg:h-9" aria-label="屋苑">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部屋苑</SelectItem>
                {estates.map((estate) => (
                  <SelectItem key={estate.id} value={estate.id}>
                    {estate.name_zh}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.verification_state}
              onValueChange={(v) =>
                setFilters((f) => ({
                  ...f,
                  verification_state: v as TransactionFilters["verification_state"],
                }))
              }
            >
              <SelectTrigger className="h-11 w-[8rem] lg:h-9" aria-label="狀態">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部狀態</SelectItem>
                <SelectItem value="unverified">未核實</SelectItem>
                <SelectItem value="pending">審核中</SelectItem>
                <SelectItem value="verified">已核實</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        actions={
          <Button asChild size="sm" className="h-11 lg:h-9">
            <Link to="/admin/transactions/new">
              <Plus className="mr-2 h-4 w-4" />
              新增成交
            </Link>
          </Button>
        }
      />

      {error ? <AdminError message={error} /> : null}
      {loadingRows && !rows ? <Skeleton className="h-72 w-full" /> : null}
      {rows && rows.length === 0 ? (
        <AdminEmptyState
          title="未有符合條件的成交記錄"
          description="調整篩選或新增一筆成交。"
          action={
            <Button asChild>
              <Link to="/admin/transactions/new">新增成交</Link>
            </Button>
          }
        />
      ) : null}
      {rows && rows.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[840px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>屋苑</TableHead>
                    <TableHead>類型</TableHead>
                    <TableHead className="text-right">價錢</TableHead>
                    <TableHead>成交日</TableHead>
                    <TableHead>負責人</TableHead>
                    <TableHead>狀態</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell className="max-w-[11rem] truncate">
                        {transaction.estate_name_zh ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={transaction.deal_type === "rent" ? "secondary" : "default"}>
                          {transaction.deal_type === "rent" ? "租" : "售"}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {transaction.price ? `$${Number(transaction.price).toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell>{transaction.deal_date ?? "—"}</TableCell>
                      <TableCell className="max-w-[10rem] truncate">
                        {transaction.agent_name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={transaction.published ? "default" : "outline"}>
                          {transaction.published
                            ? "已發布"
                            : (verificationLabels[transaction.verification_state] ??
                              transaction.verification_state)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button asChild variant="outline" size="sm" className="h-11 px-2 lg:h-8">
                            <Link to="/admin/transactions/$id" params={{ id: transaction.id }}>
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                              編輯
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </AdminShell>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/routes/admin.transactions.routes.test.mjs`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin.transactions.tsx src/routes/admin.transactions.routes.test.mjs
git commit -m "feat(admin): add /admin/transactions list route"
```

---

## Task 6: New/edit routes

**Files:**
- Create: `src/routes/admin.transactions_.new.tsx`
- Create: `src/routes/admin.transactions_.$id.tsx`
- Test: `src/routes/admin.transactions.routes.test.mjs` (extend from Task 5)

- [ ] **Step 1: Write the failing tests**

Add to `src/routes/admin.transactions.routes.test.mjs` (append, don't replace the Task 5 tests):

```javascript
test("admin.transactions_.new.tsx renders TransactionForm and navigates back to the list on save", () => {
  const source = read("src/routes/admin.transactions_.new.tsx");
  assert.match(source, /<TransactionForm/);
  assert.match(source, /to: "\/admin\/transactions"/);
});

test("admin.transactions_.$id.tsx fetches the transaction, shows a not-found state, and renders TransactionForm", () => {
  const source = read("src/routes/admin.transactions_.$id.tsx");
  assert.match(source, /fetchAdminTransaction/);
  assert.match(source, /<TransactionForm/);
  assert.match(source, /找不到此成交記錄|無權限編輯/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/routes/admin.transactions.routes.test.mjs`
Expected: the 2 new tests FAIL — neither route file exists yet.

- [ ] **Step 3: Write the new-transaction route**

Create `src/routes/admin.transactions_.new.tsx`:

```typescript
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { TransactionForm } from "@/components/dashboard/TransactionForm";
import { Button } from "@/components/ui/button";
import { useNeonAuth } from "@/hooks/use-neon-auth";

export const Route = createFileRoute("/admin/transactions_/new")({
  head: () => ({
    meta: [{ title: "新增成交｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: NewAdminTransactionPage,
});

function NewAdminTransactionPage() {
  const navigate = useNavigate();
  const { user } = useNeonAuth();

  return (
    <AdminShell
      title="新增成交"
      description="登記一筆晉誠地產自己促成的成交。"
      breadcrumb={
        <nav aria-label="麵包屑">
          <Link to="/admin" className="hover:underline">
            後台
          </Link>
          {" › "}
          <Link to="/admin/transactions" className="hover:underline">
            成交管理
          </Link>
          {" › 新增"}
        </nav>
      }
    >
      <div className="max-w-2xl">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/transactions">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Link>
        </Button>
        <TransactionForm
          staffName={user?.name ?? undefined}
          onSaved={() => navigate({ to: "/admin/transactions" })}
        />
      </div>
    </AdminShell>
  );
}
```

- [ ] **Step 4: Write the edit route**

Create `src/routes/admin.transactions_.$id.tsx`:

```typescript
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin/AdminShell";
import { TransactionForm } from "@/components/dashboard/TransactionForm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { fetchAdminTransaction } from "@/lib/neon/admin-data";
import type { AdminTransactionRow } from "@/lib/neon/admin-data.types";

export const Route = createFileRoute("/admin/transactions_/$id")({
  head: () => ({
    meta: [{ title: "編輯成交｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: EditAdminTransactionPage,
});

function EditAdminTransactionPage() {
  const { id } = Route.useParams();
  const { user, loading } = useNeonAuth();
  const navigate = useNavigate();
  const [transaction, setTransaction] = useState<AdminTransactionRow | null>(null);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setTransaction(null);

    if (loading)
      return () => {
        cancelled = true;
      };
    if (!user) {
      setFetching(false);
      return () => {
        cancelled = true;
      };
    }

    setFetching(true);
    fetchAdminTransaction({ data: { id } })
      .then((data) => {
        if (cancelled) return;
        setTransaction(data as AdminTransactionRow | null);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : String(err));
        setTransaction(null);
      })
      .finally(() => {
        if (cancelled) return;
        setFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, loading, user]);

  return (
    <AdminShell
      title="編輯成交"
      description="更新成交金額、面積、來源及發布狀態。"
      breadcrumb={
        <nav aria-label="麵包屑">
          <Link to="/admin" className="hover:underline">
            後台
          </Link>
          {" › "}
          <Link to="/admin/transactions" className="hover:underline">
            成交管理
          </Link>
          {" › 編輯"}
        </nav>
      }
    >
      <div className="max-w-2xl">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/transactions">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Link>
        </Button>
        {loading || fetching ? <Skeleton className="h-96 w-full" /> : null}
        {!loading && !fetching && !transaction ? (
          <div className="rounded-lg border bg-background p-8 text-center">
            <p className="text-sm text-muted-foreground">找不到此成交記錄或無權限編輯。</p>
            <Button asChild variant="link" className="mt-3">
              <Link to="/admin/transactions">返回成交管理</Link>
            </Button>
          </div>
        ) : null}
        {!loading && !fetching && transaction ? (
          <TransactionForm
            transaction={transaction}
            onSaved={() => navigate({ to: "/admin/transactions" })}
          />
        ) : null}
      </div>
    </AdminShell>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test src/routes/admin.transactions.routes.test.mjs`
Expected: PASS, all 5 tests (3 from Task 5 + 2 new).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. `user?.name` (confirmed in `src/lib/neon/auth.server.ts:219,428` — this is the real Neon Auth session field; `displayName` is not) — if a type error appears here anyway, re-check that field name against the actual `useNeonAuth()` return type before assuming the plan is right.

- [ ] **Step 7: Commit**

```bash
git add src/routes/admin.transactions_.new.tsx src/routes/admin.transactions_.\$id.tsx src/routes/admin.transactions.routes.test.mjs
git commit -m "feat(admin): add /admin/transactions/new and /admin/transactions/:id routes"
```

---

## Task 7: Nav entry

**Files:**
- Modify: `src/components/admin/AdminShell.tsx`
- Test: `src/routes/admin.routes.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `src/routes/admin.routes.test.mjs` (near the existing sidebar-shape tests):

```javascript
test("sidebar includes a 成交管理 entry linking to /admin/transactions", () => {
  const shell = read("src/components/admin/AdminShell.tsx");
  assert.match(shell, /to: "\/admin\/transactions"/);
  assert.match(shell, /label: "成交管理"/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/routes/admin.routes.test.mjs`
Expected: this one test FAILs (the rest of the file's existing tests still pass).

- [ ] **Step 3: Add the nav entry**

In `src/components/admin/AdminShell.tsx`, add `Receipt` to the existing `lucide-react` import (alongside `Building2`, `Home`, etc. at the top of the file), and add the entry to the `Workspace` group right after `樓盤管理` (line 35):

```typescript
      { to: "/admin/listings", label: "樓盤管理", icon: Building2, activeExact: false },
      { to: "/admin/transactions", label: "成交管理", icon: Receipt, activeExact: false },
```

- [ ] **Step 4: Update the existing sidebar-count regression test**

`src/routes/admin.routes.test.mjs`'s "sidebar has no duplicate destinations and is fully grouped" test (around line 941) hardcodes the total destination count:

```javascript
  assert.equal(destinations.length, 11);
```

Adding one nav entry makes this 12. Update it:

```javascript
  assert.equal(destinations.length, 12);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test src/routes/admin.routes.test.mjs`
Expected: PASS, including both the new test from Step 1 and the updated "sidebar has no duplicate destinations and is fully grouped" test.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/components/admin/AdminShell.tsx`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/AdminShell.tsx src/routes/admin.routes.test.mjs
git commit -m "feat(admin): add 成交管理 sidebar nav entry"
```

---

## Task 8: Wire test scripts and final verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the two new test files to `test:transactions`**

In `package.json`, find the existing `test:transactions` script:

```json
"test:transactions": "node --test src/lib/neon/transaction-search.contract.test.mjs src/routes/transactions.contract.test.mjs",
```

Replace with:

```json
"test:transactions": "node --test src/lib/neon/transaction-search.contract.test.mjs src/routes/transactions.contract.test.mjs src/lib/neon/admin-transactions.contract.test.mjs src/routes/admin.transactions.routes.test.mjs",
```

- [ ] **Step 2: Run the test-wiring guard**

Run: `node --test src/test-wiring.test.mjs`
Expected: PASS — this guard fails if any `.test.mjs` file under `src/` isn't named in some `test:*` script; Step 1 wires both new files in.

- [ ] **Step 3: Run the full transactions test suite**

Run: `npm run test:transactions`
Expected: PASS, all tests across all 4 files.

- [ ] **Step 4: Run the admin-routes test suite**

Run: `node --test src/routes/admin.routes.test.mjs`
Expected: PASS.

- [ ] **Step 5: Full verification sweep**

Run: `npx tsc --noEmit && npm run test:transactions && node --test src/routes/admin.routes.test.mjs && node --test src/test-wiring.test.mjs && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 6: Manual dev-server check**

This sandbox has no live/migrated database (every DB-dependent route 500s locally — confirmed repeatedly across P7/P8 this session). If you have access to an environment with a real, migrated `DATABASE_URL`, verify manually:
1. Start `npm run dev`, sign in as a staff member.
2. Visit `/admin/transactions` — empty state renders.
3. Click "新增成交", fill the form, leave "已核實並發布" unchecked, save — redirects to the list, new row shows "未核實".
4. Click "編輯" on that row, check "已核實並發布", save — row now shows "已發布".
5. Visit the public `/transactions` page — the row now appears (this is the actual fix: confirms the existing public query, unmodified, now has a real row to show).

If no such environment is available in this session, state that explicitly rather than claiming this step was done.

- [ ] **Step 7: Commit**

```bash
git add package.json
git commit -m "test: wire admin-transactions.contract.test.mjs and admin.transactions.routes.test.mjs into test:transactions"
```

---

## Final PR

Push the branch and open a PR against `main`, following this session's established pattern (see any prior PR this repo's history for the exact style): title referencing the design doc, summary of what was built, explicit note on the manual-verification gap (Task 8 Step 6) since this sandbox cannot exercise a live DB, and the full verification sweep's results.
