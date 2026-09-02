import "@tanstack/react-start/server-only";

import type { StaffAccess, StaffRole } from "./auth.server.ts";
import { staffLifecycleMemberFromRow } from "./admin-team.server.ts";
import type {
  ChangeStaffActiveInput,
  ChangeStaffRolesInput,
  InviteStaffMemberInput,
  LinkStaffIdentityInput,
  ResendStaffInvitationInput,
  SendStaffPasswordResetInput,
  StaffLifecycleFailureCode,
} from "./admin-team.types.ts";
import { queryRows, transactionRows, type DbRow, type TransactionStatement } from "./db.server.ts";
import {
  createIdentityActionStore,
  type IdentityActionState,
  type IdentityActionType,
} from "./staff-identity-actions.server.ts";
import {
  createStaffIdentityProvider,
  StaffIdentityProviderError,
} from "./staff-identity-provider.server.ts";
import type {
  ProviderIdentity,
  ProviderInvitation,
  ProviderOutcomeCode,
  StaffIdentityProvider,
} from "./staff-identity-provider.types.ts";
import {
  cooldownRetryAfter,
  isProviderOutcomeCode,
  normalizeStaffEmail,
} from "./staff-lifecycle-policy.ts";

type QueryRows = <T extends DbRow = DbRow>(statement: string, params?: unknown[]) => Promise<T[]>;
type TransactionRows = (statements: readonly TransactionStatement[]) => Promise<unknown>;
type IdentityActions = ReturnType<typeof createIdentityActionStore>;
type AuditInput = {
  actor: StaffAccess;
  permission: "staff.manage";
  action:
    | "staff.invited"
    | "staff.invitation_resent"
    | "staff.password_reset.requested"
    | "staff.session_revocation"
    | "staff.roles_changed"
    | "staff.identity_linked"
    | "staff.suspended"
    | "staff.reactivated";
  targetStaffId: string;
  requestId: string;
  outcome: "success" | "failure" | "denied";
  metadata?: Record<string, unknown>;
};

type LifecycleMember = {
  id: string;
  email: string;
  authUserId: string | null;
  active: boolean;
};

export type StaffLifecycleDependencies = {
  organizationId: string;
  provider: StaffIdentityProvider;
  queryRows?: QueryRows;
  transactionRows?: TransactionRows;
  identityActions?: IdentityActions;
  updateStaffRoles: (
    input: { staffId: string; roles: StaffRole[] },
    actor: StaffAccess,
  ) => Promise<{ ok: true; roles: StaffRole[] }>;
  setStaffActive: (
    input: ChangeStaffActiveInput,
    actor: StaffAccess,
  ) => Promise<{ ok: true; reassigned: Record<string, number> | null }>;
  writeAudit: (input: AuditInput) => Promise<void>;
  now?: () => Date;
  requestId?: () => string;
};

type LifecycleResult = {
  accepted: boolean;
  retryAfter: string | null;
  requestId: string;
  failureCode?: StaffLifecycleFailureCode;
};

const providerFailureCodes = new Set<ProviderOutcomeCode>([
  "PROVIDER_CAPABILITY_UNAVAILABLE",
  "PROVIDER_CONFLICT",
  "PROVIDER_FORBIDDEN",
  "PROVIDER_IDENTITY_NOT_FOUND",
  "PROVIDER_INVALID_REQUEST",
  "PROVIDER_INVITATION_NOT_FOUND",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAUTHORIZED",
  "PROVIDER_UNAVAILABLE",
]);

function requireAdmin(actor: StaffAccess) {
  if (!actor.roles.includes("admin")) throw new Response("Forbidden", { status: 403 });
}

function responseStatus(code: ProviderOutcomeCode) {
  if (code === "PROVIDER_INVALID_REQUEST") return 400;
  if (code === "PROVIDER_FORBIDDEN" || code === "PROVIDER_UNAUTHORIZED") return 403;
  if (code === "PROVIDER_IDENTITY_NOT_FOUND" || code === "PROVIDER_INVITATION_NOT_FOUND")
    return 404;
  if (code === "PROVIDER_CONFLICT") return 409;
  if (code === "PROVIDER_RATE_LIMITED") return 429;
  return 503;
}

function safeProviderCode(error: unknown): ProviderOutcomeCode {
  const candidate =
    error !== null && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : null;
  return isProviderOutcomeCode(candidate) && providerFailureCodes.has(candidate)
    ? candidate
    : "PROVIDER_UNAVAILABLE";
}

function stateFromAction(state: IdentityActionState) {
  if (state === "succeeded") return "sent" as const;
  if (state === "pending") return "pending" as const;
  return "failed" as const;
}

function idempotencyKey(action: IdentityActionType, value: string) {
  return `${action}:${value}`;
}

function cooldownWindowKey(
  action: "invitation" | "password-reset",
  value: string,
  requestedAt: Date,
) {
  const duration = action === "invitation" ? 15 * 60 * 1000 : 10 * 60 * 1000;
  return `${value}:${Math.floor(requestedAt.valueOf() / duration)}`;
}

function retryAfter(action: "invitation" | "password-reset", now: Date) {
  return cooldownRetryAfter({ action, now: new Date(now.valueOf() - 1), lastRequestedAt: now });
}

// findIdentityActionCooldown returns a row's stored retry_after verbatim -- a
// fixed timestamp written at the time of a prior failure that is never
// re-evaluated once real time moves past it. Without this check, a single
// retryable_failure row permanently blocks every future attempt: its
// retryAfter stays truthy forever, regardless of how much time has actually
// passed. localCooldown (computed from persisted.createdAt via
// cooldownRetryAfter) already gets this right; this mirrors that same
// still-in-the-future check for the DB-stored value.
function activeRetryAfter(candidate: string | null | undefined, now: Date): string | null {
  if (!candidate) return null;
  const retryAt = new Date(candidate);
  return Number.isNaN(retryAt.valueOf()) || retryAt <= now ? null : candidate;
}

async function safeAudit(writeAudit: StaffLifecycleDependencies["writeAudit"], input: AuditInput) {
  // All callers pass small allowlisted scalar/count metadata. This service is
  // the lifecycle audit boundary: no provider payload, token, cookie, body, or
  // error message is ever available to it.
  // Audit writes are explicitly best-effort once a provider delivery or local
  // transaction has completed. A transient audit outage must not recast a
  // delivered invitation/reset as a provider failure or downgrade its action.
  try {
    await writeAudit(input);
  } catch {
    // The lifecycle result remains authoritative; the next safe operation can
    // record audit state after the audit store recovers.
  }
}

export function createStaffLifecycleService(dependencies: StaffLifecycleDependencies) {
  const runQuery = dependencies.queryRows ?? queryRows;
  const runTransaction = dependencies.transactionRows ?? transactionRows;
  const actions = dependencies.identityActions ?? createIdentityActionStore();
  const now = dependencies.now ?? (() => new Date());
  // Not `crypto.randomUUID` directly: that stores the method detached from its
  // receiver, and calling it later as a bare `nextRequestId()` loses the `this`
  // binding a spec-strict WebCrypto implementation requires -- reproduced (with
  // the exact production error, "Value of \"this\" must be of type Crypto") in
  // the regression test below.
  const nextRequestId = dependencies.requestId ?? (() => crypto.randomUUID());

  async function memberById(staffId: string): Promise<LifecycleMember> {
    const rows = await runQuery<Record<string, unknown>>(
      `SELECT id::text AS id, email, auth_user_id, active
         FROM staff_users
        WHERE id = $1::uuid
        LIMIT 1`,
      [staffId],
    );
    const member = staffLifecycleMemberFromRow(rows[0]);
    if (!member) throw new Response("Staff member not found.", { status: 404 });
    return member;
  }

  async function upsertInvitee(input: InviteStaffMemberInput): Promise<LifecycleMember> {
    const email = normalizeStaffEmail(input.email);
    const roles = Array.from(new Set(input.roles));
    const statements: TransactionStatement[] = [
      {
        statement: `INSERT INTO staff_users (email, name_en, active)
                    VALUES ($1, $2, true)
                    ON CONFLICT (email) DO UPDATE
                      SET name_en = COALESCE(EXCLUDED.name_en, staff_users.name_en), updated_at = now()
                    RETURNING id::text AS id, email, auth_user_id, active`,
        params: [email, input.name?.trim() || null],
      },
      ...roles.map((role) => ({
        statement: `INSERT INTO staff_roles (staff_user_id, role)
                    SELECT id, $2::staff_role FROM staff_users WHERE email = $1
                    ON CONFLICT (staff_user_id, role) DO NOTHING`,
        params: [email, role] as unknown[],
      })),
    ];
    const results = (await runTransaction(statements)) as Array<Array<Record<string, unknown>>>;
    const member = staffLifecycleMemberFromRow(results[0]?.[0]);
    if (!member) throw new Response("Unable to prepare staff invitation.", { status: 503 });
    return member;
  }

  async function beginAction(input: {
    action: IdentityActionType;
    actor: StaffAccess;
    member: LifecycleMember;
    requestId: string;
    keyValue: string;
  }) {
    return actions.beginIdentityAction({
      idempotencyKey: idempotencyKey(input.action, input.keyValue),
      action: input.action,
      actorStaffId: input.actor.staffId,
      targetStaffId: input.member.id,
      targetEmail: input.member.email,
      requestId: input.requestId,
    });
  }

  async function latestActionFor(input: {
    targetStaffId: string;
    actions: IdentityActionType[];
  }): Promise<{
    action: IdentityActionType;
    state: IdentityActionState;
    createdAt: string;
    retryAfter: string | null;
    providerExpiresAt: string | null;
  } | null> {
    const rows = await runQuery<Record<string, unknown>>(
      `SELECT action, state, created_at, retry_after, provider_expires_at
         FROM staff_identity_actions
        WHERE target_staff_id = $1::uuid
          AND action = ANY($2::text[])
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [input.targetStaffId, input.actions],
    );
    const row = rows[0];
    if (!row) return null;
    // The Neon driver hands back timestamptz as Date objects, not strings --
    // db.server.ts's dateOrNull tests `value instanceof Date` for exactly that
    // reason, and the sibling readers (staff-identity-actions' timestampOrNull,
    // admin-team's dateString) coerce rather than type-check. A `typeof
    // created_at === "string"` guard here therefore rejected EVERY production
    // row, so this returned null always: resend saw no prior action and threw
    // 400 "Invitation is not available to resend." for members who had plainly
    // been invited, and every cooldown computed from `persisted` silently
    // never applied.
    const date = (value: unknown) => {
      if (value === null || value === undefined) return null;
      const parsed = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
    };
    const createdAt = date(row.created_at);
    if (
      typeof row.action !== "string" ||
      !input.actions.includes(row.action as IdentityActionType) ||
      typeof row.state !== "string" ||
      !["pending", "succeeded", "retryable_failure", "terminal_failure"].includes(row.state) ||
      !createdAt
    ) {
      return null;
    }
    return {
      action: row.action as IdentityActionType,
      state: row.state as IdentityActionState,
      createdAt,
      retryAfter: date(row.retry_after),
      providerExpiresAt: date(row.provider_expires_at),
    };
  }

  async function saveProviderInvitation(operationId: string, invitation: ProviderInvitation) {
    if (invitation.state === "expired") {
      await actions.markIdentityActionTerminal({
        operationId,
        safeErrorCode: "PROVIDER_INVITATION_EXPIRED",
      });
      return null;
    }
    await actions.markIdentityActionSucceeded({
      operationId,
      providerExpiresAt: invitation.expiresAt,
    });
    return invitation.state;
  }

  async function markProviderFailure(input: {
    operationId: string;
    error: unknown;
    cooldown: "invitation" | "password-reset";
  }) {
    const code = safeProviderCode(input.error);
    // Recording the failure is itself a DB write and can fail on its own
    // (e.g. a transient Neon connection reset). If it does, the original
    // provider failure must still come back as a safe result instead of
    // escaping as an unhandled exception -- the same reasoning safeAudit
    // already applies to audit writes.
    try {
      if (code === "PROVIDER_INVITATION_NOT_FOUND") {
        await actions.markIdentityActionTerminal({
          operationId: input.operationId,
          safeErrorCode: code,
        });
        return { code, terminal: true as const, retryAfter: null };
      }
      const retry = retryAfter(input.cooldown, now());
      await actions.markIdentityActionRetryable({
        operationId: input.operationId,
        safeErrorCode: code,
        retryAfter: retry,
      });
      return { code, terminal: false as const, retryAfter: retry };
    } catch {
      return { code, terminal: false as const, retryAfter: null };
    }
  }

  return {
    async inviteStaffMember(input: InviteStaffMemberInput, actor: StaffAccess, request: Request) {
      requireAdmin(actor);
      const requestId = nextRequestId();
      const member = await upsertInvitee(input);
      const operation = await beginAction({
        action: "invite",
        actor,
        member,
        requestId,
        keyValue: normalizeStaffEmail(input.email),
      });
      if (operation.isExisting) {
        return {
          memberId: member.id,
          invitationState: stateFromAction(operation.state),
          requestId,
        };
      }
      try {
        const invitation = await dependencies.provider.sendInvitation({
          email: member.email,
          organizationId: dependencies.organizationId,
          request,
        });
        const invitationState = await saveProviderInvitation(operation.operationId, invitation);
        if (!invitationState) {
          await safeAudit(dependencies.writeAudit, {
            actor,
            permission: "staff.manage",
            action: "staff.invited",
            targetStaffId: member.id,
            requestId,
            outcome: "failure",
            metadata: { safeErrorCode: "PROVIDER_INVITATION_EXPIRED" },
          });
          return { memberId: member.id, invitationState: "failed" as const, requestId };
        }
        await safeAudit(dependencies.writeAudit, {
          actor,
          permission: "staff.manage",
          action: "staff.invited",
          targetStaffId: member.id,
          requestId,
          outcome: "success",
          metadata: { beforeRoles: null, afterRoles: Array.from(new Set(input.roles)) },
        });
        return { memberId: member.id, invitationState, requestId };
      } catch (error) {
        const failure = await markProviderFailure({
          operationId: operation.operationId,
          error,
          cooldown: "invitation",
        });
        await safeAudit(dependencies.writeAudit, {
          actor,
          permission: "staff.manage",
          action: "staff.invited",
          targetStaffId: member.id,
          requestId,
          outcome: "failure",
          metadata: { safeErrorCode: failure.code, retryAfter: failure.retryAfter },
        });
        return { memberId: member.id, invitationState: "failed" as const, requestId };
      }
    },

    async resendStaffInvitation(
      input: ResendStaffInvitationInput,
      actor: StaffAccess,
      request: Request,
    ): Promise<LifecycleResult> {
      requireAdmin(actor);
      const requestId = nextRequestId();
      const member = await memberById(input.staffId);
      const currentNow = now();
      const persisted = await latestActionFor({
        targetStaffId: member.id,
        actions: ["invite", "resend_invitation"],
      });
      const previous = await actions.findIdentityActionCooldown({
        targetStaffId: member.id,
        action: "resend_invitation",
        now: currentNow.toISOString(),
      });
      const localCooldown =
        persisted && ["pending", "succeeded", "retryable_failure"].includes(persisted.state)
          ? cooldownRetryAfter({
              action: "invitation",
              now: currentNow,
              lastRequestedAt: persisted.createdAt,
            })
          : null;
      const previousCooldown = activeRetryAfter(previous?.retryAfter, currentNow);
      if (localCooldown || previousCooldown)
        return {
          accepted: false,
          retryAfter: localCooldown ?? previousCooldown,
          requestId,
        };
      if (
        persisted?.state === "succeeded" &&
        persisted.providerExpiresAt &&
        new Date(persisted.providerExpiresAt) <= currentNow
      ) {
        throw new Response("Invitation is expired; invite the staff member again.", {
          status: 400,
        });
      }
      // Only "never invited" blocks a resend. A terminal_failure row must NOT:
      // terminal is reachable solely via PROVIDER_INVITATION_NOT_FOUND, i.e. a
      // 404 from the provider's organization endpoint -- which is exactly what
      // this deployment returns, because Neon Auth's organization plugin is
      // disabled here. Since createLocalStaffInvitation records invitations
      // locally, no provider can declare one permanently gone, so the guard now
      // only poisons legacy rows. It had no escape hatch either: re-inviting
      // reuses the same idempotency key and returns "failed" forever, so a
      // member whose invite 404'd was bricked (surfaced as
      // 這項團隊操作未能執行). Resending re-records locally and clears the state.
      if (!persisted && !previous) {
        throw new Response("Invitation is not available to resend.", { status: 400 });
      }
      const operation = await beginAction({
        action: "resend_invitation",
        actor,
        member,
        requestId,
        keyValue: cooldownWindowKey("invitation", member.id, currentNow),
      });
      if (operation.isExisting) {
        return {
          accepted: operation.state === "pending" || operation.state === "succeeded",
          retryAfter: null,
          requestId,
        };
      }
      try {
        const invitationState = await saveProviderInvitation(
          operation.operationId,
          await dependencies.provider.resendInvitation({
            email: member.email,
            organizationId: dependencies.organizationId,
            request,
          }),
        );
        if (!invitationState) {
          await safeAudit(dependencies.writeAudit, {
            actor,
            permission: "staff.manage",
            action: "staff.invitation_resent",
            targetStaffId: member.id,
            requestId,
            outcome: "failure",
            metadata: { safeErrorCode: "PROVIDER_INVITATION_EXPIRED" },
          });
          return { accepted: false, retryAfter: null, requestId };
        }
        await safeAudit(dependencies.writeAudit, {
          actor,
          permission: "staff.manage",
          action: "staff.invitation_resent",
          targetStaffId: member.id,
          requestId,
          outcome: "success",
        });
        return { accepted: true, retryAfter: null, requestId };
      } catch (error) {
        const failure = await markProviderFailure({
          operationId: operation.operationId,
          error,
          cooldown: "invitation",
        });
        await safeAudit(dependencies.writeAudit, {
          actor,
          permission: "staff.manage",
          action: "staff.invitation_resent",
          targetStaffId: member.id,
          requestId,
          outcome: "failure",
          metadata: { safeErrorCode: failure.code },
        });
        return { accepted: false, retryAfter: failure.retryAfter, requestId };
      }
    },

    async sendStaffPasswordReset(
      input: SendStaffPasswordResetInput,
      actor: StaffAccess,
      request: Request,
    ): Promise<LifecycleResult> {
      requireAdmin(actor);
      const requestId = nextRequestId();
      if (actor.staffId === input.staffId)
        return {
          accepted: false,
          retryAfter: null,
          requestId,
          failureCode: "SELF_RESET_NOT_ALLOWED",
        };
      let member: LifecycleMember;
      try {
        member = await memberById(input.staffId);
      } catch (error) {
        if (error instanceof Response && error.status === 404)
          return {
            accepted: false,
            retryAfter: null,
            requestId,
            failureCode: "STAFF_IDENTITY_UNAVAILABLE",
          };
        return {
          accepted: false,
          retryAfter: null,
          requestId,
          failureCode: "STAFF_ACTION_STORE_UNAVAILABLE",
        };
      }
      if (!member.active || !member.authUserId)
        return {
          accepted: false,
          retryAfter: null,
          requestId,
          failureCode: "STAFF_IDENTITY_UNAVAILABLE",
        };
      const currentNow = now();
      let persisted: Awaited<ReturnType<typeof latestActionFor>>;
      let previous: Awaited<ReturnType<typeof actions.findIdentityActionCooldown>>;
      try {
        persisted = await latestActionFor({
          targetStaffId: member.id,
          actions: ["password_reset"],
        });
        previous = await actions.findIdentityActionCooldown({
          targetStaffId: member.id,
          action: "password_reset",
          now: currentNow.toISOString(),
        });
      } catch {
        return {
          accepted: false,
          retryAfter: null,
          requestId,
          failureCode: "STAFF_ACTION_STORE_UNAVAILABLE",
        };
      }
      const localCooldown =
        persisted && ["pending", "succeeded", "retryable_failure"].includes(persisted.state)
          ? cooldownRetryAfter({
              action: "password-reset",
              now: currentNow,
              lastRequestedAt: persisted.createdAt,
            })
          : null;
      const previousCooldown = activeRetryAfter(previous?.retryAfter, currentNow);
      if (localCooldown || previousCooldown)
        return {
          accepted: false,
          retryAfter: localCooldown ?? previousCooldown,
          requestId,
        };
      let operation: Awaited<ReturnType<typeof beginAction>>;
      try {
        operation = await beginAction({
          action: "password_reset",
          actor,
          member,
          requestId,
          keyValue: cooldownWindowKey("password-reset", member.id, currentNow),
        });
      } catch {
        return {
          accepted: false,
          retryAfter: null,
          requestId,
          failureCode: "STAFF_ACTION_STORE_UNAVAILABLE",
        };
      }
      if (operation.isExisting) {
        return {
          accepted: operation.state === "pending" || operation.state === "succeeded",
          retryAfter: null,
          requestId,
        };
      }
      try {
        // The local staff directory can contain a stale/typoed email. The
        // linked identity provider is authoritative for where a reset link is
        // delivered, so never send a reset using member.email alone.
        const identity = await dependencies.provider.resolveUser({
          authUserId: member.authUserId,
          request,
        });
        const providerEmail = identity.email?.trim().toLowerCase();
        if (!providerEmail)
          throw Object.assign(new Error(), { code: "PROVIDER_IDENTITY_NOT_FOUND" });
        await dependencies.provider.requestPasswordReset({
          email: providerEmail,
          redirectTo: new URL("/auth/reset-password", request.url).toString(),
          request,
        });
        await actions.markIdentityActionSucceeded({ operationId: operation.operationId });
        await safeAudit(dependencies.writeAudit, {
          actor,
          permission: "staff.manage",
          action: "staff.password_reset.requested",
          targetStaffId: member.id,
          requestId,
          outcome: "success",
        });
        return { accepted: true, retryAfter: null, requestId };
      } catch (error) {
        const failure = await markProviderFailure({
          operationId: operation.operationId,
          error,
          cooldown: "password-reset",
        });
        await safeAudit(dependencies.writeAudit, {
          actor,
          permission: "staff.manage",
          action: "staff.password_reset.requested",
          targetStaffId: member.id,
          requestId,
          outcome: "failure",
          metadata: { safeErrorCode: failure.code },
        });
        return { accepted: false, retryAfter: failure.retryAfter, requestId };
      }
    },

    async changeStaffRoles(input: ChangeStaffRolesInput, actor: StaffAccess, _request: Request) {
      requireAdmin(actor);
      const requestId = nextRequestId();
      const result = await dependencies.updateStaffRoles(input, actor);
      await safeAudit(dependencies.writeAudit, {
        actor,
        permission: "staff.manage",
        action: "staff.roles_changed",
        targetStaffId: input.staffId,
        requestId,
        outcome: "success",
        metadata: { afterRoles: result.roles },
      });
      return { ...result, requestId };
    },

    /**
     * Bind a staff row to the Neon Auth account registered with the same
     * email, on an admin's say-so.
     *
     * auth.server.ts only auto-binds by email once Neon Auth reports the
     * address verified, and Neon Auth does not verify emails unless the
     * project enables it -- so by default an invited member who signs up is
     * refused on every request, indefinitely, however their roles are set.
     * An explicit admin confirmation is at least as strong an identity claim
     * as a verification click, and it works regardless of the provider
     * setting. Same-email only: an admin who wants a different address must
     * first correct the member's email, so the audit trail stays honest.
     */
    async linkStaffIdentity(input: LinkStaffIdentityInput, actor: StaffAccess, _request: Request) {
      requireAdmin(actor);
      const requestId = nextRequestId();
      const member = await memberById(input.staffId);
      if (member.authUserId) throw new Response("already-linked", { status: 409 });

      const accounts = await runQuery<Record<string, unknown>>(
        `SELECT id::text AS id, "emailVerified" AS email_verified
           FROM neon_auth."user"
          WHERE lower(email) = lower($1)
          LIMIT 1`,
        [member.email],
      );
      const account = accounts[0];
      const authUserId = typeof account?.id === "string" && account.id ? account.id : null;
      if (!authUserId) throw new Response("account-not-found", { status: 404 });

      // staff_users.auth_user_id is UNIQUE; check first so a clash is a clear
      // 409 instead of a constraint error surfacing as a 500.
      const owners = await runQuery<Record<string, unknown>>(
        `SELECT id::text AS id FROM staff_users WHERE auth_user_id = $1 AND id <> $2::uuid LIMIT 1`,
        [authUserId, member.id],
      );
      if (owners.length) throw new Response("account-already-linked", { status: 409 });

      const updated = await runQuery<Record<string, unknown>>(
        `UPDATE staff_users
            SET auth_user_id = $1, updated_at = now()
          WHERE id = $2::uuid AND auth_user_id IS NULL
          RETURNING id::text AS id`,
        [authUserId, member.id],
      );
      if (!updated.length) throw new Response("already-linked", { status: 409 });

      const emailVerified = account.email_verified === true;
      await safeAudit(dependencies.writeAudit, {
        actor,
        permission: "staff.manage",
        action: "staff.identity_linked",
        targetStaffId: member.id,
        requestId,
        outcome: "success",
        metadata: { emailVerified },
      });
      return { ok: true as const, emailVerified, requestId };
    },

    async changeStaffActive(input: ChangeStaffActiveInput, actor: StaffAccess, request: Request) {
      requireAdmin(actor);
      const requestId = nextRequestId();
      const member = await memberById(input.staffId);
      if (input.active) {
        if (!member.authUserId)
          throw new Response("Staff identity is required for reactivation.", { status: 400 });
        try {
          await dependencies.provider.resolveUser({ authUserId: member.authUserId, request });
        } catch (error) {
          throw new Response(safeProviderCode(error), {
            status: responseStatus(safeProviderCode(error)),
          });
        }
        const result = await dependencies.setStaffActive(
          { staffId: input.staffId, active: true, reassignToStaffId: null },
          actor,
        );
        await safeAudit(dependencies.writeAudit, {
          actor,
          permission: "staff.manage",
          action: "staff.reactivated",
          targetStaffId: member.id,
          requestId,
          outcome: "success",
        });
        return { ...result, requestId };
      }
      const result = await dependencies.setStaffActive({ ...input, active: false }, actor);
      const operation = await beginAction({
        action: "session_revocation",
        actor,
        member,
        requestId,
        keyValue: member.id,
      });
      try {
        if (!member.authUserId)
          throw Object.assign(new Error(), { code: "PROVIDER_IDENTITY_NOT_FOUND" });
        await dependencies.provider.revokeUserSessions({ userId: member.authUserId, request });
        await actions.markIdentityActionSucceeded({ operationId: operation.operationId });
        await safeAudit(dependencies.writeAudit, {
          actor,
          permission: "staff.manage",
          action: "staff.session_revocation",
          targetStaffId: member.id,
          requestId,
          outcome: "success",
          metadata: { reassignedCounts: result.reassigned },
        });
      } catch (error) {
        const failure = await markProviderFailure({
          operationId: operation.operationId,
          error,
          cooldown: "invitation",
        });
        await safeAudit(dependencies.writeAudit, {
          actor,
          permission: "staff.manage",
          action: "staff.session_revocation",
          targetStaffId: member.id,
          requestId,
          outcome: "failure",
          metadata: { safeErrorCode: failure.code, reassignedCounts: result.reassigned },
        });
      }
      await safeAudit(dependencies.writeAudit, {
        actor,
        permission: "staff.manage",
        action: "staff.suspended",
        targetStaffId: member.id,
        requestId,
        outcome: "success",
        metadata: { reassignedCounts: result.reassigned },
      });
      return { ...result, requestId };
    },
  };
}

type DefaultStaffLifecycleLoaders = {
  loadAdminData?: () => Promise<
    Pick<typeof import("./admin-data.server.ts"), "updateStaffRoles" | "setStaffActive">
  >;
  loadAudit?: () => Promise<Pick<typeof import("../control-plane/audit.server.ts"), "writeAudit">>;
};

/**
 * Resolve a Neon Auth identity from the neon_auth."user" table this database
 * already holds, instead of Neon Auth's HTTP admin API.
 *
 * The HTTP route (/admin/get-user) rejected every credential shape this app
 * can forward -- three distinct attempts, each captured 401 in production
 * with the diagnostic in staff-identity-provider.server.ts: the app's own
 * session JWT (better-auth's bearer plugin cannot parse a 3-segment JWT), the
 * getSession() body token (same JWT, injected by the jwt plugin), and the
 * set-auth-token provider-session forwarding. The endpoint is also redundant:
 * Neon Auth syncs its user table into this database, and auth.server.ts
 * already treats neon_auth."user" as authoritative for id/email/name AND for
 * the security-critical emailVerified gate. Reading it here keeps password
 * reset working without any dependency on the provider's admin auth.
 */
export function createNeonAuthUserResolver(
  runQuery: QueryRows = queryRows,
): (input: { authUserId: string; request: Request }) => Promise<ProviderIdentity> {
  return async ({ authUserId }) => {
    let rows: DbRow[];
    try {
      rows = await runQuery(
        `SELECT id::text AS id, email, name, "emailVerified" AS email_verified
           FROM neon_auth."user"
          WHERE id::text = $1
          LIMIT 1`,
        [authUserId],
      );
    } catch {
      throw new StaffIdentityProviderError("PROVIDER_UNAVAILABLE", 503);
    }
    const row = rows[0];
    if (!row || typeof row.id !== "string" || !row.id) {
      throw new StaffIdentityProviderError("PROVIDER_IDENTITY_NOT_FOUND", 404);
    }
    return {
      id: row.id,
      email: typeof row.email === "string" ? row.email : null,
      name: typeof row.name === "string" ? row.name : null,
      emailVerified: row.email_verified === true,
    };
  };
}

/**
 * Revoke a user's Neon Auth sessions by deleting their rows in
 * neon_auth.session, instead of POST /admin/revoke-user-sessions.
 *
 * The HTTP route is unusable from a server: Neon's docs state admin
 * operations require the signed-in user's HTTP-only session cookie ("your
 * admin tooling must run on the same site that can send those cookies"), and
 * every credential this server can forward was rejected 401 in production.
 * The route is also nothing more than this delete -- the vendored better-auth
 * admin plugin's handler body is a permission check followed by
 * internalAdapter.deleteSessions(userId), a delete on the session model where
 * userId matches. neon_auth is the service's primary store (login verifies
 * against neon_auth.jwks), so the direct delete severs the same sessions.
 *
 * Inherent limit shared by BOTH methods: already-issued JWTs stay valid until
 * their exp (better-auth default 15m) because auth.server.ts's JWT path is
 * exp-bound and session-blind. Suspension's real gate is immediate either
 * way: findStaff requires staff_users.active = true.
 */
export function createNeonAuthSessionRevoker(
  runQuery: QueryRows = queryRows,
): (input: { userId: string; request: Request }) => Promise<void> {
  return async ({ userId }) => {
    try {
      await runQuery(`DELETE FROM neon_auth.session WHERE "userId" = $1`, [userId]);
    } catch {
      throw new StaffIdentityProviderError("PROVIDER_UNAVAILABLE", 503);
    }
  };
}

/**
 * Record an invitation locally instead of POST /organization/invite-member.
 *
 * No server-side credential exists for the hosted organization endpoints
 * (cookie-session only, same as the admin surface), and even a working call
 * only sends email if the hosted service configured sendInvitationEmail --
 * unknowable from here, so a "successful" call could silently send nothing.
 * The provider invitation never carried access anyway: inviteStaffMember
 * commits the staff row (email, roles, NULL auth_user_id) before the provider
 * is consulted, and auth.server.ts's findStaff binds the member's Neon Auth
 * account by verified email at first sign-up. The invitation email was pure
 * notification; the Team UI now tells the admin to share the sign-up link
 * instead, so the recorded state stays honest.
 *
 * state "sent" here means "invitation recorded; awaiting sign-up" (the UI
 * labels it 已邀請); expiresAt is null because a locally recorded invitation
 * does not expire.
 */
export function createLocalStaffInvitation(): (input: {
  email: string;
  organizationId: string;
  request: Request;
}) => Promise<ProviderInvitation> {
  return async () => ({ state: "sent", expiresAt: null });
}

export async function createDefaultStaffLifecycleDependencies(
  loaders: DefaultStaffLifecycleLoaders = {},
): Promise<StaffLifecycleDependencies> {
  const loadAdminData = loaders.loadAdminData ?? (() => import("./admin-data.server.ts"));
  const loadAudit = loaders.loadAudit ?? (() => import("../control-plane/audit.server.ts"));
  const localInvitation = createLocalStaffInvitation();
  return {
    organizationId: process.env.NEON_AUTH_ORGANIZATION_ID ?? "",
    // Every identity operation that previously hit Neon Auth's authenticated
    // admin/organization HTTP surface is served locally -- see
    // createNeonAuthUserResolver, createNeonAuthSessionRevoker and
    // createLocalStaffInvitation. The only HTTP call left on the provider is
    // requestPasswordReset, whose endpoint is public (verified live) and is
    // the one thing only the provider can do: send email.
    provider: {
      ...createStaffIdentityProvider({}),
      resolveUser: createNeonAuthUserResolver(),
      revokeUserSessions: createNeonAuthSessionRevoker(),
      sendInvitation: localInvitation,
      resendInvitation: localInvitation,
    },
    updateStaffRoles: async (input, actor) =>
      (await loadAdminData()).updateStaffRoles(input, actor),
    setStaffActive: async (input, actor) => (await loadAdminData()).setStaffActive(input, actor),
    writeAudit: async (input) => {
      const audit = await loadAudit();
      await audit.writeAudit({
        actor: input.actor,
        permission: input.permission,
        action: input.action,
        resourceType: "staff_user",
        resourceId: input.targetStaffId,
        outcome: input.outcome,
        context: { requestId: input.requestId, startedAt: new Date().toISOString() },
        metadata: input.metadata,
      });
    },
  };
}

async function defaultDependencies(): Promise<StaffLifecycleDependencies> {
  return createDefaultStaffLifecycleDependencies();
}

let defaultService: ReturnType<typeof createStaffLifecycleService> | null = null;
export async function getStaffLifecycleService() {
  defaultService ??= createStaffLifecycleService(await defaultDependencies());
  return defaultService;
}
