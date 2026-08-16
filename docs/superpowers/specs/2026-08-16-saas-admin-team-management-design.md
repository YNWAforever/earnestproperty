# Earnest SaaS Admin Command Center and Team Lifecycle Design

**Date:** 2026-08-16

**Status:** Approved in design review; awaiting written-spec review

## Objective

Turn the Earnest Property admin into a coherent, brand-led SaaS workspace and add a dedicated Team/Users surface where authorized staff can manage the complete staff lifecycle. Password recovery must send a provider-generated, one-time reset email; Earnest must never set, receive, store, or display another user's password or reset token.

This is an extension of the current admin and staff-access implementation on `origin/main`, not a replacement.

## Current Baseline

The merged staff-access work from 2026-08-12 already provides:

- grouped admin navigation and a responsive `AdminShell`;
- multi-role `admin` / `manager` / `agent` access in `staff_roles`;
- Admin-only role changes;
- self-demotion, last-active-Admin, protected-account, and concurrent-write guards;
- transactional staff deactivation with ownership reassignment;
- reactivation and safe audit events;
- staff access controls embedded in `AgentProfileForm`;
- Neon Auth sessions linked to application staff through `staff_users.auth_user_id` or verified email matching.

The existing implementation deliberately excluded invitations, a Team/Users directory, provider session management, and password-reset administration because the application has no first-party email service. This design closes those gaps through Neon Auth's supported identity and email APIs while preserving the existing application authorization model.

## Approved Product Decisions

- Use the Operations Command Center layout.
- Use the Earnest Brand SaaS visual direction: warm white surfaces, deep property navy, and restrained gold accents.
- Add a dedicated `/admin/team` route.
- Admins can view and mutate the complete team lifecycle.
- Managers receive the same searchable directory in read-only mode.
- Agents cannot access the Team route or its data.
- Supported lifecycle actions are invite, resend invitation, change roles, suspend, reactivate, and send a password-reset link.
- Password recovery is email-link only. There is no Admin-set temporary password flow.
- Neon Auth owns identity, credentials, reset tokens, invitation tokens, email delivery, and sessions.
- `staff_users`, `staff_roles`, and the existing security policies remain authoritative for application access.
- Existing role and deactivation use cases are reused rather than reimplemented.
- Production provider changes, database migrations, live emails, deployment, and live-account mutations require separate approval.

## Information Architecture

### Admin shell

The current responsive `AdminShell` remains the shared shell. This phase refines spacing, hierarchy, grouped navigation, active states, and overview composition without replacing its working sign-in gate, mobile drawer, sign-out confirmation, breadcrumbs, or page-action slot.

Navigation becomes:

```text
Workspace
  總覽                         /admin
  客戶查詢                     /admin/leads
  樓盤管理                     /admin/listings

Growth
  內容中心                     /admin/cms
  客戶分群                     /admin/segments
  WhatsApp                     /admin/whatsapp
  推廣活動                     /admin/blasts

Administration
  團隊成員                     /admin/team
  經紀檔案                     /admin/agents
  系統營運                     /admin/operations
```

`/admin/team` owns identity and access. `/admin/agents` remains the public-facing agent-profile editor. The access section currently embedded in `AgentProfileForm` moves to the Team member detail surface so there is one operational place to manage roles and account state. The underlying server functions and policy tests remain shared.

### Overview

`/admin` becomes an operational overview rather than a link directory. It contains:

1. Active team members.
2. Pending invitations, including delivery failures or impending expiry.
3. Open customer inquiries.
4. System health from the existing control-plane health projection.
5. A needs-attention queue for failed invitations, expired invitations, access-cleanup failures, and other actionable items.
6. Recent sanitized Admin activity.

The page uses existing data sources and small dedicated read models. It does not introduce vanity charts, duplicate operational tables, or continuous polling for data that changes infrequently. System health follows the existing operations refresh behavior; team counts refresh on entry, manual refresh, and successful team mutations.

### Team/Users

`/admin/team` contains:

- search by normalized name or email;
- role filters;
- access-state filters;
- keyset pagination;
- visible counts for active, invited, suspended, and attention-needed members;
- a table with member, email, roles, access state, invitation state, and created or joined time;
- an Admin-only Invite button;
- a member detail panel with identity summary, application roles, access state, invitation state, safe recent activity, and lifecycle actions.

Managers see the same directory projection without invitation, overflow, role, reset, suspension, or reactivation controls. Agents receive a server-side `403` and no navigation entry.

Tables collapse to deliberate member cards on narrow screens. The mobile shell remains a drawer; it must not stack the entire navigation above page content.

## Architecture and Ownership

The browser calls a thin set of Team server functions. A server-only lifecycle service owns authorization, orchestration, provider calls, operation state, audit, and safe error normalization.

```text
Admin UI
  -> Team server functions
    -> requireStaffAccess
    -> staff lifecycle policy
    -> staff lifecycle service
      -> Neon Auth provider adapter
      -> existing staff directory and role services
      -> identity-action operation store
      -> existing audit writer
```

### Neon Auth owns

- user identity and verified email;
- credential hashes;
- invitation and reset tokens;
- invitation and password-reset email delivery;
- identity sessions and session revocation;
- provider-specific rate limits and token expiry.

Earnest code does not write directly to Neon Auth credential or token tables.

### Earnest application data owns

- staff profile and public agent profile;
- application roles;
- active or suspended application access;
- work ownership and reassignment;
- normalized identity-action status used for retries and operational attention;
- safe append-only audit history.

### New focused modules

The feature should avoid expanding the already-large `admin-data.server.ts` and `AgentProfileForm.tsx` further. New responsibilities are isolated as:

- `src/lib/neon/staff-identity-provider.server.ts` — Neon Auth adapter with a narrow testable interface;
- `src/lib/neon/staff-lifecycle.server.ts` — invite, resend, reset, suspend cleanup, and reactivation orchestration;
- `src/lib/neon/staff-lifecycle-policy.ts` — pure target, cooldown, and lifecycle decisions;
- `src/lib/neon/staff-identity-actions.server.ts` — idempotency, retry state, and safe provider-outcome persistence;
- `src/lib/neon/admin-team.server.ts` — Team directory and member-detail read models;
- `src/lib/neon/admin-team.ts` — authenticated server-function boundary used by the UI;
- `src/routes/admin.team.tsx` — route container and URL-backed filters;
- `src/components/admin/team/*` — focused table, detail, status, and dialog components.

Existing `updateStaffRoles`, `setStaffActive`, ownership reassignment, `writeAudit`, `requireStaffAccess`, and their pure security policies stay authoritative. New UI code calls those use cases through the lifecycle service instead of copying their rules.

## Identity-Action Operation Store

Provider calls cannot share a database transaction with the local staff update. A small application-only operation table records recoverable state without storing secrets.

Each row contains:

- operation ID;
- unique idempotency key;
- action type: invite, resend invitation, reset request, or session revocation;
- actor staff ID;
- target staff ID when available;
- normalized target email;
- state: pending, succeeded, retryable failure, or terminal failure;
- stable safe error code;
- request ID;
- retry-after time where applicable;
- created and updated timestamps.

It never stores a password, invitation token, reset token, raw provider response, provider stack trace, or complete email body. The table is application-only and is not exposed through a public Data API.

Migration code may be authored and verified in an isolated environment. Applying it to production is outside this phase unless separately approved.

## Permission Model

| Capability | Admin | Manager | Agent |
| --- | --- | --- | --- |
| View Team directory | Yes | Read only | No |
| View member detail | Yes | Read only | No |
| Invite or resend | Yes | No | No |
| Change roles | Yes | No | No |
| Suspend or reactivate | Yes | No | No |
| Send password-reset link | Yes | No | No |

Navigation visibility is presentational only. Every read and mutation repeats authorization on the server.

Existing protected-account, self-change, last-active-Admin, role concurrency, and deactivation ownership rules continue to apply. Additional rules are:

- an Admin cannot send a reset link to themselves from Team; self-service recovery is used instead;
- an Admin cannot suspend themselves from Team;
- the final active Admin cannot be demoted or suspended;
- a reset request requires an active, linked Neon Auth identity;
- invitation resend requires a current provider invitation or a recoverable failed delivery;
- reactivation requires the linked provider identity to still exist;
- Managers cannot call mutation functions even if they manually construct a request.

## Lifecycle Flows

### Invite

1. Admin enters name, normalized email, and one or more application roles.
2. Server re-authorizes the actor and validates the target and roles.
3. A local staff profile and pending identity-action record are created or reused idempotently.
4. The Neon Auth adapter sends a provider-managed invitation.
5. The operation is marked succeeded or failed with a stable safe code.
6. The existing verified-email linking behavior binds `auth_user_id` when the invited user signs in.
7. The UI refreshes Team, Overview, and Audit.

Duplicate normalized email requests return the existing staff member or invitation. They do not create another identity or staff profile.

Inviting an Admin requires a confirmation dialog that names the target email and the added Admin role. Roles remain multi-select because `staff_roles` supports multiple roles.

### Resend invitation

Resend uses the existing invitation identity and an idempotency key. A successful resend has a 15-minute target-specific cooldown. Expired invitations require explicit resend; they do not silently regenerate while the page loads.

### Change roles

The Team detail panel calls the existing `updateStaffRoles` use case. It retains:

- multi-role checkboxes;
- typed or explicit confirmation for Admin-role changes;
- own-Admin and last-active-Admin protection;
- serializable conflict handling;
- before/after audit metadata.

### Suspend

1. The existing deactivation flow reassigns current work and sets local access inactive in one guarded transaction.
2. Only after local access is denied does the provider adapter attempt to revoke the target's identity sessions.
3. If session revocation fails, local application access remains denied and a retryable cleanup operation appears in needs-attention.
4. The failure does not reactivate the account or roll ownership back.

This ordering fails closed: `requireStaffAccess` rejects the inactive local staff record even if an old provider session remains technically valid.

### Reactivate

The lifecycle service confirms the linked Neon Auth identity still exists, then calls the existing `setStaffActive` reactivation use case. Reactivation does not reclaim previously reassigned work.

### Send password-reset link

1. Admin opens a confirmation dialog showing the target name and masked email.
2. Server re-authorizes the Admin and checks target eligibility.
3. A successful reset request for the same target has a 10-minute cooldown.
4. The Neon Auth adapter requests the provider-generated reset email.
5. No password or token enters browser state or the operation store.
6. The browser receives only accepted or failed, a stable error code, cooldown information when applicable, and a request ID.
7. The outcome is audited as `staff.password_reset.requested` without token or provider payload data.

Sending a reset link does not suspend the user and does not promise immediate session revocation. Admins use Suspend when immediate access removal is required. Password-reset token lifetime and post-reset session policy remain provider-owned and must be verified during the provider contract check rather than inferred in the UI.

## Server Contracts

The browser-facing contracts return only safe projections.

```text
listAdminTeam({ query?, roles?, states?, cursor? })
  -> { members, counts, nextCursor }

getAdminTeamMember({ staffId })
  -> { member, roles, accessState, invitationState, safeRecentActivity, version }

inviteStaffMember({ name, email, roles, idempotencyKey })
  -> { memberId, invitationState, requestId }

resendStaffInvitation({ staffId, idempotencyKey })
  -> { invitationState, retryAfter?, requestId }

sendStaffPasswordReset({ staffId, idempotencyKey })
  -> { accepted, retryAfter?, requestId }

changeStaffRoles({ staffId, roles, expectedVersion })
  -> existing role-change result

changeStaffActive({ staffId, active, reassignToStaffId?, expectedVersion })
  -> existing activation result plus safe session-cleanup state
```

Unknown provider data is converted into one stable internal error. Raw provider errors never reach toasts, logs intended for users, analytics, audit metadata, or server-function responses.

## Error and Concurrency Behavior

- `400`: invalid target, roles, successor, or lifecycle transition; show a field or dialog error.
- `401`: preserve the route shell, clear pending sensitive state, and request sign-in.
- `403`: remove mutation controls and refresh the staff access projection.
- `404`: target no longer exists; close detail state and refresh the list.
- `409`: stale member version, concurrent role change, duplicate state transition, or last-Admin conflict; close stale confirmation state and refresh.
- `429`: show the safe retry time for invitation or reset cooldown.
- provider/network failure: keep safe local state, mark retryable follow-up where appropriate, and show a request ID.

Mutation buttons are disabled while their request is in flight. Every mutation uses an idempotency key. The server, not the disabled button, is the duplicate-action authority.

A panel retains last successful data when a refresh fails and marks it stale. One failed Overview section does not erase healthy sections.

## Audit

Audit records include:

- actor staff ID;
- action;
- target type and stable target ID;
- outcome;
- request ID;
- safe before/after roles where relevant;
- safe reassignment counts;
- stable provider outcome code;
- timestamp.

They exclude passwords, tokens, raw provider responses, email bodies, stack traces, environment values, and unrelated customer information.

## Accessibility and Responsive Behavior

- Navigation and status are not communicated by color alone.
- Icon-only actions have visible tooltips and accessible names.
- Confirmation dialogs trap focus and return it to the invoking control.
- Pending controls expose a readable pending label.
- Tables become deliberate member cards on narrow screens instead of horizontal overflow with hidden actions.
- Filters remain keyboard accessible and URL-backed.
- The mobile sidebar remains a drawer and closes after navigation.
- Headings retain a clear hierarchy appropriate for an operational admin.

## Testing

### Pure policy tests

- Admin, Manager, and Agent read/mutation matrix defaults to deny.
- Self-reset and self-suspension are rejected.
- Last-active-Admin protection remains enforced.
- Invite, resend, reset, suspend cleanup, and reactivation transitions reject invalid states.
- Duplicate email normalization is deterministic.
- Invitation and reset cooldown calculations are deterministic.
- Provider outcomes map only to stable safe error codes.

### Service and data tests

- The Neon Auth adapter contract is tested with mocked supported responses.
- Provider input and output never include application-only role authority.
- Invite retries reuse the same local staff and operation record.
- Reset retries do not produce duplicate provider calls inside the cooldown window.
- Suspension denies local access before provider session revocation.
- Session-revocation failure leaves the account inactive and creates retryable cleanup.
- Reactivation refuses a missing provider identity.
- Existing role and ownership-reassignment transactions remain unchanged and passing.
- Audit is written for success, rejection, conflict, and provider failure.
- The identity-action table rejects duplicate idempotency keys and stores no token-shaped fields.

### Route and component tests

- `/admin/team` is registered and noindexed.
- Admin sees all lifecycle actions.
- Manager sees the directory without mutation controls.
- Agent receives no usable route data.
- Filters, cursor pagination, detail selection, and URL state are stable.
- Invite, Admin-role, reset, suspension, and reactivation confirmations name the target.
- Loading, empty, stale, conflict, cooldown, and provider-failure states are covered.
- Overview counts refresh after relevant successful mutations.
- `AgentProfileForm` no longer duplicates the access-management UI after Team owns it.

### Browser verification

- Verify Admin, Manager, and Agent behavior with isolated non-production accounts.
- Verify the provider reset contract with a designated test inbox only.
- Verify that no reset token or raw provider payload appears in the URL, DOM, browser storage, toast, or network response.
- Verify invitation, resend, role, suspend, reactivate, and reset flows on desktop and mobile.
- Capture Overview, Team directory, detail panel, confirmation, empty, and failure-state screenshots.

### Regression verification

- existing Neon Auth tests;
- existing staff security and ownership tests;
- existing command-center and control-plane tests;
- existing admin route tests;
- focused Team and lifecycle tests;
- targeted ESLint and TypeScript checks for changed files;
- production build;
- `git diff --check`.

Generated or line-ending-only `bun.lockb` and route-tree noise must not be committed unless the content genuinely changes for this feature.

## Provider Contract Gate

Before UI implementation calls a real provider method, verify the exact installed Neon Auth SDK and current provider behavior for:

- listing or resolving identities;
- sending invitations and resending an existing invitation;
- requesting a password-reset email for a known identity;
- revoking a target user's sessions;
- stable response and error shapes;
- invitation and reset cooldown or rate-limit behavior.

The verification uses official current documentation and an isolated non-production branch or mocked contract fixture. If any required operation is unsupported, implementation stops and reports the missing capability. It must not fall back to direct writes in `neon_auth`, a custom password table, an Admin-set password, or an unapproved email provider.

## Delivery Boundaries

- Work occurs on an isolated `codex/...` worktree based on current `origin/main`.
- The user's stale, heavily modified root checkout remains untouched.
- Existing staff-access policies and transactions are preserved and reused.
- No real user receives an automated test email.
- No production database migration is applied.
- No provider, secret, environment, or email-domain configuration is changed.
- No deployment or live-account mutation is performed.
- Production migration, provider configuration, deployment, and live role-based smoke tests each require separate approval.

## Success Criteria

1. The admin reads as one Earnest-branded SaaS workspace across desktop and mobile.
2. Overview communicates operational state and actionable attention items without duplicating specialist pages.
3. Admins can invite, resend, change roles, suspend, reactivate, and send password-reset links from one Team surface.
4. Managers receive a useful read-only directory; Agents cannot access it.
5. Existing last-Admin, self-change, protected-account, concurrency, audit, and ownership-reassignment guarantees remain intact.
6. Passwords and provider tokens never enter Earnest UI state, application tables, logs, analytics, audit metadata, or server responses.
7. Provider failures are explicit, safe to retry, and cannot leave an account with unintended application access.
8. Focused tests, existing regressions, responsive browser verification, targeted static checks, production build, and diff checks pass before completion.
