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

## Step 1 — Decide who owns a sales enquiry (decision, no write)

- **Owner decision:** one named dedicated sales agent for all unattributed leads, or "the listing's
  own agent, else one named person". This blocks Steps 2–5.
- **Record:** staff name, staff id, role, branch, active. Today `staff_roles` holds 4 admins and 1
  manager; a dedicated sales _agent_ may not exist yet.

## Step 2 — Website enquiries fall back to that person (code, this PR)

- **Change:** `EP_LEAD_DEFAULT_ASSIGNEE_STAFF_ID` (optional, server-only). When set, enquiries with
  no visitor choice and no active listing agent are assigned to that staff member; the SQL refuses
  the assignment if the colleague is inactive. Unset or malformed = byte-identical behaviour to
  today, so merging is safe and changes nothing until the variable exists.
- **Evidence:** `npm run test:property-experience` new cases — fallback only when nobody else owns,
  never displacing a visitor's choice or the listing's agent; the statement still opens with
  `WITH resolved_listing`; unset binds no extra parameter and still inserts `NULL`.
- **Rollback:** unset the variable (or remove the PR). No data changes.
- **Not covered here:** WhatsApp conversations are assigned by the Woztell inbox, not by this
  statement. See Step 3.

## Step 3 — Conversations are assigned on arrival (Woztell + DB, owner-approved)

- 3.1 In Woztell, map new conversations on `85224962283` to the dedicated agent's folder (inbox
  assignment rule). Acceptance: a test conversation appears in that folder.
- 3.2 Keep `whatsapp_staff_channels` for channel `6ad6c566` verified (already done 2026-11-08);
  re-verify if the inbox user, folder or routing node changes.
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

- 5.1 Grant and verify consent for the recipient rows: `manager:1..3` need `permission_granted`,
  `verified_at` and `enabled=true`. This is a consent record, not a preference toggle.
- 5.2 Register a verified WhatsApp endpoint for staff alerts (today both endpoints are
  `inbox_private_note` only) and confirm `EP_WA_STAFF_ALERT_TEMPLATE` is approved for that number.
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
