# Agent Directory Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate the live defects from the PR #32 review by making Neon the sole source of truth for the agent directory and deleting the static-manifest merge layer that three of them lived in.

**Architecture:** `resolveDisplayAgents` and its four mappers are deleted. Both agent routes and the homepage consume `NeonPublicAgentProfile` directly, deriving contact details through one new pure function, `resolveAgentContact`. `src/config/site-team.ts` demotes from a render-time fallback to input for the seed script. Separately, the migration becomes idempotent, the admin form stops rejecting the seeded photo paths, and both Neon scripts become safe to re-run.

**Tech Stack:** TanStack Start (file-based routes, server functions), Neon serverless Postgres over the HTTP driver, React 19, Tailwind v4, zod, `bun test` for `.ts`/`.tsx` tests and `node --test` for `.mjs` tests.

**Spec:** `docs/superpowers/specs/2026-08-01-agent-directory-remediation-design.md`

**Branch:** `fix/agent-directory-remediation` (already created, spec already committed)

---

## Orientation for the implementer

You will not have seen this codebase. Read these before starting:

- `docs/superpowers/specs/2026-08-01-agent-directory-remediation-design.md` — the approved design, including a findings-coverage table.
- `src/lib/agent-directory.ts` — the file being gutted. 118 lines.
- `src/lib/neon/public-data.types.ts` — `NeonPublicAgentProfile`, the shape everything converges on.

**Two conventions that will bite you if you miss them:**

1. **`.ts`/`.tsx` tests run under `bun test`; `.mjs` tests run under `node --test`.** They are different runners with different assertion APIs, and `package.json` chains them with `&&`. There is no `npm test` script — use `npm run test:property-experience`.
2. **Public SQL must never reference `s.public_slug`, `s.job_title`, `s.show_on_website` or `s.display_order` directly.** A contract test (`src/lib/neon/agent-profiles.contract.test.mjs:92`) bans it, so the queries stay valid against a database that predates the `20260710090000` migration. Those columns are read via `to_jsonb(s)->>'name'`. Do not "clean this up".

**Typecheck baseline:** `npx tsc --noEmit` reports 56 pre-existing errors, 10 of which are `Cannot find module 'bun:test'`. The gate is **no new errors**, not zero.

---

## File Structure

| File | Change | Responsibility after |
| --- | --- | --- |
| `neon/migrations/20260801090000_staff_public_slug_unique.sql` | Modify | Idempotent constraint creation |
| `src/lib/agent-directory.ts` | Rewrite | Only `resolveAgentContact` + `agentContactNote` |
| `src/lib/agent-directory.test.ts` | Rewrite | Behavioural tests for the two functions above |
| `src/routes/agents.tsx` | Modify | Renders `NeonPublicAgentProfile[]` directly |
| `src/routes/agents_.$slug.tsx` | Modify | Same contact derivation as the directory |
| `src/routes/index.tsx` | Modify | Homepage preview, `.slice(0, 6)` |
| `src/routes/agents.contract.test.mjs` | Modify | Source-level guards only |
| `src/config/site-team.ts` | Modify | Seed input for `seed-staff.mjs` |
| `src/lib/neon/public-data.types.ts` | Modify | Drop `display_order` |
| `src/lib/neon/public-data.server.ts` | Modify | Drop the unused projection column |
| `src/lib/neon/admin-data.types.ts` | Modify | `display_order: number \| null` |
| `src/lib/neon/admin-data.server.ts` | Modify | FAQ upsert; append-on-create ordering |
| `src/lib/admin/agent-profile-form-utils.ts` | Modify | Map empty order field to `null` |
| `src/components/admin/AgentProfileForm.tsx` | Modify | Accept relative photo paths; blank order |
| `src/lib/staff/licence.ts` | Modify | Add `normaliseWhatsapp` |
| `src/lib/staff/licence.test.ts` | Modify | Cover `normaliseWhatsapp` |
| `scripts/neon/seed-staff.mjs` | Modify | Additive, transactional, shape-validated |
| `scripts/neon/import-faqs.mjs` | Modify | Preserve admin FAQ ordering |

**Task order matters.** Tasks 3–7 migrate consumers off the merge before Task 8 deletes it, so the suite stays green at every commit.

---

## Task 1: Make the migration idempotent

Highest priority — until this lands, nobody can bring up a fresh database.

**Files:**
- Modify: `neon/migrations/20260801090000_staff_public_slug_unique.sql` (whole file)
- Test: `src/lib/neon/agent-profiles.contract.test.mjs`

**Background:** `20260622060000_public_content.sql:85` already declares `CONSTRAINT faqs_scope_question_key UNIQUE (scope, question)` inline inside `CREATE TABLE IF NOT EXISTS faqs`. So on any database built by replaying migrations, this migration's second statement fails. `scripts/neon/apply-migrations.mjs:116` runs statements one at a time with no transaction and only writes `app_migrations` after all succeed, so statement 1 commits, statement 2 fails, and every retry then dies on statement 1. Production is unaffected — it recorded the migration already, and the runner skips recorded versions.

- [ ] **Step 1: Write the failing test**

Add to the end of `src/lib/neon/agent-profiles.contract.test.mjs`:

```js
test("the unique-constraint migration is idempotent", () => {
  const sql = read("neon/migrations/20260801090000_staff_public_slug_unique.sql");

  // apply-migrations.mjs runs statements one at a time with no transaction and only
  // records the version after all succeed. A bare ADD CONSTRAINT that collides with
  // 20260622060000's inline faqs_scope_question_key therefore commits statement 1,
  // fails statement 2, and wedges every retry on statement 1.
  assert.doesNotMatch(
    sql,
    /^\s*ALTER TABLE/m,
    "both ALTER TABLE statements must be wrapped in a DO $$ block",
  );
  assert.equal(sql.match(/WHEN duplicate_object THEN NULL/g)?.length, 2);
  assert.equal(sql.match(/WHEN duplicate_table THEN NULL/g)?.length, 2);

  // A unique_violation from real duplicate rows must still fail loudly rather than
  // silently skipping constraint creation.
  assert.doesNotMatch(sql, /WHEN unique_violation/);
  assert.doesNotMatch(sql, /WHEN others/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/neon/agent-profiles.contract.test.mjs`
Expected: FAIL — `both ALTER TABLE statements must be wrapped in a DO $$ block`

- [ ] **Step 3: Rewrite the migration**

Replace the entire contents of `neon/migrations/20260801090000_staff_public_slug_unique.sql`:

```sql
-- staff_users.public_slug is the natural key for seeding agents from the static
-- roster. 20260710090000 already created a PARTIAL unique index on it
-- (staff_users_public_slug_unique ... WHERE public_slug IS NOT NULL), but Postgres
-- cannot infer a partial index as an ON CONFLICT arbiter unless the predicate is
-- restated, so the seed script had nothing to target. This adds a total constraint.
-- Postgres permits multiple NULLs under a unique constraint, so the admin account
-- and the leftover test row -- both with a null public_slug -- are unaffected.
--
-- Guarded because apply-migrations.mjs runs each statement in its own implicit
-- transaction and only records the version once all of them succeed. An unguarded
-- failure here commits the first statement, skips the app_migrations write, and
-- wedges every subsequent retry on the statement that already succeeded.
DO $$
BEGIN
  ALTER TABLE staff_users
    ADD CONSTRAINT staff_users_public_slug_key UNIQUE (public_slug);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

-- 20260622060000_public_content.sql declares this constraint inline, so every
-- database built by replaying the migration set already has it. Production's faqs
-- table pre-dated that migration and CREATE TABLE IF NOT EXISTS skipped the whole
-- statement, so production alone was missing it.
--
-- Only duplicate_object/duplicate_table are swallowed. A unique_violation means the
-- table genuinely holds duplicate (scope, question) rows and must fail loudly --
-- silently skipping would leave saveAdminFaq's ON CONFLICT with nothing to target.
DO $$
BEGIN
  ALTER TABLE faqs
    ADD CONSTRAINT faqs_scope_question_key UNIQUE (scope, question);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/neon/agent-profiles.contract.test.mjs`
Expected: PASS, all tests

- [ ] **Step 5: Verify the statement splitter handles `DO $$` blocks**

`apply-migrations.mjs` has a hand-rolled `splitSqlStatements`. Confirm it does not split on the semicolons inside a `DO $$ ... END $$;` body — `20260622060000_public_content.sql:3-8` already uses this exact form and applies cleanly, so it does. Read `scripts/neon/apply-migrations.mjs` around the `splitSqlStatements` function and confirm it tracks `$$` dollar-quoting.

If it does **not** track `$$`, stop and report — the guard will be split into fragments and this task needs a different approach.

- [ ] **Step 6: Commit**

```bash
git add neon/migrations/20260801090000_staff_public_slug_unique.sql src/lib/neon/agent-profiles.contract.test.mjs
git commit -m "fix(db): make the unique-constraint migration idempotent

20260622060000 already declares faqs_scope_question_key inline, so this
migration's second statement failed on every database built by replaying the
set. The runner has no transaction and records the version only after all
statements succeed, so statement 1 committed, statement 2 failed, and each
retry then died on statement 1 -- fresh dev machines, CI and Neon preview
branches were permanently wedged.

Only duplicate_object and duplicate_table are swallowed. A unique_violation
from real duplicate rows still fails loudly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Accept root-relative photo paths in the admin form

**Files:**
- Modify: `src/components/admin/AgentProfileForm.tsx:28`
- Test: `src/components/admin/AgentProfileForm.test.tsx`

**Background:** `scripts/neon/seed-staff.mjs` wrote `/team/<slug>.jpg` into `avatar_url` for all 23 production agents. The form validates that column with `z.string().trim().url()`, which rejects a path. Because `safeParse` validates the whole object and returns before `saveAdminAgentProfile` is called, **no field of any seeded agent can be saved** — an admin editing only 電話 is blocked by the untouched photo field. The data is correct (`agents_.$slug.tsx:65` renders it fine and all 24 files exist under `public/team/`); the schema is wrong.

- [ ] **Step 1: Write the failing test**

Add to `src/components/admin/AgentProfileForm.test.tsx`:

```tsx
test("accepts the root-relative photo paths the seed script writes", () => {
  expect(agentProfileSchema.shape.avatar_url.safeParse("/team/tommy-yiu.jpg").success).toBe(true);
  expect(agentProfileSchema.shape.avatar_url.safeParse("https://cdn.example.com/a.jpg").success).toBe(
    true,
  );
  expect(agentProfileSchema.shape.avatar_url.safeParse("").success).toBe(true);
});

test("rejects a photo value that is neither a path nor an http(s) URL", () => {
  for (const input of ["javascript:alert(1)", "team/tommy-yiu.jpg", "ftp://x/a.jpg", "  "]) {
    expect(agentProfileSchema.shape.avatar_url.safeParse(input).success).toBe(false);
  }
});
```

This requires the schema to be exported. In `AgentProfileForm.tsx`, change `const schema = z` to `export const agentProfileSchema = z`, then rename every remaining reference:

```bash
grep -n "\bschema\b" src/components/admin/AgentProfileForm.tsx
```

Update each hit (there is at least `schema.safeParse` at line 107; check for `z.infer<typeof schema>` too). Re-run the grep afterwards and confirm the only remaining matches are `agentProfileSchema`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/admin/AgentProfileForm.test.tsx`
Expected: FAIL — `/team/tommy-yiu.jpg` returns `success: false`

- [ ] **Step 3: Replace the validator**

In `src/components/admin/AgentProfileForm.tsx`, replace line 28:

```ts
    avatar_url: z.string().trim().url("請輸入有效相片網址").max(500).or(z.literal("")),
```

with:

```ts
    // seed-staff.mjs writes root-relative paths (/team/<slug>.jpg) for all 23
    // roster agents, and z.url() rejects them -- which blocked every admin edit to
    // every seeded agent, because safeParse validates the whole object. Schemes are
    // still restricted so an <img src> cannot be pointed anywhere arbitrary.
    avatar_url: z
      .string()
      .trim()
      .max(500)
      .refine(
        (value) => value === "" || value.startsWith("/") || /^https?:\/\/\S+$/.test(value),
        "請輸入有效相片網址，或以 / 開頭的路徑",
      ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/admin/AgentProfileForm.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/AgentProfileForm.tsx src/components/admin/AgentProfileForm.test.tsx
git commit -m "fix(admin): accept the root-relative photo paths the seed writes

seed-staff.mjs wrote /team/<slug>.jpg into avatar_url for all 23 production
agents, and the form validated that column with z.url(). safeParse validates
the whole object and returns before the save, so an admin editing only a phone
number was blocked by the untouched photo field -- every field of every seeded
agent was unsaveable.

The data is right and the schema was wrong, so this relaxes the schema rather
than rewriting the column. Schemes stay restricted to / paths and http(s).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Add `resolveAgentContact` and `agentContactNote`

Pure addition. The old merge code stays in place and the suite stays green.

**Files:**
- Modify: `src/lib/agent-directory.ts` (append)
- Test: `src/lib/agent-directory.test.ts` (append)

**Background:** Three separate defects come from contact derivation being copy-pasted between the two agent routes and getting fixed in only one. `SITE_BRANCHES[0]` (麗都分行) is used as a silent fallback for any unmatched or null branch, so 董事 Kenneth Chang's card renders no branch label and then names 麗都分行 two lines below it. And `usesGeneralContact = !phone && !whatsapp` suppresses the disclosure for a WhatsApp-only agent whose 電話聯絡 button dials a branch switchboard.

The five reachable note cases are enumerated in the spec's §3 table.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/agent-directory.test.ts`:

```ts
import { agentContactNote, resolveAgentContact } from "./agent-directory";

function contactInput(overrides: Partial<Parameters<typeof resolveAgentContact>[0]> = {}) {
  return { branch: "海韻分行", phone: null, whatsapp: null, ...overrides };
}

describe("resolveAgentContact", () => {
  test("routes to the agent's own branch, not SITE_BRANCHES[0]", () => {
    const contact = resolveAgentContact(contactInput({ branch: "海韻分行" }));
    expect(contact.homeBranch?.name).toBe("海韻分行");
    expect(contact.phone).toBe("26886996");
  });

  test("a null branch resolves to no branch, never to a default", () => {
    // 董事 Kenneth Chang has no branch. The card deliberately renders no branch
    // label; naming 麗都分行 in the follow-up note contradicted that blank.
    const contact = resolveAgentContact(contactInput({ branch: null }));
    expect(contact.homeBranch).toBeNull();
  });

  test("a branch string matching no configured branch resolves to null", () => {
    const contact = resolveAgentContact(contactInput({ branch: "海韻分行 " }));
    expect(contact.homeBranch).toBeNull();
  });

  test("the agent's own number wins over the branch line", () => {
    const contact = resolveAgentContact(contactInput({ phone: "91234567" }));
    expect(contact.phone).toBe("91234567");
    expect(contact.phoneIsFallback).toBe(false);
  });

  test("a WhatsApp-only agent is still flagged as dialling a fallback", () => {
    // The 電話聯絡 button dials the branch switchboard here, so the disclosure
    // must render even though the agent supplied a WhatsApp number.
    const contact = resolveAgentContact(contactInput({ whatsapp: "91234567" }));
    expect(contact.phoneIsFallback).toBe(true);
    expect(contact.whatsappIsFallback).toBe(false);
    expect(contact.whatsapp).toBe("91234567");
  });

  test("WhatsApp falls back to the agent's own phone and is not a fallback", () => {
    const contact = resolveAgentContact(contactInput({ phone: "91234567" }));
    expect(contact.whatsapp).toBe("91234567");
    expect(contact.whatsappIsFallback).toBe(false);
  });
});

describe("agentContactNote", () => {
  test("says nothing when both numbers are the agent's own", () => {
    expect(agentContactNote(resolveAgentContact(contactInput({ phone: "91234567" })))).toBeNull();
  });

  test("names the agent's branch when they supplied no contact details", () => {
    expect(agentContactNote(resolveAgentContact(contactInput()))).toBe(
      "代理未有提供直接聯絡方式，電話查詢將由海韻分行跟進。",
    );
  });

  test("names no branch for an agent who has none", () => {
    expect(agentContactNote(resolveAgentContact(contactInput({ branch: null })))).toBe(
      "代理未有提供直接聯絡方式，請使用一般查詢。",
    );
  });

  test("distinguishes a real WhatsApp line from a fallback phone", () => {
    expect(agentContactNote(resolveAgentContact(contactInput({ whatsapp: "91234567" })))).toBe(
      "WhatsApp 為代理直綫，電話查詢將由海韻分行跟進。",
    );
  });

  test("handles a WhatsApp-only agent with no branch", () => {
    expect(
      agentContactNote(resolveAgentContact(contactInput({ branch: null, whatsapp: "91234567" }))),
    ).toBe("WhatsApp 為代理直綫，電話查詢請使用一般查詢。");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/agent-directory.test.ts`
Expected: FAIL — `resolveAgentContact` is not exported

- [ ] **Step 3: Implement both functions**

Append to `src/lib/agent-directory.ts`, and add `SITE_BRANCHES, SITE_CONTACT, type SiteBranch` to the imports from `@/config/site`:

```ts
export type AgentContact = {
  /** null when the agent has no branch, or when their branch matches no configured one. */
  homeBranch: SiteBranch | null;
  phone: string | null;
  whatsapp: string | null;
  /** The rendered phone number is not the agent's own. */
  phoneIsFallback: boolean;
  /** The rendered WhatsApp number is not the agent's own. */
  whatsappIsFallback: boolean;
};

/**
 * Derive the contact details an agent card renders. Shared by /agents and
 * /agents/<slug>, which previously each carried their own copy -- so a fix landed
 * on one and the two pages told a visitor different things about the same person.
 *
 * There is deliberately no fallback to SITE_BRANCHES[0]: defaulting a missing
 * branch printed 麗都分行 on agents based elsewhere, and on 董事, who has none.
 */
export function resolveAgentContact(profile: {
  branch: string | null;
  phone: string | null;
  whatsapp: string | null;
}): AgentContact {
  const homeBranch = SITE_BRANCHES.find((entry) => entry.name === profile.branch) ?? null;
  return {
    homeBranch,
    // `||` not `??`: SITE_CONTACT.phoneTel is `import.meta.env.VITE_CONTACT_PHONE_TEL ?? ""`,
    // so it is an empty string when unset. `??` would pass "" through and produce a
    // `tel:+` href with no number behind it.
    phone: profile.phone || homeBranch?.phone || SITE_CONTACT.phoneTel || null,
    whatsapp: profile.whatsapp || profile.phone || SITE_CONTACT.whatsappPhone || null,
    phoneIsFallback: !profile.phone,
    whatsappIsFallback: !profile.whatsapp && !profile.phone,
  };
}

/** The disclosure line, or null when both rendered numbers are the agent's own. */
export function agentContactNote(contact: AgentContact): string | null {
  if (!contact.phoneIsFallback) return null;
  const branch = contact.homeBranch;
  if (contact.whatsappIsFallback) {
    return branch
      ? `代理未有提供直接聯絡方式，電話查詢將由${branch.name}跟進。`
      : "代理未有提供直接聯絡方式，請使用一般查詢。";
  }
  return branch
    ? `WhatsApp 為代理直綫，電話查詢將由${branch.name}跟進。`
    : "WhatsApp 為代理直綫，電話查詢請使用一般查詢。";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/agent-directory.test.ts`
Expected: PASS — the 11 new tests plus the 8 pre-existing ones

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-directory.ts src/lib/agent-directory.test.ts
git commit -m "feat(agents): add resolveAgentContact, one derivation for both routes

/agents and /agents/<slug> each carried a copy of the phone/branch fallback, so
PR #32 fixed one and left the other -- a 海韻 agent's card said their call went
to 海韻分行 while their own profile page said 麗都分行.

Two behaviour fixes come with it. homeBranch returns null rather than
SITE_BRANCHES[0], so 董事 Kenneth Chang no longer gets 麗都分行 named two lines
under a deliberately blank branch label. And the single usesGeneralContact flag
splits in two, so a WhatsApp-only agent no longer has the disclosure suppressed
while their 電話聯絡 button dials a branch switchboard.

Nothing consumes it yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Move `/agents` onto `NeonPublicAgentProfile`

**Files:**
- Modify: `src/routes/agents.tsx`
- Modify: `src/routes/agents.contract.test.mjs:150-176`

**Background:** `AgentDirectoryCard` takes a `DisplayAgent` (camelCase) built by the merge. It now takes the DB row directly (snake_case). Six assertions in the contract test break, because the route stops importing `SITE_BRANCHES` and `DEFAULT_AGENT_BRANCH` and the `??` chains move into the resolver.

- [ ] **Step 1: Update the contract test first**

In `src/routes/agents.contract.test.mjs`, replace the whole `test("branch is never defaulted, but contact details still fall back", ...)` block (lines 150–176) with:

```js
test("branch is never defaulted in either agent route", () => {
  for (const file of ["src/routes/agents.tsx", "src/routes/agents_.$slug.tsx"]) {
    const source = readExisting(file);

    // Defaulting a missing branch to SITE_BRANCHES[0] printed 麗都分行 on the 15
    // agents based at 海韻 or 青山公路豪景 -- a confident wrong answer about named
    // real people. A blank is the correct rendering, and 董事 has no branch at all.
    assert.doesNotMatch(source, /(?:profile|agent)\.branch\s*\?\?/);
    assert.match(source, /\{branch \? </, `${file} must render branch conditionally`);

    // The derivation lives in resolveAgentContact so both routes cannot drift
    // again. No route may reintroduce a hardcoded branch fallback.
    assert.doesNotMatch(
      source,
      /DEFAULT_AGENT_BRANCH/,
      `${file} must not hardcode a default branch`,
    );
    assert.doesNotMatch(
      source,
      /SITE_BRANCHES\s*\[\s*0\s*\]/,
      `${file} must not fall back to the first configured branch`,
    );
    assert.match(source, /resolveAgentContact/, `${file} must derive contact details centrally`);
  }
});
```

Behavioural coverage for what these assertions used to grep for now lives in `src/lib/agent-directory.test.ts` (Task 3).

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `node --test src/routes/agents.contract.test.mjs`
Expected: FAIL — `src/routes/agents.tsx must not hardcode a default branch`

- [ ] **Step 3: Rewrite the route's imports and card**

In `src/routes/agents.tsx`, replace the import block and delete `DEFAULT_AGENT_BRANCH`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, MessageCircle, Phone, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchNeonPublicAgentProfiles } from "@/lib/neon/public-data";
import type { NeonPublicAgentProfile } from "@/lib/neon/public-data.types";
import { agentContactNote, resolveAgentContact } from "@/lib/agent-directory";
import { toTelHref, toWhatsAppHref } from "@/lib/contact-links";
```

Replace `AgentsPage`'s body line:

```tsx
function AgentsPage() {
  const agents = Route.useLoaderData();
```

Replace the whole head of `AgentDirectoryCard` (its signature down to `usesGeneralContact`):

```tsx
function AgentDirectoryCard({ agent }: { agent: NeonPublicAgentProfile }) {
  const name = agent.name_zh || agent.name_en || "晉誠地產代理";
  // No fallback: this used to default to SITE_BRANCHES[0] (麗都分行), which printed a
  // real branch name on agents who work elsewhere. A missing branch renders
  // nothing — 董事 legitimately has none, and a blank beats a confident wrong answer.
  const branch = agent.branch;
  const contact = resolveAgentContact(agent);
  const note = agentContactNote(contact);
  const phoneHref = toTelHref(contact.phone);
  const whatsappHref = toWhatsAppHref(contact.whatsapp);
```

- [ ] **Step 4: Update the card's JSX field references**

Within `AgentDirectoryCard`'s returned JSX, apply exactly these renames:

| Was | Now |
| --- | --- |
| `agent.photo` | `agent.avatar_url` |
| `agent.nameZh && agent.nameEn` | `agent.name_zh && agent.name_en` |
| `{agent.nameEn}` | `{agent.name_en}` |
| `agent.jobTitle` (both) | `agent.job_title` |
| `agent.licenceNo` (both) | `agent.licence_no` |

Delete the `agent.isPlaceholder` block entirely:

```tsx
        {agent.isPlaceholder ? (
          <p className="mt-3 text-xs text-muted-foreground">資料整理中，詳情稍後更新。</p>
        ) : null}
```

Replace the `usesGeneralContact` note block with:

```tsx
        {note ? <p className="mt-3 text-xs text-muted-foreground">{note}</p> : null}
```

Replace the 一般查詢 button's condition — it should appear when the WhatsApp number is not the agent's own:

```tsx
          {contact.whatsappIsFallback ? (
            <Button asChild size="sm">
              <Link to="/contact">一般查詢</Link>
            </Button>
          ) : null}
```

And the profile link's condition changes from `agent.slug` to `agent.public_slug`:

```tsx
          {agent.public_slug ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/agents/$slug" params={{ slug: agent.public_slug }}>
                <Building2 className="mr-2 h-4 w-4" />
                查看資料
              </Link>
            </Button>
          ) : null}
```

- [ ] **Step 5: Run the tests**

Run: `node --test src/routes/agents.contract.test.mjs && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: contract test PASS; error count `56`

- [ ] **Step 6: Commit**

```bash
git add src/routes/agents.tsx src/routes/agents.contract.test.mjs
git commit -m "refactor(agents): render Neon rows directly on the directory

AgentDirectoryCard took a DisplayAgent built by the static-manifest merge; it
now takes the row. isPlaceholder is deleted along with the 資料整理中 caveat --
the job titles and branches it covered were supplied by the client in PHASE 4,
and the // TODO comments claiming otherwise are stale.

Six contract assertions pinned an anonymous lambda parameter, a local variable
name and JSX whitespace, and blocked exactly this extraction. They are replaced
by guards on the property that actually matters -- no route hardcodes a branch
fallback -- with the behavioural claims covered in agent-directory.test.ts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Move `/agents/<slug>` onto the shared resolver

**Files:**
- Modify: `src/routes/agents_.$slug.tsx:1-46, 97-101, 119-123`

**Background:** This route was absent from PR #32's diff entirely. It still computes `profile.phone ?? (SITE_CONTACT.phoneTel || DEFAULT_AGENT_BRANCH.phone)` and renders `查詢將由{DEFAULT_AGENT_BRANCH.name}跟進`, so for Sam Lee (branch 海韻分行, no phone) `/agents` dials 26886996 and names 海韻分行 while `/agents/sam-lee` dials 26882988 and names 麗都分行.

- [ ] **Step 1: Replace the imports**

In `src/routes/agents_.$slug.tsx`, replace lines 1–11:

```tsx
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, Building2, MessageCircle, Phone, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SITE_NAME } from "@/content/seo";
import { fetchNeonPublicAgentProfileBySlug } from "@/lib/neon/public-data";
import type { NeonPublicAgentProfile } from "@/lib/neon/public-data.types";
import { agentContactNote, resolveAgentContact } from "@/lib/agent-directory";
import { toTelHref, toWhatsAppHref } from "@/lib/contact-links";
```

`SITE_BRANCHES`, `SITE_CONTACT` and the `DEFAULT_AGENT_BRANCH` constant are all deleted from this file.

- [ ] **Step 2: Replace the derivation**

Replace lines 42–47 (from `const phone =` through `const usesGeneralContact =`):

```tsx
  const contact = resolveAgentContact(profile);
  const note = agentContactNote(contact);
  const phoneHref = toTelHref(contact.phone);
  const whatsappHref = toWhatsAppHref(contact.whatsapp);
```

- [ ] **Step 3: Replace the two `usesGeneralContact` render sites**

The note block at lines 97–101 becomes:

```tsx
            {note ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{note}</p> : null}
```

The 一般查詢 button at lines 119–123 becomes:

```tsx
              {contact.whatsappIsFallback ? (
                <Button asChild className="w-full justify-start">
                  <Link to="/contact">一般查詢</Link>
                </Button>
              ) : null}
```

- [ ] **Step 4: Run the tests**

Run: `node --test src/routes/agents.contract.test.mjs && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: contract test PASS; error count `56`

- [ ] **Step 5: Commit**

```bash
git add src/routes/agents_.\$slug.tsx
git commit -m "fix(agents): give the profile page the same contact derivation

This route was absent from PR #32's diff, so it kept the old hardcoded
DEFAULT_AGENT_BRANCH. For Sam Lee -- branch 海韻分行, no direct number -- /agents
dialled 26886996 and named 海韻分行 while /agents/sam-lee dialled 26882988 and
named 麗都分行. Same person, one click apart, and it held for all 14 agents
based outside 麗都.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Move the homepage preview off the merge

**Files:**
- Modify: `src/routes/index.tsx:41, 75, 326-348`

- [ ] **Step 1: Replace the loader line**

Delete the `resolveDisplayAgents` import at line 41. Replace line 75:

```tsx
      agents: agentProfiles.slice(0, 6),
```

Ordering now comes from `listPublicAgentProfiles`' `ORDER BY COALESCE((to_jsonb(s)->>'display_order')::integer, 0)`. The seed wrote `display_order = index`, so the client-approved order is preserved with no client-side sort.

- [ ] **Step 2: Update the team section's field names**

In the `agents.map` block around line 326, apply these renames:

| Was | Now |
| --- | --- |
| `agent.nameZh \|\| agent.nameEn` | `agent.name_zh \|\| agent.name_en` |
| `agent.photo` (both) | `agent.avatar_url` |
| `agent.jobTitle` (both) | `agent.job_title` |

`key={agent.id}` is unchanged — `NeonPublicAgentProfile.id` is the row uuid.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `56`

- [ ] **Step 4: Commit**

```bash
git add src/routes/index.tsx
git commit -m "refactor(home): read the team preview straight off the Neon rows

The limit argument becomes a slice; ordering is the query's ORDER BY, which the
seed already populated with the client-approved order.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Delete the merge layer

Every consumer is migrated, so the dead code can go.

**Files:**
- Modify: `src/lib/agent-directory.ts` (delete lines 1–118, keep only Task 3's additions)
- Modify: `src/lib/agent-directory.test.ts` (delete the `resolveDisplayAgents` describe block and the `dbProfile` fixture)

- [ ] **Step 1: Delete the obsolete tests**

In `src/lib/agent-directory.test.ts`, delete the `dbProfile` helper and the entire `describe("resolveDisplayAgents", ...)` block. Keep the `resolveAgentContact` and `agentContactNote` blocks and the `contactInput` helper. Remove the now-unused `import { SITE_TEAM } from "@/config/site-team";`.

Note: the deleted test named "keeps the client's approved order and applies the limit last" passed `resolveDisplayAgents([], 3)` — zero DB profiles — so it never exercised a single `display_order` and could not fail. Ordering is now asserted at `src/lib/neon/agent-profiles.contract.test.mjs:88-93`, which pins the query's `ORDER BY`.

- [ ] **Step 2: Delete the merge code**

In `src/lib/agent-directory.ts`, delete: the `SITE_TEAM` / `TeamMemberPlaceholder` import, the `DisplayAgent` type, `fromDbProfile`, `fromPlaceholder`, `preferLive`, `resolveDisplayAgents`, and the orphaned JSDoc block at lines 56–61 (which describes the wholesale-swap behaviour this PR deleted and now sits above the wrong function).

The file should contain only the `@/config/site` and `public-data.types` imports plus `AgentContact`, `resolveAgentContact` and `agentContactNote`.

- [ ] **Step 3: Verify nothing still references the deleted symbols**

Run:
```bash
grep -rn "resolveDisplayAgents\|DisplayAgent\|fromPlaceholder\|preferLive" --include="*.ts" --include="*.tsx" src
```
Expected: no output.

- [ ] **Step 4: Run the full suite**

Run: `npm run test:property-experience`
Expected: PASS, both the bun and node halves

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-directory.ts src/lib/agent-directory.test.ts
git commit -m "refactor(agents): delete the static-manifest merge

With Neon holding all 23 rows the merge reconciled one source with itself, and
three review findings were properties of that layer rather than bugs inside it:
preferLive treated an admin-cleared field as 'no opinion' and resurrected the
manifest value; the isPlaceholder literal was never null so every slug-matched
agent was marked verified; and the sort mixed DB display_order values with
static array indices.

Unpublishing now works by construction -- listPublicAgentProfiles filters
active AND show_on_website and nothing re-adds rows downstream. DirectoryEmptyState
stops being unreachable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Demote `site-team.ts` to seed input

**Files:**
- Modify: `src/config/site-team.ts:1-28, 286-293`

- [ ] **Step 1: Replace the header and type**

Replace lines 1–28:

```ts
/**
 * Seed input for scripts/neon/seed-staff.mjs.
 *
 * These 23 entries were reconciled against the client's roster in PR #30
 * (CHANGELOG PHASE 4): the job titles and branches below are client-supplied and
 * confirmed, and Michael Wong was removed to reach 23. They were seeded into
 * Neon `staff_users` by commit c5ff3bb and Neon is now the source of truth --
 * /agents and the homepage read the database directly and never consult this file.
 *
 * Still outstanding, tracked in TODO-ASSETS.md: Traditional Chinese names, direct
 * phone and WhatsApp numbers, and individual EAA licence numbers. Supply them via
 * the optional contacts JSON that seed-staff.mjs accepts, not by editing here --
 * the seed is additive and will not overwrite a value an admin has since entered.
 */

export type TeamSeedMember = {
  slug: string;
  nameEn: string;
  nameZh: string | null;
  jobTitle: string | null;
  branch: string | null;
  phone: string | null;
  whatsapp: string | null;
  licenceNo: string | null;
  photo: string;
};
```

- [ ] **Step 2: Remove the stale TODO comments**

Across all 23 entries, delete the `// TODO: confirm job title` and `// TODO: confirm branch assignment` trailing comments — the client resolved both in PHASE 4. Keep the `nameZh`, `phone`, `whatsapp` and `licenceNo` TODOs; those are genuinely outstanding.

Run this to do it mechanically, then read the diff to confirm nothing else moved:

```bash
perl -pi -e 's{,\s*//\s*TODO: confirm job title$}{,};
              s{,\s*//\s*TODO: confirm branch assignment$}{,};' src/config/site-team.ts
```

- [ ] **Step 3: Replace the export tail**

Replace lines 286–293:

```ts
export const SITE_TEAM: TeamSeedMember[] = RAW_TEAM;
```

and update `RAW_TEAM`'s declaration at line 30 from `Omit<TeamMemberPlaceholder, "isPlaceholder">[]` to `TeamSeedMember[]`.

This deletes the `isPlaceholder: true` mapping and `getTeamPreview`, which had no callers anywhere in the repo.

- [ ] **Step 4: Verify**

Run:
```bash
grep -rn "TeamMemberPlaceholder\|getTeamPreview\|isPlaceholder" --include="*.ts" --include="*.tsx" --include="*.mjs" src scripts
npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Expected: no grep output; error count `56`

- [ ] **Step 5: Commit**

```bash
git add src/config/site-team.ts
git commit -m "refactor(team): demote the roster manifest to seed input

Its only consumer is now seed-staff.mjs. The header claimed the file was a
render-time fallback that 'becomes unused and can be deleted' and said 24
entries where there are 23.

The // TODO: confirm job title and branch comments are deleted -- CHANGELOG
PHASE 4 records the client supplying all 23 in PR #30, and those stale comments
are what led a review to report the seeded data as unverified. The nameZh,
phone, whatsapp and licenceNo TODOs stay; TODO-ASSETS.md still tracks them.

getTeamPreview had no callers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Drop `display_order` from the public projection

**Files:**
- Modify: `src/lib/neon/public-data.types.ts:42`
- Modify: `src/lib/neon/public-data.server.ts:42, 176`

**Background:** `agent-directory.ts:97` and `:110` were the only readers, and Task 7 deleted them. `publicAgentProfileColumns` is inlined into `listingColumns`, so this expression was running a third whole-row `to_jsonb(s)` serialization on every `/listings` row (12/page), every `/videos` row (36) and every property page — for a value nothing read.

- [ ] **Step 1: Remove the type field**

In `src/lib/neon/public-data.types.ts`, delete `  display_order: number | null;` from `NeonPublicAgentProfile`.

- [ ] **Step 2: Remove the projection column**

In `src/lib/neon/public-data.server.ts`, change the tail of `publicAgentProfileColumns` from:

```
  s.bio AS agent_bio,
  (to_jsonb(s)->>'display_order')::integer AS agent_display_order
```

back to:

```
  s.bio AS agent_bio
```

- [ ] **Step 3: Remove the mapper field**

In `mapPublicAgentProfile`, delete `    display_order: numberOrNull(row.agent_display_order),`.

- [ ] **Step 4: Confirm the ORDER BY is untouched**

`listPublicAgentProfiles` computes its own separate
`ORDER BY COALESCE((to_jsonb(s)->>'display_order')::integer, 0) ASC`. Leave it exactly as is — `agent-profiles.contract.test.mjs:88-93` pins it, and the `doesNotMatch(/\bs\.display_order\b/)` guard at line 92 still passes because the expression uses `to_jsonb`.

- [ ] **Step 5: Verify**

Run: `node --test src/lib/neon/agent-profiles.contract.test.mjs && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: PASS; error count `56`

- [ ] **Step 6: Commit**

```bash
git add src/lib/neon/public-data.types.ts src/lib/neon/public-data.server.ts
git commit -m "perf(neon): stop projecting display_order into every listing row

agent-directory.ts was its only reader and no longer exists. Because
publicAgentProfileColumns is inlined into listingColumns, this ran a third
whole-row to_jsonb(s) serialization -- including bio, capped at 2000 chars -- on
every /listings row, every /videos row and every property page, for a value
nothing read. The ORDER BY keeps its own separate expression.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Append new agents to the end of the roster

**Files:**
- Modify: `src/lib/neon/admin-data.types.ts:164`
- Modify: `src/components/admin/AgentProfileForm.tsx:38, 66`
- Modify: `src/lib/admin/agent-profile-form-utils.ts`
- Modify: `src/lib/neon/admin-data.server.ts:652, 692, 706, 727, 744`

**Background:** `staff_users.display_order` is `INTEGER NOT NULL DEFAULT 0` and the form defaults to `"0"`, so an agent published through the admin panel ties with Kenneth Chang at position 0 and sorts to second place ahead of 22 approved agents — pushing the sixth off the homepage preview.

- [ ] **Step 1: Widen the input type**

In `src/lib/neon/admin-data.types.ts:164`, change `display_order: number;` to:

```ts
  /** null means "append to the end" on create, and "leave unchanged" on update. */
  display_order: number | null;
```

- [ ] **Step 2: Let the form submit a blank**

In `src/components/admin/AgentProfileForm.tsx`, change line 38:

```ts
    display_order: z.union([z.literal(""), z.coerce.number().int().min(0).max(9999)]),
```

and line 66:

```ts
    display_order: profile?.display_order?.toString() ?? "",
```

An existing profile keeps its number; a new one starts blank. Add a placeholder to the input at line 203:

```tsx
            placeholder="留空自動排在最後"
```

- [ ] **Step 3: Map blank to null**

In `src/lib/admin/agent-profile-form-utils.ts`, find where `display_order` is read off the form and change it to:

```ts
    display_order: data.display_order === "" ? null : Number(data.display_order),
```

- [ ] **Step 4: Make the server honour null**

In `src/lib/neon/admin-data.server.ts`, replace line 652:

```ts
  const displayOrder = Number.isInteger(input.display_order) ? input.display_order : null;
```

In the two **INSERT** statements (around lines 706 and 744), replace the `display_order` value placeholder with a subquery. For the identity-and-profile insert at line 706 the parameter is `$14`, so:

```sql
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                  COALESCE($14, (SELECT COALESCE(MAX(display_order), -1) + 1 FROM staff_users)),
                  $15)
```

Then do the same for the profile-only INSERT. Read `src/lib/neon/admin-data.server.ts:711-760` first — that branch uses `publicProfileParams` (`identityAndProfileParams.slice(2, 14)`), so every placeholder is shifted down by two and `display_order` is `$12` rather than `$14`. Wrap `$12` in the identical `COALESCE(..., (SELECT COALESCE(MAX(display_order), -1) + 1 FROM staff_users))`.

Confirm the mapping before editing rather than assuming it: run `grep -an "display_order = \$" src/lib/neon/admin-data.server.ts` and check each statement's parameter number against its own `VALUES`/`SET` list.

In the two **UPDATE** statements (lines 692 and 727), make a null leave the existing value alone:

```sql
            display_order = COALESCE($14, display_order),
```

again matching the positional parameter used in each statement.

- [ ] **Step 5: Verify**

Run: `npm run test:property-experience && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: PASS; error count `56`

- [ ] **Step 6: Commit**

```bash
git add src/lib/neon/admin-data.types.ts src/lib/neon/admin-data.server.ts src/lib/admin/agent-profile-form-utils.ts src/components/admin/AgentProfileForm.tsx
git commit -m "fix(admin): append new agents instead of hoisting them to the top

display_order is NOT NULL DEFAULT 0 and the form defaulted to '0', so an agent
published through the admin panel tied with Kenneth Chang at position 0 and
sorted to second place ahead of 22 client-approved agents -- pushing the sixth
off the homepage preview.

The field now starts blank on create and maps to null, which the server reads as
'append' on insert and 'leave unchanged' on update.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Give `saveAdminFaq` the upsert its migration assumes

**Files:**
- Modify: `src/lib/neon/admin-data.server.ts:1116-1122`

**Background:** Task 1's constraint means a duplicate `(scope, question)` now raises 23505. `admin.cms.tsx:316-330` loops `saveAdminFaq` with no per-row recovery, and `assertNoServerError` only unwraps a returned `{error: string}` — a throw propagates to a raw toast, aborts the import mid-file, and leaves `refreshCmsData()` and the knowledge rebuild unrun.

- [ ] **Step 1: Replace the INSERT branch**

In `saveAdminFaq`, replace the `: await queryRows(...)` insert branch:

```ts
    : await queryRows(
        `INSERT INTO faqs (scope, question, answer, sort_order)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (scope, question) DO UPDATE
           SET answer = EXCLUDED.answer
         RETURNING id, (xmax = 0) AS inserted`,
        [input.scope, input.question, input.answer, input.sort_order],
      );
```

`sort_order` is deliberately not updated on conflict — see Task 13. `xmax = 0` is the standard way to tell an insert from an update in a `RETURNING` clause.

- [ ] **Step 2: Return the flag**

Replace the function's tail:

```ts
  if (input.id && !rows[0]) return { id: "", error: "Not found" };
  const id = stringOrEmpty(rows[0]?.id);
  const inserted = input.id ? false : rows[0]?.inserted !== false;
  await writeAudit(actor.staffId, inserted ? "faq.create" : "faq.update", "faq", id);
  return { id, inserted };
```

- [ ] **Step 3: Verify**

Run: `npm run test:content-copilot && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: PASS; error count `56`

- [ ] **Step 4: Commit**

```bash
git add src/lib/neon/admin-data.server.ts
git commit -m "fix(cms): upsert FAQs instead of throwing on a duplicate question

20260801090000 added UNIQUE (scope, question) but left this caller on a bare
INSERT -- the migration's own comment names it as the reason duplicates existed,
and the one-off import script got the upsert while the production path did not.

The admin import loops saveAdminFaq with no per-row recovery, and the 23505
surfaces as a raw toast that aborts mid-file, leaving refreshCmsData() and the
knowledge rebuild unrun. The returned inserted flag lets the import report
created versus updated counts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: Make the staff seed additive and transactional

**Files:**
- Modify: `src/lib/staff/licence.ts` (append)
- Modify: `src/lib/staff/licence.test.ts` (append)
- Modify: `scripts/neon/seed-staff.mjs:30-97`

**Background:** three defects. The `ON CONFLICT DO UPDATE` forces `active = true, show_on_website = true` and overwrites `name_en`/`job_title`/`branch`/`avatar_url`/`display_order`, contradicting the COALESCE rationale two lines above it — so a re-run republishes a departed agent and reverts admin corrections. A numeric phone in the contacts JSON is truthy, so `input.replace` throws mid-loop, and with 23 separate auto-committed HTTP round trips the roster is left half-published. And `normalisePhone` accepts fixed-line prefixes 2 and 3, so an office DID becomes a dead `wa.me` link presented as the agent's own number.

- [ ] **Step 1: Write the failing test for `normaliseWhatsapp`**

Append to `src/lib/staff/licence.test.ts`:

```ts
import { normaliseWhatsapp } from "./licence";

describe("normaliseWhatsapp", () => {
  test("accepts a mobile number", () => {
    expect(normaliseWhatsapp("9123 4567")).toBe("91234567");
    expect(normaliseWhatsapp("+852 6123 4567")).toBe("61234567");
  });

  test("rejects a fixed line, which cannot receive WhatsApp", () => {
    // 26882883 is the 青山公路豪景分行 switchboard. Writing it into the WhatsApp
    // column produces a wa.me link that answers "not on WhatsApp", presented on
    // the card as the agent's own number.
    for (const input of ["2688 2883", "26886996", "3123 4567"]) {
      expect(normaliseWhatsapp(input)).toBeNull();
    }
  });

  test("handles null and undefined without throwing", () => {
    expect(normaliseWhatsapp(null)).toBeNull();
    expect(normaliseWhatsapp(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/staff/licence.test.ts`
Expected: FAIL — `normaliseWhatsapp` is not exported

- [ ] **Step 3: Implement it**

Append to `src/lib/staff/licence.ts`:

```ts
/**
 * WhatsApp needs a mobile number. normalisePhone accepts fixed-line prefixes 2
 * and 3, so an office DID transcribed off a namecard would otherwise be written
 * to the whatsapp column and rendered as a wa.me link that does not resolve.
 */
const HK_MOBILE = /^[569]\d{7}$/;

export function normaliseWhatsapp(input: string | null | undefined): string | null {
  const digits = normalisePhone(input);
  return digits && HK_MOBILE.test(digits) ? digits : null;
}
```

Note this intentionally does not add mobile prefixes 4, 7 and 8. Those are deferred with `HK_PHONE` (spec §Deferred) because adding prefix 8 without also fixing `normalisePhone`'s `.replace(/^852/, "")` would corrupt a genuine 8-prefixed number.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/staff/licence.test.ts`
Expected: PASS

- [ ] **Step 5: Replace the contacts loading and loop in the seed script**

In `scripts/neon/seed-staff.mjs`, replace lines 22–23 to import the new validator:

```js
import { SITE_TEAM } from "../../src/config/site-team.ts";
import { normaliseLicence, normalisePhone, normaliseWhatsapp } from "../../src/lib/staff/licence.ts";
```

Replace lines 30–36 (the contacts loading) with a guard-then-read that also validates shape:

```js
const contactsPath = process.argv[2];
if (contactsPath && !existsSync(contactsPath)) {
  console.error(`Contacts file not found: ${contactsPath}`);
  process.exit(1);
}
const contacts = contactsPath ? JSON.parse(readFileSync(contactsPath, "utf8")) : {};

// Every value is hand-transcribed into a hand-authored file with no schema, and
// an unquoted number is the natural thing to type for a HK number (they have no
// leading zero). It is truthy, so normalisePhone's `if (!input)` guard misses it
// and `input.replace` throws partway through the loop.
const shapeErrors = [];
for (const [slug, contact] of Object.entries(contacts)) {
  if (typeof contact !== "object" || contact === null) {
    shapeErrors.push(`${slug}: expected an object, got ${typeof contact}`);
    continue;
  }
  for (const field of ["phone", "whatsapp", "licence"]) {
    const value = contact[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      shapeErrors.push(`${slug}.${field}: expected a string, got ${typeof value} (${value})`);
    }
  }
}
if (shapeErrors.length) {
  console.error("Contacts file has invalid values:\n  " + shapeErrors.join("\n  "));
  process.exit(1);
}
```

- [ ] **Step 6: Collect the statements instead of awaiting each one**

Three edits inside the existing `for (const [index, member] of SITE_TEAM.entries())` loop.

First, add a statements array next to `const rejected = [];` at line 39:

```js
const rejected = [];
const statements = [];
```

Second, replace line 44 so WhatsApp gets its own validator:

```js
  const whatsapp = normaliseWhatsapp(contact.whatsapp ?? contact.phone);
```

Third, stop awaiting each insert. Line 57 currently reads `  await sql\`` and the statement closes with `  \`;` at line 80. Change the opening to:

```js
  statements.push(sql`
```

and the closing to:

```js
  `);
```

The `neon()` HTTP driver returns a lazy query object from the tagged template, so pushing it without awaiting is exactly what `sql.transaction()` expects. Do not add `await` back.

- [ ] **Step 7: Rewrite the upsert to be additive**

Replace the `ON CONFLICT` clause (lines 65–78):

```sql
    ON CONFLICT (public_slug) DO UPDATE SET
      -- Additive only. Neon is the source of truth now, so the admin panel is
      -- where corrections happen; this script's job is to make sure the 23 rows
      -- exist, not to force them to match the file. Overwriting reverted admin
      -- edits, and forcing active/show_on_website republished agents an admin had
      -- deliberately unpublished.
      name_en = COALESCE(staff_users.name_en, EXCLUDED.name_en),
      name_zh = COALESCE(staff_users.name_zh, EXCLUDED.name_zh),
      job_title = COALESCE(staff_users.job_title, EXCLUDED.job_title),
      branch = COALESCE(staff_users.branch, EXCLUDED.branch),
      phone = COALESCE(staff_users.phone, EXCLUDED.phone),
      whatsapp = COALESCE(staff_users.whatsapp, EXCLUDED.whatsapp),
      licence_no = COALESCE(staff_users.licence_no, EXCLUDED.licence_no),
      avatar_url = COALESCE(staff_users.avatar_url, EXCLUDED.avatar_url)
      -- active, show_on_website and display_order are set on INSERT only.
```

- [ ] **Step 8: Run the statements atomically and fix the count check**

After the loop, add:

```js
await sql.transaction(statements);
```

Replace the count query and check (lines 82–95):

```js
const [counts] = await sql`
  SELECT count(*) FILTER (WHERE active AND show_on_website)::int AS published,
         count(*) FILTER (WHERE active AND show_on_website AND branch IS NOT NULL)::int AS with_branch,
         count(*) FILTER (WHERE active AND show_on_website AND whatsapp IS NOT NULL)::int AS with_whatsapp
  FROM staff_users`;

console.log(
  `published=${counts.published} with_branch=${counts.with_branch} with_whatsapp=${counts.with_whatsapp}`,
);
if (rejected.length) console.log("rejected (left null):\n  " + rejected.join("\n  "));

// active AND show_on_website is the predicate listPublicAgentProfiles uses, so
// this counts what the public page will actually render.
if (counts.published !== SITE_TEAM.length) {
  console.error(
    `EXPECTED ${SITE_TEAM.length} published rows, got ${counts.published}. A different count means a row without a roster slug got published, or a roster row is inactive.`,
  );
  process.exit(1);
}
```

- [ ] **Step 9: Verify the script parses and the suite passes**

Run: `node --check scripts/neon/seed-staff.mjs && npm run test:property-experience`
Expected: no output from `node --check`; suite PASS

Do **not** run the script itself — it needs a production `DATABASE_URL`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/staff/licence.ts src/lib/staff/licence.test.ts scripts/neon/seed-staff.mjs
git commit -m "fix(seed): make the staff seed additive, transactional and shape-checked

The upsert forced active and show_on_website true and overwrote name_en,
job_title, branch, avatar_url and display_order -- so a re-run republished an
agent an admin had deliberately unpublished and reverted their corrections to
the manifest values. That contradicted the COALESCE comment two lines above it.
Now Neon is the source of truth the rule is 'make sure these rows exist', not
'force them to match the file'.

A numeric phone in the hand-authored contacts JSON is truthy, so normalisePhone's
guard missed it and input.replace threw mid-loop -- with 23 separate
auto-committed HTTP round trips that left the roster half-published. The file is
now shape-checked before any write and the statements run in one transaction.

normaliseWhatsapp requires a mobile prefix. normalisePhone accepts fixed lines,
so an office DID off a namecard became a wa.me link that does not resolve,
presented on the card as the agent's own number.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 13: Stop the FAQ import clobbering admin ordering

**Files:**
- Modify: `scripts/neon/import-faqs.mjs:36-43`

**Background:** `SET sort_order = EXCLUDED.sort_order` re-numbers every matched FAQ to its position in the whole parsed file, so a re-import silently reverts an admin's drag-and-drop ordering from `reorderAdminFaqs`. The script is also add-only, so an FAQ removed from the seed file stays published while the row count only grows.

- [ ] **Step 1: Replace the loop**

Replace lines 36–43:

```js
for (const row of rows) {
  await sql`
    INSERT INTO faqs (scope, question, answer, sort_order)
    VALUES (${row.scope}, ${row.question}, ${row.answer},
            (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM faqs WHERE scope = ${row.scope}))
    ON CONFLICT (scope, question) DO UPDATE
      -- sort_order is deliberately not updated. It used to be set to the row's
      -- position in the whole parsed file, which silently reverted any ordering
      -- an admin had set through the CMS reorder.
      SET answer = EXCLUDED.answer
  `;
}
```

- [ ] **Step 2: Report what the file no longer contains**

After the `after` count log, add:

```js
// Add-only: a question retracted from the seed file stays published, and the
// row count only grows, so nothing surfaces it. Report rather than delete --
// an admin may have authored the extra FAQ deliberately.
const scopes = [...new Set(rows.map((row) => row.scope))];
const seeded = new Set(rows.map((row) => `${row.scope} ${row.question}`));
const existing = await sql`
  SELECT scope, question FROM faqs
  WHERE scope = ANY(${scopes})
  ORDER BY scope, question
`;
const orphans = existing.filter((row) => !seeded.has(`${row.scope} ${row.question}`));
if (orphans.length) {
  console.log(
    `in the database but not in ${SOURCE} (left published):\n  ` +
      orphans.map((row) => `${row.scope}: ${row.question}`).join("\n  "),
  );
}
```

The diff runs in JavaScript rather than as a SQL row-array comparison because the Neon HTTP driver's parameter serialisation for composite arrays is fiddly, and this is one pass over roughly 22 rows.

- [ ] **Step 3: Verify**

Run: `node --check scripts/neon/import-faqs.mjs`
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add scripts/neon/import-faqs.mjs
git commit -m "fix(faq): stop the seed import reverting admin FAQ ordering

SET sort_order = EXCLUDED.sort_order renumbered every matched row to its
position in the whole parsed file, so a re-import silently undid any ordering an
admin had set through the CMS reorder -- which writes sort_order via unnest WITH
ORDINALITY and leaves an audit entry, so the revert had no trace explaining it.

New rows now take max-within-scope + 1, and the script reports FAQs present in a
seeded scope but absent from the file rather than leaving a retracted answer
published behind a row count that only grows.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 14: Full verification

**Files:** none — this task runs gates and records results.

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:property-experience`
Expected: PASS on both halves. Record the counts.

- [ ] **Step 2: Run every other suite the changes touch**

Run: `npm run test:content-copilot`
Expected: PASS (covers the FAQ import path and admin data contracts)

- [ ] **Step 3: Typecheck against the baseline**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `56`. If higher, the new errors are yours — fix them. Do not "fix" pre-existing ones.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success

- [ ] **Step 5: Migration dry run**

Point `DATABASE_URL` at a scratch Neon branch (create one with `neonctl branches create`) and run:

```bash
npm run neon:migrate
```

Expected: JSON output with every migration `applied` or `skipped`, exit 0. Then run it a **second** time and confirm exit 0 again — that is the regression this whole task set exists to prevent, and nothing in CI covers it.

If you cannot get a scratch branch, say so explicitly in your report rather than marking this step done.

- [ ] **Step 6: Record what could not be verified locally**

Production Neon is not reachable from this environment, so these need checking on the preview deployment before merge:

- `/agents` renders 23 cards
- unchecking 公開顯示 on one agent in `/admin/agents` removes them from `/agents` and the homepage
- an agent's card and their `/agents/<slug>` page name the same branch and dial the same number
- editing and saving any field of a seeded agent succeeds (Task 2)

- [ ] **Step 7: Commit any fixes and push**

```bash
git push -u origin fix/agent-directory-remediation
```

---

## Deferred, deliberately not in this plan

Recorded so a later reader does not think they were missed. Reasons are in the spec's "Deferred" section.

- **Findings 14 and 15** — `EAA_INDIVIDUAL` accepting 25 of 26 letter prefixes, and `HK_PHONE` rejecting HK mobile prefixes 4/7/8. Both dormant: every `licenceNo`, `phone` and `whatsapp` in the roster is null. They must be fixed together, because adding prefix 8 without also fixing `normalisePhone`'s `.replace(/^852/, "")` would corrupt a genuine 8-prefixed number.
- **Branch as a modelled entity** (`branch_id` foreign key plus a `<Select>`). After Task 3 a typo degrades to "no branch named" rather than "the wrong branch named", which is safe.
- **The redundant second unique index on `public_slug`.** Not a live defect — Postgres checks unique indexes in OID order and the older `staff_users_public_slug_unique` has the lower OID, so `agentProfileSlugConflictError` still matches.
- **`ops_audit_logs` entries for both scripts.** Script hygiene, not a live defect.
- **The two new note strings** in Task 3 are customer-facing Chinese copy and should be confirmed with the client before release. They are accurate as drafted; only the wording is open.
