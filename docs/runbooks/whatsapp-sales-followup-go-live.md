# WhatsApp sales follow-up go-live checklist

Status on 2026-11-24 (verified read-only against production Neon + Vercel env names/flags): **the
flow is not live**. What _is_ live is the plumbing — the number, the tracked links and inbound
capture. What is missing is ownership: nothing is attributed, assigned, or followed up.

Every step below names its type, the evidence that proves it is done, and the rollback. **None of
the production steps may be executed without Willy naming that step.** Code steps go through a PR
and are inert until the matching setting exists.

## Where the flow actually stands

| Layer                                       | Evidence (2026-11-24)                                                                                                                                                                             | Live? |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Company number                              | `EP_WA_COMPANY_PHONE=85224962283`                                                                                                                                                                 | ✅    |
| Tracked links on the new channel `6ad6c566` | 629 link versions (minted by 2026-11-08)                                                                                                                                                          | ✅    |
| Link clicks                                 | 2,829 opens in the last 30 days, latest 2026-11-24 13:36 SGT                                                                                                                                      | ✅    |
| Inbound capture                             | 23 `customer_message` events in 30 days, `origin=live_webhook`, latest 2026-11-22 17:39 SGT, 16 enquiries                                                                                         | ✅    |
| Click → enquiry attribution                 | `whatsapp_enquiry_reference_links` = **0 rows ever**                                                                                                                                              | ❌    |
| Conversation / lead ownership               | 16 conversations created in 20 days: **0 assigned**; 30-day CRM leads: 13 WhatsApp + 7 website **all unassigned**                                                                                 | ❌    |
| Staff↔channel mapping                       | `whatsapp_staff_channels`: channel `6ad6c566` verified 2026-11-08 (inbox user, folder, routing node)                                                                                              | ✅    |
| Portal staff aliases (28hse "XXX 你好")     | `staff_external_references` = 0                                                                                                                                                                   | ❌    |
| Portal no-link intake                       | no `EP_WA_NO_LINK_*` variables exist; `no_link_effect_decisions` = 0; `portal_source_scopes` = 0                                                                                                  | ❌    |
| Manager / staff follow-up alerts            | `manager:1..3` recipients all `enabled=false`, `permission_granted=false`, `verified_at=null`; `EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED=false`; last notification intent 2026-09-28 (still `pending`) | ❌    |

## Step 1 - Who owns a sales enquiry (DECIDED 2026-11-24)

Willy's standing rule, restated 2026-11-24: **sales -> 秋, manager -> 秋.**

- **Sales assignee:** 張秋 (Kenneth Chang), job title 董事,
  `staff_users.id = 64d5a2d6-e602-4760-9709-63b0414f6a83`, `active = true`, `branch_id = null`.
- **Manager follow-up recipient:** the same person, 張秋.

Nothing in production points at 張秋 yet, so the rule is currently unenforced on every layer:

| Check (2026-11-24)                               | Result                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `crm_leads` / `inquiries` ever assigned to 張秋  | 0 / 0                                                                                                                                                                                                                                            |
| `staff_roles` row for 張秋                       | none - he holds no admin/manager/agent role                                                                                                                                                                                                      |
| Where the 負責經紀 lives                         | `property_agents` (1,394 rows). `properties.agent_id` is set on **0 of 836** active property rows, while **781 of 836** have an active correspondent agent (417 of 454 active public listings) - routing reads `property_agents`, not `agent_id` |
| `enquiry_notification_recipients` rows           | `manager:1` 姚頌溏 (Tommy Yiu), `manager:2` 鄧錦雄 (Terence Tang), `manager:3` 李德鴻 (Sam Lee) - all `enabled=false`, `permission_granted=false`, `verified_at=null`; no row for 張秋                                                           |
| `whatsapp_staff_channels` owner (both channels)  | the staff account literally named **"test"** (`72285986-c82c-46bd-98d9-c6b021d91b0d`), admin                                                                                                                                                     |
| `staff_notification_endpoints` owner (both rows) | also the **"test"** account, transport `inbox_private_note` only                                                                                                                                                                                 |

Implementing the rule needs three separately approved production changes (Step 2 covers the code,
which is inert on its own):

1. `EP_LEAD_DEFAULT_ASSIGNEE_STAFF_ID=64d5a2d6-e602-4760-9709-63b0414f6a83` in Vercel Production -
   this is the whole of "sales + 秋" for website enquiries.
2. A **new versioned** `enquiry_notification_recipients` row for 張秋 with consent evidence
   (`permission_granted`, `verified_at`, `enabled=true`) - this is "manager + 秋". Do not silently
   repoint the existing `manager:1..3` rows: they are three other people, and a recipient row is a
   consent record, not a routing preference.
3. A verified WhatsApp endpoint for 張秋 (and a `whatsapp_staff_channels` row if the Inbox mapping
   should move off the "test" account). Until then his alerts can only be an Inbox private note.

## Step 2 — Website enquiries fall back to that person (code, this PR)

- **Assignment order (one statement):** visitor's chosen correspondent agent -> the 負責經紀 on the
  listing page (`property_agents`, position 1, active staff only) -> `properties.agent_id` when that
  staff row is active -> `EP_LEAD_DEFAULT_ASSIGNEE_STAFF_ID` (optional, server-only, last resort).
  The SQL refuses the default when the colleague is inactive.
- **Inert by default:** unset or malformed means the same statement shape as today (a literal NULL and
  no extra parameter). Routing to the 負責經紀 needs no setting at all: it fixes the case where a listing
  enquiry currently falls through to NULL because `properties.agent_id` is empty.
- **Evidence:** `npm run test:property-experience` new cases — fallback only when nobody else owns,
  never displacing a visitor's choice or the listing's agent; the statement still opens with
  `WITH resolved_listing`; unset binds no extra parameter and still inserts `NULL`.
- **Rollback:** unset the variable (or remove the PR). No data changes.
- **Not covered here:** WhatsApp conversations are assigned by the Woztell inbox, not by this
  statement. See Step 3.

## Step 3 — Conversations are assigned on arrival (Woztell + DB, owner-approved)

- 3.1 In Woztell, map new conversations on `85224962283` to the dedicated agent's folder (inbox
  assignment rule). Acceptance: a test conversation appears in that folder.
- 3.2 `whatsapp_staff_channels` for channel `6ad6c566` exists and is verified (2026-11-08), but its
  owner is the **"test"** account. Re-verify it for 張秋's own Inbox user/folder/routing node before
  claiming conversations route to him.
- 3.3 Back-fill is optional: existing unassigned conversations stay visible to managers (FX-06), so
  no re-assignment is required to start.

## Step 4 — Attribution from a tracked link to the enquiry (code + data)

- The click side works (2,829 opens) but no enquiry has ever carried a reference link. The missing
  link is the enquiry↔reference join, not the link minting.
- Investigate `/w/<code>` → `wa.me` text and the webhook payload for the `EPWA:` reference; record
  the exact place the reference is dropped before changing code. Do not guess: capture one test
  message with the reference visible (owner-approved test phone only).
- Acceptance: one test enquiry has a `whatsapp_enquiry_reference_links` row and its conversation
  shows the source link and staff.

## Step 5 — Manager follow-up alerts (owner consent + config)

- 5.1 Create and verify the recipient row for 張秋 (per the Step 1 decision), with consent evidence
  (`permission_granted`, `verified_at`, `enabled=true`). The existing `manager:1..3` rows belong to
  three other colleagues and stay as they are unless Willy says otherwise. This is a consent record,
  not a preference toggle.
- 5.2 Register a verified WhatsApp endpoint for 張秋 (today both endpoints are `inbox_private_note`
  and owned by the "test" account) and confirm `EP_WA_STAFF_ALERT_TEMPLATE` is approved for that
  number.
- 5.3 Only then set `EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED=true`.
- Acceptance: one test enquiry produces exactly one `staff_notification_intents` row that renders
  (the pending row from 2026-09-28 is a good first sample), delivered to the approved recipient,
  acknowledged by them, and recorded with a masked destination.
- Rollback: set the flag back to `false` and retire the endpoint. Do not delete intents or receipts.

## Step 6 — Portal sources (28hse, Property.hk)

- 6.1 Add `staff_external_references` for the 28hse staff names so "XXX 你好" maps to the agent.
- 6.2 Turn on the no-link canary **after** 6.1 and after one validated sample per portal
  (`EP_WA_NO_LINK_EFFECTS_ENABLED`, channel / activation / staff ids). Property.hk last only, its
  parser is still `propertyhk_shape_unverified`.
- Rollback: unset the canary variables; effects stop applying immediately, no data is rewritten.

## Step 7 — End-to-end verification (one test per source)

For each of: website header CTA, listing CTA via `/w/`, contact form, 28hse, Property.hk — record
`message → webhook 2xx → receipt → enquiry event → CRM lead → assignee → notification`. Every
source must pass before any canary is widened.

## Hard rules

- Read-only investigation (this document, the evidence table) needs no approval.
- Production env writes, consent records, Woztell configuration, migrations and deployment each need
  their own named approval from Willy.
- Never print secrets, tokens or customer content; mask destinations in evidence.
- Never infer "live" from a merged PR: the layers above are independently gated.
