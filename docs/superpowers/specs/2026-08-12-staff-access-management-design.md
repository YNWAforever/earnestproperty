# Staff Access Management & Admin Navigation — Design

**Date:** 2026-08-12
**Status:** Approved, ready for implementation planning

## Problem

Two unrelated pains, both in the admin panel.

**1. Roles cannot be changed.** `staff_roles` is written in exactly one place in
the whole codebase — the first-admin bootstrap at `src/lib/neon/auth.server.ts`.
Nothing grants, revokes, or edits a role afterwards. Promoting an agent to
manager, or revoking admin from someone who left, requires hand-written SQL
against production. A `staff.manage` permission is declared in
`src/lib/control-plane/permissions.ts` but is enforced nowhere — the hook for
this feature was planned and never built.

Deactivating someone is possible (`active` is editable by admins through the
agent form) but does nothing about the work assigned to them. `agentScope()`
hides rows assigned to another agent, so a deactivated agent's leads and
conversations become invisible to every other agent while remaining assigned to
a dormant account.

**2. The sidebar has 11 flat items and lies about two of them.** `/admin/cms`
appears twice, differing only by a search param:

- `CMS / FAQ` → `/admin/cms` → actually lands on the **屋苑 SEO** tab, not FAQ
- `AI Agent` → `/admin/cms?tab=faqs` → lands on **FAQ 編輯**

`/admin/cms` has five tabs (屋苑 SEO, 文章編輯, YouTube影片, FAQ 編輯, 媒體庫).
Three of them — 文章編輯, YouTube影片, 媒體庫 — have no sidebar entry at all and
are reachable only by clicking through from another tab. Labels mix Chinese and
English with no rule.

## Scope

**In scope**

- Role management: grant and revoke `admin` / `manager` / `agent`
- Deactivation that reassigns everything the person owns, in one transaction
- Regrouping the admin sidebar

**Explicitly out of scope**

- Invite flow. No email infrastructure exists in this app (no Resend, SendGrid,
  Nodemailer or SMTP anywhere), and adding it is a larger piece of work than the
  rest of this design combined. New colleagues continue to self-register at
  `/auth/sign-up`; `findStaff` binds them to their seeded `staff_users` row once
  the email is verified.
- A separate non-agent staff type. Every user remains an agent-shaped record.
- A separate `/admin/users` screen. Access lives in the existing person editor.

## Design

### Roles

`staff_roles` has `PRIMARY KEY (staff_user_id, role)`, so a person can hold more
than one role, and `hasPermission` unions them. The UI therefore uses **three
checkboxes** (管理員 / 主管 / 經紀), not a single-select — a radio group would
misrepresent the data model and silently drop roles.

The section lives at the bottom of the existing agent form
(`src/components/admin/AgentProfileForm.tsx`) under a `權限` heading, rather than
on a new screen: one place to look up a colleague.

**Rules.** All of these are pure functions in
`src/lib/neon/staff-security-policy.ts`, which already owns
`decideAgentProfileMutation` and `shouldBootstrapFirstAdmin` and already has a
test file. They are enforced again server-side; the client copy only decides
what renders.

| Rule | Reason |
| --- | --- |
| Only `admin` may view or change the 權限 section | Managers must not be able to escalate themselves or others |
| An admin may not remove their **own** `admin` role | Prevents self-lockout. Deliberately narrower than "cannot edit yourself" — dropping your own `manager` is allowed |
| The **last** `admin` role in the system may not be removed | Prevents locking everyone out. Counted server-side inside the same transaction as the write, never from a client-supplied list |
| A role change requires its own confirmation | See below |

**Confirmation.** Roles live in a form that also saves bio, photo and licence
number. To stop a privilege change riding along with a cosmetic edit, saving a
changed role set opens an `AdminConfirmDialog` naming the delta explicitly —
e.g. `陳大文：+管理員 −經紀`. Profile-only saves are unaffected.

**Audit.** `writeAudit(actor.staffId, "staff.roles.update", "staff_user", id,
{ before, after })`.

### Deactivation and reassignment

Deactivating sets `active = false` **and** hands over everything the person
owns. Five columns reference `staff_users` as current ownership:

| Table | Column |
| --- | --- |
| `properties` | `agent_id` |
| `crm_contacts` | `assigned_agent_id` |
| `crm_leads` | `assigned_agent_id` |
| `inquiries` | `assigned_agent_id` |
| `whatsapp_conversations` | `assigned_agent_id` |

`whatsapp_conversations` is the one most easily missed and the most damaging to
miss: a departing agent's live customer threads would stay bound to a dormant
account and, through `agentScope()`, be invisible to everyone who should now be
answering them.

**Historical columns must not be rewritten.** Eighteen other columns reference
`staff_users` as a record of who did something: `sent_by`,
`created_by`, `author_id`, `reviewed_by`, `approved_by`, `actor_id`,
`actor_staff_id`, `requested_by`, `decided_by`, `approved_by_staff_id`,
`executed_by_staff_id`, and `crm_activities.staff_user_id`. Reassigning
`sent_by` would claim a different person sent a WhatsApp message;
`ops_audit_logs` is append-only by trigger and must not be touched at all.
**Ownership moves. History does not.**

**Flow**

1. Admin opens 員工管理 → the person → 權限 → 停用帳戶.
2. The dialog calls `fetchStaffAccessSummary` and shows live per-table counts
   ("12 leads, 4 listings, 3 WhatsApp 對話").
3. If the total is greater than zero, a successor must be chosen from active
   staff, excluding the person being deactivated. If the total is zero the
   picker is skipped and it is a plain confirmation.
4. Confirming runs all five `UPDATE`s plus `active = false` in a single
   `transactionRows` call, so a partial handover cannot occur.
5. `writeAudit(actor.staffId, "staff.deactivate", "staff_user", id,
   { successorStaffId, counts })`.

Reactivation is a plain `active = true` toggle with no reassignment — it does
not attempt to claw work back.

**Guards:** an admin may not deactivate themselves, and the last remaining admin
may not be deactivated. Both are checked server-side.

### Server surface

Three new functions in `src/lib/neon/admin-data.server.ts`, wrapped by
`createServerFn` in `src/lib/neon/admin-data.ts`, all gated on
`requireStaff(["admin"])`:

```
fetchStaffAccessSummary({ staffId })
  -> { roles, active, isSelf, isLastAdmin,
       owned: { properties, contacts, leads, inquiries, conversations } }

updateStaffRoles({ staffId, roles })
  -> { ok: true } | throws Response 403 / 400

setStaffActive({ staffId, active, reassignToStaffId? })
  -> { ok: true, reassigned: { ...counts } }
```

`setStaffActive` requires `reassignToStaffId` when deactivating a person with a
non-zero owned count, and rejects it as a validation error when reactivating.

**Cleanup.** `staff.manage` is a declared `ControlPlanePermission` that nothing
enforces. Only `admin` holds it, so gating on `requireStaff(["admin"])` is
behaviourally identical. Delete the permission rather than leave one that
implies a check it never performs.

### Navigation

`AdminShell.navItems` gains a `group` field; the sidebar renders static
(non-collapsible) group headings. Collapsible groups were considered and
rejected: with ten items there is no space to reclaim, and a collapsed group is
how 媒體庫 became unreachable in the first place.

```
總覽                              /admin

物業
  放盤                            /admin/listings
  網站內容                         /admin/cms          (all five tabs inside)

客戶
  CRM                             /admin/leads
  Command Center                  /admin/leads/command-center
  客戶分群                         /admin/segments

訊息
  WhatsApp                        /admin/whatsapp
  群發                             /admin/blasts

系統
  員工管理                         /admin/agents
  系統營運                         /admin/operations
```

Changes: the duplicate `/admin/cms` entry collapses to a single 網站內容 entry,
so all five CMS tabs are reachable from one honest label; `經紀管理` becomes
`員工管理`, because with roles attached the screen manages staff access, not just
public directory entries. `CRM`, `Command Center` and `WhatsApp` stay in English
because those are the terms the team uses; everything else is Chinese.

## Testing

Following existing repo convention — `node --test` for `.mjs`, `bun test` for
`.ts`/`.tsx`, and wiring into a named `test:*` script since there is no
aggregate `npm test`.

| Area | Where | What |
| --- | --- | --- |
| Role guard rules | `src/lib/neon/staff-security-policy.test.mjs` | last-admin protection, own-admin removal blocked, own-manager removal allowed, manager denied entirely |
| Reassignment coverage | new contract test | the transaction touches **all five** ownership columns **and none** of the historical ones — the assertion most likely to catch a future regression |
| Transaction atomicity | same contract test | all six statements go through one `transactionRows` call, not sequential `queryRows` |
| Server gating | `src/routes/admin.routes.test.mjs` | all three server fns require `admin` |
| 權限 section | `src/components/admin/AgentProfileForm.test.tsx` | section hidden for managers; role change opens the confirm; profile-only save does not |
| Nav | new assertion | every `navItems` entry has a group; no two entries share a destination; every CMS tab is reachable |

All new tests wired into `test:property-experience`, which already runs the
staff and agent suites.

## Open question

`crm_contacts.assigned_agent_id` is included in reassignment. A contact is a
person rather than a work item, so reassigning contacts alongside leads is
arguably wrong. It is included because excluding it would make a departing
agent's contacts invisible under `agentScope()`. Reviewed and accepted as part
of this design; revisit if the agency's mental model differs.
