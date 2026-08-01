# Agent Directory Remediation — Design

Date: 2026-08-01
Status: approved, ready for planning
Supersedes the agent-directory decisions in PR #32 (`feat/agent-directory-merge`, merged as `06aff2d`).

## Context

PR #32 shipped five changes together: a per-field merge between Neon `staff_users` and the static
`SITE_TEAM` manifest, unique constraints on `staff_users.public_slug` and `faqs`, transcription
validators for phone and licence numbers, a staff seed script, and a FAQ import script. It was
executed against `docs/superpowers/plans/2026-08-01-data-completion.md`, which was never committed
and does not exist in the repository or in git history.

A max-effort review of the merge found 15 confirmed defects. Three are live in production now,
because the seed script was run against the production Neon branch (`published=23, with_branch=22`,
per commit `c5ff3bb`):

- `neon/migrations/20260801090000_staff_public_slug_unique.sql` cannot apply to any database built by
  replaying the migration set. It re-adds `faqs_scope_question_key`, which
  `20260622060000_public_content.sql:85` already declares inline. The runner has no transaction, so
  statement 1 commits, statement 2 fails, `app_migrations` is never written, and every retry then
  dies on statement 1. Fresh dev machines, CI, and Neon preview branches are wedged.
- Every one of the 23 seeded agents is unsaveable in the admin panel. The seed writes root-relative
  `avatar_url` values (`/team/tommy-yiu.jpg`); `AgentProfileForm` validates that column with
  `z.string().trim().url()`, which rejects them. The form validates the whole object and returns
  before `saveAdminAgentProfile` is called, so editing any field of any agent fails.
- There is no way to unpublish an agent. `resolveDisplayAgents` renders every `SITE_TEAM` member
  unconditionally, so unchecking `show_on_website` returns the agent to the page with the manifest's
  values.

### A correction to the review

The review flagged the seeded job titles and branches as unverified, citing the
`// TODO: confirm job title` and `// TODO: confirm branch assignment` comments in
`src/config/site-team.ts`. Those comments are stale. CHANGELOG PHASE 4 records 加分行及 Title as
complete — the client supplied all 23 titles and branches in PR #30, and the roster reconciled
exactly when Michael Wong was removed (24 − 1 = 23).

What renders on those cards is therefore client-approved. What is genuinely still outstanding is
`nameZh`, `phone`, `whatsapp` and `licenceNo`, all null across all 23 entries and all tracked in
`TODO-ASSETS.md`. This materially reduces the severity of the vanished 資料整理中 caveat and changes
its fix: delete the stale comments, do not preserve the caveat.

## Goals

Remediate the defects that are live or that block work, and remove the layer they live in.

## Non-goals

- Production activation (`AI_GATEWAY_*`, `WOZTELL_*`, `BLOB_READ_WRITE_TOKEN`, the worker cron).
  Tracked in `docs/production-activation-status.md`.
- The client-blocked items in `TODO-ASSETS.md` (estate photos, the 麗都 shopfront, agent contact
  details, the five new estate slugs).
- Modelling branch as a foreign key or enum. The render-time string match is retained; see
  Deferred below.

## Decisions

1. **Scope is the live defects plus the cleanup that enables them.** The two dormant validator
   fixes are deferred; everything else is in.
2. **No production data repair.** The 23 rows are correct. Every fix is a code fix, and the
   `avatar_url` fix is specifically a schema relaxation rather than a column rewrite so it stays
   that way.
3. **Neon is the source of truth.** `src/config/site-team.ts` demotes to seed input.
4. **Collapse to one shape.** `DisplayAgent` and its mappers are deleted rather than repaired.

Decision 4 follows from decision 3. The mapper layer existed to reconcile two sources; with one
source it is ceremony, and three of the confirmed defects (`preferLive`'s null rule, the
`isPlaceholder` literal, the `display_order`/array-index mixing) were properties of that layer rather
than bugs inside it. Deleting it removes the class.

---

## 1. Architecture

### Deleted

From `src/lib/agent-directory.ts`: the `DisplayAgent` type, `fromDbProfile`, `fromPlaceholder`,
`preferLive`, `resolveDisplayAgents`, and the runtime `SITE_TEAM` import.

### Added

One exported function in the same file, keeping the existing module path:

```ts
export type AgentContact = {
  homeBranch: SiteBranch | null;
  phone: string | null;
  whatsapp: string | null;
  phoneIsFallback: boolean;
  whatsappIsFallback: boolean;
};

export function resolveAgentContact(profile: NeonPublicAgentProfile): AgentContact;
```

Rules:

- `homeBranch` = `SITE_BRANCHES.find((b) => b.name === profile.branch) ?? null`. No fallback to
  `SITE_BRANCHES[0]`. A null branch, or a branch string that does not match, yields `null`.
- `phone` = `profile.phone || homeBranch?.phone || SITE_CONTACT.phoneTel || null`.
- `whatsapp` = `profile.whatsapp || profile.phone || SITE_CONTACT.whatsappPhone || null`.

`||` rather than `??` is deliberate for the two `SITE_CONTACT` terms: `phoneTel` is
`import.meta.env.VITE_CONTACT_PHONE_TEL ?? ""` (`src/config/site.ts:5`), so it is an empty string
when unset, not null, and `??` would return `""` and produce a `tel:+` href with no number.
- `phoneIsFallback` = `!profile.phone`.
- `whatsappIsFallback` = `!profile.whatsapp && !profile.phone`.

Returning `null` for `homeBranch` fixes the 董事 case: Kenneth Chang has `branch: null`, the card
deliberately renders no branch label, and today the follow-up note names 麗都分行 two lines below
that blank. Splitting the single `usesGeneralContact` boolean into two flags fixes the WhatsApp-only
agent whose 電話聯絡 button dials a branch switchboard with the disclosure suppressed.

### Data flow

`listPublicAgentProfiles` → `NeonPublicAgentProfile[]` → JSX. No intermediate shape.

Ordering comes from the query's existing
`ORDER BY COALESCE(display_order, 0), COALESCE(name_zh, name_en), s.id`. The seed wrote
`display_order = index`, so the client-approved order is preserved with no client-side sort. The
homepage's `resolveDisplayAgents(agentProfiles, 6)` becomes `agentProfiles.slice(0, 6)`.

Unpublishing works by construction: `listPublicAgentProfiles` filters
`active = true AND show_on_website = true` and nothing re-adds rows downstream.
`DirectoryEmptyState` in `src/routes/agents.tsx` stops being unreachable and becomes the honest
zero-row rendering.

### Consequence: drop `display_order` from the public projection

`src/lib/agent-directory.ts:97` and `:110` are the only readers of
`NeonPublicAgentProfile.display_order`, and both are being deleted. Remove the field from
`public-data.types.ts` and remove `(to_jsonb(s)->>'display_order')::integer AS agent_display_order`
from `publicAgentProfileColumns`.

The `ORDER BY` at `public-data.server.ts:553` computes its own separate expression and is unaffected.
The admin path reads `display_order` through `admin-data.server.ts`, a different column list, and is
also unaffected.

This reverts PR #32's type change and, as a side effect, removes a third whole-row `to_jsonb(s)`
serialization from every listing row — `publicAgentProfileColumns` is inlined into `listingColumns`,
so it was running on `/listings` (12 rows), `/videos` (36 rows) and every property page.

### `src/config/site-team.ts`

Demoted to seed input. Its only consumer becomes `scripts/neon/seed-staff.mjs`.

- Rewrite the header. It currently describes the file as a render-time fallback that "becomes unused
  and can be deleted", and states 24 entries where there are 23.
- Drop the `isPlaceholder: true` field and rename the type `TeamMemberPlaceholder` → `TeamSeedMember`.
- Delete `getTeamPreview` (line 291) — it has no callers.
- Delete the `// TODO: confirm job title` and `// TODO: confirm branch assignment` comments, which
  the client resolved in PHASE 4. Keep the `nameZh`, `phone`, `whatsapp` and `licenceNo` TODOs.

### Files touched

`src/lib/agent-directory.ts`, `src/lib/agent-directory.test.ts`, `src/routes/agents.tsx`,
`src/routes/agents_.$slug.tsx`, `src/routes/index.tsx`, `src/config/site-team.ts`,
`src/lib/neon/public-data.types.ts`, `src/lib/neon/public-data.server.ts`.

---

## 2. Database and scripts

### Migration `20260801090000`

Edited in place. Production already recorded it — both statements succeeded there — and
`apply-migrations.mjs` skips any version present in `app_migrations`, so an in-place edit cannot
re-run against production and will fix every fresh database.

Both `ALTER TABLE ... ADD CONSTRAINT` statements get the guard pattern already used at
`20260622060000_public_content.sql:3-8`:

```sql
DO $$
BEGIN
  ALTER TABLE faqs ADD CONSTRAINT faqs_scope_question_key UNIQUE (scope, question);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;
```

Catching only `duplicate_object` and `duplicate_table` is deliberate. A `unique_violation` raised by
real duplicate rows must still fail loudly rather than silently skipping constraint creation.

Correct the comment block. It states that no unique constraint was ever created on `public_slug`;
`20260710090000_agent_profiles.sql:7` already created a partial one. The accurate reason the new
constraint was needed is that Postgres cannot infer a partial unique index as an `ON CONFLICT`
arbiter without restating its predicate.

### `saveAdminFaq`

`src/lib/neon/admin-data.server.ts:1121` gains the upsert the migration's own comment says it needs:

```sql
ON CONFLICT (scope, question) DO UPDATE SET answer = EXCLUDED.answer
RETURNING id, (xmax = 0) AS inserted
```

`sort_order` is deliberately not updated — see the import script below. The `inserted` flag lets the
admin import report 「N 新增，M 更新」 instead of aborting mid-file and leaving `refreshCmsData()`
and the knowledge rebuild unrun.

### `scripts/neon/seed-staff.mjs`

Its contract changes from "force these 23 rows to match the file" to "make sure these 23 rows
exist". That is what makes re-running safe now the database is authoritative; corrections happen in
the admin panel.

- `ON CONFLICT DO UPDATE` COALESCEs every column and touches neither `active`, `show_on_website` nor
  `display_order`. Those three are set on INSERT only. A re-run can fill a gap but can never
  republish a departed agent, revert an admin's correction, or undo a reorder.
- Validate the contacts JSON shape before the loop begins. A non-string `phone`, `whatsapp` or
  `licence` exits non-zero naming the slug and field, rather than throwing
  `input.replace is not a function` partway through.
- Move all 23 upserts into one `sql.transaction([...])`, the pattern already used at six call sites
  via `src/lib/neon/db.server.ts:31`. One round trip, and no half-seeded roster on failure.
- Add `normaliseWhatsapp`, which requires a mobile prefix. `normalisePhone` accepts fixed-line
  prefixes 2 and 3, so an office DID transcribed from a namecard currently becomes a dead `wa.me`
  link presented as the agent's own number.
- The final count uses `active AND show_on_website` — the predicate the public page uses — and calls
  `process.exit(1)` on mismatch instead of logging to stderr and exiting 0.

### `scripts/neon/import-faqs.mjs`

- On conflict, update `answer` only. Leave `sort_order` alone, so a re-import no longer reverts an
  admin's drag-and-drop ordering from `reorderAdminFaqs`.
- New rows get `sort_order` = max within their scope + 1, rather than their position in the whole
  parsed file.
- Report any FAQ present in the database under a seeded scope but absent from the seed file. Do not
  delete it. The script is currently add-only and silently leaves retracted answers published, with
  a row count that only grows.

---

## 3. Admin panel and routes

### `avatar_url` validation

`src/components/admin/AgentProfileForm.tsx:28` becomes a `refine` accepting an empty string, a
`/`-prefixed path, or an `http(s)://` URL, and rejecting anything else so an `<img src>` cannot be
pointed at an arbitrary scheme. The 23 production rows keep their existing values.

### `display_order` for new profiles

The form's initial value for a *new* profile becomes `""` with placeholder 「留空自動排在最後」, and
`saveAdminAgentProfile` maps an empty value on create to
`COALESCE(MAX(display_order), -1) + 1`. Today it sends `"0"`, which ties with Kenneth Chang at the
top of the roster. Editing an existing profile is unchanged.

### Both routes

`src/routes/agents.tsx` and `src/routes/agents_.$slug.tsx` call `resolveAgentContact` and derive
nothing else. `DEFAULT_AGENT_BRANCH` is deleted from both; neither imports `SITE_BRANCHES`. The
branch label stays conditional in both files. Each contact button renders when its number is
non-null.

### Follow-up note copy

The current single string is wrong in two of the four cases. Proposed replacements:

Both dimensions matter — which numbers are the agent's own, and whether `homeBranch` resolved — so
all five reachable combinations are enumerated:

| `profile.phone` | `profile.whatsapp` | `homeBranch` | Note |
| --- | --- | --- | --- |
| set | any | any | none — both rendered numbers are the agent's own |
| null | null | resolved | 代理未有提供直接聯絡方式，電話查詢將由{branch}跟進。 (unchanged) |
| null | null | null | 代理未有提供直接聯絡方式，請使用一般查詢。 |
| null | set | resolved | WhatsApp 為代理直綫，電話查詢將由{branch}跟進。 |
| null | set | null | WhatsApp 為代理直綫，電話查詢請使用一般查詢。 |

Row 3 is the live defect — it is what all 23 agents hit today for Kenneth Chang, whose branch is
null. Rows 4 and 5 are currently unreachable and become reachable the moment a WhatsApp number is
entered without a phone number.

These two new strings are customer-facing Chinese copy and should be confirmed with the client
before release, consistent with how PHASE 4–7 copy was handled. They are not blocking: the drafts
are accurate, and only the wording is at issue.

---

## 4. Testing

### Behavioural tests

`src/lib/agent-directory.test.ts` is rewritten against `resolveAgentContact`:

- a 海韻分行 agent resolves `homeBranch.phone` to 海韻's number, not 麗都's;
- an agent with `branch: null` resolves `homeBranch` to `null`;
- an agent whose `branch` string matches no `SITE_BRANCHES` entry resolves `homeBranch` to `null`;
- an agent with `whatsapp` but no `phone` reports `phoneIsFallback: true` and
  `whatsappIsFallback: false`;
- an agent with a `phone` and no `whatsapp` reports both flags false.

The current file's ordering test (`resolveDisplayAgents([], 3)`) passes zero DB profiles and so
cannot fail; it is removed along with the function it tests. Ordering becomes the query's
responsibility, which `src/lib/neon/agent-profiles.contract.test.mjs:88-93` already asserts —
it pins `ORDER BY COALESCE((to_jsonb(s)->>'display_order')::integer, 0) ASC`. No new assertion is
needed there, and that test keeps passing after the projection column is dropped, because the
`ORDER BY` computes its own separate expression.

### Contract test surgery

`src/routes/agents.contract.test.mjs` — the block at lines 150–176 has six assertions that break
under this refactor, because both routes stop importing `SITE_BRANCHES` and `DEFAULT_AGENT_BRANCH`
and the `??` chains move into the resolver:

- `assert.match(source, /SITE_BRANCHES/)` — remove; the symbol moves to the resolver.
- `assert.match(source, /DEFAULT_AGENT_BRANCH/)` — remove; the symbol is deleted.
- `assert.match(source, /(?:profile|agent)\.phone\s*\?\?/)` — remove; covered behaviourally.
- `/SITE_BRANCHES\.find\(\(entry\) => entry\.name === agent\.branch\)/` — remove; covered
  behaviourally. It pins an anonymous lambda parameter name.
- `/電話查詢將由\{homeBranch\.name\}跟進/` — remove; it pins a local variable name and JSX
  whitespace, and the copy is changing.
- `assert.doesNotMatch(source, /(?:profile|agent)\.branch\s*\?\?/)` — keep.
- `assert.match(source, /\{branch \? </)` — keep; both routes still render branch conditionally.

Retain one source-level guard, since it is the kind of claim only source inspection can make: no
route hardcodes a branch fallback. Extend it across both routes and to the profile page's
`查詢將由` spelling, which the current guard misses because it looks only for `電話查詢將由`.

### Gates

- `npm run test:property-experience`
- `npx tsc --noEmit`, held at its 56-error pre-existing baseline with no new errors
- `npm run build`
- `npm run neon:migrate` against a scratch Neon branch. Nothing in CI runs this today, which is why
  the wedged migration reached main.

### Not verifiable locally

The seeded production data. Production Neon is not reachable from here, so the claim that `/agents`
renders 23 cards and that unchecking `show_on_website` removes an agent must be checked on the
preview deployment before merge.

---

## Findings coverage

| # | Finding | Resolved by |
| --- | --- | --- |
| 1 | Migration cannot apply on a fresh DB | §2 |
| 2 | Seeded `avatar_url` blocks all admin edits | §3 |
| 3 | No unpublish path | §1 |
| 4 | Seed re-run republishes and reverts | §2 |
| 5 | `display_order` default hoists agents up the roster | §1 ordering, §3 append default |
| 6 | Profile route contradicts `/agents` | §1, §3 |
| 7 | `isPlaceholder` hides the 資料整理中 caveat | §1 — the flag is deleted; data is client-approved |
| 8 | `saveAdminFaq` bare INSERT | §2 |
| 9 | Numeric contact value half-seeds the roster | §2 |
| 10 | Admin-cleared fields resurrect from the manifest | §1 — the merge is deleted |
| 11 | Fixed-line number written into the WhatsApp column | §2 |
| 12 | WhatsApp-only agent shows a switchboard as their own number | §1 flags, §3 copy |
| 13 | FAQ re-import clobbers admin ordering | §2 |
| 14 | Licence regex accepts 25 of 26 prefixes | Deferred |
| 15 | Phone regex rejects HK 4/7/8 prefixes | Deferred |

Resolved incidentally, having been reported as lower-severity items: the stale JSDoc describing
deleted behaviour and the vacuous ordering test both disappear with the rewrite, and the third
`to_jsonb(s)` per listing row is removed as a consequence of dropping an unused projection.

## Deferred, with reasons

- **Findings 14 and 15.** Both are dormant: every `licenceNo`, `phone` and `whatsapp` in the roster
  is null, so neither validator runs on real input today. They must be fixed together — adding
  prefix 8 to `HK_PHONE` without also fixing `normalisePhone`'s `.replace(/^852/, "")` would corrupt
  a genuine 8-prefixed number into a rejection. The natural time is when `agent-contacts.json`
  arrives, which is the next `TODO-ASSETS.md` item.
- **Branch as a modelled entity.** `staff_users.branch` is free text and the admin form is a plain
  `<Input>`, so a typo silently yields `homeBranch: null`. After this change that degrades to "no
  branch named in the note" rather than "the wrong branch named", which is safe. A `branch_id`
  foreign key with a `<Select>` is the real fix and is a separate piece of work.
- **The redundant second unique index on `public_slug`.** `20260801090000` adds
  `staff_users_public_slug_key` alongside the existing partial
  `staff_users_public_slug_unique`, and `agentProfileSlugConflictError` matches only the older name.
  Postgres checks unique indexes in OID order and the older index has the lower OID, so the friendly
  "slug taken" message still fires reliably. Not a live defect; cleaning it up means dropping an
  index in production.
- **Audit entries for both scripts.** Neither writes to `ops_audit_logs`, so a seeded change has no
  attribution. Worth doing, but it is script hygiene rather than a live defect.

## Open items needing client input

- The two new note strings in §3. Drafts supplied; wording only.
