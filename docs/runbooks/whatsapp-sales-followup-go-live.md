# WhatsApp sales follow-up go-live checklist

Website lead forwarding uses the approved `staff_enquiry_followup` Utility template. The draft adds a dedicated phone destination for each colleague. Four production destination drafts await verification and delivery hours. The migration, release and automatic phone delivery are pending.

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

A unit enquiry alerts its responsible Sales colleague and copies 張秋 (Kenneth Chang). An estate enquiry alerts the manager assigned to that estate and copies 張秋. An enquiry with unknown scope goes only to 張秋. Option B identifies him by staff ID `64d5a2d6-e602-4760-9709-63b0414f6a83` and uses his own verified staff line ending 6562. Each distinct phone receives one template per enquiry.

| Check (2026-11-24)                               | Result                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `crm_leads` / `inquiries` ever assigned to 張秋  | 0 / 0                                                                                                                                                                                                                                            |
| `staff_roles` row for 張秋                       | none - he holds no admin/manager/agent role                                                                                                                                                                                                      |
| Where the 負責經紀 lives                         | `property_agents` (1,394 rows). `properties.agent_id` is set on **0 of 836** active property rows, while **781 of 836** have an active correspondent agent (417 of 454 active public listings) - routing reads `property_agents`, not `agent_id` |
| `enquiry_notification_recipients` rows           | `manager:1` 姚頌溏 (Tommy Yiu), `manager:2` 鄧錦雄 (Terence Tang), `manager:3` 李德鴻 (Sam Lee) - all `enabled=false`, `permission_granted=false`, `verified_at=null`; no row for 張秋                                                           |
| `whatsapp_staff_channels` owner (both channels)  | the staff account literally named **"test"** (`72285986-c82c-46bd-98d9-c6b021d91b0d`), admin                                                                                                                                                     |
| `staff_notification_endpoints` owner (both rows) | also the **"test"** account, transport `inbox_private_note` only                                                                                                                                                                                 |

The 2026-11-24 observations above predate the four destination drafts. The website lead worker uses `staff_notification_endpoints`. Inbound WhatsApp conversation assignment uses the channel mapping described in Step 3.

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

## Step 5 — Website lead phone delivery

1. Apply `20261125000000_website_lead_phone.sql` during the authorised release. It adds the `website_lead_phone` endpoint type and reserves new website submissions for their own worker. Existing jobs retain the route chosen at intake.
2. Under 同事通知設定, use 重新核實 on each existing draft, select 網站查詢 WhatsApp 電話通知, and enter the independently confirmed staff number, verification reference, recipient permission reference and approved hours. Use the same procedure for listing Sales who should receive unit enquiries. Enable each eligible destination. The current delivery worker supports approved all-hours endpoints. Inbox emails and memberships are only needed for colleagues managing conversations in Inbox.
3. Use the company channel and the verified staff transport settings. Set `EP_WA_STAFF_ALERT_TEMPLATE` to `{"name":"staff_enquiry_followup","language":"zh_HK","params":["name","source","phone","link"]}`. The shared `EP_WA_STAFF_NOTIFICATIONS_ENABLED` switch must be `true`. The older `EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED` environment entry has no runtime effect.
4. For an authorised delivery test, compare the intended recipients with the frozen attempts by `lead_id`. A provider acceptance has an operation ID when supplied. Use delivery receipts or recipient confirmation to establish delivery. A missing or unverified destination leaves a suppressed attempt. A lost provider outcome stays unknown and is never automatically resent.

To pause one phone, disable its website endpoint. The shared `EP_WA_STAFF_NOTIFICATIONS_ENABLED` switch pauses all staff notifications. Submissions created during a global pause keep their paused state when delivery resumes.

### Follow-up template with enquiry text

The proposed zh_HK Utility template `staff_enquiry_followup_context` shows the original website enquiry or the inbound WhatsApp message that opened the enquiry. Sales can read up to 500 characters. `…` marks a longer message and `未有查詢文字` marks missing text. The last field opens the full record.

```text
你有一宗新查詢需要跟進。
客戶姓名：{{1}}
查詢來源：{{2}}
聯絡電話：{{3}}
查詢內容：{{4}}
後台連結：{{5}}
請按客戶要求跟進。
```

Use synthetic examples when submitting the Utility template, such as `陳小姐`, `網站查詢`, `測試電話`, `想問兩房租盤，星期六下午可以睇樓嗎？` and `https://example.invalid/admin/leads`. After the company channel shows this exact five-field body as `APPROVED`, the rollout setting is:

```json
{
  "name": "staff_enquiry_followup_context",
  "language": "zh_HK",
  "params": ["name", "source", "phone", "context", "link"]
}
```

Set `EP_WA_STAFF_ALERT_TEMPLATE` during the authorised rollout. For an active informational forwarding policy, refresh its provider proof and bind the new template through the existing review flow. The four-field setting in step 5 remains available for rollback. Switching templates applies to future dispatches and does not replay accepted notices.

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

## Production state after Willy's approval (2026-11-25)

Four disabled staff WhatsApp endpoints on company channel `6ad6c56645bc37e79936664a` record
Willy's setup approval under `permission_ref=owner-approval:Willy:2026-11-25`. The targets are
張秋 (line ending 6562), 姚頌溏 (2444), 鄧錦雄 (5322) and 李德鴻 (6608). Each record now has
`verified_at=NULL`, `verification_ref=NULL` and an empty quiet-hours policy. The original setup
mistakenly used the owner's approval as evidence of destination verification and all-hours delivery.

### Woztell Inbox access

Colleagues who handle or assign conversations in Inbox need a matching Inbox account and channel access. The two historical mappings belong to the test account. Receiving the website template directly by phone requires the verified destination described in Step 5.

The November 18 delivery to the test line ending 3493 established template delivery on the company channel. The four staff drafts each need their own destination evidence. [Delivery record](../decisions/2026-11-18-channel-archive-live-delivery.md)
