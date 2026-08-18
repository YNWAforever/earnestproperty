import "@tanstack/react-start/server-only";

import type { StaffAccess, StaffRole } from "./auth.server.ts";
import { staffLifecycleMemberFromRow } from "./admin-team.server.ts";
import type {
  ChangeStaffActiveInput,
  ChangeStaffRolesInput,
  InviteStaffMemberInput,
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
import { createStaffIdentityProvider } from "./staff-identity-provider.server.ts";
import type {
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
  const nextRequestId = dependencies.requestId ?? crypto.randomUUID;

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
    if (
      !row ||
      typeof row.action !== "string" ||
      !input.actions.includes(row.action as IdentityActionType) ||
      typeof row.state !== "string" ||
      !["pending", "succeeded", "retryable_failure", "terminal_failure"].includes(row.state) ||
      typeof row.created_at !== "string" ||
      Number.isNaN(new Date(row.created_at).valueOf())
    ) {
      return null;
    }
    const date = (value: unknown) => {
      const parsed = new Date(String(value));
      return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
    };
    return {
      action: row.action as IdentityActionType,
      state: row.state as IdentityActionState,
      createdAt: new Date(row.created_at).toISOString(),
      retryAfter:
        row.retry_after === null || row.retry_after === undefined ? null : date(row.retry_after),
      providerExpiresAt:
        row.provider_expires_at === null || row.provider_expires_at === undefined
          ? null
          : date(row.provider_expires_at),
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
      if (localCooldown || previous?.retryAfter)
        return {
          accepted: false,
          retryAfter: localCooldown ?? previous?.retryAfter ?? null,
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
      if (
        (!persisted && !previous) ||
        (persisted?.state === "terminal_failure" && previous?.state !== "retryable_failure")
      ) {
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
        if (operation.state === "terminal_failure") {
          throw new Response("Invitation is not available to resend.", { status: 400 });
        }
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
      if (localCooldown || previous?.retryAfter)
        return {
          accepted: false,
          retryAfter: localCooldown ?? previous?.retryAfter ?? null,
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

export async function createDefaultStaffLifecycleDependencies(
  loaders: DefaultStaffLifecycleLoaders = {},
): Promise<StaffLifecycleDependencies> {
  const loadAdminData = loaders.loadAdminData ?? (() => import("./admin-data.server.ts"));
  const loadAudit = loaders.loadAudit ?? (() => import("../control-plane/audit.server.ts"));
  return {
    organizationId: process.env.NEON_AUTH_ORGANIZATION_ID ?? "",
    provider: createStaffIdentityProvider({}),
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
