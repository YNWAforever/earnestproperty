import type { ProviderOutcomeCode } from "./staff-identity-provider.types";

export type StaffLifecycleRole = "admin" | "manager" | "agent";
export type TeamCapability =
  | "directory"
  | "detail"
  | "invite"
  | "resend"
  | "change-roles"
  | "suspend"
  | "reactivate"
  | "reset";

export type InvitationState = "none" | "pending" | "sent" | "expired" | "failed";
export type CooldownAction = "invitation" | "password-reset";

const STAFF_ROLES = new Set<StaffLifecycleRole>(["admin", "manager", "agent"]);
const PROVIDER_OUTCOME_CODES = new Set<ProviderOutcomeCode>([
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

const cooldownMs: Record<CooldownAction, number> = {
  invitation: 15 * 60 * 1000,
  "password-reset": 10 * 60 * 1000,
};

function hasKnownId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeStaffEmail(value: string) {
  return value.trim().normalize("NFC").toLowerCase();
}

export function isStaffRoleSet(roles: readonly string[]) {
  return (
    roles.length > 0 &&
    roles.every((role) => STAFF_ROLES.has(role as StaffLifecycleRole)) &&
    new Set(roles).size === roles.length
  );
}

export function decideTeamAccess(input: {
  actorRoles: readonly string[];
  capability: TeamCapability;
}) {
  if (!isStaffRoleSet(input.actorRoles))
    return { allowed: false, reason: "not-authorized" } as const;
  if (input.actorRoles.includes("admin")) return { allowed: true } as const;
  if (
    input.actorRoles.includes("manager") &&
    (input.capability === "directory" || input.capability === "detail")
  ) {
    return { allowed: true, readOnly: true } as const;
  }
  return { allowed: false, reason: "not-authorized" } as const;
}

function decideSelfAction(input: { actorStaffId: string | null; targetStaffId: string | null }) {
  if (!hasKnownId(input.actorStaffId) || !hasKnownId(input.targetStaffId)) {
    return { allowed: false, reason: "unknown-target" } as const;
  }
  if (input.actorStaffId === input.targetStaffId)
    return { allowed: false, reason: "self" } as const;
  return { allowed: true } as const;
}

export function decideSelfReset(input: {
  actorStaffId: string | null;
  targetStaffId: string | null;
}) {
  return decideSelfAction(input);
}

export function decideSelfSuspend(input: {
  actorStaffId: string | null;
  targetStaffId: string | null;
}) {
  return decideSelfAction(input);
}

export function decideInvitationTransition(input: {
  action: "invite" | "resend";
  currentState: InvitationState;
  providerOutcome: ProviderOutcomeCode | "PROVIDER_OK";
}) {
  if (input.action === "invite") {
    return input.currentState === "none" ||
      input.currentState === "failed" ||
      input.currentState === "expired"
      ? ({ allowed: true } as const)
      : ({ allowed: false, reason: "duplicate-invitation" } as const);
  }
  if (input.currentState === "none")
    return { allowed: false, reason: "invitation-not-found" } as const;
  if (input.currentState === "failed" && input.providerOutcome !== "PROVIDER_UNAVAILABLE") {
    return { allowed: false, reason: "invitation-not-retryable" } as const;
  }
  return { allowed: true } as const;
}

export function decideReactivation(input: {
  authUserId: string | null;
  providerOutcome: ProviderOutcomeCode | "PROVIDER_OK";
}) {
  if (!hasKnownId(input.authUserId))
    return { allowed: false, reason: "identity-required" } as const;
  if (input.providerOutcome !== "PROVIDER_OK") {
    return {
      allowed: false,
      reason: isProviderOutcomeCode(input.providerOutcome)
        ? input.providerOutcome
        : "PROVIDER_UNAVAILABLE",
    } as const;
  }
  return { allowed: true } as const;
}

export function cooldownRetryAfter(input: {
  action: CooldownAction;
  now: Date;
  lastRequestedAt: string | Date | null;
}) {
  if (!input.lastRequestedAt) return null;
  const requestedAt = new Date(input.lastRequestedAt);
  if (Number.isNaN(requestedAt.valueOf())) return null;
  const retryAt = new Date(requestedAt.valueOf() + cooldownMs[input.action]);
  return retryAt > input.now ? retryAt.toISOString() : null;
}

export function mapProviderOutcome(input: {
  status: number;
  resource: "identity" | "invitation" | "general";
}): ProviderOutcomeCode {
  if (input.status === 400) return "PROVIDER_INVALID_REQUEST";
  if (input.status === 401) return "PROVIDER_UNAUTHORIZED";
  if (input.status === 403) return "PROVIDER_FORBIDDEN";
  if (input.status === 404) {
    return input.resource === "invitation"
      ? "PROVIDER_INVITATION_NOT_FOUND"
      : "PROVIDER_IDENTITY_NOT_FOUND";
  }
  if (input.status === 409) return "PROVIDER_CONFLICT";
  if (input.status === 429) return "PROVIDER_RATE_LIMITED";
  return "PROVIDER_UNAVAILABLE";
}

export function isProviderOutcomeCode(value: unknown): value is ProviderOutcomeCode {
  return typeof value === "string" && PROVIDER_OUTCOME_CODES.has(value as ProviderOutcomeCode);
}
