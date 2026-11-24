# Lead routing owner: sales → 張秋, manager follow-up → 張秋

Date: 2026-11-24 · Decided by: Willy · Status: decision recorded, **not yet applied in production**

## Decision

Every lead that has no other owner is followed up by **張秋 (Kenneth Chang, 董事)**:

- **sales** enquiry → assigned to 張秋
- **manager** follow-up / escalation → 張秋 is the recipient

This restates the rule Willy set before 2026-11-24. Until now it existed only in conversation, so it
was implemented nowhere; recording it here makes "who owns a lead" reviewable instead of inferred.

## Staff identity (production `staff_users`, read 2026-11-24)

| Field                 | Value                                      |
| --------------------- | ------------------------------------------ |
| `id`                  | `64d5a2d6-e602-4760-9709-63b0414f6a83`     |
| `name_zh` / `name_en` | 張秋 / Kenneth Chang                       |
| `job_title`           | 董事                                       |
| `active`              | true                                       |
| `branch_id`           | null (org-wide, not branch-scoped)         |
| `staff_roles`         | **none** — no admin/manager/agent role row |

Two consequences worth stating plainly:

1. Assignment does not need a role: website-enquiry assignment only requires `staff_users.active`.
   The role row matters for what 張秋 can _see and do_ in the admin Inbox, and that is a separate
   authorization decision.
2. A "manager recipient" is a consent record, not a role. Adding 張秋 as the alert recipient needs its
   own consent evidence, not just the decision above.

## How it is implemented

| Layer                                                               | Mechanism                                                                                                                         | State                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| A listing enquiry with no visitor choice and no correspondent agent | `EP_LEAD_DEFAULT_ASSIGNEE_STAFF_ID` (code: PR #362, inert until set)                                                              | code ready, variable unset  |
| A listing enquiry that shows a correspondent agent                  | `property_agents` position 1, active staff (the 負責經紀 on the page)                                                             | code in PR #362, not merged |
| WhatsApp conversations                                              | Woztell inbox assignment rule to 張秋's folder                                                                                    | not configured              |
| Manager follow-up alerts                                            | new versioned `enquiry_notification_recipients` row for 張秋 + verified WhatsApp endpoint + `EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED` | not configured              |

The ordered checklist, the current production evidence and the rollback for each step live in
`docs/runbooks/whatsapp-sales-followup-go-live.md` (Step 1 is this decision).

## What this is not

Not an approval to write to production. Each production change above needs Willy to name it. The
existing `manager:1..3` recipients belong to three other colleagues and are left untouched until he
says otherwise.

## Correction: where the 負責經紀 actually lives (2026-11-24)

Willy's point on the A034926 listing is right and worth recording: every listing page does show a
負責經紀 (there, 李偉增 S-098767). That agent is a `property_agents` row, **not**
`properties.agent_id`. Measured on 2026-11-24:

| Field                                                                          | Coverage on active listings                        |
| ------------------------------------------------------------------------------ | -------------------------------------------------- |
| `properties.agent_id` (the routing column the old code used)                   | **0 of 836**                                       |
| `property_agents` with an active staff member (the 負責經紀 shown on the page) | **781 of 836** (417 of 454 active public listings) |

So routing must read `property_agents`. A buyer's enquiry goes to the colleague whose name and
licence the buyer sees; 張秋 receives the ones with no listing-level agent at all - the contact page,
estate and district pages, and the roughly 7% of listings without a correspondent agent. If Willy
instead wants **every** enquiry to land with 張秋, that is a one-line ordering change in
`src/lib/neon/website-inquiry.js` and it will be done on request.

## The rule, verbatim (2026-11-24)

| Enquiry scope                    | Who is notified                               |
| -------------------------------- | --------------------------------------------- |
| 定單位 (a specific listing/unit) | that unit's 負責 Sales **+ copy 85297987774** |
| 只講屋苑 (estate named, no unit) | that estate's 經理 **+ copy 85297987774**     |
| 無範圍 / 無法判定                | copy 85297987774 only                         |

Every enquiry notifies **once**. The send must be locked and de-duplicated.

### What each part needs, and where it stands

| Part                 | Mechanism                                                                                                                                | State                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 定單位 -> 負責 Sales | listing enquiry assigns the 負責經紀 from `property_agents`; the lead alert plans the assigned agent's endpoint                          | code in PR #362 (unit routing); alert recipient plan already targets the assigned agent                                                            |
| 只講屋苑 -> 屋苑經理 | **no estate-to-manager mapping exists** in the schema (no `estate_manager*` column/table, no per-estate manager row)                     | **blocked: needs the manager named per estate**, or an approved rule such as "estate manager = manager of that estate's branch" (3 branches exist) |
| copy 85297987774     | **owner identified 2026-11-24: 張秋**; `EP_LEAD_COPY_PHONE` (server-only, digits normalised to `85297987774`)                            | code in PR #362; still needs consent + a `staff_whatsapp` endpoint before anything can send                                                        |
| 只發一次 + 鎖 + 去重 | `ops_jobs` enqueue uses `idempotency_key='lead-alert:'                                                                                   |                                                                                                                                                    | lead_id`with`ON CONFLICT DO NOTHING`; `staff_notification_attempts`has a unique`attempt_key` plus a "no attempts exist for this lead" guard, so a retry or a second job cannot send twice | **already implemented** (code path unchanged by this rule) |
| Actual send          | the plan only reads endpoints with `transport='staff_whatsapp'`, verified mapping, granted permission and an approved quiet-hours policy | **blocked: production has only two `inbox_private_note` endpoints** and `EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED=false`                                |

Two facts about the current staff table that matter for the estate-manager case: the only `manager`
role account is a placeholder ("Earnest Admin"), and no staff row carries `is_duty_manager = true`,
so the existing duty-manager fallback would notify nobody even if the transport were on.

## 屋苑 → 經理 rotation (transcribed from the printed sheet, 2026-11-24)

Willy supplied the agency's printed 推介 sheet (photo dated 2026-11-11). Each estate carries a circled
①/②/③, and the top of the sheet writes the legend by hand:

| Mark | Contact                       | Phone on sheet | Existing recipient row | Staff id                               |
| ---- | ----------------------------- | -------------- | ---------------------- | -------------------------------------- |
| ①    | Tommy 姚頌溏 (Tommy Yiu)      | 6644 2444      | `manager:1`            | `81206a23-777c-45c0-a2c5-7b53757206ca` |
| ②    | Terence 鄧錦雄 (Terence Tang) | 9100 5322      | `manager:2`            | `fb4dfa8f-a892-458b-a4f9-7caf48a4a0a2` |
| ③    | Sam 李德鴻 (Sam Lee)          | 6626 6608      | `manager:3`            | `48e258b4-6b1f-4f65-b5e8-2f10a34806ba` |

The three numbers match the three `enquiry_notification_recipients` manager rows that already exist
(disabled, unconsented), so the rotation maps straight onto recipients the notification plan can use.

Transcription lives in code, not in this document, so it is testable:
`src/content/estate-manager-rotation.ts` (`ESTATE_MANAGERS`, `ESTATE_MANAGER_BY_SLUG`,
`ESTATE_MANAGER_BY_NAME`, `managerRotationForEstate`), pinned by
`src/content/estate-manager-rotation.test.mjs` (6 cases, in `npm run test:estate-conversion`).

Counts from the sheet:

| Item                                                                                     | Count                                    |
| ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| Estates on the sheet with a live page here (slug-keyed)                                  | 48                                       |
| Estates on the sheet with no live page (kept by name, listed in `UNMAPPED_ESTATE_NAMES`) | 5 - 皇壁, 新麗苑, 金麗苑, 凱和山, 龍珠島 |
| Not estates (村屋 ① in the 深井 block only; 村屋 and 其他 unmarked in the 青山 block)    | never routed                             |

What is still missing before 「只講屋苑 → 屋苑經理」 actually notifies anyone:

1. the enquiry has to carry estate scope (the public form sends a property id / listing number today,
   not an estate slug), so `enquiry_routing_context` needs a `kind = 'estate'` case wired through
   `website-inquiry.js`;
2. the estate manager needs a usable notification path - at present there is **no** `staff_whatsapp`
   endpoint for any of the three, the recipient rows are `enabled=false` with no consent evidence, and
   `EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED=false`;
3. the copy number 85297987774 still needs its owner and consent, and an endpoint, exactly like the
   managers.

The once-only guarantee needs no work: the lead alert is one `ops_jobs` row keyed
`lead-alert:<lead id>` with `ON CONFLICT DO NOTHING`, and `staff_notification_attempts` has a unique
`attempt_key` plus a per-lead "no attempts yet" guard, so a retry, a second job or a duplicate
delivery cannot send twice.

## The copy destination is 張秋 (2026-11-24)

Willy: "copy 85297987774 張秋". So every lead alert also copies 張秋 (Kenneth Chang,
`64d5a2d6-e602-4760-9709-63b0414f6a83`), and 85297987774 is the line that copy goes to.

Two details recorded so nobody assumes them later:

- 張秋's own `staff_users.phone` / `whatsapp` is **92786562**, not 85297987774. The copy line is a
  second (office) line, and the repository hardcodes neither number: the copy destination is the
  server-only variable `EP_LEAD_COPY_PHONE`, normalised to the `852...` form, unset by default.
- Because the default assignee (張秋) and the copy (張秋 on the office line) are different
  destinations, a lead that 張秋 owns produces two planned sends - one to his own line, one copy to
  the office line - and the plan already collapses identical destinations
  (`DISTINCT ON staffDestinationKey(destination_reference)`), so nothing is duplicated by accident.
  If Willy would rather the copy go to his own line, say so and leave `EP_LEAD_COPY_PHONE` unset.

Combined with the rotation sheet, the full rule is now:

| Enquiry scope     | Assigned owner                                                                   | Copy                        |
| ----------------- | -------------------------------------------------------------------------------- | --------------------------- |
| 定單位            | the 負責經紀 from `property_agents` (falls back to 張秋 if the listing has none) | 張秋 / `EP_LEAD_COPY_PHONE` |
| 只講屋苑          | the estate's manager from the rotation sheet                                     | 張秋 / `EP_LEAD_COPY_PHONE` |
| 無範圍 / 無法判定 | nobody (no `assigned_agent_id`)                                                  | 張秋 / `EP_LEAD_COPY_PHONE` |

Every one of them still sends at most once per enquiry: one `ops_jobs` row keyed
`lead-alert:<lead id>`, unique `staff_notification_attempts.attempt_key`, and a per-lead
"no attempts yet" guard.
