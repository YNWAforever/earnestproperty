# P6c2 — Content Copilot social-copy extension for transactions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Content Copilot (`src/lib/ai/content-copilot.ts` and friends) to generate zh-HK FB/IG social copy for a transaction, plus a text-only preview mockup on the transaction edit page. **No image rendering** — per the confirmed P6c scope decision, a real server-rendered PNG pipeline (satori/@vercel-og-style) is a separate future phase; this ships the AI-generated copy and a styled HTML/CSS preview only.

**Base branch:** `feat/frontend-revamp-p6c1-admin-transactions` (needs the transaction data layer and edit route from P6c1).

**Architecture:** Content Copilot is already fully generic over resource type — `buildSystemPrompt`/`buildUserPrompt` take `request.resourceType`/`action`/`selectedFields`/`context.resource` with no per-type branching in the prompt itself. Extending it is: (1) widen three type unions/schemas in `content-copilot.ts`, (2) add one new resource-fetch branch in `content-copilot-context.server.ts`, (3) add two new columns via migration, (4) wire the existing `AdminContentCopilot` panel into the transaction edit route exactly as `admin.cms.tsx` already does for estate/article, (5) a new preview component.

---

## 0. Design decisions

1. **New columns, not the existing `social_state`.** `transactions.social_state` (added in P5) tracks *whether/how* a verified deal has been used in a social post — a status, not the copy itself. Two new nullable `TEXT` columns, `social_copy_fb`/`social_copy_ig`, hold the actual generated/edited copy.
2. **`assertAccess` in `content-copilot-context.server.ts` needs zero changes.** Its existing rule — privileged (`admin`/`manager`) OR (`resourceType === "listing"` AND actor is `agent`) — already restricts `transaction` to privileged users only, matching estate/article/faq/video today. No special agent carve-out for transactions.
3. **Social copy is saved through the same `saveAdminTransaction` call as everything else**, following the exact pattern `EstateDialog`/`ArticleDialog` already use: Content Copilot's `onApply` merges the accepted patch into the form's local state; the existing "儲存變更" button persists the merged state. This means `saveAdminTransaction` needs a real behavior change (Task 4 below) — otherwise editing only the social copy on an already-verified, published transaction would incorrectly demote it back to `pending` under P6c1's "any edit to a verified row is a correction" rule, silently pulling a live, factually-unchanged transaction off the public site just because someone touched up its Facebook caption.
4. **Only a real change to a *factual* field triggers the pending-demotion.** `saveAdminTransaction` must compare the incoming factual fields (`estate_id`, `unit`, `deal_type`, `price`, `saleable_area`, `saleable_psf`, `deal_date`, `block`, `floor_band`, `source`, `source_url`) against the stored row and only demote when at least one of those actually differs. `agent_id` (an assignment, not a fact about the deal) and the two new social-copy fields never trigger demotion.
5. **The preview is a styled `<div>`, not an image.** A fixed-aspect-ratio card component showing the estate name, deal-type badge, price/area/psf/date, and the accepted FB or IG copy text, with a visible "預覽（非正式發布圖片）" label so nobody mistakes it for a real downloadable asset.

---

## Task 1: Migration — social copy columns

**Files:**
- Create: `neon/migrations/20260831110000_transaction_social_copy.sql`
- Modify: `src/lib/control-plane/migration-versions.js`

- [ ] **Step 1: Write the migration**

```sql
-- Content Copilot's new "social" action generates FB/IG zh-HK copy for a
-- transaction (see P6c2 plan). transactions.social_state (P5) tracks
-- whether/how a verified deal has been used in a social post -- a status,
-- not the copy itself. These two nullable columns hold the actual text.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS social_copy_fb TEXT,
  ADD COLUMN IF NOT EXISTS social_copy_ig TEXT;
```

- [ ] **Step 2: Register it in the manifest**, add `"20260831110000_transaction_social_copy.sql"` to `MIGRATION_VERSIONS` in `migration-versions.js`, after the last entry.

- [ ] **Step 3: Run the migration-manifest tests**

Run: `node --test src/lib/control-plane/migration-versions.test.mjs scripts/neon/check-migration-drift.test.mjs`

- [ ] **Step 4: Commit**

```bash
git add neon/migrations/20260831110000_transaction_social_copy.sql src/lib/control-plane/migration-versions.js
git commit -m "feat(admin): add transaction social copy columns (unapplied)"
```

**This migration is not applied to production in this phase** — same practice as every prior phase.

---

## Task 2: Widen Content Copilot's type unions and schemas

**Files:**
- Modify: `src/lib/ai/content-copilot.ts`
- Modify: `src/lib/ai/content-copilot.contract.test.mjs` (or wherever the existing resource/action lists are asserted — check first)

- [ ] **Step 1: Add `transaction` and `social`**

```typescript
export const CONTENT_COPILOT_RESOURCE_FIELDS = {
  estate: ["name_zh", "name_en", "description", "seo_title", "seo_description"],
  article: ["title", "excerpt", "content", "seo_title", "seo_description"],
  faq: ["question", "answer"],
  video: ["title", "description"],
  listing: ["title_zh", "title_en", "description", "features", "seo_title", "seo_description"],
  transaction: ["social_copy_fb", "social_copy_ig"],
} as const;

export type ContentCopilotAction =
  | "generate"
  | "improve"
  | "shorten"
  | "translate"
  | "seo_optimize"
  | "fact_check"
  | "social";
```

And the two Zod enums:

```typescript
const resourceTypeSchema = z.enum(["estate", "article", "faq", "video", "listing", "transaction"]);
const actionSchema = z.enum([
  "generate",
  "improve",
  "shorten",
  "translate",
  "seo_optimize",
  "fact_check",
  "social",
]);
```

Nothing else in this file needs to change — `patchSchema`, `proposalSchema`, `contentCopilotRequestSchema`'s `superRefine`, `allowedContentCopilotFields`, and `buildContentFingerprint` are all already generic over resource type.

- [ ] **Step 2: Grep for any other hardcoded resource/action list**

Run: `grep -rn '"estate", "article", "faq", "video", "listing"' src/` and `grep -rn '"generate", "improve", "shorten", "translate", "seo_optimize", "fact_check"' src/` — update any other literal copy of these lists you find (e.g. a contract test asserting the exact array) the same way, preserving each test's original intent.

- [ ] **Step 3: Typecheck and run the content-copilot suite**

Run: `npx tsc --noEmit && npm run test:content-copilot`

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/content-copilot.ts <any test files touched in Step 2>
git commit -m "feat(admin): add transaction resource type and social action to Content Copilot"
```

---

## Task 3: Fetch transaction context for generation

**Files:**
- Modify: `src/lib/ai/content-copilot-context.server.ts`

- [ ] **Step 1: Add a `fetchResource` branch**

Add before the final `properties`-joined fallback branch (which handles `listing`):

```typescript
if (request.resourceType === "transaction") {
  return first(
    queryRows(
      `SELECT t.id, t.social_copy_fb, t.social_copy_ig, t.deal_type, t.price,
        t.saleable_area, t.saleable_psf, t.deal_date, t.unit, t.block,
        t.floor_band, t.created_at, e.name_zh AS estate_name_zh
       FROM transactions t
       JOIN estates e ON e.id = t.estate_id
       WHERE t.id = $1
       LIMIT 1`,
      [request.resourceId],
    ),
  );
}
```

- [ ] **Step 2: Add a `mapResource` branch**

Add an `else if (type === "transaction")` before the final `else` (the `listing` fallback):

```typescript
} else if (type === "transaction") {
  Object.assign(
    resource,
    pick(row, [
      "deal_type",
      "price",
      "saleable_area",
      "saleable_psf",
      "deal_date",
      "unit",
      "block",
      "floor_band",
      "estate_name_zh",
      "created_at",
    ]),
  );
}
```

- [ ] **Step 3: Extend `buildSearchQuery`**

Add `resource.estate_name_zh` is already covered by the existing line (`resource.estate_name_zh` is already in the `values` array) — no change needed there; verify by reading the function before assuming.

- [ ] **Step 4: Write a test**

Add to whichever test file already covers `content-copilot-context.server.ts` (check `content-copilot-repository.contract.test.mjs`/`content-copilot-service.test.mjs` first for the right home) a case proving `fetchResource`/`mapResource` handle `resourceType: "transaction"` and that `assertAccess` still rejects an `agent` actor for it (privileged-only, same as estate/article).

- [ ] **Step 5: Typecheck and run the content-copilot suite**

Run: `npx tsc --noEmit && npm run test:content-copilot`

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/content-copilot-context.server.ts <test file touched>
git commit -m "feat(admin): fetch transaction context for Content Copilot generation"
```

---

## Task 4: Persist social copy + refine the verification-demotion rule

**Files:**
- Modify: `src/lib/neon/admin-transactions.types.ts`
- Modify: `src/lib/neon/admin-transactions.server.ts`
- Modify: `src/lib/neon/admin-transactions.contract.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `admin-transactions.contract.test.mjs`:

```javascript
test("saving only social copy on an already-verified transaction does NOT demote it to pending", async () => {
  const { service, queries } = fixture({
    queryRows: async (statement) => {
      if (statement.includes("SELECT * FROM transactions WHERE id")) {
        return [{ ...validInput, id: "44444444-4444-4444-8444-444444444444", verification_state: "verified" }];
      }
      return [{ id: "44444444-4444-4444-8444-444444444444" }];
    },
  });
  await service.saveAdminTransaction(
    {
      ...validInput,
      id: "44444444-4444-4444-8444-444444444444",
      social_copy_fb: "新增嘅 FB 文案",
      social_copy_ig: null,
    },
    actor,
  );
  const insertQuery = queries.find((q) => q.statement.includes("INSERT INTO transactions"));
  assert.doesNotMatch(insertQuery.statement, /'pending'/);
});

test("changing price on an already-verified transaction still demotes it to pending", async () => {
  const { service, queries } = fixture({
    queryRows: async (statement) => {
      if (statement.includes("SELECT * FROM transactions WHERE id")) {
        return [{ ...validInput, id: "44444444-4444-4444-8444-444444444444", verification_state: "verified" }];
      }
      return [{ id: "44444444-4444-4444-8444-444444444444" }];
    },
  });
  await service.saveAdminTransaction(
    { ...validInput, id: "44444444-4444-4444-8444-444444444444", price: 6_500_000, saleable_psf: 10_534 },
    actor,
  );
  const insertQuery = queries.find((q) => q.statement.includes("INSERT INTO transactions"));
  assert.match(insertQuery.statement, /'pending'/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/neon/admin-transactions.contract.test.mjs`
Expected: FAIL (the current query is `SELECT verification_state FROM transactions WHERE id = $1`, not `SELECT * FROM transactions WHERE id`, and there's no factual-change comparison at all — every edit of a verified row demotes it today).

- [ ] **Step 3: Add the two fields to the types**

In `admin-transactions.types.ts`, add to `AdminTransactionInput`: `social_copy_fb: string | null; social_copy_ig: string | null;`. `AdminTransactionRow` already inherits this via `AdminTransactionInput &`.

- [ ] **Step 4: Rewrite `saveAdminTransaction`'s demotion check**

Replace the `SELECT verification_state` lookup with a full-row fetch, and compare the factual fields:

```typescript
const FACTUAL_FIELDS = [
  "estate_id",
  "unit",
  "deal_type",
  "price",
  "saleable_area",
  "saleable_psf",
  "deal_date",
  "block",
  "floor_band",
  "source",
  "source_url",
] as const;

async function saveAdminTransaction(input: AdminTransactionInput, actor: StaffAccess) {
  validateTransactionInput(input);

  let resetToPending = false;
  if (input.id) {
    const current = await queryRows("SELECT * FROM transactions WHERE id = $1", [input.id]);
    const existing = current[0];
    if (existing?.verification_state === "verified") {
      resetToPending = FACTUAL_FIELDS.some((field) => {
        const before = existing[field];
        const after = (input as Record<string, unknown>)[field];
        // deal_date comes back as a Date from the driver; input carries an
        // ISO date string -- compare as strings so an unchanged date doesn't
        // false-positive as "changed".
        if (field === "deal_date") return dateOrNull(before) !== after;
        return before !== after && !(before == null && after == null);
      });
    }
  }

  const rows = await queryRows(
    `INSERT INTO transactions
       (id, estate_id, unit, deal_type, price, saleable_area, saleable_psf, deal_date,
        block, floor_band, source, source_url, agent_id, social_copy_fb, social_copy_ig
        ${resetToPending ? ", verification_state, verified_at" : ""})
     VALUES
       (COALESCE($1, gen_random_uuid()), $2, $3, $4::deal_type, $5, $6, $7, $8::date,
        $9, $10, $11, $12, $13, $14, $15
        ${resetToPending ? ", 'pending', NULL" : ""})
     ON CONFLICT (id) DO UPDATE SET
       estate_id = EXCLUDED.estate_id, unit = EXCLUDED.unit, deal_type = EXCLUDED.deal_type,
       price = EXCLUDED.price, saleable_area = EXCLUDED.saleable_area,
       saleable_psf = EXCLUDED.saleable_psf, deal_date = EXCLUDED.deal_date,
       block = EXCLUDED.block, floor_band = EXCLUDED.floor_band,
       source = EXCLUDED.source, source_url = EXCLUDED.source_url, agent_id = EXCLUDED.agent_id,
       social_copy_fb = EXCLUDED.social_copy_fb, social_copy_ig = EXCLUDED.social_copy_ig
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
      input.social_copy_fb,
      input.social_copy_ig,
    ],
  );
  // ...rest unchanged (writeAudit + return), using the same resetToPending flag
}
```

Also update `mapTransactionRow` to read `social_copy_fb`/`social_copy_ig` off the row (via `stringOrNull`).

- [ ] **Step 5: Run test to verify it passes, then run the full transactions suite**

Run: `node --test src/lib/neon/admin-transactions.contract.test.mjs && npm run test:admin-transactions`
Expected: all PASS, including the pre-existing "editing an already-verified transaction resets it to pending" test (still true for a factual change) and "writes transaction.create/transaction.correct" tests (`fixture`'s default mock returns a bare `{ verification_state: "unverified" }`-shaped row for the `SELECT *` query now — update the fixture's default mock response to include enough fields for `FACTUAL_FIELDS.some(...)` to run without throwing on `undefined` field access; a plain object literal with all `FACTUAL_FIELDS` keys plus `verification_state` is enough).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add src/lib/neon/admin-transactions.types.ts src/lib/neon/admin-transactions.server.ts src/lib/neon/admin-transactions.contract.test.mjs
git commit -m "feat(admin): persist transaction social copy; only demote verification on a real factual change"
```

---

## Task 5: Wire the Content Copilot panel and preview into the transaction edit route

**Files:**
- Create: `src/components/admin/transactions/TransactionSocialPreview.tsx`
- Modify: `src/components/admin/transactions/AdminTransactionForm.tsx`
- Modify: `src/routes/admin.transactions_.$id.tsx`

- [ ] **Step 1: Add `social_copy_fb`/`social_copy_ig` fields to `AdminTransactionForm`'s state and payload** (same pattern as every other field — `createInitialForm`, `set()`, and the `payload` object in `handleSubmit`).

- [ ] **Step 2: Mount `AdminContentCopilot` next to the form**, only when editing an existing transaction (`transaction?.id` present — matches the fact that Content Copilot needs a real `resourceId`):

```tsx
{form.id ? (
  <AdminContentCopilot
    resourceType="transaction"
    resourceId={form.id}
    fingerprintValues={{
      social_copy_fb: form.social_copy_fb,
      social_copy_ig: form.social_copy_ig,
      created_at: transaction?.created_at ?? null,
    }}
    values={{ social_copy_fb: form.social_copy_fb, social_copy_ig: form.social_copy_ig }}
    onApply={(patch) => setForm((current) => ({ ...current, ...patch }))}
  />
) : null}
```

(`created_at` stands in for the missing `updated_at` here, matching the FAQ dialog's existing precedent in `admin.cms.tsx`'s `faqFingerprintValues`.)

- [ ] **Step 3: Build `TransactionSocialPreview`**

A read-only card, fixed aspect ratio (e.g. 4:5 for IG, or just a single square preview — pick one consistent shape), rendering: estate name, a 買賣/租賃 badge, price/area/psf, deal date, and a tab or toggle between the FB and IG copy text. A visible small label: "預覽（非正式發布圖片，僅供內部參考）". No image export, no download button — this is explicitly a preview, not a deliverable per this phase's scope.

```tsx
export function TransactionSocialPreview({
  estateName,
  dealType,
  price,
  saleableArea,
  saleablePsf,
  dealDate,
  copyFb,
  copyIg,
}: {
  estateName: string;
  dealType: "sale" | "rent";
  price: number;
  saleableArea: number;
  saleablePsf: number;
  dealDate: string;
  copyFb: string | null;
  copyIg: string | null;
}) {
  const [tab, setTab] = useState<"fb" | "ig">("fb");
  const copy = tab === "fb" ? copyFb : copyIg;
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">社交媒體文案預覽</h3>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant={tab === "fb" ? "default" : "outline"} onClick={() => setTab("fb")}>
            Facebook
          </Button>
          <Button type="button" size="sm" variant={tab === "ig" ? "default" : "outline"} onClick={() => setTab("ig")}>
            Instagram
          </Button>
        </div>
      </div>
      <div className="mx-auto max-w-sm rounded-md border bg-muted/30 p-4">
        <p className="text-xs text-muted-foreground">預覽（非正式發布圖片，僅供內部參考）</p>
        <p className="mt-2 text-lg font-bold">{estateName}</p>
        <p className="text-sm text-muted-foreground">
          {dealType === "sale" ? "買賣" : "租賃"} · ${price.toLocaleString()} · {saleableArea} 呎 · 實呎 $
          {saleablePsf.toLocaleString()} · {dealDate}
        </p>
        <p className="mt-3 whitespace-pre-wrap text-sm">{copy || "尚未有文案，請使用旁邊嘅 AI 協作生成。"}</p>
      </div>
    </div>
  );
}
```

Import `useState` and `Button` at the top of the file.

- [ ] **Step 4: Mount the preview in `admin.transactions_.$id.tsx`**, below the form, passing the live `transaction` fields (or the current form state if you thread it up — simplest: pass the `transaction` prop's fields, refreshed via the existing `refresh()` call after every save, matching how the rest of this page already re-fetches after a write rather than trying to keep client and server state in lockstep manually).

- [ ] **Step 5: Typecheck and run the full suites**

Run: `npx tsc --noEmit && npm run test:admin-transactions && npm run test:content-copilot`

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/transactions/TransactionSocialPreview.tsx src/components/admin/transactions/AdminTransactionForm.tsx src/routes/admin.transactions_.$id.tsx
git commit -m "feat(admin): wire Content Copilot and a text-only social preview into the transaction editor"
```

---

## Final verification

Run: `npm run test:admin-transactions && npm run test:content-copilot && npm run test:cms && npx tsc --noEmit && npm run lint`

## Acceptance

- A privileged staff member can generate zh-HK FB/IG copy for a verified transaction, review it, apply it, and save — the transaction's verification/publish state is untouched by that save.
- Changing an actual deal fact (price, date, area, etc.) still correctly demotes an already-verified transaction to `pending`, exactly as P6c1 established.
- An `agent` cannot use Content Copilot on a transaction (403), matching estate/article/faq/video today.
- The preview is clearly labeled as a non-final mockup, not a real generated image.
