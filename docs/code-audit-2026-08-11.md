# Code Audit — 11 Aug 2026

> **Status:** MUST FIX 1–5 are **done**, together with SHOULD FIX 7 and 8 (7 is
> not separable from 5). The fixes were then put through a second adversarial
> review, which found 9 real defects in them — including two regressions the
> first pass introduced. Those are fixed too; see "Fix pass" at the bottom.
>
> **Update:** every remaining item (SHOULD FIX 6, 9–14 and all of OPTIONAL
> 15–25) has since been fixed too, and re-reviewed — that pass found 14 more
> real defects, including a HIGH regression the fix pass itself introduced in the
> job runner. All 14 are fixed. See "Second fix pass" at the bottom.
>
> Still open: item 26 only, which needs a product decision (delete the dead CMS
> revision subsystem and drop its table, or wire it up).

Full-repo defect audit. Method: deterministic toolchain checks, then 8 parallel
finder passes (authz, SQL/data, React, silent-failure, dead code, tests, prod
config, input security), each finding put through an independent adversarial
verifier instructed to refute it.

**61 raw findings → 32 survived verification → 29 refuted.**
The 5 MUST-FIX items and the dead-cron item were additionally re-verified by hand
against source; every quoted line below was read directly.

## Toolchain: green

| Check               | Result   |
| ------------------- | -------- |
| `npx tsc --noEmit`  | 0 errors |
| `npm run lint`      | clean    |
| `npm run build`     | passes   |
| 16 `test:*` scripts | all pass |

Nothing is broken in the committed, wired-up state. Everything below is a latent
defect that the current checks do not catch.

---

## MUST FIX

### 1. Stored XSS in every JSON-LD block (18 sinks)

`dangerouslySetInnerHTML={{ __html: JSON.stringify(x) }}` across 12 route files.
`JSON.stringify` escapes neither `<` nor `/`, so a `</script>` inside any
staff-editable or MLS-scraped field breaks out of the `<script type="application/ld+json">`
element. SSR'd, so it fires for anonymous visitors. Auth is cookie-based
(`auth.server.ts`) and there is no CSP — an agent-role account escalates to admin.

`src/lib/schema.ts` does no escaping.

Fix — add to `src/lib/schema.ts`:

```ts
export const jsonLdScript = (o: unknown) =>
  JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
```

then replace all 18 `__html: JSON.stringify(...)` sites. Files:
`property.$listingNo.tsx:761`, `estate.$slug.tsx:129,134`,
`castle-peak-road.index.tsx:136,141`, `castle-peak-road.$segment.tsx:253,258,264`,
`blog_.$slug.tsx:118`, `agents.tsx:49`, `agents_.$slug.tsx:63`, `listings.tsx:122`,
`videos.tsx:170`, `contact.tsx:101`, `index.tsx:551,601`, `district.sham-tseng.tsx:332`.

### 2. Unauthenticated WhatsApp consent forgery + contact hijack

`src/lib/neon/website-inquiry.js:34` — the public inquiry form's upsert:

```sql
ON CONFLICT (normalized_phone) DO UPDATE SET
  name  = COALESCE(EXCLUDED.name,  crm_contacts.name),
  email = COALESCE(EXCLUDED.email, crm_contacts.email),
  opt_in_whatsapp = crm_contacts.opt_in_whatsapp OR EXCLUDED.opt_in_whatsapp,
```

`OR EXCLUDED` lets anyone who knows a phone number flip that contact's marketing
consent to true. Forged opt-in flows straight into real blast delivery
(`campaign-delivery.server.ts:143`). `COALESCE(EXCLUDED.x, existing)` prefers the
_submitted_ value, so name/email are overwritten too. No rate limit on the path.
`live-agent.server.ts:337` has the same name/email overwrite.

Fix — `opt_in_whatsapp = crm_contacts.opt_in_whatsapp` (never raise it from a public
form); flip both COALESCE argument orders to `COALESCE(crm_contacts.x, EXCLUDED.x)`;
add `enforceRateLimit` in `createWebsiteInquiry` (`admin-data.ts:430`).

> Behaviour change: a returning customer can no longer correct their own name/email
> via the public form. Confirm with the agency before shipping.

### 3. Substring opt-out permanently bricks WhatsApp for real customers

`src/lib/woztell/woztell.server.ts:46`:

```ts
return ["stop", "unsubscribe", "取消", "停止", "退訂", "唔要", "不要"].some(
  (term) => text === term || text.includes(term),
);
```

The `includes` arm means 「我想**取消**今日睇樓約會」 opts the customer out of WhatsApp
entirely. The column is written monotonically — `api.woztell.webhook.ts:80`
`opted_out_whatsapp = opted_out_whatsapp OR $7` — and **no code path anywhere sets it
back to false**. Staff replies then 400 forever and the contact is excluded from every
campaign, permanently.

Fix — drop the `text.includes(term)` arm (keep punctuation-trimmed whole-message
equality) **and** add an admin/manager-gated reset server fn with an audit write,
surfaced on the 已拒收 badge at `admin.whatsapp.tsx:746`. The reset is the
load-bearing half; narrowing the match alone leaves every already-blocked contact stuck.

### 4. Any agent can send WhatsApp on any conversation

`src/routes/api.admin.woztell.send.ts:40` looks up `WHERE wc.id = $1` with no
`assigned_agent_id` filter. Every sibling path scopes agents —
`admin-data.server.ts` uses `agentScope(actor)` at lines 368, 469, 557, 1312, 1347,
1371, 1467, 1489. An `agent`-role token POSTing another agent's conversation UUID
sends a real WhatsApp message to a customer they cannot even read, stamped with
their own `sent_by`.

Fix — compute `agentScope(staff)`, append `AND (wc.assigned_agent_id = $2 OR $2::uuid IS NULL)`,
return 403 on no row.

### 5. Campaign delivery job is permanently un-enqueueable after its first run

`src/lib/control-plane/jobs.server.ts:58`:

```sql
ON CONFLICT (idempotency_key) DO UPDATE
  SET idempotency_key = EXCLUDED.idempotency_key
```

Self-assignment — a no-op that returns the **old terminal row**. The key is
campaign-stable. Once a campaign's job reaches `succeeded` or exhausts
`max_attempts=5`, re-queueing returns that dead row: the route answers
`202 {jobStatus:"succeeded"}`, the UI toasts 已排隊, nothing is ever in `queued`, and
the send-queue cron re-enqueues forever. `retryJob` cannot help —
`jobs.server.ts:261` only accepts `failed`/`cancelled`.

Fix — make the key attempt-scoped in `api.admin.campaigns.$id.queue.ts:20` and
`api.admin.jobs.send-queue.ts:26`:
`woztell.campaign.deliver:${campaignId}:${queuedAt.toISOString()}`.

> **Pair with item 7.** The stable key is currently the only thing preventing a
> re-materialized campaign from re-sending. Landing this alone converts a silent
> non-send into a duplicate billable send. `control-plane.test.mjs:367` pins the
> current ON CONFLICT string and must be updated.

---

## SHOULD FIX

**6. Two of three Vercel crons can never run.** `vercel.ts:41-42` schedules
`/api/admin/control-plane/worker` and `/api/admin/jobs/send-queue`; both register
**POST only** (`worker.ts:8`, `send-queue.ts:13`). Vercel crons issue GET. TanStack
falls through to the SPA render rather than 405, so the documented "Worker is down"
24h backstop silently does not exist. (`/api/mls-sync` is GET and is fine.)
Fix — export one handler under both `GET` and `POST`, keep the `Bearer ${CRON_SECRET}`
check, and add a test asserting every `vercel.ts` cron path has a GET handler.

**7. Re-materializing a campaign re-sends delivered messages.**
`admin-data.server.ts:2237` — the ON CONFLICT preserves only `sent`/`sending`, so a
recipient left at `WOZTELL_DELIVERY_UNKNOWN` (message _did_ reach the handset)
returns to `queued` and is billed and sent again. Fix — preserve rows where
`error = 'WOZTELL_DELIVERY_UNKNOWN'` too.

**8. Campaign status has no state machine.** `saveAdminCampaign`
(`admin-data.server.ts:2188`) writes `status=$4` unconditionally, and
`queueAdminCampaign`'s TOCTOU re-assert (`:2349`) accepts `'draft'`, contradicting
`canPrepareAdminCampaignQueue`. Fix — `AND c.status IN ('review','scheduled')`;
reject transitions out of `sending`/`completed`/`cancelled`.

**9. Nightly MLS sync deactivates what it failed to fetch, and reports `ok:true`.**
`mls/neon-db.mjs:106` guards only on non-empty; `parseMaxListingPage` falls back to
page 1 and the cron's `maxPages:50` already truncates a ~102-page source. Fix —
abort when `seenLegacyIds.length < 0.7 ×` active count, and return `ok:false` from
`api.mls-sync.ts:44`. Make the abort loud so a legitimate bulk delisting can be
overridden.

**10. Staff identity bound by unverified email.** `auth.server.ts:257` matches
`lower(s.email)` against rows with `auth_user_id IS NULL` and binds permanently.
`/auth/sign-up` is public and no `emailVerified` check exists in the repo. Anyone
registering a seeded-but-not-yet-activated staff address inherits that row's roles,
up to `admin`. Fix — require `neon_auth."user".email_verified` on the email branch,
or drop the fallback and activate staff by invite token.

**11. Media upload has no server-side type or size limit.**
`api.admin.media.upload.ts:20` passes the caller's MIME straight to a public blob for
any agent-role token; the only checks are client-side in `ImageUploader.tsx:15-16`.
Fix — allowlist `image/{jpeg,png,webp,avif}` and cap at 5 MB.
(Path-traversal and owner_type claims on this route were **refuted**.)

**12. Four missing `agentScope` filters** — all reachable with a UUID an agent
retained after reassignment:

| Site                                                                                | Defect                                                                                                     |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `admin-data.server.ts:1569` `createAdminLeadActivity`                               | writes notes/calls/`due_at` onto any lead; pollutes the owner's timeline and overdue KPI                   |
| `admin-data.server.ts:1433` `fetchAdminLeadAiProfile` / `analyzeAdminLeadAiProfile` | literal `void actor` — unscoped read _and_ overwrite of another agent's AI profile, plus a billed LLM call |
| `admin-data.server.ts:1446` AI tag approve/reject                                   | `WHERE id=$3` only; flips another agent's tags with your name on the audit row                             |
| `admin-data.ts:198` `getAdminProperty`                                              | `SELECT *` on any listing incl. drafts and internal columns; every sibling write is scoped                 |

> `admin.listings_.$id.tsx:46` is the only caller of `getAdminProperty`;
> `content-copilot-context.server.ts:117` already does its own scoped read and must
> not be double-filtered.

**13. ImageUploader resurrects deleted photos.** `ImageUploader.tsx:79`
`onChange([...value, ...uploaded])` closes over pre-upload state while remove/reorder
stay enabled, so a mid-upload delete is undone and the wrong image becomes the public
cover. Fix — functional updater, and `disabled={uploading}` on the input at `:128`.

**14. Dirty-lead close double-prompts and strands the URL.** `admin.leads.tsx:471` —
`setFilters` is a router navigate and `RouteLeaveBlocker`'s `shouldBlockFn: () => isDirty`
fires on same-route REPLACE. Cancelling the second dialog leaves `?lead=<id>` on a
closed panel. Fix — `shouldBlockFn: ({current,next}) => isDirty && current.routeId !== next.routeId`.

---

## OPTIONAL

| #   | Defect                                                                                                                                                                                                                      | Fix                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 15  | `jobs.server.ts:502` forces `limit: 1`, ignoring callers' `10`/`20`; reports `claimed:1`                                                                                                                                    | honour the limit with a cap that fits the function timeout, or delete the param (`control-plane.test.mjs:362` pins it) |
| 16  | Keyset cursors truncate µs→ms (`audit.server.ts:195`, `jobs.server.ts:478`), skipping same-ms rows across pages                                                                                                             | select `to_char(created_at,'…US"Z"')` and carry it verbatim                                                            |
| 17  | WhatsApp AI-assist card blanks every 30 s (`admin.whatsapp.tsx:233`)                                                                                                                                                        | thread the `background` flag through; skip the `setAiAssist(null)`                                                     |
| 18  | `admin.whatsapp.tsx:385` writes outside `listRequestRef`, so a poll overwrites the just-saved row                                                                                                                           | bump and re-check the ref around the fetch                                                                             |
| 19  | Segments editor is dirty on load (`admin.segments.tsx:141` tests non-empty defaults)                                                                                                                                        | compare against the seed constants                                                                                     |
| 20  | WhatsApp reply drafts are pure component state (`admin.whatsapp.tsx:117`)                                                                                                                                                   | persist to `sessionStorage` — do **not** wire a route blocker, see caveat                                              |
| 21  | Live-agent failures discard `err` and log nothing (`api.live-agent.handoff.ts:59`, `message.ts:60`)                                                                                                                         | `console.error` before the 500; wrap the 4 writes in `live-agent.server.ts:152-240` in `transactionRows`               |
| 22  | Failed AI-profile fetch renders as 「未有 AI profile」 (`admin.leads.tsx:289`)                                                                                                                                              | bind an `aiError` state, render 載入失敗                                                                               |
| 23  | `admin.operations.tsx:61` names nonexistent permission `system.audit.read` (real: `audit.read`)                                                                                                                             | fix the string; type `TAB_PERMISSIONS` as `Record<OperationTab, ControlPlanePermission \| null>`                       |
| 24  | Health check's `ai` key ignores `AI_GATEWAY_*` (`health.server.ts:56`), reports healthy while the gateway is unconfigured                                                                                                   | split `ai.gateway` / `ai.copilot`                                                                                      |
| 25  | `admin.blasts.tsx:333` keys the toast off the response id, so create says 已儲存 and 已新增 is dead                                                                                                                         | `const isUpdate = Boolean(campaignDraft.id)` before the request                                                        |
| 26  | Entire CMS revision workflow unreachable — `admin-cms.ts`, `admin-cms.server.ts`, `cms-revisions.ts`, `cms_content_revisions` not bundled in `.output/`; kept alive only by source-regex contract tests that imply it ships | delete it, or wire `admin.cms.tsx` to it — do not keep two write paths                                                 |

---

## Test-suite integrity

**12 test files under `src/` are not referenced by any `test:*` script**, and there
is no aggregate `npm test`. They run only if invoked by hand:

```
src/lib/ai/ai-contract.test.mjs                        <-- currently FAILING
src/lib/ai/ai-workflow.test.mjs
src/lib/neon/admin-cms.contract.test.mjs
src/lib/neon/admin-cms.server.contract.test.mjs
src/lib/neon/cms-public-isolation.contract.test.mjs
src/lib/neon/cms-schema-compatibility.contract.test.mjs
src/lib/neon/cms-revisions.test.mjs
src/lib/neon/cms-videos-schema.test.mjs
src/lib/neon/admin-workflow.test.mjs
src/config/neon-only.test.mjs
src/lib/contact-links.test.mjs
src/lib/ai/content-copilot-repository.behavior.test.ts
```

`ai-contract.test.mjs:256` asserts `/onClick=\{materializeSegment\}/` against
`admin.segments.tsx`. That is **stale, not a regression** — commit `6e13ff3` moved the
send behind `AdminConfirmDialog` (`admin.segments.tsx:335` → `:499`,
`admin.blasts.tsx:712`), which _strengthens_ the invariant the test is named for.
The assertion was never updated, and nothing ran it.

Fixes:

1. Update the two regexes to match the confirm-dialog wiring.
2. Add an aggregate `"test"` script covering all 64 files so this cannot recur.
3. These contract tests assert on **source text**, not behaviour — they rot silently
   on every refactor. Prefer behavioural assertions where practical.

## Dependencies

26 advisories (2 critical, 9 high). Two criticals reach through
`@neondatabase/auth-ui` with **no fix available**: `better-auth` (OAuth callback
accepts mismatched `state`) and `seroval` (`fromJSON()` type confusion — fix
available). Four highs (`sharp`, `undici`, `ws`, `miniflare`) resolve only via a
major `nitro` downgrade, which is not viable on a `3.0.x-beta` direct dependency.
Track the `better-auth` advisory; it is the one that matters for a cookie-auth admin.

## Refuted

29 of 61 findings were rejected on verification — most commonly claims that a guard
was missing when it existed in the caller, or that a path was reachable when it was
dead. Notable: the media-upload path-traversal and `owner_type` injection claims were
both disproven.

---

## Fix pass — 11 Aug 2026

MUST FIX 1–5 applied, plus SHOULD FIX 7 and 8. Item 7 is not separable from 5:
the campaign-stable idempotency key was the only thing preventing a
re-materialized campaign from re-sending, so fixing 5 alone would have converted
a silent non-send into a duplicate billable send.

The diff was then re-reviewed adversarially (15 claims, 9 confirmed). Two were
regressions the fix pass itself introduced:

**Opt-out matching was over-corrected.** Requiring whole-message equality for
Chinese killed 13 of 13 real-world opt-out phrases — 取消訂閱, 我要退訂, 唔該停止,
拒收 all silently stopped opting customers out. Trading false positives for false
negatives is the wrong direction: a false positive is recoverable (an admin
clears it), a false negative means continuing to market to someone who asked you
to stop. Separately, the Latin boundary used `\P{L}`, which never fires next to a
CJK character — CJK _are_ letters — so 「請stop」 and 「STOP啦」 also stopped
matching, and there was no NFKC folding so full-width ＳＴＯＰ was missed.
Rewritten to split terms by ambiguity rather than by language: unambiguous
phrases match anywhere, ambiguous bare stems only as a whole message after
politeness prefixes are stripped, Latin stems on a Latin-aware boundary. Now 41
cases pass in both directions.

**The idempotency key derived differently in each path.** The admin route passes
`Date.toISOString()` (`2026-08-11T02:00:00.000Z`); the cron reads
`timestamptz::text` (`2026-08-11 02:00:00+00`). Different strings meant both
paths would enqueue for one queue run — a duplicate send, the exact failure item
7 exists to prevent. The key now normalises to epoch millis. The cron's fallback
also moved from `updated_at` (changes on every write) to `created_at`.

Other confirmed findings, all fixed:

| Sev  | Defect                                                                                                                                                                   | Resolution                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| high | `updateLiveAgentContact` still caller-wins — the first fix only covered `upsertLiveAgentContact`, and the UPDATE path is the one an attacker reaches on a second handoff | existing-values-win; test widened to cover both functions                              |
| high | `WOZTELL_DELIVERY_UNKNOWN` applied to definitively-undelivered sends, which item 7 made permanently terminal                                                             | 429 reclassified as `WOZTELL_PROVIDER_REJECTED` (rejected before dispatch ⇒ retryable) |
| med  | Per-phone rate limit was a weapon: anyone could burn a stranger's quota and lock them out of the contact form                                                            | scoped to `(ip, phone)`                                                                |
| med  | Server inquiry schema was weaker than both client forms — accepted a 30-char phone with no digits                                                                        | mirrors the client's `min(8)` + digit pattern                                          |
| low  | Phones with no digits shared one global bucket                                                                                                                           | per-phone limit skipped when there are no digits                                       |

**Known gap, needs a product decision.** Because the public upsert now carries
`opt_in_whatsapp` over unchanged, an existing contact cannot grant consent
through the website: a customer who submits once without ticking the box and
later returns and ticks it has that consent silently discarded. No admin screen
or server fn sets `crm_contacts.opt_in_whatsapp`, so the only remaining path is
an inbound WhatsApp message. Deliberately not papered over — letting the public
form raise consent is the forgery this guards against. The fix is a staff-side
audited mutation (mirroring `clearContactWhatsappOptOut`) plus an admin control.
Documented at the top of `persistWebsiteInquiry`.

Refuted and not acted on: the JSON-LD guard's scope, an `admin-data.server`
bundle-size concern, and a claim that the `created_at` fallback reinstates the
dead-row bug.

---

## Second fix pass — 11 Aug 2026

SHOULD FIX 6, 9–14 and OPTIONAL 15–25 applied, then adversarially re-reviewed
(20 claims, 14 confirmed). The most important finding was a regression this pass
introduced:

**Raising the job-runner limit made draining worse, not better.** `claimJobs`
stamps ONE shared `lease_expires_at` across every row of a batch, but
`runClaimedJobs` executes serially. A batch of 5 behind a
`woztell.campaign.deliver` — which is designed to occupy an entire run — left
jobs 2..N with an expired lease before they started. `renewJobLease`, `failJob`
and `completeJob` all require `lease_expires_at >= now()`, so those jobs could
neither run, fail, nor complete: they stayed `status='running'` with a dead
lease, were counted as `cancelled`, and `recoverExpiredLeases` re-queued them
with the attempt burned — flipping them to `failed` permanently after
`max_attempts` without the handler ever succeeding. Worse, a handler that does
not checkpoint ran to completion, failed `completeJob` on the dead lease, and
was re-queued and executed **again** — for campaign delivery, duplicate billable
WhatsApp sends. Now claims one job at a time inside the loop, so each gets a full
lease window when it is about to run, bounded by a wall-clock budget rather than
a job count.

Other confirmed findings, all fixed:

| Sev  | Defect                                                                                                                              | Resolution                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| high | MLS coverage guard compared set SIZES, never overlap — it could pass while discovery missed most of the active set                  | counts real overlap via `FILTER (WHERE legacy_detail_id = ANY(...))`    |
| high | Guard counted `status <> 'inactive'`, including draft/sold/rented rows, and counted rows not distinct listings                      | `status = 'active'` + `count(DISTINCT legacy_detail_id)`                |
| high | Reply drafts persisted unnamespaced — on a shared machine the next agent to sign in saw, and could send, the previous agent's draft | key namespaced per staff user, reloaded when the user changes           |
| med  | `assertLeadInScope` silently discarded a pending note when an agent reassigned their own lead                                       | note written before the reassignment                                    |
| med  | Operations dashboard still keyed `ai`, so both new health checks rendered as a generic fallback label                               | `ai.gateway` / `ai.copilot` labels added                                |
| med  | `aiError` fix was incomplete — the retry the banner asks for never cleared it, rendering error and skeleton together                | cleared on retry, set on retry failure, cleared on lead switch          |
| med  | Segments confirm was still bypassed by 「新增 segment」, which resets the editor just as destructively                              | confirm moved above every reset path                                    |
| low  | Cursor decoders accepted any `Date.parse`-able string and forwarded it raw to `::timestamptz` (500 instead of 400)                  | validated against the exact microsecond format the encoder emits        |
| low  | `updateInquiryStatus` was still unscoped and unvalidated — the class of hole item 12 closed everywhere else                         | agent scope + status allowlist + 403                                    |
| low  | Email-verification check added a serial round-trip to every authenticated admin request                                             | moved into the first-bind branch, where it is the only place it matters |
| low  | Zero-byte upload rejected as `FILE_TOO_LARGE`/413                                                                                   | `EMPTY_FILE`/400                                                        |
| low  | Claiming `listRequestRef` without owning `setLoadingRows` stranded the inbox in its loading state                                   | claim now owns the full loading lifecycle                               |

Two further risks were caught before the review ran: comparing `routeId` in the
route blocker would have stopped protecting a dirty listing form when moving
between two listings (same route, different param) — it compares `pathname`
instead; and the `emailVerified` gate failed closed silently, so it now logs
explicitly before denying.

Six claims were refuted, including one that the run-scoped idempotency key makes
a partially-delivered campaign unrecoverable, and one that the media-upload size
cap is checked too late.
