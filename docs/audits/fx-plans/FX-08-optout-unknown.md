# FX-08: No accidental opt-outs; no permanently locked conversations. Implementation plan

**Owner decision D4 (2026-10-06, binding):**
1. **Opt-out words, whole message only:** `STOP`, `UNSUBSCRIBE`, `退訂`, `取消訂閱`, `停止接收`.
   - The whole message, after the normalisation in Task 1, must equal one of them. Nothing is matched on word boundaries, as a substring, or after stripping a politeness prefix. "Can I stop by?" is **not** an opt-out. 「唔要」 is **not** an opt-out.
   - Normalisation, with the recommended default for each rule (Task 1 pins every one of them with a test):

     | Rule | Default | Example |
     |---|---|---|
     | Unicode NFKC | **on** | `ＳＴＯＰ` → `STOP`; full-width `！` → `!` |
     | Latin case-fold (`toLowerCase` after NFKC) | **on** | `Stop`, `stop`, `STOP` are the same word |
     | Zero-width and variation characters (`U+200B–U+200D`, `U+2060`, `U+FEFF`, `U+FE00–U+FE0F`) | **removed** | `退訂️` |
     | Leading and trailing punctuation, symbols (including emoji) and whitespace (`\p{P}\p{S}\p{Z}\s`) | **trimmed** | `STOP.`, `退訂！`, `「退訂」`, `🛑 STOP` |
     | Whitespace inside the message | **removed** | `退 訂`, `UN SUBSCRIBE` |
     | Punctuation inside the message | **kept**, so no match | `退訂，謝謝`, `STOP-ish` |
     | Simplified forms of the same words (`退订`, `取消订阅`; `停止接收` is identical) | **matched** (owner decision 6) | `退订` |
     | Messages longer than 64 characters after NFKC | **never** an opt-out (fast path) | |
2. **What an opt-out blocks:** business-initiated messages only, meaning templates, campaigns and surveys (plus the other service-automation sends; see Open question 3).
3. **How it reopens:** a new customer message reopens normal (non-template) staff replies for 24 hours. "New" means the conversation's latest inbound time is **strictly after** the opt-out time. Templates stay blocked while the contact is opted out.
4. **The fix plan's other rules:**
   - The evidence (`opted_out_at`, the message id and the message text) is recorded and shown to staff.
   - It is never set from `history_import`.
   - A manager or above can clear an accidental opt-out. The clear is audited and keeps the evidence.
   - A read-only report lists existing contacts that were opted out by text **not** in the D4 list, for the owner to review. Nothing is auto-cleared.
5. **Unknown outcomes:**
   - Config errors, and HTTP 400/401/403/404/422/429 with a parsed body and no acceptance signal, become `failed`, not `unknown`.
   - **Update 2026-10-07 (FX-10b controller ruling):** a body that could not be read or parsed (gateway HTML, an empty body, truncated JSON) is never a definite refusal. It stays `unknown` at any status, 4xx and 429 included, so the conversation locks until a manager resolves it. `sendWoztellResponse` marks it `bodyUnreadable: true`.
   - A manager or above can resolve an `unknown` intent to `resolved_sent` or `resolved_not_sent` through an audited action. That releases the conversation lock. Resolving never sends anything, and `resolved_not_sent` only releases the lock. Any resend is a separate, explicit staff action.

**Owner answers (2026-10-06, binding; these supersede the matching open questions):**

6. **Simplified forms are approved.** `退订` and `取消订阅` are exact opt-out words, alongside the five D4 words.
7. **Near-miss opt-out requests are flagged for staff review. They never opt the customer out automatically.**
   - **What a near-miss is:** an inbound message that is **not** an exact opt-out (`isOptOutText` is false) but matches the contains rules in Task 1. For example: 「我要退訂」, "STOP please", 「唔好再send嘢俾我」.
   - **What staff see:** a visible 「可能要求退訂」 flag on the conversation, with the quoted message. Two actions:
     - **確認退訂** opens the existing consent dialog with 拒收推廣 / 客戶拒收要求 and the evidence reference already filled in. Confirming it is one click.
     - **不是退訂** dismisses the flag.
   - **No migration.** The flag is derived at read time from the conversation's inbound messages newer than three cut-offs: the contact's latest `crm_consent_events` row, the latest dismissal, and `opted_out_at` when the contact is opted out. A dismissal persists as an `audit_logs` row (justification in Task 3), so no table or column is added.
   - **Audit:** confirming writes the existing `contact.marketing_consent` audit row, now carrying `trigger:'near_miss'` and the message id. Dismissing writes `contact.whatsapp_opt_out_near_miss_dismissed`.
8. **Both migrations are approved as drafted**, including Migration A's one-time `opted_out_at` stamp on existing opt-outs. Claude runs them on owned or test databases only. Applying them to a Neon branch, and then to production, is the owner's step.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Every behaviour change gets a failing test first.

**Goal.** A customer who types 「唔要」 or "Can I stop by?" can still be answered. A customer who types 退訂 or STOP is never sent a template, campaign or survey again, and staff can see exactly which message did it. A send with an uncertain outcome no longer locks a conversation for ever: definite refusals become `failed`, and a manager can close out a real `unknown` without anything being re-sent (D-01, D-02).

**Approach.**
- **One pure detector.** `isOptOutText` keeps its name and signature, so its two callers do not change. Its body becomes "normalise, then exact-match the D4 set". A second pure function, `isOptOutNearMiss`, applies the owner's contains rules. Its result is only ever displayed to staff, never written to the flag.
- **Evidence on the contact, not a new table.** `crm_contacts` gains `opted_out_at`, `opted_out_message_id`, `opted_out_text`, `opted_out_source`, `opted_out_cleared_at` and `opted_out_cleared_by`. The boolean `opted_out_whatsapp` stays the single gate that every existing reader uses: campaign, segments, blast review, service workflow and phone identity.
- **The reopen is one SQL predicate.** In the dispatch gate, `text` is allowed when `NOT opted_out OR (opted_out_at IS NOT NULL AND wc.last_inbound_at > opted_out_at)`, inside the existing 24 h window. `template` still needs `opted_out_whatsapp=false`. A NULL `opted_out_at` fails closed.
- **The lock is released by leaving the lock states.** The lock is "any intent in `dispatching` or `unknown`" (`20261001090000…sql:31-36`, `outbound-intent.server.ts:104-107`). Two new terminal states, `resolved_sent` and `resolved_not_sent`, release it without replacing the reservation trigger. A **new** guard trigger allows those states only from `unknown`, only with actor, time and reason set, and never out of them.
- **Two migrations, as in the register:**
  - `20261008100000_whatsapp_opt_out_evidence.sql`: additive, plus a one-time stamp of `opted_out_at` on legacy rows.
  - `20261008110000_outbound_unknown_resolution.sql`: widens the state CHECK, adds the resolution columns and adds the guard trigger.

  The revert lives in `neon/reverts/`, following the FX-06 pattern.
- **No new env var. No provider call** anywhere in this batch's new code paths.

**Tech stack.**
- Unit tests use `node --test` (`src/lib/woztell/woztell.test.mjs`, `outbound-intent.test.mjs`, `src/lib/neon/admin-workflow.test.mjs`, `whatsapp-consent.test.mjs`, all already in `test:woztell`).
- DB tests run on full-schema owned Postgres: `withOwnedPostgres` + `mockOwnedServerDb` (`scripts/acceptance/owned-postgres-test.mjs:144-164`), with `--experimental-test-module-mocks`.
- Component tests use `bun test` with `renderToStaticMarkup`.

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md` (branch `fix/fx-01-public-form-feedback`):
  - D-01 (:220)
  - D-02 (:221)
  - summary item 6 (:56-58)
  - A-02 (:126), on source-regex tests
  - the owner data list (:537-538)
- Fix plan `docs/audits/2026-10-fix-plan.md` (same branch):
  - FX-08 (:403-442)
  - D4 (:72)
  - Review focus 4 (:46)
  - the migration register (:787-799)
  - Global constraints (:17-39)

## Verified current behaviour (main 4965d48)

| # | Fact | Where |
|---|---|---|
| 1 | **The detector is far broader than D4.** It has three tiers. (a) 19 "unambiguous" phrases matched **anywhere** in the message after punctuation is stripped, including `拒收`, `停止發送`, `不再接收`, `唔想再收`, `opt out`, `remove me` and `unsubscribe`; so "unsubscribe please" is an opt-out. (b) The bare stems `取消/停止/唔要/不要/不用` count when they are the whole message after politeness prefixes (`唔該`, `我要`, `please`…) are stripped. (c) `stop` is matched on Latin word boundaries, so "Can I stop by?" and "附近有冇 bus stop?" are opt-outs. NFKC and lower-casing are already applied. | `src/lib/woztell/woztell.server.ts:62-136` (lists), `:140-158` (strip helpers), `:160-185` (`isOptOutText`) |
| 2 | **Ingest sets the flag monotonically from any origin.** The contact upsert writes `opted_out_whatsapp=c.opted_out_whatsapp OR $5`, and a new contact gets `$5`, where `$5 = event.direction==="inbound" && isOptOutText(event.text)`. **`origin` is not consulted**, so `history_import` (called from `history-import.server.ts:70`) sets it too. The contact update runs **even when the message is a duplicate**: only the message insert is `ON CONFLICT DO NOTHING` (`:216-217`). No time, message id or text is recorded. | `src/lib/woztell/woztell-ingest.server.ts:186-198`, `:240`; origin check `:35-37` |
| 3 | **`live_webhook` versus `history_import`.** `origin` must be one of the two (`WA_EVENT_ORIGIN_REQUIRED`). Live events may be `signedEvent`. Receipt reconciliation (`:65-71`) and enquiry observation (`:49`) are already live-only; opt-out is not. | `woztell-ingest.server.ts:35-49,65-71` |
| 4 | **Every reader of the flag.** These readers block on it: staff dispatch gate (`outbound-intent.server.ts:271`, `c.opted_out_whatsapp=false` for text **and** template); campaign claim and send (`campaign-delivery.server.ts:65-68`, `:275-282` via `isBlastRecipientAllowed`, `woztell.server.ts:201-209`); service automation (survey, after-hours ack, survey thanks, manager ack) (`service-workflow.server.ts:202`, `:281`, `:341`); campaign materialisation (`admin-data.server.ts:3529`, `:3584`); marketing eligibility (`:898`; `crm-enrichment.server.ts:363`); segments (`segments.server.ts:62,106`); blast review (`blast-review.ts:32-38`); phone identity merge (`phone-identity.ts:23`). These readers display or pre-check it: inbox badge 已拒收 (`admin.whatsapp.tsx:1502`, `:1626`); composer pre-check via `canReplyToConversation` (`admin.whatsapp.tsx:2204-2211` → `admin-workflow.ts:9-27`, returns `CONTACT_OPTED_OUT` before the window check); command center (`command-center.ts:110-131`, fed by `admin-data.server.ts:2837`); AI suggested reply suppressed (`admin-data.server.ts:3093-3105`). | as listed |
| 5 | **Who can set or clear it today.** Ingest sets it (fact 2). `setWhatsappMarketingConsent` (admin/manager) writes `opt_in_whatsapp=$2, opted_out_whatsapp=NOT $2` with a `crm_consent_events` row and an `audit_logs` row. So the **only undo is recording marketing consent**, and recording 拒收推廣 sets the flag without any time. The legacy reset `clearContactWhatsappOptOut` exists only as a 409 stub. | `src/lib/neon/whatsapp-consent.server.ts:15-58` (UPDATE `:35`), `:60-72`; `admin-data.server.ts:3157`; `admin-data.ts:1424-1442`; UI `WhatsappConsentDialog.tsx` mounted at `admin.whatsapp.tsx:1627-1633` when `can_clear_opt_out` (`admin-data.server.ts:3021-3023`) |
| 6 | **Storage.** `crm_contacts.opted_out_whatsapp boolean NOT NULL DEFAULT false`, `opt_in_whatsapp`, `last_inbound_at`. There is no evidence column. | `neon/migrations/20260623090000_neon_admin_crm_whatsapp.sql:87-102` |
| 7 | **The reservation lock.** Trigger `wa_intent_unknown_reservation` (BEFORE INSERT OR UPDATE OF state) runs `wa_guard_outbound_reservation()`, and only for `actor_type='staff'` rows. A staff INSERT, or a `queued→dispatching` update, is refused (`OUTBOUND_RECONCILIATION_REQUIRED`, or `cancelled` for a queued row) while **any** other intent on the conversation is in `dispatching` or `unknown`. The EXISTS has **no actor_type filter**, so a stuck service-automation intent locks staff too. **Every other UPDATE passes straight through** (`:12-14`), so a manual `unknown → <non-lock state>` update is not blocked by this trigger. Partial index `wa_outbound_unresolved`. | `neon/migrations/20261001090000_whatsapp_outbound_unknown_reservation.sql:3-5,7-46`; it is the only definition (no later migration redefines it) |
| 8 | **The state CHECK is the real blocker.** It is an inline `CHECK (state IN ('queued','dispatching','accepted','unknown','failed','cancelled'))`, so Postgres names it `whatsapp_outbound_intents_state_check`. | `neon/migrations/20260905130000_outbound_intents.sql:9` |
| 9 | **The provider-result classification.** `accepted` only when `result.ok` and `identifiable_acceptance`. `failed` only when `result.refused===true` or `definitive_refusal`, and there is no `possibleAccepted`. Everything else is `unknown`, and any throw (timeout or network) is `unknown`. `sendWoztellResponse` returns `{ok:false}` with **no `status` and no `refused`** for `WOZTELL_ENABLED` not `true`, or for a missing token or channel (`woztell.server.ts:376-381`). A non-JSON body returns `WOZTELL_INVALID_RESPONSE` with `status` (`:400-405`). A JSON 4xx without `ok:0` returns `refused:false` (`:468`). So 401/403/404/422/429 and config errors all become `unknown` today. The 15 s fetch timeout is in `provider-fetch.ts:7-9`. | `src/lib/woztell/outbound-intent.server.ts:200-245`; `provider-result.ts:47-113`; `woztell.server.ts:370-469` |
| 10 | **Campaigns already classify this correctly.** `providerFailureCode`: no status → `WOZTELL_CONFIGURATION_UNAVAILABLE`; refused or `[400,401,403,404,422,429]` → `WOZTELL_PROVIDER_REJECTED`; anything else → `WOZTELL_DELIVERY_UNKNOWN`. FX-08 reuses the codes, **not** this function (FX-10b owns campaigns). | `src/lib/woztell/campaign-delivery.server.ts:238-268` |
| 11 | **How an `unknown` resolves today: only on provider evidence.** (a) A signed live DELIVERED/READ receipt with the same external id (`woztell-ingest.server.ts:65-110`). (b) A verified outbound echo (`:221-238`). (c) A trusted live receipt seen at finish time (`outbound-intent.server.ts:334-352`). There is no human action, so without a provider id (timeout, non-JSON 401) it **never** resolves. Lease expiry turns a stuck `dispatching` into `unknown`, never into `queued` (`control-plane/jobs.server.ts:755-760`; `outbound-intent.server.ts:284`). | as listed |
| 12 | **Service automation shares the path.** `service-workflow.server.ts` calls `deliverOutboundIntent` with its own begin and finish (`:345-377`), so the classification change applies to survey and ack sends too. It syncs action state only for `('accepted','unknown','failed','cancelled')` (`:311`), so a resolved intent leaves the action row at `unknown`. | `service-workflow.server.ts:311,345-377` |
| 13 | **The human-response credit fires only on `accepted`.** `wa_credit_accepted_intent` credits only `state='accepted'`, so `resolved_sent` will never count as a verified first human response. | `neon/migrations/20260912140000_whatsapp_assignment_evidence.sql:118-124` |
| 14 | **The inbox UI.** The header badge and consent dialog are at `admin.whatsapp.tsx:1626-1633`. The template picker is shown only for `OUTSIDE_24_HOUR_WINDOW` (`:1612`). Reply-error copy is at `:109-116` and `:2102-2110`. Message status labels are at `:2232-2239`, and the bubble warning styling at `:2040`. The reservation check is `checkOutboundReservation` (`:317-344`, run on select `:345-348`). The two `onConsentSaved` arrows that reload detail are at `:1251-1253` (desktop) and `:1316-1318` (mobile). `ConversationWorkspace` is at `:1514`. | `src/routes/admin.whatsapp.tsx` |
| 15 | **Tests that pin today's behaviour.** `woztell.test.mjs:262` (`isOptOutText("停止")===true`) and `:263` (`"unsubscribe please"` true); `:381-430` (phrases, stems with politeness, `stop` on word boundaries including `請stop`/`Please STOP`, all true); `:435-454` (negatives); `:286-302` source regex (`outbound-intent.server.ts` must contain `opted_out_whatsapp`; keep); `:456-477` source regex (inbox must **not** contain `clearContactWhatsappOptOut\|confirmClearOptOut\|clearOptOutReason\|解除拒收`). `outbound-intent.test.mjs:276-284` (`{ok:false,status:503}` → unknown; keep). `admin-workflow.test.mjs:21-60` (`optedOut:true` → `CONTACT_OPTED_OUT`). `scripts/no-link-local-postgres.test.mjs:1610-1640` sets `opted_out_whatsapp=true` with **no** `opted_out_at` and expects 0 provider calls (still true under fail-closed NULL). `admin.routes.test.mjs:471` pins 已拒收 in the **campaign** page, not the inbox. | as listed |
| 16 | **Hand-made schemas that run ingest.** These will break once ingest writes the new columns. `inbound-identity.db.test.mjs:147-152` is PGlite and runs in CI (`test:no-link`). `workflow.db.test.mjs:94` and `staff-notifications.db.test.mjs:89` run on Neon only (`skip: !url`). | as listed |
| 17 | **Migration manifest.** It has 85 entries, ending at `20261003040000_content_proposal_source_guard.sql`, and the order is enforced by `migration-versions.test.mjs:20-42`. Two owned tests pin the count: `performance-readback-owned.db.test.mjs:16` and `link-bulk-owned.db.test.mjs:23` (`assert.equal(migrationCount, 85)`). `neon/reverts/` does not exist on main; FX-06 (#226) creates it. | `src/lib/control-plane/migration-versions.js:120-123` |

## Global Constraints

- **Owner safety rules (binding).**
  - Never message a real number. Unit tests inject a fake `send`. Owned DB tests mock `globalThis.fetch` to throw (the FX-06 pattern) **and** pass a fake `send` that counts calls. Nothing talks to WozTell, Neon production or a model.
  - Synthetic data on owned Postgres only (`withOwnedPostgres`). Use ids such as `78000000-0000-4000-8000-…` and member ids `synthetic-…`.
  - **No resend, ever, from a resolution.** `resolveUnknownOutbound` never inserts `ops_jobs`, never calls `enqueueOutboundIntent`, and never imports `woztell.server.ts`. A test asserts all three.
  - **Clearing never erases history.** `clearAccidentalOptOut` sets `opted_out_whatsapp=false` plus `opted_out_cleared_at/by`. It never nulls `opted_out_at/_message_id/_text/_source`, and it never changes `opt_in_whatsapp`. The audit row snapshots the evidence.
  - **Existing opt-outs are never auto-cleared** (Review focus 4). Migration A only **adds** columns and stamps `opted_out_at` where it is NULL. It never writes `opted_out_whatsapp`.
- **Configuration.** No new env var. No `VITE_*`.
- **Copy.** All new UI text is zh-HK (copy table in Task 5). Reuse the shadcn primitives already on the page: `Badge`, `Button`, `Dialog*`, `Textarea`, `AdminConfirmDialog`, `sonner`. Keep the existing consent dialog as it is.
- **Roles.** "Manager or above" means `admin` or `manager`. Check it twice: with `requireStaff(["admin","manager"])` in the server fn, and in SQL against `staff_users.active` + `staff_roles` (the `whatsapp-consent.server.ts:28-33` pattern). Resolution also requires `wa_can_read_conversation(actor, conversation)`, so it keeps working after #226 replaces that function.
- **Avoid conflicts with open PRs** (diffs taken against `4965d48`; `git diff HEAD...origin/<branch> --stat`):

  | PR | Branch | Overlap with FX-08 | Rule |
  |---|---|---|---|
  | #221 | `fix/fx-01-public-form-feedback` | `ci.yml:81-87`; `package.json:32-38,119-125`; public forms only | No overlap. Do not edit those lines. |
  | #222 | `fix/fx-03-live-agent-handoff` | `admin-data.server.ts` end (`:3811+`), `admin-data.ts` end (`:1818+`), `admin-data.types.ts` end (`:637+`); `synthetic-api.ts:533`; `package.json:49-55` | **Never append at end of file** in the three `admin-data*` files. Insert at the anchors given in Tasks 3–5. |
  | #223 | `fix/fx-04-admin-attention` | **`admin.whatsapp.tsx` hunks at `:4-9`, `:41-60`, `:175-660`, `:1050-1160`**; `admin-data.ts:392-450,651-700`; `admin-data.server.ts:981-1080`; `admin-data.types.ts:591-610`; `synthetic-api.ts:73-260,591+`; `package.json:36-42` (**`:39` is next to `test:woztell` at `:40`**), `:114-120`; `admin.routes.test.mjs` | In `admin.whatsapp.tsx`, edit **only**: one import block inserted after `:29` (`AdminToolbar` import); `:109-116`; `:1251-1253`; `:1316-1318`; `:1626-1633`; `:2102-2110`; `:2192-2212`; `:2232-2239`. Put all new UI in **new files** under `src/components/admin/whatsapp/`. **Do not edit `package.json:40`.** New unit tests go into files that `test:woztell` already lists. New component tests get a new script inserted after `package.json:80`. Do not edit `admin.routes.test.mjs`. Fixture stubs go after `synthetic-api.ts:305`. |
  | #224 | `fix/fx-05a-ui-flags` | `package.json:12-18`; `build-whatsapp-no-link.mjs` | Do not edit the fixture build script. |
  | #225 | `fix/fx-05b-lead-alert` | `migration-versions.js:123` (adds `20261006110000_duty_manager.sql`); the two pinned counts; `staff-notifications.db.test.mjs:81-173` (rewritten); `package.json:91-97,122-128`; `ci.yml:155-158`; `admin-data.server.ts:3689-3710` | Append FX-08's two manifest entries **after** the last entry. On rebase, keep the list sorted: `…20261006110000…`, `…20261007100000…`, `20261008100000…`, `20261008110000…`. **Do not edit `staff-notifications.db.test.mjs`.** If, after #225 merges, its schema is still hand-made, add the six columns there during the rebase (fact 16). The `ci.yml` line goes after `:149`, not near `:155-158`. |
  | #226 | `fix/fx-06-manager-wa-access` | **Replaces `wa_can_read_conversation` and `wa_can_read_enquiry`**; creates `neon/reverts/`; `migration-versions.js:123`; the pinned counts; `package.json:122-128`; `ci.yml:155-158` | Call `wa_can_read_conversation` but **never redefine it**. Create `neon/reverts/20261008110000_outbound_unknown_resolution_revert.sql`; if #226 has merged, the folder already exists. FX-08's owned tests must **not** assume managers are branch-scoped: give the test manager no branch and assign the conversation to them, so the test passes before and after #226. |
  | #227 | `fix/fx-07-jobs-drain` | Ops, receipts, `service-health*`, `job-wake*`, worker | **No file overlap.** Verified: #227 adds **no** migration and does not touch `migration-versions.js`. Do not add an "unknown count" to service health here (follow-up). |

  **Pinned migration counts.** FX-08 alone: 85 + 2 = **87**. After #225 and #226: **89**. On every rebase, set `performance-readback-owned.db.test.mjs:16` and `link-bulk-owned.db.test.mjs:23` to `ls neon/migrations/*.sql | wc -l`. The new FX-08 owned tests assert `MIGRATION_VERSIONS.includes(<file>)`, **not** a count, so they add no third pin.
- **Committing.** `git add <paths>` only; never `bun.lockb`, which is already dirty in this worktree. Use conventional commits with a scope, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Every task passes** `npm run lint`, `npm run typecheck` and its listed suites. Owned suites need Docker and `docker pull pgvector/pgvector@sha256:d2ef61f4…` (`ci.yml:143`). The PR as a whole also passes `npm run build`, the `playwright.admin-owned.config.ts` suites, and 375 px / 1440 px before/after screenshots of the inbox header (Task 5).

## Review Focus

These are the five likeliest failure modes that no fix-plan test covers. Each has a named test in its owning task.

1. **A webhook retry of the original 退訂 re-opts-out a contact that a manager just cleared.** Today the contact upsert runs even for a duplicate message (fact 2). *Test (Task 2):* `a redelivered opt-out message does not re-set the flag after a clear, but a new 退訂 does`.
2. **The STOP message itself reopens text replies.** If `opted_out_at` and `last_inbound_at` come from different clocks, or the comparison is `>=`, the customer's own STOP opens the 24 h window. *Test (Task 3):* `the opt-out message itself never reopens text; only a strictly later inbound does, and only on that conversation`.
3. **A manager clears a genuine 退訂/STOP, or clears a newer opt-out than the one they looked at** (Review focus 4). *Tests (Task 3):* `clearAccidentalOptOut refuses when the contact's history contains a D4 message` and `a stale clear (expectedOptedOutAt mismatch) changes nothing`.
4. **Resolving an `unknown` while the provider call is still in flight, followed by a manual resend: a double message.** A lease-expired `dispatching` row becomes `unknown` while the original worker may still be waiting up to 15 s (fact 11). *Test (Task 4):* `resolution is refused until 15 minutes after dispatch_started_at and never enqueues, sends or credits a human response`.
5. **A 4xx or config error is filed as `failed` even though the provider showed acceptance**, so staff resend a message the customer already has. *Test (Task 4):* `any acceptance signal keeps unknown: 401 with ok:1, 429 with a messageId, 2xx execution_accepted`.
6. **The near-miss flag goes wrong in one of three ways** (added by owner decision 7):
   - it silently opts the customer out;
   - a dismissal hides a **later** request;
   - it fires on everyday sentences ("Can I stop by?"), so staff learn to ignore it.

   *Tests:*
   - *(Task 1):* `near-miss contains rules: what flags and what does not`.
   - *(Task 3):* `a near-miss never changes opted_out_whatsapp, and a dismissal hides only messages up to the dismissed one`.

## Out of scope / follow-ups

| Follow-up | Owner | What it must do |
|---|---|---|
| Unknown-intent count and oldest age in service health | FX-07 follow-up / FX-17 | One `required:false` check. #227 owns `service-health*`. |
| Check `WOZTELL_ENABLED` at enqueue (D-02 suggestion) | FX-19c | Not needed for the lock: a config error now becomes `failed`, so it no longer locks. |
| Command center reopen awareness | FX-17 | `command-center.ts:110-131` keeps treating any opt-out as "cannot reply" (conservative). #223 edits the command-center route. |
| Service action row stays `unknown` after its intent is resolved | FX-18 | Sync `whatsapp_service_actions.state` for `resolved_*` (fact 12). It is display-only and does not lock. |
| Near-miss flag on the conversation **list** rows | FX-17 | FX-08 shows it in the conversation header only. The list component is next to #223's edits. |
| Campaign classifier shared with staff sends | FX-10b | Fold `providerFailureCode` (fact 10) into `classifyOutboundSendResult`. |

---

### Task 1: The D4 detector (pure, whole message only) and the near-miss rules

**Files:**
- **Modify `src/lib/woztell/woztell.server.ts:62-185`.** Replace the three lists, `POLITENESS_PREFIXES`, `stripPunctuation`, `stripPolitenessPrefixes` and the body of `isOptOutText` with the interface below. Rewrite the comment block at `:62-73`: opt-out now blocks business-initiated messages only, and the flag is recorded with evidence.
- **Modify `src/lib/woztell/woztell.test.mjs`:**
  - `:262-263`: `停止` → `false`; `"unsubscribe please"` → `false`; add `退訂` → `true`.
  - **Replace** `:374-454` with the two tests below.
  - Leave `:286-302` alone.

**Interfaces:**
```ts
/** D4 (owner, 2026-10-06). Canonical, already normalised forms. Simplified forms per Open question 1. */
export const OPT_OUT_WORDS: ReadonlySet<string> = new Set([
  "stop", "unsubscribe", "退訂", "退订", "取消訂閱", "取消订阅", "停止接收",
]);
/** NFKC → drop zero-width/variation chars → trim [\p{P}\p{S}\p{Z}\s] at both ends → remove inner [\p{Z}\s] → toLowerCase. "" for null/undefined/over-length. */
export function normalizeOptOutCandidate(value: string | null | undefined): string;
/** True only when the whole normalised message is in OPT_OUT_WORDS. Never word-boundary, never substring. */
export function isOptOutText(value: string | null | undefined): boolean;

/** Owner decision 7. Display-only: true when the message is NOT an exact opt-out but asks to stop. Never sets any flag. */
export function isOptOutNearMiss(value: string | null | undefined): boolean;
```

**Near-miss contains rules.** These are applied to `normalizeOptOutCandidate`'s output, with the 64-character cap raised to 280 for this function only. A message flags when `isOptOutText` is false **and** any rule below matches:
1. **A CJK opt-out word anywhere:** `退訂`, `退订`, `取消訂閱`, `取消订阅`, `停止接收`.
2. **A CJK stop-messaging phrase anywhere.** The list (recommended, kept as one exported constant `OPT_OUT_NEAR_MISS_PHRASES`): `唔好再send`, `唔好再發`, `唔好再傳`, `唔好再传`, `唔使再send`, `唔要再send`, `唔想再收`, `不想再收`, `不要再發`, `不要再发`, `不要再傳`, `不再接收`, `停止發送`, `停止发送`, `拒收`, `唔好再搵我`, `不要再聯絡我`, `唔好再聯絡我`, `removeme`, `optout`. The match runs after inner whitespace is removed, so `remove me` and `opt out` match as `removeme` / `optout`.
3. **`unsubscribe` as a Latin token anywhere**, meaning the characters on either side are not Latin letters or digits.
4. **`stop` only when nothing else is in the message except politeness or emphasis tokens.** The tokens are `please`, `pls`, `plz`, `now`, `thanks`, `thank you`, `thx`, `ok`, `唔該`, `請`, `啦`, `呀`, `喇`, `吖`, plus a repeated `stop`. This check runs on the NFKC, lower-cased, punctuation-trimmed text **before** inner whitespace is removed, so token boundaries survive. So "STOP please", "please stop", "stop stop" and 「唔該stop啦」 flag; "Can I stop by?", "bus stop" and "stopover" do not.

Bare 停止, 取消, 唔要 and 不要 never flag on their own. They are too common in property talk (「請停止安排星期六睇樓」).

- [ ] **Step 1: write the failing tests** in `woztell.test.mjs`.
  - `D4: only the whole message STOP/UNSUBSCRIBE/退訂/取消訂閱/停止接收 is an opt-out`. Each of these is `true`: `STOP`, `stop`, `Stop`, `  STOP  `, `STOP.`, `STOP!!!`, `ＳＴＯＰ`, `Ｓｔｏｐ`, `🛑 STOP`, `STOP 🙏`, `S T O P`, `UNSUBSCRIBE`, `unsubscribe`, `Unsubscribe.`, `退訂`, `退訂！`, `「退訂」`, `退 訂`, `退訂️`, `​退訂`, `退订`, `取消訂閱`, `取消订阅`, `取消訂閱。`, `停止接收`, `停止接收。`.
  - `D4: sentences, stems and old phrases are not opt-outs`. Each of these is `false`:
    - Fix-plan names: `Can I stop by?`, `「唔要」 as reply` (`唔要`).
    - Sentences and stems: `can i stop by the office`, `附近有冇 bus stop?`, `bus stop`, `please stop`, `STOP please`, `Please STOP`, `請stop`, `STOP啦`, `stopover in Tsuen Wan`, `STOP STOP`, `STOP-STOP`, `不要`, `取消`, `停止`, `不用`, `唔該停止`, `我要取消`, `我想取消今日睇樓約會`.
    - Near-miss opt-out requests: `我要退訂`, `請退訂`, `唔該退訂`, `退訂，謝謝`, `unsubscribe me`, `unsubscribe please`.
    - Old phrases: `opt out`, `remove me`, `拒收`, `停止發送`, `不再接收`, `唔想再收`, `唔要再send`.
    - Empty and junk: `""`, `"   "`, `"!!!"`, `"🛑"`, `null`, `undefined`, and `"STOP" + " ".repeat(10) + "x".repeat(60)`.
  - `near-miss contains rules: what flags and what does not` (Review Focus 6).
    - **Flags (`isOptOutNearMiss === true`):** `我要退訂`, `請退訂`, `唔該退訂`, `退訂，謝謝`, `我想取消訂閱`, `退订吧`, `STOP please`, `Please STOP`, `stop stop`, `唔該stop啦`, `請stop`, `unsubscribe me`, `please unsubscribe`, `唔好再send嘢俾我`, `唔好再發訊息俾我`, `不要再發給我`, `拒收`, `唔想再收你哋訊息`, `停止發送`, `remove me from the list`, `opt out`.
    - **Does not flag (false):** `Can I stop by?`, `can i stop by the office tomorrow`, `附近有冇 bus stop?`, `bus stop`, `stopover in Tsuen Wan`, `nonstop`, `唔要`, `不要太貴嘅盤`, `取消`, `我想取消今日睇樓約會`, `請停止安排星期六睇樓`, `停止`, `想睇樓`, `""`, `null`.
    - **Never both:** `isOptOutNearMiss` is false for every exact opt-out (`STOP`, `退訂`, `退订`, `取消订阅`, …), so a message is either an opt-out or a near-miss, never both.
  - `normalizeOptOutCandidate applies NFKC, case-fold, edge trim and inner-space removal only`: `normalizeOptOutCandidate("  ＳＴＯＰ！ ")==="stop"`; `("退 訂")==="退訂"`; `("退訂，謝謝")==="退訂,謝謝"`; `("x".repeat(65))===""`.
  - Run `npm run test:woztell`. It must fail on the new expectations, for example `停止` is still `true`.
- [ ] **Step 2:** implement until green. Do not keep any of the old lists.
- [ ] **Step 3:** run `npm run test:woztell`, `npm run lint`, `npm run typecheck`.
- [ ] **Step 4: commit.**
  ```
  fix(whatsapp): opt out only on a whole-message STOP/UNSUBSCRIBE/退訂/取消訂閱/停止接收 (D4); detect near-misses for review

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 2: Opt-out evidence: migration A, and ingest records it (live only, duplicate-safe)

**Files:**
- **Create `neon/migrations/20261008100000_whatsapp_opt_out_evidence.sql`.** It is additive and idempotent:
  ```sql
  ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS opted_out_at timestamptz;
  ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS opted_out_message_id text;   -- whatsapp_messages.external_message_id
  ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS opted_out_text text;          -- left(text, 500)
  ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS opted_out_source text;        -- CHECK below
  ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS opted_out_cleared_at timestamptz;
  ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS opted_out_cleared_by uuid REFERENCES staff_users(id) ON DELETE SET NULL;
  -- DO $$ … IF NOT EXISTS pg_constraint 'crm_contacts_opted_out_source_check' THEN
  --   ADD CONSTRAINT … CHECK (opted_out_source IS NULL OR opted_out_source IN ('customer_message','staff_recorded','legacy')) … $$;
  -- Legacy stamp: freeze the opt-out at the latest known inbound, so only a LATER customer message reopens text.
  UPDATE crm_contacts c SET opted_out_at = COALESCE(GREATEST(c.last_inbound_at, (SELECT max(wc.last_inbound_at) FROM whatsapp_conversations wc WHERE wc.contact_id = c.id), c.updated_at), now()), opted_out_source = 'legacy'
   WHERE opted_out_whatsapp AND opted_out_at IS NULL;
  ```
  Header comment: FX-08 / D-01 / D4; "never writes `opted_out_whatsapp`; never clears; re-runnable". **No revert file**: the columns stay (register).
- **Modify `src/lib/control-plane/migration-versions.js:122`:** append the filename after the last entry.
- **Modify the pinned counts** at `performance-readback-owned.db.test.mjs:16` and `link-bulk-owned.db.test.mjs:23` (85 → 86 here; Task 4 makes it 87).
- **Modify `src/lib/woztell/woztell-ingest.server.ts:186-198` and `:238-241`:**
  - Param `$5` becomes `origin === "live_webhook" && event.direction === "inbound" && isOptOutText(event.text)`.
  - The `updated_contact` CTE derives `new_opt_out := $5 AND NOT EXISTS (SELECT 1 FROM whatsapp_messages WHERE external_message_id=$12 OR ($14::text IS NOT NULL AND external_message_id=$14 AND channel_id=$7 AND woztell_member_id=$2 AND direction::text='inbound'))`. The statement snapshot sees a previously committed copy of this message, so a duplicate is never "new".
  - It sets:
    - `opted_out_whatsapp = c.opted_out_whatsapp OR new_opt_out`;
    - `opted_out_at`, `_message_id`, `_text`, `_source` = `CASE WHEN new_opt_out AND (NOT c.opted_out_whatsapp OR c.opted_out_at IS NULL OR $6::timestamptz > c.opted_out_at) THEN ($6, $12, left($11,500), 'customer_message') ELSE <existing> END`.

    Use **`$6`**, the same value written to `last_inbound_at`, so the STOP message's own `last_inbound_at` equals `opted_out_at` exactly (Review Focus 2).
  - `new_contact` gets the same four values when `$5`.
  - **No `opted_out_cleared_at` filter.** A delayed but genuinely new 退訂 after a clear must still opt out.
- **Modify `src/lib/neon/whatsapp-consent.server.ts:35`.** When `$2=false` (拒收推廣) and the contact was not already opted out, set `opted_out_at=now()` and `opted_out_source='staff_recorded'`.
  - **Near-miss confirm (owner decision 7):** when `evidenceRef` matches `^near-miss:<uuid>$`, look up that `whatsapp_messages` row, which must be inbound and have `contact_id = $1`. Copy its `external_message_id` and `left(text,500)` into `opted_out_message_id` / `opted_out_text`. A uuid that is unknown or belongs to another contact → 400, with no write (wrong-recipient guard).
  - Otherwise both are NULL.
  - When `$2=true`, leave every evidence column untouched (it still clears the flag, as today).
  - The audit metadata (`:43-45`) gains `evidenceRef` and `trigger: 'near_miss' | 'manual'`.
- **Modify `src/lib/whatsapp-enquiries/inbound-identity.db.test.mjs:147-152`** (PGlite, in CI) and **`workflow.db.test.mjs:94`** (Neon-only): add the six columns to the hand-made `crm_contacts`. Do **not** touch `staff-notifications.db.test.mjs` (#225; see Global Constraints).
- **Create `src/lib/woztell/opt-out.owned.db.test.mjs`** (owned Postgres; `mockOwnedServerDb`; `globalThis.fetch` mocked to throw; `OPS_EVENT_WAKE_ENABLED` deleted, as in the FX-06 test header).
- **Modify `package.json`.** Insert after `:80` (`test:woztell:db`):
  `"test:woztell:owned:db": "node --experimental-test-module-mocks --test --test-concurrency=1 src/lib/woztell/opt-out.owned.db.test.mjs src/lib/woztell/outbound-intent.owned.db.test.mjs"`.
  Until Task 4 creates the second file, list only the first.
- **Modify `.github/workflows/ci.yml`:** insert `- run: npm run test:woztell:owned:db` after `:149` (`test:whatsapp-setup:db`).

**Interfaces.** None new in TS. The SQL column contract is above. `ingestWoztellEvent`'s signature is unchanged.

- [ ] **Step 1: write the failing tests** in `opt-out.owned.db.test.mjs`. Build synthetic events with `normalizeWoztellEvent`; call `ingestWoztellEvent(event, origin, undefined, { mode: "off", signedEvent: true })`.
  - `migration A is additive: it adds six columns and stamps legacy rows without changing any flag`:
    - The owned helper has already applied every migration, so seed three contacts with NULL evidence columns, then run the migration file text again:
      - (a) opted out, with `last_inbound_at`;
      - (b) opted out, with no inbound;
      - (c) not opted out.
    - After: (a) `opted_out_at=last_inbound_at` and `source='legacy'`; (b) `opted_out_at` is not null; (c) all NULL. `opted_out_whatsapp` is unchanged for all three.
    - Re-running the file changes 0 rows.
    - `MIGRATION_VERSIONS.includes("20261008100000_whatsapp_opt_out_evidence.sql")`.
  - `「退訂」 → opt-out with evidence` (fix-plan name). A live inbound `退訂` sets `opted_out_whatsapp=true`, `opted_out_at = <event ts>`, `opted_out_message_id = <external id>`, `opted_out_text='退訂'` and `source='customer_message'`. `last_inbound_at` equals `opted_out_at`.
  - `「唔要」 as reply → not opt-out` (fix-plan name) and `"Can I stop by?" → not opt-out`. Both leave the flag `false` and every evidence column NULL.
  - `history_import never sets opt-out` (fix-plan name). `ingestWoztellEvent(<退訂 event>, "history_import")` inserts the message and updates `last_inbound_at`, but the flag and evidence are untouched, for both an existing contact and a newly created one.
  - `a redelivered opt-out message does not re-set the flag after a clear, but a new 退訂 does` (Review Focus 1, idempotency):
    1. Live `退訂` (id X).
    2. `UPDATE … SET opted_out_whatsapp=false, opted_out_cleared_at=now()`.
    3. Re-ingest the identical event X: the flag stays `false`.
    4. Ingest a new `退訂` (id Y, later timestamp): the flag is `true`, and the evidence points at Y.
  - `an older opt-out arriving late does not overwrite newer evidence`. Opt-out Y at T2, then a late opt-out Z at T1 < T2: the evidence stays Y.
  - `wrong recipient: an opt-out on contact A never touches contact B`. Two contacts and two member ids: `退訂` from A leaves B unchanged.
  - Extend `whatsapp-consent.test.mjs`: `a near-miss confirm copies that message as evidence and audits trigger near_miss; a foreign message id is refused` (fake `query`: asserts the message lookup is bound to `contact_id=$1`, and that the audit metadata has `trigger` and `evidenceRef`).
  - Extend `whatsapp-consent.test.mjs`: `recording 拒收推廣 stamps staff_recorded evidence; recording consent keeps the evidence columns`. The fake `query` captures the SQL, and the test asserts `opted_out_source` and `'staff_recorded'` appear in the `NOT $2` branch, and that no `opted_out_at = NULL` or `opted_out_text = NULL` assignment exists.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run `npm run test:woztell`, `npm run test:no-link` (PGlite ingest), `npm run test:woztell:owned:db`, `npm run test:control-plane` (manifest order), `npm run test:no-link:local-postgres` (golden, unchanged), `npm run lint`, `npm run typecheck`.
- [ ] **Step 4: commit.**
  ```
  fix(whatsapp): record opt-out evidence from live messages only, never from history import

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 3: What an opt-out blocks: text reopens after a newer customer message; managers can clear an accidental opt-out

**Files:**
- **Modify `src/lib/woztell/outbound-intent.server.ts:271-272`** (the eligibility predicate):
  ```sql
  NULLIF(wc.woztell_member_id,'') IS NOT NULL
  AND (
    (i.kind='text' AND wc.last_inbound_at >= now()-interval '24 hours'
       AND (c.opted_out_whatsapp=false
            OR (c.opted_out_at IS NOT NULL AND wc.last_inbound_at > c.opted_out_at)))
    OR (i.kind='template' AND c.opted_out_whatsapp=false AND t.status LIKE 'active%'))
  ```
  Everything else in the predicate is unchanged. The source-regex test at `woztell.test.mjs:286-302` still finds `opted_out_whatsapp`.
- **Modify `src/lib/neon/admin-workflow.ts:9-27`.** Add `optedOutAt?: Date | string | null` to `canReplyToConversation`.
  - While opted out, the result is ok **only** when `optedOutAt` parses, `lastInboundAt > optedOutAt`, and the inbound is within 24 h.
  - Opted out with no newer inbound → `CONTACT_OPTED_OUT`. That holds even if the window has also expired, so the template picker (`admin.whatsapp.tsx:1612`) never appears for an opted-out contact.
  - Add a pure `optOutReplyState(input): "not_opted_out" | "blocked" | "reopened"` for the UI.
- **No change** to `campaign-delivery.server.ts`, `service-workflow.server.ts`, `blast-review.ts`, `segments.server.ts` or `admin-data.server.ts:898,3529,3584`. They keep blocking on `opted_out_whatsapp`, which is what D4 wants; tests pin it.
- **Create `src/lib/neon/whatsapp-opt-out.server.ts`** (`server-only`, the same shape as `whatsapp-consent.server.ts`).
- **Modify `src/lib/neon/admin-data.ts`.** Insert directly after `:1469` (the end of `setWhatsappMarketingConsent`), **not** at the end of the file: `clearAccidentalWhatsappOptOutServer` (createServerFn POST, `requireStaff(["admin","manager"])`) plus the exported client wrapper `clearAccidentalWhatsappOptOut`. **Do not name anything `clearContactWhatsappOptOut*`, `confirmClearOptOut` or `clearOptOutReason`** (`woztell.test.mjs:456-477`).
- **Create `src/lib/neon/whatsapp-opt-out.test.mjs`** (unit, fake ports), and register it by adding it to the **existing** `src/lib/neon/whatsapp-consent.test.mjs` import list. Alternative: put the tests in `whatsapp-consent.test.mjs` directly, which avoids touching `package.json:40`.
- **Extend `opt-out.owned.db.test.mjs`, `outbound-intent.test.mjs` and `admin-workflow.test.mjs`.**

**Interfaces:**
```ts
// src/lib/neon/whatsapp-opt-out.server.ts
export type ClearAccidentalOptOutInput = {
  contactId: string;                 // uuid
  reason: string;                    // trimmed, 5–500 chars
  expectedOptedOutAt: string | null; // ISO from the detail the manager saw; stale guard
};
export async function clearAccidentalOptOut(
  value: unknown,
  actor: Pick<StaffAccess, "staffId" | "roles">,
  ports?: { query?: typeof queryRows },
): Promise<{ ok: true; contactId: string; cleared: boolean }>;
// Errors (Response): 403 role/inactive; 400 validation; 404 contact not opted out / not found;
// 409 "OPT_OUT_GENUINE_USE_CONSENT" when the evidence or the inbound history holds a D4 message,
//     or opted_out_source='staff_recorded';
// 409 "OPT_OUT_CHANGED" when opted_out_at IS DISTINCT FROM expectedOptedOutAt.

// src/lib/neon/admin-workflow.ts
export function canReplyToConversation(input: {
  woztellEnabled: boolean; optedOut: boolean; optedOutAt?: Date | string | null;
  lastInboundAt: Date | string | null; now?: Date;
}): { ok: true } | { ok: false; reason: "WOZTELL_DISABLED" | "CONTACT_OPTED_OUT" | "OUTSIDE_24_HOUR_WINDOW" };
export function optOutReplyState(input: {
  optedOut: boolean; optedOutAt: Date | string | null; lastInboundAt: Date | string | null; now?: Date;
}): "not_opted_out" | "blocked" | "reopened";
```
**Near-miss read and dismiss (owner decision 7; no migration).**
- **Create `src/lib/neon/whatsapp-opt-out-near-miss.server.ts`:**
  ```ts
  export type OptOutNearMiss = { messageId: string; text: string; at: string } | null; // newest flagged inbound
  /** Read-time derivation. Never writes. */
  export async function readOptOutNearMiss(
    input: { conversationId: string; contactId: string },
    ports?: { query?: typeof queryRows },
  ): Promise<OptOutNearMiss>;
  export async function dismissOptOutNearMiss(
    value: unknown, // { conversationId: uuid; contactId: uuid; messageId: uuid; reason?: string (≤200) }
    actor: Pick<StaffAccess, "staffId" | "roles">,
    ports?: { query?: typeof queryRows },
  ): Promise<{ ok: true; dismissed: boolean }>;
  ```
- **The read** runs one query:
  ```sql
  WITH cut AS (SELECT GREATEST(
     (SELECT max(created_at) FROM crm_consent_events WHERE contact_id=$2),
     (SELECT max((metadata->>'messageAt')::timestamptz) FROM audit_logs
       WHERE action='contact.whatsapp_opt_out_near_miss_dismissed' AND subject_type='contact' AND subject_id=$2),
     (SELECT CASE WHEN opted_out_whatsapp THEN opted_out_at END FROM crm_contacts WHERE id=$2),
     now() - interval '30 days') AS t)
  SELECT id, text, created_at FROM whatsapp_messages, cut
  WHERE conversation_id=$1 AND contact_id=$2 AND direction='inbound' AND created_at > cut.t
  ORDER BY created_at DESC LIMIT 50
  ```
  TS then returns the newest row for which `isOptOutNearMiss(text)` is true. An opted-out contact with no newer message gets nothing, so the flag never duplicates the 已退訂推廣 badge. The 30-day floor and `LIMIT 50` bound the cost.
- **Why the dismissal is persisted in `audit_logs`, not a new column or table.** A dismissal must survive a reload, or the flag returns on every poll (#223). The owner also asked for an audit row on dismiss anyway. Using that same row as the cut-off adds no migration and keeps a single source of truth. The row is `action='contact.whatsapp_opt_out_near_miss_dismissed'`, `subject_type='contact'`, `subject_id=contactId`, `metadata={conversationId, messageId, messageAt, text: left(text,200), reason}`. `messageAt` is the dismissed message's own `created_at`, **not** the click time, so a near-miss that arrives after the staff member loaded the page still shows (Review Focus 6). Cost: `audit_logs` has no `(subject_id, action)` index. The query reads a handful of rows per contact; if the canary shows it slow, FX-18c adds the index.
- **The dismiss** is one CTE: verify that the message is inbound, belongs to `contactId` and `conversationId` (wrong-recipient guard), and that the actor is an active admin or manager with `wa_can_read_conversation`. Insert the audit row only `WHERE NOT EXISTS` an identical dismissal for that `messageId` (idempotent). It **never** writes `crm_contacts`.
- **Who acts.** Confirm and dismiss are **admin or manager**, matching the consent dialog's existing gate. Agents see the flag and the copy 「請通知經理處理」.
- **Modify `src/lib/neon/admin-data.ts`.** After the clear wrapper, add `dismissOptOutNearMissServer` (createServerFn POST, `requireStaff(["admin","manager"])`) plus the exported `dismissOptOutNearMiss`.

**The clear runs in two statements.**
1. A read: the contact's evidence, plus up to 200 inbound texts with `created_at <= opted_out_at`. The TS then runs `isOptOutText` over the texts and the evidence.
2. One guarded write CTE: `UPDATE crm_contacts SET opted_out_whatsapp=false, opted_out_cleared_at=now(), opted_out_cleared_by=$actor, updated_at=now() WHERE id=$1 AND opted_out_whatsapp AND opted_out_at IS NOT DISTINCT FROM $expected AND <active admin/manager EXISTS>`, then `INSERT INTO audit_logs(actor_id, action='contact.whatsapp_opt_out_cleared', subject_type='contact', subject_id, metadata={reason, optedOutAt, optedOutMessageId, optedOutText: left(text,200), optedOutSource})`.

`opt_in_whatsapp` is never written.

- [ ] **Step 1: write the failing tests.**
  - `admin-workflow.test.mjs`:
    - `opted-out contact: blocked until a strictly later inbound, then text for 24 h`. With `optedOutAt=T`: `lastInboundAt=T` → `CONTACT_OPTED_OUT`; `T+1ms` → ok; `T+1ms` checked at `now=T+24h+2ms` → `CONTACT_OPTED_OUT` (**not** `OUTSIDE_24_HOUR_WINDOW`); `optedOutAt=null` → `CONTACT_OPTED_OUT`.
    - `optOutReplyState` covers the same four cases.
  - `opt-out.owned.db.test.mjs`. Drive `beginOutboundDispatch` through `deliverOutboundIntent` with a fake `send` that counts calls, and a real `ops_jobs` lease, using the same setup as `no-link-local-postgres.test.mjs:1610-1640`.
    - `opted-out contact: template cancelled, text allowed after newer inbound` (fix-plan name), in this order:
      1. Live 退訂 at T.
      2. Text intent → `cancelled`, send calls 0.
      3. Template intent → `cancelled`, 0 calls.
      4. Live 「你好」 at T+1 s.
      5. Text intent → `dispatching` → fake accepted, 1 call.
      6. A new template intent → `cancelled`, still 1 call.
    - `the opt-out message itself never reopens text; only a strictly later inbound does, and only on that conversation` (Review Focus 2; wrong recipient). One contact has two conversations, C1 on channel A and C2 on channel B. Opt out on C1. A newer inbound on C2 reopens C2 only; a C1 text stays `cancelled`. A different contact's inbound changes nothing.
    - `legacy opt-out (stamped at migration) stays blocked until the next customer message`. Set `opted_out_at = last_inbound_at`: the text is cancelled. After a later inbound, the text dispatches.
    - `campaigns, surveys and service acks stay blocked while opted out, even after a reopen` (Review focus 4). After a reopen, campaign claim eligibility (`campaign-delivery.server.ts:65-73`) for that contact is false. `service-workflow` `blockedReason` returns `whatsapp_opt_out` (it is pure; call it with a row carrying `opted_out_whatsapp:true`, or run its eligibility query). The fake send count is still 0.
    - `clearAccidentalOptOut refuses when the contact's history contains a D4 message` (Review Focus 3). For a contact opted out by a live 退訂, a manager's clear → 409 `OPT_OUT_GENUINE_USE_CONSENT`, and the row is unchanged. The same applies to a legacy row whose inbound history has `STOP.`, and to a `staff_recorded` row.
    - `clearAccidentalOptOut clears a legacy false positive, keeps the evidence and writes one audit row`. A legacy row whose history is only `唔要`: after the clear, the flag is `false`; `opted_out_at`, `_source` and `_text` are unchanged; `opted_out_cleared_by` is the manager; `opt_in_whatsapp` is unchanged; 1 `audit_logs` row with the reason and an evidence snapshot.
    - `a stale clear (expectedOptedOutAt mismatch) changes nothing` (Review Focus 3). A new opt-out lands after the manager's read: 409 `OPT_OUT_CHANGED`, 0 audit rows.
    - `clear is idempotent`. A second identical call → `{cleared:false}`, and still exactly 1 audit row.
    - `a near-miss never changes opted_out_whatsapp, and a dismissal hides only messages up to the dismissed one` (Review Focus 6), in this order:
      1. Live 「我要退訂」 at T1: `readOptOutNearMiss` returns it, and the flag and evidence are unchanged.
      2. A manager dismisses: 1 audit row, and the read → `null`.
      3. Live 「STOP please」 at T2 > T1 → returned.
      4. Live "Can I stop by?" at T3 → still returns T2's message.
    - `near-miss confirm through the consent dialog opts out with that message as evidence`. `setWhatsappMarketingConsent({optedIn:false, evidenceSource:'customer_opt_out', evidenceRef:'near-miss:<id>'})`:
      - sets the flag, with `opted_out_text='我要退訂'` and `source='staff_recorded'`;
      - writes 1 `contact.marketing_consent` audit row with `trigger:'near_miss'`;
      - makes the read return `null`;
      - leaves templates `cancelled`.
    - `near-miss dismiss: idempotent, wrong-recipient and approval gates`:
      - A double dismissal → 1 audit row.
      - A `messageId` from another contact or conversation → 404, 0 rows.
      - An agent, a viewer or an inactive manager → 403.
      - The dismiss SQL never mentions `crm_contacts` in an UPDATE.
    - `approval gate: agents, viewers and inactive managers cannot clear` → 403, 0 writes.
  - `outbound-intent.test.mjs`: `eligibility SQL keeps template behind opted_out_whatsapp=false and gates text on last_inbound_at > opted_out_at`. This is a tight structural check on the one predicate; the behaviour is proven by the owned test above.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run `npm run test:woztell`, `npm run test:woztell:owned:db`, `npm run test:no-link:local-postgres`, `npm run test:command-center` (`command-center.ts` callers unchanged), `npm run lint`, `npm run typecheck`.
- [ ] **Step 4: commit.**
  ```
  fix(whatsapp): opt-out blocks templates and campaigns only; reopen text after a newer message; review near-miss requests

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 4: Unknown outcomes: definite refusals become `failed`; managers resolve a real `unknown` (migration B)

**Files:**
- **Modify `src/lib/woztell/provider-result.ts`** (append after `:113`): `DEFINITE_REJECTION_STATUSES` and `classifyOutboundSendResult`.
- **Modify `src/lib/woztell/woztell.server.ts:376-381`.** The two config returns gain `stage: "preflight"`, which is additive: `campaign-delivery` ignores it and still keys on the missing `status` (fact 10).
- **Modify `src/lib/woztell/outbound-intent.server.ts`:**
  - `:5-11`: add `"resolved_sent" | "resolved_not_sent"` to `OutboundState`.
  - `:220-239`: replace the inline ternaries with `classifyOutboundSendResult(result, parsed)`. The `catch` at `:240-243` stays `unknown`.
- **Create `neon/migrations/20261008110000_outbound_unknown_resolution.sql`:**
  1. `ALTER TABLE whatsapp_outbound_intents ADD COLUMN IF NOT EXISTS resolved_at timestamptz, ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES staff_users(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS resolution_reason text`.
  2. A `DO $$` block that drops `whatsapp_outbound_intents_state_check` if present and adds a named `wa_intent_state_check CHECK (state IN ('queued','dispatching','accepted','unknown','failed','cancelled','resolved_sent','resolved_not_sent'))`, guarded by `pg_constraint` so it is idempotent.
  3. `CREATE OR REPLACE FUNCTION wa_guard_outbound_resolution()` plus `CREATE TRIGGER wa_intent_resolution_guard BEFORE INSERT OR UPDATE OF state ON whatsapp_outbound_intents`. On INSERT, `resolved_*` raises `OUTBOUND_RESOLUTION_INVALID`. On UPDATE into `resolved_*`, it requires `OLD.state='unknown'` and non-null `resolved_at`, `resolved_by` and `resolution_reason`, or it raises `OUTBOUND_RESOLUTION_INVALID`. On UPDATE out of `resolved_*` to any other state, it raises `OUTBOUND_RESOLUTION_FINAL`.
  4. **`wa_guard_outbound_reservation` and its trigger are not touched** (fact 7).

  Header: "FX-08 / D-02. Releases the lock by moving out of ('dispatching','unknown'). Sends nothing. Rollback: `neon/reverts/20261008110000_outbound_unknown_resolution_revert.sql`."
- **Create `neon/reverts/20261008110000_outbound_unknown_resolution_revert.sql`.** It drops `wa_intent_resolution_guard` and `wa_guard_outbound_resolution()`. It deliberately **keeps** the widened CHECK and the columns: old code never writes `resolved_*`, and narrowing the CHECK would fail on resolved rows. Use the same "lives outside `neon/migrations`; apply by hand with owner approval; leaves the `app_migrations` row" header as FX-06's revert.
- **Modify `migration-versions.js`** (append) and the two pinned counts (→ 87).
- **Create `src/lib/woztell/outbound-resolution.server.ts`.**
- **Modify `src/lib/neon/admin-data.ts`.** Directly after the Task 3 insertion: `resolveAdminUnknownOutboundServer` (createServerFn POST, `requireStaff(["admin","manager"])`) plus the exported `resolveAdminUnknownOutbound`.
- **Create `src/lib/woztell/outbound-intent.owned.db.test.mjs`** (the fix-plan name) and add it to `test:woztell:owned:db`.
- **Extend `outbound-intent.test.mjs`** (unit harness `:214-250`) and `src/lib/woztell/provider-result.test.mjs` (in `test:whatsapp-enquiries`).

**Interfaces:**
```ts
// provider-result.ts
export const DEFINITE_REJECTION_STATUSES: readonly number[] = [400, 401, 403, 404, 422, 429];
export function classifyOutboundSendResult(
  result: { ok: boolean; status?: number; refused?: boolean; stage?: "preflight" },
  parsed: ParsedWoztellProviderResult,
): { state: "accepted" | "failed" | "unknown"; error: string | null };
// Order (first match wins):
// 1. result.ok && parsed.outcome==="identifiable_acceptance"      → accepted, null
// 2. result.ok || parsed.possibleAccepted                          → unknown, "WOZTELL_DELIVERY_UNKNOWN"   (any acceptance signal)
// 3. result.stage==="preflight"                                    → failed,  "WOZTELL_CONFIGURATION_UNAVAILABLE"
// 4. result.refused===true || parsed.outcome==="definitive_refusal" → failed,  "WOZTELL_REFUSED"
// 5. DEFINITE_REJECTION_STATUSES.includes(result.status)            → failed,  "WOZTELL_PROVIDER_REJECTED"
// 6. otherwise                                                     → unknown, "WOZTELL_DELIVERY_UNKNOWN"

// outbound-resolution.server.ts
export type ResolveUnknownOutboundInput = {
  intentId: string; conversationId: string;            // both uuid; must match each other
  outcome: "resolved_sent" | "resolved_not_sent";
  reason: string;                                      // trimmed, 5–500 chars
};
export const UNKNOWN_RESOLUTION_MIN_AGE_MINUTES = 15;
export async function resolveUnknownOutbound(
  value: unknown,
  actor: Pick<StaffAccess, "staffId" | "roles">,
  ports?: { query?: typeof queryRows },
): Promise<{ ok: true; intentId: string; state: "resolved_sent" | "resolved_not_sent"; changed: boolean; lockReleased: boolean }>;
// One CTE statement:
//   lock      AS (SELECT id FROM whatsapp_conversations WHERE id=$conv FOR UPDATE)   -- serialises with the reservation trigger
//   upd       AS (UPDATE whatsapp_outbound_intents i SET state=$outcome, resolved_at=now(), resolved_by=$actor,
//                   resolution_reason=$reason, error=COALESCE(i.error,'WOZTELL_DELIVERY_UNKNOWN'), updated_at=now()
//                 WHERE i.id=$intent AND i.conversation_id=$conv AND i.state='unknown'
//                   AND (i.dispatch_started_at IS NULL OR i.dispatch_started_at <= now() - interval '15 minutes')
//                   AND <active admin/manager> AND wa_can_read_conversation($actor,$conv) RETURNING i.*)
//   msg       AS (UPDATE whatsapp_messages m SET status=u.state FROM upd u WHERE m.id=u.message_id)
//   audit     AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
//                 SELECT $actor,'whatsapp.outbound_unknown_resolved','whatsapp_outbound_intent',u.id,
//                   jsonb_build_object('conversationId',u.conversation_id,'outcome',u.state,'reason',$reason,
//                     'kind',u.kind,'actorType',u.actor_type,'dispatchStartedAt',u.dispatch_started_at,'previousError',u.error) FROM upd u)
//   SELECT COALESCE((SELECT state FROM upd), i.state) AS state, EXISTS(SELECT 1 FROM upd) AS changed,
//          NOT EXISTS(SELECT 1 FROM whatsapp_outbound_intents o WHERE o.conversation_id=$conv AND o.id<>$intent
//                     AND o.state IN ('dispatching','unknown')) AS lock_released
//   FROM whatsapp_outbound_intents i WHERE i.id=$intent AND i.conversation_id=$conv
// Mapping: no row → 404 OUTBOUND_NOT_FOUND_OR_FORBIDDEN; state = requested outcome & !changed → idempotent ok;
// state = other resolved_* → 409 OUTBOUND_ALREADY_RESOLVED; still 'unknown' & !changed → 409 OUTBOUND_RESOLUTION_TOO_EARLY
// (or 403 if the role/read check failed — return the read-check result separately so the codes are honest);
// any other state → 409 OUTBOUND_NOT_UNKNOWN.
```
The resolution applies to staff **and** service-automation intents (fact 7: both lock staff).

- [ ] **Step 1: write the failing tests.**
  - `outbound-intent.test.mjs` (harness):
    - ~~`401 non-JSON → failed, next send allowed`~~ superseded 2026-10-07: `an unreadable or unparsable provider answer is unknown at any status, never re-sent` (`{ok:false,error:"WOZTELL_INVALID_RESPONSE",status,bodyUnreadable:true}` and the empty-body shape → `unknown`).
    - `definite rejections and config errors are failed`: statuses 400, 401, 403, 404, 422, 429 with a parsed `{ok:0}` or `{}` body → `failed` (`WOZTELL_PROVIDER_REJECTED`). No body or an unparsable body is `unknown` (2026-10-07). `{ok:false, error:"WOZTELL_ENABLED is not true", stage:"preflight"}` → `failed` (`WOZTELL_CONFIGURATION_UNAVAILABLE`).
    - `any acceptance signal keeps unknown: 401 with ok:1, 429 with a messageId, 2xx execution_accepted` (Review Focus 5).
    - `5xx without ok:0, a timeout throw and an ambiguous 2xx stay unknown`. Keep `:276-284` and add a 500 non-JSON case.
    - **Provider-down fallback:** each case calls `send` exactly once; a second `deliverOutboundIntent` makes 0 calls.
  - `provider-result.test.mjs`: `classifyOutboundSendResult` covers the full rule table (one assert per row). Separately, `sendWoztellResponse` with `WOZTELL_ENABLED` unset returns `stage:"preflight"` without calling `provider-fetch` (mock `boundedProviderFetch` to throw).
  - `outbound-intent.owned.db.test.mjs`. Seed an active manager (no branch) assigned to the conversation, an agent, a viewer, an inactive manager, a contact and a conversation. Mock fetch to throw. Use a fake `send`.
    - `migration B widens the state check, adds the guard, and the revert drops only the guard`. Check `pg_constraint` contains `wa_intent_state_check` with 8 states and `pg_trigger` has `wa_intent_resolution_guard`. Apply the revert text, then the trigger is gone, the check still has 8 states and `wa_intent_unknown_reservation` is still present. Re-apply the forward file: idempotent. `MIGRATION_VERSIONS.includes(...)`.
    - `401 non-JSON → unknown and locked, never re-sent` and `401 parsed refusal → failed, next send allowed` (DB half; split 2026-10-07). The parsed case: Deliver with a fake send returning the 401 shape → state `failed`. A new `enqueueOutboundIntent` on the same conversation succeeds; no `OUTBOUND_RECONCILIATION_REQUIRED`.
    - `timeout → unknown; resolveUnknownOutbound releases lock` (fix-plan name):
      1. A fake send throws → `unknown`.
      2. `enqueueOutboundIntent` → rejects `OUTBOUND_RECONCILIATION_REQUIRED`.
      3. Age `dispatch_started_at` by 16 min.
      4. The manager resolves `resolved_not_sent`: `changed:true`, `lockReleased:true`, the transcript `status='resolved_not_sent'`, 1 audit row.
      5. `readOutboundReservation` → `blocked:false`.
      6. A new enqueue succeeds.
    - `resolution is refused until 15 minutes after dispatch_started_at and never enqueues, sends or credits a human response` (Review Focus 4):
      - At 14 min → 409 `OUTBOUND_RESOLUTION_TOO_EARLY`, unchanged.
      - At 16 min with `resolved_sent` on an intent linked to an enquiry: `ops_jobs` count is unchanged, the fake send has 0 calls, `fetch` is never called, `whatsapp_human_response_evidence` is unchanged, and `inquiries.first_human_response_at` is unchanged.
      - The source of `outbound-resolution.server.ts` does not import `woztell.server` or `enqueueOutboundIntent`.
    - `idempotency: double click and two managers resolve once`. `Promise.all` of 2 identical calls → one `changed:true`, one `changed:false`, both `ok`, 1 audit row. A conflicting outcome afterwards → 409 `OUTBOUND_ALREADY_RESOLVED`.
    - `wrong-recipient guard: an intent id with another conversation's id is not found`. Resolving intent X with conversation Y → 404, and X stays `unknown`.
    - `approval gate: agent, viewer and inactive manager get 403; the reason is required` (400 when shorter than 5 characters); 0 writes.
    - `a resolved intent is final; provider evidence and lease recovery cannot move it`:
      - A direct `UPDATE … SET state='unknown'` raises `OUTBOUND_RESOLUTION_FINAL`.
      - `finishOutboundIntent(id, {state:"accepted",…})` leaves `resolved_not_sent`, because its `WHERE` excludes it.
      - A signed DELIVERED receipt ingest leaves it unchanged.
      - The jobs lease recovery (`jobs.server.ts:757`) only touches `dispatching`.
    - `resolving a service-automation unknown also releases the staff lock`. With `actor_type='service'` in `unknown`, staff enqueue is blocked; after resolution it is allowed.
    - `only unknown can be resolved`. `queued`, `dispatching`, `accepted` and `failed` → 409 `OUTBOUND_NOT_UNKNOWN`. A raw SQL `UPDATE … SET state='resolved_sent'` without `resolved_by` → `OUTBOUND_RESOLUTION_INVALID`.
- [ ] **Step 2:** implement until green.
- [ ] **Step 3:** run `npm run test:woztell`, `npm run test:whatsapp-enquiries`, `npm run test:woztell:owned:db`, `npm run test:no-link:local-postgres` (reservation and receipt goldens unchanged), `npm run test:control-plane`, `npm run lint`, `npm run typecheck`.
- [ ] **Step 4: commit.**
  ```
  fix(whatsapp): definite provider refusals fail fast; managers resolve unknown sends without resending

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

### Task 5: Inbox: opt-out evidence, 清除誤判 and 核對未確認傳送 (small diff in `admin.whatsapp.tsx`)

**Files:**
- **Modify `src/lib/neon/admin-data.server.ts:2958-3033`** (`fetchAdminConversation`, not touched by #223 or #225):
  - Select `c.opted_out_at, c.opted_out_text, c.opted_out_source, c.opted_out_cleared_at`.
  - For managers and above only, add a lateral `unknown_outbound`: the oldest `state='unknown'` intent's `id, kind, actor_type, dispatch_started_at, error`, plus `resolvable := dispatch_started_at IS NULL OR dispatch_started_at <= now()-interval '15 minutes'`. Agents get `null`.
  - Return `opted_out_at`, `opted_out_text` (`left(…,200)`), `opted_out_source`, `can_resolve_unknown_outbound` (the same role rule as `can_clear_opt_out`) and `unknown_outbound`.
- **Modify `src/lib/neon/admin-data.types.ts:388-400`** (`AdminConversationDetail`): add the optional fields `opted_out_at?: string | null`, `opted_out_text?: string | null`, `opted_out_source?: "customer_message" | "staff_recorded" | "legacy" | null`, `can_resolve_unknown_outbound?: boolean` and `unknown_outbound?: { id: string; kind: "text" | "template"; actor_type: "staff" | "service"; dispatch_started_at: string | null; error: string | null; resolvable: boolean } | null`. They are optional so the fixture and older clients still compile.
- **Create `src/components/admin/whatsapp/OptOutEvidenceNotice.tsx`.** It renders nothing when `!detail.opted_out_whatsapp`. Otherwise it shows a `Badge variant="destructive"` 已退訂推廣, one line of evidence (time + quoted text, or the legacy/staff copy), the reopen line when `optOutReplyState(...) === "reopened"`, and, when `detail.can_clear_opt_out && detail.opted_out_source === "legacy"`, a 清除誤判 `Dialog` with a required reason (`Textarea`). It calls `clearAccidentalWhatsappOptOut({ data: { contactId, reason, expectedOptedOutAt: detail.opted_out_at } })`, maps 409 codes to copy, then `onChanged()`.
- **Near-miss flag, inside `OptOutEvidenceNotice.tsx`** (owner decision 7; no new line in `admin.whatsapp.tsx`):
  - `fetchAdminConversation` also returns `opt_out_near_miss: OptOutNearMiss`, from `readOptOutNearMiss`, for every reader.
  - When it is non-null and the contact is not opted out, the notice renders a `Badge variant="outline"` 「可能要求退訂」 and the quoted message with its time.
  - For managers (`can_clear_opt_out`), it shows two buttons:
    - **確認退訂** renders the existing `WhatsappConsentDialog` with a new optional prop `preset={{ optedIn: false, evidenceSource: "customer_opt_out", evidenceRef: "near-miss:" + messageId }}` and `triggerLabel="確認退訂"`. With the preset, one click on 確認並儲存 saves.
    - **不是退訂** opens an `AdminConfirmDialog` with an optional reason, then calls `dismissOptOutNearMiss` and `onChanged()`.
  - Agents see the 「請通知經理處理」 line instead of the buttons.
- **Modify `src/components/admin/WhatsappConsentDialog.tsx`** (no open PR touches it): add the optional `preset` and `triggerLabel` props; the default behaviour is unchanged.
- **Modify `src/lib/neon/admin-data.types.ts`:** add `opt_out_near_miss?: { messageId: string; text: string; at: string } | null`.
- **Add a fixture stub after `synthetic-api.ts:305`:** `export const dismissOptOutNearMiss = () => noMutation("dismissNearMiss");`.
- **Create `src/components/admin/whatsapp/ResolveUnknownOutboundDialog.tsx`.** It renders only when `detail.can_resolve_unknown_outbound && detail.unknown_outbound`.
  - The trigger button is 核對未確認傳送. It is disabled with the 「最早可於…核對」 copy when `!resolvable`.
  - The dialog has two radio options (`radio-group`): 已送達客戶 → `resolved_sent`; 未有送出 → `resolved_not_sent`. It also has a required reason and a confirm button.
  - It calls `resolveAdminUnknownOutbound`, then `onChanged()`.
  - **It never calls a send function.** The success toast says the conversation is unlocked and nothing was resent.
- **Modify `src/routes/admin.whatsapp.tsx`, only at these anchors:**
  - After `:29`: import the two components.
  - `:111`: copy for `CONTACT_OPTED_OUT`.
  - `:1251-1253` and `:1316-1318`: each `onConsentSaved` arrow additionally runs `if (staffUserId && selectedIdRef.current) void checkOutboundReservation(selectedIdRef.current, staffUserId).catch(() => {})`.
  - `:1626`: replace the badge with `<OptOutEvidenceNotice detail={detail} onChanged={onConsentSaved} />`, and add `<ResolveUnknownOutboundDialog detail={detail} onChanged={onConsentSaved} />` next to the consent dialog (`:1627-1633` unchanged).
  - `:2102-2110`: labels for `WOZTELL_PROVIDER_REJECTED`, `WOZTELL_REFUSED` and `OUTBOUND_RESOLUTION_*`.
  - `:2204-2208`: pass `optedOutAt: detail.opted_out_at ?? null`.
  - `:2232-2239`: labels for `resolved_sent` and `resolved_not_sent`.

  Leave the list badge at `:1502` (`ConversationList`) alone to keep the diff small. It still says 已拒收; FX-17 renames it.
- **Modify `scripts/browser-fixtures/no-link/synthetic-api.ts`.** After `:305`, add `export const clearAccidentalWhatsappOptOut = () => noMutation("clearAccidentalOptOut");` and `export const resolveAdminUnknownOutbound = () => noMutation("resolveUnknownOutbound");`. This avoids #223's `:73-260` and `:591+` and #222's `:533`.
- **Create `src/components/admin/whatsapp/OptOutEvidenceNotice.test.tsx` and `ResolveUnknownOutboundDialog.test.tsx`** (bun, `renderToStaticMarkup`).
- **Modify `package.json`.** After the Task 2 line (still after `:80`), add `"test:whatsapp-safety:ui": "bun test --no-env-file src/components/admin/whatsapp/OptOutEvidenceNotice.test.tsx src/components/admin/whatsapp/ResolveUnknownOutboundDialog.test.tsx"`. In `ci.yml`, add `- run: npm run test:whatsapp-safety:ui` after `:103` (`test:woztell`).
- **Extend `woztell.test.mjs:456-477`**, keeping its intent: the legacy stub still rejects; the inbox still has no `clearContactWhatsappOptOut|confirmClearOptOut|clearOptOutReason|解除拒收`; and `admin-data.ts` now contains `clearAccidentalWhatsappOptOutServer` guarded by `requireStaff(["admin", "manager"])`.

**Copy table (zh-HK):**

| Key / place | Text |
|---|---|
| Badge | 已退訂推廣 |
| Evidence, customer message | 客戶於 {時間} 傳送「{原文}」，系統已停止範本、推廣及問卷。 |
| Evidence, staff recorded | 同事於 {時間} 記錄客戶拒收推廣。 |
| Evidence, legacy | 舊系統於 {時間} 或之前判定為拒收（未有保存原文）。如屬誤判，經理可清除。 |
| Reopened line | 客戶於 {時間} 再次來訊，現可在 24 小時內以文字回覆；範本仍然停用。 |
| `CONTACT_OPTED_OUT` (`:111`) | 客戶已退訂推廣。客戶再次來訊後 24 小時內可用文字回覆；範本、推廣及問卷會保持停用。 |
| Clear button / dialog title | 清除誤判 / 清除誤判的退訂 |
| Clear description | 只適用於系統誤判（例如客戶回覆「唔要」）。原有紀錄會保留，並記入審計紀錄。不會更改推廣同意。 |
| Reason label / placeholder | 原因（必填） / 例如：客戶只是回答「唔要車位」 |
| Clear success / 409 genuine / 409 changed | 已清除誤判，紀錄已保留。 / 客戶曾明確要求退訂，不能清除；如客戶重新同意，請用「管理 WhatsApp 推廣同意」記錄憑證。 / 退訂狀態剛有更新，請重新載入後再核對。 |
| Resolve button | 核對未確認傳送 |
| Resolve, too early | 傳送結果仍在確認中，最早可於 {時間} 核對。 |
| Resolve dialog title / description | 核對未確認的傳送 / 系統未能確認這則{文字訊息/範本}是否已送達（開始傳送：{時間}）。請先在 WhatsApp 或 WozTell 核對，再選擇結果。此操作不會重新傳送任何訊息。 |
| Options | 已送達客戶 / 未有送出 |
| Resolve success | 已記錄核對結果，對話已解鎖。系統沒有重新傳送；如需再發，請自行輸入新訊息。 |
| Resolve errors | 已由其他同事核對。 / 此傳送已不是未確認狀態，請重新載入。 / 你沒有權限核對此傳送。 |
| `WOZTELL_PROVIDER_REJECTED` | WhatsApp 供應商拒絕了這次傳送，訊息未送出，可以修正後再試。 |
| `WOZTELL_REFUSED` | WhatsApp 供應商拒絕傳送，訊息未送出。 |
| Status `resolved_sent` / `resolved_not_sent` | 經理已核對：已送達 / 經理已核對：未送出 |
| Near-miss flag (badge) | 可能要求退訂 |
| Near-miss line | 客戶於 {時間} 傳送「{原文}」，可能想停止接收訊息。系統未有自動退訂，請核實。 |
| Near-miss confirm button / dismiss button | 確認退訂 / 不是退訂 |
| Near-miss dismiss dialog title / description | 不是退訂要求？ / 只會隱藏這則提示，不會更改客戶的推廣同意。之後如客戶再傳類似訊息，系統會再次提示。此操作會記入審計紀錄。 |
| Near-miss dismiss reason (optional) | 備註（選填），例如：客戶只是問「可唔可以停一停先」 |
| Near-miss agent line | 請通知經理處理。 |
| Near-miss confirm / dismiss success | 已記錄客戶退訂，範本及推廣會停止。 / 已隱藏提示，並記入審計紀錄。 |

- [ ] **Step 1: write the failing tests.**
  - `OptOutEvidenceNotice.test.tsx`:
    - `shows the quoted message and time for a customer opt-out, with no clear button`.
    - `shows 清除誤判 only to managers on legacy rows`.
    - `shows the reopened line only after a strictly newer inbound`.
    - `renders nothing when not opted out and there is no near-miss`.
    - `near-miss: shows 可能要求退訂 with the quoted message; managers get 確認退訂 (consent dialog preset to 客戶拒收要求 + near-miss:<id>) and 不是退訂; agents get 請通知經理處理 only`.
    - `near-miss is not shown when the contact is already opted out`.
  - `ResolveUnknownOutboundDialog.test.tsx`:
    - `hidden for agents and when there is no unknown intent`.
    - `disabled with the earliest time before 15 minutes`.
    - `copy states nothing is resent and offers exactly two outcomes`. The markup contains 此操作不會重新傳送任何訊息, and there is no send or resend button.
  - `admin-data.contract.test.mjs` is **not** edited (#222 and #223 touch it). Instead, `opt-out.owned.db.test.mjs` adds `fetchAdminConversation exposes evidence to all readers and unknown_outbound to managers only` (an agent gets `unknown_outbound: null`).
  - `woztell.test.mjs` (`:456-477`, rewritten as above).
- [ ] **Step 2:** implement until green. Then confirm `git diff --stat src/routes/admin.whatsapp.tsx` is **≤ 40 lines** and that every hunk sits at one of the anchors listed.
- [ ] **Step 3:** run `npm run test:whatsapp-safety:ui`, `npm run test:woztell`, `npm run test:woztell:owned:db`, `npm run test:no-link` (the browser-fixture build compiles with the stubs), `npm run test:whatsapp-mobile:ui`, `npm run test:admin-daily-work:ui`, `npm run lint`, `npm run typecheck`, `npm run build`. Take before/after screenshots of the conversation header at 375 px and 1440 px: synthetic fixture, opted-out legacy row, unknown intent.
- [ ] **Step 4: commit.**
  ```
  feat(admin): show opt-out evidence and let managers clear a misread opt-out or close out an unknown send

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## Owner actions before production

**Order:** owner approves this plan → the owner applies both migrations on a Neon branch → read-only reports → sandbox → production migrations (explicit approval) → merge → canary. Nothing is applied anywhere without approval (fix plan Global constraints).

1. **Neon branch migration (owner's step; both migrations approved as drafted, owner decision 8).** Claude only runs them on owned or test databases.
   - Apply `20261008100000_whatsapp_opt_out_evidence.sql`, then `20261008110000_outbound_unknown_resolution.sql`, with `npm run neon:migrate` against the **branch** URL.
   - Verify:
     - `\d crm_contacts` shows the six columns;
     - `SELECT count(*) FROM crm_contacts WHERE opted_out_whatsapp AND opted_out_at IS NULL` = 0;
     - `SELECT count(*) FROM crm_contacts WHERE opted_out_source='legacy'` equals report total (2) below;
     - `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='wa_intent_state_check'` lists 8 states;
     - `SELECT tgname FROM pg_trigger WHERE tgrelid='whatsapp_outbound_intents'::regclass AND NOT tgisinternal` includes both `wa_intent_unknown_reservation` and `wa_intent_resolution_guard`.
   - On a second throwaway branch: apply the revert, confirm the guard is gone, then re-apply the forward file.
2. **Read-only report: contacts opted out by text not in the D4 list** (run **before** migration A on production, and on the branch). Nothing is changed by it:
   ```sql
   BEGIN READ ONLY;
   WITH d4(word) AS (VALUES ('stop'),('unsubscribe'),('退訂'),('退订'),('取消訂閱'),('取消订阅'),('停止接收')),
   inbound AS (
     SELECT m.contact_id, m.created_at, m.text,
       lower(regexp_replace(
         regexp_replace(normalize(coalesce(m.text,''), NFKC),
           '^[[:space:][:punct:]！？。，、「」『』～…!?.,~]+|[[:space:][:punct:]！？。，、「」『』～…!?.,~]+$', '', 'g'),
         '[[:space:]]+', '', 'g')) AS norm
     FROM whatsapp_messages m
     WHERE m.direction = 'inbound' AND m.contact_id IS NOT NULL
   ),
   opted AS (
     SELECT c.id, right(coalesce(c.normalized_phone,''), 4) AS phone_last4,
            c.last_inbound_at, c.updated_at,
            EXISTS (SELECT 1 FROM inbound i JOIN d4 ON d4.word = i.norm WHERE i.contact_id = c.id) AS has_d4_message,
            EXISTS (SELECT 1 FROM crm_consent_events e WHERE e.contact_id = c.id AND e.opted_in = false) AS staff_recorded
     FROM crm_contacts c WHERE c.opted_out_whatsapp
   )
   -- (1) review list: opted out, no exact D4 message, not staff-recorded
   SELECT o.id AS contact_id, o.phone_last4, o.last_inbound_at,
          (SELECT string_agg(left(i.text, 80), ' | ' ORDER BY i.created_at DESC)
             FROM (SELECT text, created_at FROM inbound i2 WHERE i2.contact_id = o.id
                   ORDER BY created_at DESC LIMIT 3) i) AS last_3_inbound
   FROM opted o WHERE NOT o.has_d4_message AND NOT o.staff_recorded
   ORDER BY o.last_inbound_at DESC NULLS LAST;
   ROLLBACK;
   -- (2) totals (same CTEs, in their own BEGIN READ ONLY … ROLLBACK):
   -- SELECT count(*) total_opted_out, count(*) FILTER (WHERE has_d4_message) d4,
   --        count(*) FILTER (WHERE staff_recorded) staff_recorded,
   --        count(*) FILTER (WHERE NOT has_d4_message AND NOT staff_recorded) to_review FROM opted;
   ```
   The normalisation in SQL is approximate. It can only **over**-report (list a contact for review), never hide one. The owner reviews the list; a manager clears a row one at a time in the inbox with 清除誤判, giving a reason. **Nothing is auto-cleared.**
3. **Read-only report: conversations locked by `unknown` today:**
   ```sql
   BEGIN READ ONLY;
   SELECT i.conversation_id, i.id AS intent_id, i.kind, i.actor_type, i.error,
          i.dispatch_started_at, now() - i.dispatch_started_at AS age
   FROM whatsapp_outbound_intents i WHERE i.state IN ('dispatching','unknown')
   ORDER BY i.dispatch_started_at NULLS FIRST;
   ROLLBACK;
   ```
   After deploy, a manager resolves each one in the inbox after checking WozTell. These are never bulk-resolved by SQL.
4. **Sandbox, with the owner's test number only** (WozTell sandbox channel, Vercel preview on the Neon branch):
   1. From the test phone, reply 「唔要」 → no 已退訂推廣 badge; a staff text reply sends.
   2. Reply "Can I stop by?" → no badge.
   3. Reply 「退訂」 → badge with the quoted text. A staff text is refused in the composer, and a template is not offered (or is `cancelled` if forced through the API).
   4. Reply 「你好」 → the reopened line appears; a staff text sends; a template is still blocked.
   5. Clear: as a manager, 清除誤判 on this contact is refused with the "genuine" copy.
   6. Unknown/failed: on the preview, set a wrong `WOZTELL_BOT_ACCESS_TOKEN` → send a text → the bubble shows 供應商拒絕… (`failed`), and the next send is not locked. Restore the token.
   7. Resolution: on the **branch** DB, set one synthetic intent on the test conversation to `unknown` with `dispatch_started_at = now() - interval '20 minutes'`. As a manager, 核對未確認傳送 → 未有送出 → the conversation unlocks, and the WozTell sandbox log shows **no** new outbound.
5. **Production:** apply both migrations with explicit approval, **then** merge (FX-00 order).
6. **Canary (read-only, first 48 h):**
   - `/admin/whatsapp` loads for an agent and a manager.
   - `SELECT opted_out_source, count(*) FROM crm_contacts WHERE opted_out_whatsapp GROUP BY 1` is stable, apart from new `customer_message` rows.
   - Every new `customer_message` row has `opted_out_text` matching D4 (`SELECT opted_out_text, count(*) … WHERE opted_out_source='customer_message' AND opted_out_at > <deploy> GROUP BY 1`).
   - `SELECT state, error, count(*) FROM whatsapp_outbound_intents WHERE created_at > <deploy> GROUP BY 1,2` shows `failed/WOZTELL_PROVIDER_REJECTED` rather than new `unknown` rows for 4xx.
   - `audit_logs` has one row per clear or resolve.
   - Then update the Status column in the audit doc and `CHANGELOG.md`.

## Open questions

Each has a recommended default; I will use the default unless the owner says otherwise.

1. ~~Simplified forms~~ **Resolved (owner decision 6):** `退订` and `取消订阅` are exact opt-out words.
2. ~~Near-miss requests~~ **Resolved (owner decision 7):** a 「可能要求退訂」 flag for staff review, confirmed via the consent dialog or dismissed, with both actions audited. There is no automatic opt-out and no migration. The remaining sub-question: **should agents also be able to confirm or dismiss? Default: no.** It stays admin and manager, matching the consent dialog's gate; agents see the flag and are asked to notify a manager.
3. **Service automation replies (after-hours ack, survey thanks, manager ack).** These are replies to the customer, not campaigns. **Default: keep them blocked while opted out** (today's behaviour, `service-workflow.server.ts:202`). Only staff text reopens. This is the conservative reading of "business-initiated".
4. **The 15-minute minimum age before an `unknown` can be resolved.** **Default: 15 min.** That is well over the 15 s fetch bound and lease recovery, and gives a signed DELIVERED receipt time to auto-resolve to `accepted`.
5. ~~Stamping legacy `opted_out_at` inside migration A~~ **Resolved (owner decision 8):** approved as drafted. Both migrations run on test databases only; the Neon branch and production are the owner's step.
6. **Clearing a genuine opt-out.** **Default: refused** (`OPT_OUT_GENUINE_USE_CONSENT`) when the evidence or the history has a D4 message, or the opt-out was staff-recorded. Re-consent goes through the evidence-based consent dialog, which already exists.
7. **Who resolves `unknown`.** D4 says manager or above. **Default: admin and manager, any intent on a conversation they can read**, including service-automation intents and other staff's intents. Agents see the existing 「請先核對狀態」 copy only.

## Findings that differ from the approved fix plan

1. **The reservation trigger does not need replacing.** The fix plan says "replace the trigger from `20261001090000…`" (fix plan :408). In fact the trigger already lets every update except `queued→dispatching` through (`…unknown_reservation.sql:12-14`). What blocks a resolution is the inline state CHECK (`20260905130000_outbound_intents.sql:9`). Migration B therefore widens the CHECK and **adds** a separate guard trigger. The FX-08 revert drops only the new guard; the reservation trigger is never touched, so it needs no revert.
2. **The evidence needs more than the three columns in the register.** `opted_out_source` is needed to tell `customer_message`, `staff_recorded` and `legacy` apart; the clear rule and the UI copy depend on it. `opted_out_cleared_at/_by` are needed to keep history when a clear does not erase evidence. All are additive.
3. **Migration A includes a one-time data stamp** (legacy `opted_out_at`). The register calls it purely "additive". It writes only NULL evidence columns on already-opted-out rows. The owner approved it on 2026-10-06 (decision 8).
4. **Ingest also has a duplicate-message bug.** The contact upsert applies the opt-out even when the message is a webhook redelivery (fact 2). The fix plan's four ingest tests would not catch a re-opt-out after a clear (Review Focus 1).
5. **The audit's file anchors moved.** The fix plan cites `woztell.server.ts:104-118` and audit D-01 cites `:108,114`. On `4965d48` the detector spans `:62-185` and is already three-tier, with NFKC and politeness stripping. It still opts out on 「唔要」, 「停止」, "unsubscribe please" and word-boundary `stop`, so D-01 still holds. `woztell.test.mjs:406` (cited in the audit) now sits inside the stems test at `:401-414`.
6. **Campaigns already treat 4xx and config errors as definite** (`campaign-delivery.server.ts:253-268`). Only staff and service sends were affected. FX-08 reuses the campaign's error codes, so both paths read the same in the UI.
7. **#227 (FX-07) touches neither the migration registry nor any migration** (verified with `git diff 4965d48...origin/fix/fx-07-jobs-drain`). The registry conflicts come only from #225 and #226.
8. **Service-automation `unknown` intents lock staff replies too**, because the reservation EXISTS has no actor filter (fact 7). The fix plan scopes resolution to staff sends. FX-08 lets managers resolve either kind.
9. **The fix plan's test file `outbound-intent.owned.db.test.mjs` does not exist yet.** The existing `outbound-intent.db.test.mjs` runs only against a Neon `TEST_DATABASE_URL` and is skipped in CI. FX-08 creates the owned file plus `opt-out.owned.db.test.mjs`, and wires both into CI (`ci.yml` after `:149`).
10. **The near-miss review flag is new scope** (owner decision 7); the fix plan has no equivalent. It adds no migration: dismissals are stored as `audit_logs` rows.
