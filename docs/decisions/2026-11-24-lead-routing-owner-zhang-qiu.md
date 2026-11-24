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

| Layer                                                                | Mechanism                                                                                                                         | State                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Website enquiries with no visitor choice and no active listing agent | `EP_LEAD_DEFAULT_ASSIGNEE_STAFF_ID` (code: PR #362, inert until the variable is set)                                              | code ready, variable unset |
| WhatsApp conversations                                               | Woztell inbox assignment rule to 張秋's folder                                                                                    | not configured             |
| Manager follow-up alerts                                             | new versioned `enquiry_notification_recipients` row for 張秋 + verified WhatsApp endpoint + `EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED` | not configured             |

The ordered checklist, the current production evidence and the rollback for each step live in
`docs/runbooks/whatsapp-sales-followup-go-live.md` (Step 1 is this decision).

## What this is not

Not an approval to write to production. Each production change above needs Willy to name it. The
existing `manager:1..3` recipients belong to three other colleagues and are left untouched until he
says otherwise.
