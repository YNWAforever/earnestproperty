# P6c1 — admin.transactions (draft → verify → publish → correct)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A brand-new admin surface for managing `transactions` rows end-to-end: create/edit as a draft, verify (approve), publish (go live), and correct (editing a published row pulls it back to review — it never silently changes public-facing data). No content-copilot/social-card work here — that's P6c2.

**Base branch:** This branches from `feat/frontend-revamp-p6b-cms-revision-wiring` (not `main`, not P6a), because it reuses `admin-cms.ts`'s pattern of wrapping every client export in `unwrapServerFnResponse` from the start — a bug P6b found and fixed after the fact. Building fresh on top of that lesson instead of repeating the mistake. This PR does not depend on P6a's changes; the two new permissions added here are additive edits to `permissions.ts` that will merge independently of P6a's `viewer`-role changes.

**Architecture:** New `.ts`/`.server.ts`/`.types.ts` triad (`src/lib/neon/admin-transactions*`) following this repo's established two-file DB boundary. Three new route files (`admin.transactions.tsx` list, `admin.transactions_.$id.tsx` detail/edit, `admin.transactions_.new.tsx` create) following the exact pattern already established by `admin.agents.tsx`/`admin.agents_.$id.tsx`/`admin.agents_.new.tsx`. No schema migration needed — every column this phase touches (`source`, `source_url`, `verification_state`, `verified_at`, `agent_id`, `published`, `block`, `floor_band`) already exists from P5's `20260830140000_transaction_provenance.sql`.

---

## 0. Design decisions

1. **Two new granular permissions**, not a reuse of `cms.publish`: `transaction.verify` and `transaction.publish`, both granted to `manager`/`admin` only (same effective grant as `cms.publish` today, but named for what they actually gate — this is exactly the kind of extension P6a's permission-map refactor was meant to make cheap). Creating/editing a draft needs no special permission beyond ordinary staff access (`admin`/`manager`/`agent` — not `viewer`), mirroring the CMS revision engine's `ALL_CMS_ROLES`.
2. **"Correct" is not a separate button — it's what editing an already-verified row does automatically.** If `saveAdminTransaction` is called against a row whose current `verification_state` is `'verified'`, the save resets it to `'pending'` and clears `verified_at`. The public queries already gate on `verification_state = 'verified'`, so this alone removes the row from public view the instant it's edited — no need to separately touch `published`. This is the "correct" stage: editing live data always demotes it back to review, never silently changes what the public sees.
3. **Publish requires verification first, enforced server-side.** `publishAdminTransaction` checks `verification_state = 'verified'` before setting `published = true`; if not verified, it returns a typed `{ ok: false, code: "TRANSACTION_NOT_VERIFIED" }` result (same convention as the CMS revision engine's `{ ok: false, code }` shape) rather than silently publishing an unverified row.
4. **PSF is a real, separately-tracked field, not a derived column — validate it against price/area, don't silently override it.** `saleable_psf` is a stored column read directly by public queries. `saveAdminTransaction` rejects a submitted `saleable_psf` that differs from `round(price / saleable_area)` by more than 5%, with a clear error naming both the submitted and expected value. This catches fat-finger errors without pretending the field is purely computed.
5. **Bulk import creates unverified drafts only — it never bypasses the verify/publish gate.** Matches the "don't fabricate, gate on real verification" precedent from P2/P5: imported rows are exactly as invisible to the public as a hand-entered draft until a human verifies and publishes them.
6. **Reuse existing estate/agent option-fetchers.** `fetchAdminEstateOptions()` and `fetchAdminAgents()` (both in `src/lib/neon/admin-data.ts`, already used by `PropertyForm.tsx`) are the estate/agent pickers — no new option-list endpoint needed.
7. **No client-side permission-hiding for verify/publish buttons** (same call as P6b's estate/article dialogs): the buttons are always visible to any staff member who can reach the page; the server enforces the real boundary and `callTransactions()` (this plan's equivalent of P6b's `callCms()`) surfaces a clear zh-HK message on a 403.

---

## Task 1: Data layer — types, server functions, permissions

**Files:**
- Create: `src/lib/neon/admin-transactions.types.ts`
- Create: `src/lib/neon/admin-transactions.server.ts`
- Create: `src/lib/neon/admin-transactions.ts`
- Create: `src/lib/neon/admin-transactions.contract.test.mjs`
- Modify: `src/lib/control-plane/permissions.ts`

- [ ] **Step 1: Define the types**

`src/lib/neon/admin-transactions.types.ts`:

```typescript
export type AdminTransactionVerificationState = "unverified" | "pending" | "verified";

export type AdminTransactionInput = {
  id?: string;
  estate_id: string;
  unit: string | null;
  deal_type: "sale" | "rent";
  price: number;
  saleable_area: number;
  saleable_psf: number;
  deal_date: string;
  block: string | null;
  floor_band: string | null;
  source: string | null;
  source_url: string | null;
  agent_id: string | null;
};

export type AdminTransactionRow = AdminTransactionInput & {
  id: string;
  estate_name_zh: string;
  verification_state: AdminTransactionVerificationState;
  verified_at: string | null;
  published: boolean;
  created_at: string;
};

export type AdminTransactionListFilters = {
  estateId?: string;
  verificationState?: AdminTransactionVerificationState;
  published?: boolean;
  cursor?: string;
  limit?: number;
};

export type AdminTransactionListResult = {
  rows: AdminTransactionRow[];
  nextCursor: string | null;
};

export type AdminTransactionImportRow = AdminTransactionInput;

export type AdminTransactionImportResult = {
  imported: number;
  total: number;
  failure: { position: number; message: string } | null;
};
```

- [ ] **Step 2: Write the failing test for PSF/date validation**

Create `src/lib/neon/admin-transactions.contract.test.mjs`:

```javascript
import assert from "node:assert/strict";
import test from "node:test";

import { createAdminTransactionsService } from "./admin-transactions.server.ts";

const actor = { staffId: "11111111-1111-4111-8111-111111111111", roles: ["admin"] };

function fixture() {
  const queries = [];
  const service = createAdminTransactionsService({
    queryRows: async (statement, params = []) => {
      queries.push({ statement, params });
      if (statement.includes("SELECT verification_state")) {
        return [{ verification_state: "unverified" }];
      }
      return [{ id: "22222222-2222-4222-8222-222222222222" }];
    },
    writeAudit: async () => {},
  });
  return { service, queries };
}

test("saveAdminTransaction rejects a PSF more than 5% off price/area", async () => {
  const { service } = fixture();
  await assert.rejects(
    () =>
      service.saveAdminTransaction(
        {
          estate_id: "33333333-3333-4333-8333-333333333333",
          unit: null,
          deal_type: "sale",
          price: 6_000_000,
          saleable_area: 617,
          saleable_psf: 5_000, // real value is ~9724
          deal_date: "2026-07-22",
          block: null,
          floor_band: null,
          source: null,
          source_url: null,
          agent_id: null,
        },
        actor,
      ),
    /實呎.*不符|PSF/,
  );
});

test("saveAdminTransaction rejects a future deal_date", async () => {
  const { service } = fixture();
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await assert.rejects(
    () =>
      service.saveAdminTransaction(
        {
          estate_id: "33333333-3333-4333-8333-333333333333",
          unit: null,
          deal_type: "sale",
          price: 6_000_000,
          saleable_area: 617,
          saleable_psf: 9724,
          deal_date: future,
          block: null,
          floor_band: null,
          source: null,
          source_url: null,
          agent_id: null,
        },
        actor,
      ),
    /日期|date/,
  );
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test src/lib/neon/admin-transactions.contract.test.mjs`
Expected: FAIL (module doesn't exist yet).

- [ ] **Step 4: Implement `admin-transactions.server.ts`**

```typescript
import "@tanstack/react-start/server-only";

import { queryRows as defaultQueryRows, stringOrEmpty, stringOrNull, numberOrNull, dateOrNull } from "./db.server";
import { writeAudit as defaultWriteAudit } from "./admin-data.server";
import type {
  AdminTransactionImportResult,
  AdminTransactionInput,
  AdminTransactionListFilters,
  AdminTransactionListResult,
  AdminTransactionRow,
} from "./admin-transactions.types";
import type { StaffAccess } from "./auth.server.ts";

type Dependencies = {
  queryRows?: typeof defaultQueryRows;
  writeAudit?: typeof defaultWriteAudit;
};

function validateTransactionInput(input: AdminTransactionInput) {
  if (!input.estate_id) throw new Error("請選擇屋苑");
  if (!(input.price > 0)) throw new Error("成交價必須大於零");
  if (!(input.saleable_area > 0)) throw new Error("實用面積必須大於零");
  const expectedPsf = input.price / input.saleable_area;
  const deviation = Math.abs(input.saleable_psf - expectedPsf) / expectedPsf;
  if (deviation > 0.05) {
    throw new Error(
      `實呎叫價 $${input.saleable_psf} 與成交價/面積計算值 $${Math.round(expectedPsf)} 不符（超過 5%），請確認`,
    );
  }
  const dealDate = new Date(input.deal_date);
  if (Number.isNaN(dealDate.getTime())) throw new Error("成交日期格式錯誤");
  if (dealDate.getTime() > Date.now()) throw new Error("成交日期不能是未來日期");
}

export function createAdminTransactionsService(dependencies: Dependencies = {}) {
  const queryRows = dependencies.queryRows ?? defaultQueryRows;
  const writeAudit = dependencies.writeAudit ?? defaultWriteAudit;

  async function listAdminTransactions(
    filters: AdminTransactionListFilters,
  ): Promise<AdminTransactionListResult> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.estateId) {
      params.push(filters.estateId);
      conditions.push(`t.estate_id = $${params.length}`);
    }
    if (filters.verificationState) {
      params.push(filters.verificationState);
      conditions.push(`t.verification_state = $${params.length}::transaction_verification_state`);
    }
    if (filters.published !== undefined) {
      params.push(filters.published);
      conditions.push(`t.published = $${params.length}`);
    }
    const limit = Math.min(Math.max(filters.limit ?? 40, 1), 100);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await queryRows(
      `SELECT t.*, e.name_zh AS estate_name_zh
       FROM transactions t
       JOIN estates e ON e.id = t.estate_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT ${limit + 1}`,
      params,
    );
    const hasMore = rows.length > limit;
    return {
      rows: rows.slice(0, limit).map(mapTransactionRow),
      nextCursor: hasMore ? rows[limit - 1]?.id ?? null : null,
    };
  }

  async function getAdminTransaction(id: string): Promise<AdminTransactionRow | null> {
    const rows = await queryRows(
      `SELECT t.*, e.name_zh AS estate_name_zh FROM transactions t
       JOIN estates e ON e.id = t.estate_id WHERE t.id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ? mapTransactionRow(rows[0]) : null;
  }

  async function saveAdminTransaction(input: AdminTransactionInput, actor: StaffAccess) {
    validateTransactionInput(input);

    let resetToPending = false;
    if (input.id) {
      const current = await queryRows("SELECT verification_state FROM transactions WHERE id = $1", [
        input.id,
      ]);
      resetToPending = current[0]?.verification_state === "verified";
    }

    const rows = await queryRows(
      `INSERT INTO transactions
         (id, estate_id, unit, deal_type, price, saleable_area, saleable_psf, deal_date,
          block, floor_band, source, source_url, agent_id
          ${resetToPending ? ", verification_state, verified_at" : ""})
       VALUES
         (COALESCE($1, gen_random_uuid()), $2, $3, $4::deal_type, $5, $6, $7, $8::date,
          $9, $10, $11, $12, $13
          ${resetToPending ? ", 'pending', NULL" : ""})
       ON CONFLICT (id) DO UPDATE SET
         estate_id = EXCLUDED.estate_id, unit = EXCLUDED.unit, deal_type = EXCLUDED.deal_type,
         price = EXCLUDED.price, saleable_area = EXCLUDED.saleable_area,
         saleable_psf = EXCLUDED.saleable_psf, deal_date = EXCLUDED.deal_date,
         block = EXCLUDED.block, floor_band = EXCLUDED.floor_band,
         source = EXCLUDED.source, source_url = EXCLUDED.source_url, agent_id = EXCLUDED.agent_id
         ${resetToPending ? ", verification_state = 'pending', verified_at = NULL" : ""}
       RETURNING id`,
      [
        input.id ?? null,
        input.estate_id,
        input.unit,
        input.deal_type,
        input.price,
        input.saleable_area,
        input.saleable_psf,
        input.deal_date,
        input.block,
        input.floor_band,
        input.source,
        input.source_url,
        input.agent_id,
      ],
    );
    const id = stringOrEmpty(rows[0]?.id);
    await writeAudit(
      actor.staffId,
      !input.id ? "transaction.create" : resetToPending ? "transaction.correct" : "transaction.update",
      "transaction",
      id,
    );
    return { id };
  }

  async function verifyAdminTransaction(id: string, actor: StaffAccess) {
    await queryRows(
      "UPDATE transactions SET verification_state = 'verified', verified_at = now() WHERE id = $1",
      [id],
    );
    await writeAudit(actor.staffId, "transaction.verify", "transaction", id);
    return { ok: true as const };
  }

  async function publishAdminTransaction(id: string, actor: StaffAccess) {
    const rows = await queryRows("SELECT verification_state FROM transactions WHERE id = $1", [id]);
    if (rows[0]?.verification_state !== "verified") {
      return { ok: false as const, code: "TRANSACTION_NOT_VERIFIED" as const };
    }
    await queryRows("UPDATE transactions SET published = true WHERE id = $1", [id]);
    await writeAudit(actor.staffId, "transaction.publish", "transaction", id);
    return { ok: true as const };
  }

  async function unpublishAdminTransaction(id: string, actor: StaffAccess) {
    await queryRows("UPDATE transactions SET published = false WHERE id = $1", [id]);
    await writeAudit(actor.staffId, "transaction.unpublish", "transaction", id);
    return { ok: true as const };
  }

  async function importAdminTransactionsDraft(
    rows: AdminTransactionInput[],
    actor: StaffAccess,
  ): Promise<AdminTransactionImportResult> {
    let imported = 0;
    let failure: AdminTransactionImportResult["failure"] = null;
    for (const [index, row] of rows.entries()) {
      try {
        await saveAdminTransaction({ ...row, id: undefined }, actor);
        imported += 1;
      } catch (err) {
        failure = { position: index + 1, message: err instanceof Error ? err.message : "未知錯誤" };
        break;
      }
    }
    return { imported, total: rows.length, failure };
  }

  return {
    listAdminTransactions,
    getAdminTransaction,
    saveAdminTransaction,
    verifyAdminTransaction,
    publishAdminTransaction,
    unpublishAdminTransaction,
    importAdminTransactionsDraft,
  };
}

function mapTransactionRow(row: Record<string, unknown>): AdminTransactionRow {
  return {
    id: stringOrEmpty(row.id),
    estate_id: stringOrEmpty(row.estate_id),
    estate_name_zh: stringOrEmpty(row.estate_name_zh),
    unit: stringOrNull(row.unit),
    deal_type: row.deal_type === "rent" ? "rent" : "sale",
    price: numberOrNull(row.price) ?? 0,
    saleable_area: numberOrNull(row.saleable_area) ?? 0,
    saleable_psf: numberOrNull(row.saleable_psf) ?? 0,
    deal_date: dateOrNull(row.deal_date) ?? "",
    block: stringOrNull(row.block),
    floor_band: stringOrNull(row.floor_band),
    source: stringOrNull(row.source),
    source_url: stringOrNull(row.source_url),
    agent_id: stringOrNull(row.agent_id),
    verification_state:
      row.verification_state === "verified" || row.verification_state === "pending"
        ? row.verification_state
        : "unverified",
    verified_at: dateOrNull(row.verified_at),
    published: row.published === true,
    created_at: dateOrNull(row.created_at) ?? "",
  };
}

// Module-level singleton for the createServerFn wrappers in admin-transactions.ts.
export const {
  listAdminTransactions,
  getAdminTransaction,
  saveAdminTransaction,
  verifyAdminTransaction,
  publishAdminTransaction,
  unpublishAdminTransaction,
  importAdminTransactionsDraft,
} = createAdminTransactionsService();
```

Check `db.server.ts` exports `numberOrNull`/`dateOrNull` under those exact names before using them (grep first) — adjust the import list to whatever this file's real helper names are if they differ.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test src/lib/neon/admin-transactions.contract.test.mjs`
Expected: both PASS.

- [ ] **Step 6: Add the two new permissions**

In `src/lib/control-plane/permissions.ts`, add `"transaction.verify"` and `"transaction.publish"` to `controlPlanePermissions`, and to `manager`'s set in `rolePermissions` (both `admin` and the new `viewer`-aware structure already spread `controlPlanePermissions`/stay untouched, so only `manager`'s explicit array needs the two new strings added).

- [ ] **Step 7: Create the client wrapper module**

`src/lib/neon/admin-transactions.ts` — `createServerFn` wrappers for all 7 functions, each wrapped in `unwrapServerFnResponse` from the start (per this plan's base-branch rationale). `listAdminTransactions`/`getAdminTransaction`/`saveAdminTransaction`/`importAdminTransactionsDraft` gate on `requireStaffAccess(request, ["admin","manager","agent"])`; `verifyAdminTransaction` gates on `requireStaffPermission(request, "transaction.verify")`; `publishAdminTransaction`/`unpublishAdminTransaction` gate on `requireStaffPermission(request, "transaction.publish")`.

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit`

```bash
git add src/lib/neon/admin-transactions.types.ts src/lib/neon/admin-transactions.server.ts src/lib/neon/admin-transactions.ts src/lib/neon/admin-transactions.contract.test.mjs src/lib/control-plane/permissions.ts
git commit -m "feat(admin): add transaction data layer with verify/publish workflow"
```

---

## Task 2: Routes — list, detail/edit, new

**Files:**
- Create: `src/components/admin/transactions/AdminTransactionForm.tsx`
- Create: `src/routes/admin.transactions.tsx`
- Create: `src/routes/admin.transactions_.$id.tsx`
- Create: `src/routes/admin.transactions_.new.tsx`
- Modify: `src/components/admin/AdminShell.tsx`

- [ ] **Step 1: Build `AdminTransactionForm`**, following `AgentProfileForm.tsx`'s structure: fields for estate (Select, options from `fetchAdminEstateOptions()`), deal_type (Select: 買賣/租賃), unit/block/floor_band (TextField), price/saleable_area/saleable_psf (NumberField, with inline helper text showing the computed price/area value next to the PSF field so staff can self-correct before submit), deal_date (date input), source/source_url (TextField), agent (Select, options from `fetchAdminAgents()`, optional/nullable). Client-side mirrors the server's PSF-tolerance and future-date checks for fast feedback, but the server is authoritative.

- [ ] **Step 2: Build the list route** (`admin.transactions.tsx`): filters (estate select, verification-state select, published toggle), table (estate/unit/block/floor, price, area, psf, deal_date, state badge, published badge, 編輯 link to `/admin/transactions/$id`), 新增成交 button linking to `/admin/transactions/new`, 匯入 button opening an import dialog (textarea, one transaction per line, comma-separated in the fixed order `estate_id,unit,deal_type,price,saleable_area,saleable_psf,deal_date,block,floor_band,source,source_url,agent_id` — empty optional fields as consecutive commas — parse client-side, show a preview count, submit via `importAdminTransactionsDraft`).

- [ ] **Step 3: Build the detail/edit route** (`admin.transactions_.$id.tsx`): loads the transaction client-side via a `getAdminTransaction`-style fetch (mirroring `admin.agents_.$id.tsx`'s pattern exactly — loader does a lightweight permission check, entity fetched in a `useEffect`), renders `AdminTransactionForm` pre-filled, plus a status card (verification_state badge, published badge, verified_at) and two action buttons: 核實 (calls `verifyAdminTransaction`, disabled if already verified) and 發布/取消發布 (calls `publishAdminTransaction`/`unpublishAdminTransaction` based on current `published`, disabled if not yet verified — show a tooltip/helper text explaining why when disabled). Both actions go through a `callTransactions()` helper (same shape as P6b's `callCms()`, handling the `{ok:false, code:"TRANSACTION_NOT_VERIFIED"}` result and 401/403 statuses with zh-HK messages).

- [ ] **Step 4: Build the new-transaction route** (`admin.transactions_.new.tsx`): `AdminTransactionForm` with no pre-filled data; on save, navigate to `/admin/transactions/$id` for the newly created row so staff can continue to verify/publish.

- [ ] **Step 5: Register the nav entry**

In `AdminShell.tsx`'s `navGroups`, add to the "Workspace" group (after 樓盤管理): `{ to: "/admin/transactions", label: "成交管理", icon: TrendingUp, activeExact: false }` (import `TrendingUp` from `lucide-react`).

- [ ] **Step 6: Regenerate the route tree**

Run: `npm run build` (or start `npm run dev` briefly and stop it) — this runs the TanStack Start Vite plugin, which regenerates `src/routeTree.gen.ts` to include the three new routes. **Never hand-edit that file.**

- [ ] **Step 7: Typecheck and run the full admin test suites**

Run: `npx tsc --noEmit && npm run test:command-center && npm run lint`

- [ ] **Step 8: Commit**

```bash
git add src/components/admin/transactions/AdminTransactionForm.tsx src/routes/admin.transactions.tsx src/routes/admin.transactions_.$id.tsx src/routes/admin.transactions_.new.tsx src/components/admin/AdminShell.tsx src/routeTree.gen.ts
git commit -m "feat(admin): add transaction list, detail, and new routes with nav entry"
```

---

## Task 3: Test coverage for the new surface

**Files:**
- Modify: `src/routes/admin.routes.test.mjs` (or create `src/routes/admin.transactions.routes.test.mjs`)
- Modify: `package.json`

- [ ] **Step 1: Add route-presence and permission-shape assertions**, following this repo's established regex-on-source-text contract-test convention (see `admin.cms-revision-wiring.contract.test.mjs` for the exact style): confirm all three route files exist and export a `Route`, confirm `admin-transactions.ts` gates verify/publish behind `requireStaffPermission(request, "transaction.verify"|"transaction.publish")`, confirm the nav entry exists in `AdminShell.tsx`.

- [ ] **Step 2: Register a `test:admin-transactions` script** in `package.json` covering `admin-transactions.contract.test.mjs` and the new routes test file.

- [ ] **Step 3: Run the full suite and the test-wiring guard**

Run: `npm run test:admin-transactions && node --test src/test-wiring.test.mjs`

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.transactions.routes.test.mjs package.json
git commit -m "test(admin): cover the new transaction admin surface"
```

---

## Final verification

Run: `npm run test:admin-transactions && npm run test:command-center && npx tsc --noEmit && npm run lint`

## Acceptance

- A staff member can create a transaction (draft), have a manager/admin verify it, publish it (now visible on `/transactions` and the estate page), edit it (it silently reverts to `pending` and disappears from public view), re-verify, and re-publish.
- An `agent` can create/edit drafts but gets a clear, friendly error attempting to verify or publish directly.
- Bulk import creates unverified drafts only — never bypasses the verify/publish gate.
- PSF more than 5% off price/area is rejected with a message naming both values.
- Nothing in P6c2 (content-copilot/social card) is touched here.
