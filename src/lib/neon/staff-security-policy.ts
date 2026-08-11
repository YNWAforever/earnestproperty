export type AgentProfileIdentityInput = {
  auth_user_id: string | null;
  email: string | null;
  active: boolean;
};

export type AgentProfileSecurityTarget = {
  authUserId: string | null;
  email: string | null;
  active: boolean;
  roles: readonly string[];
};

export type AgentProfileMutationDecision =
  | { allowed: true; mode: "identity-and-profile" | "public-profile-only" }
  | {
      allowed: false;
      reason: "insufficient-role" | "identity-access-admin-only" | "privileged-target-admin-only";
    };

type BootstrapStaffRow = {
  authUserId: string | null;
  roles: readonly string[];
};

type FirstAdminBootstrapAccess = {
  roles: readonly string[];
  matchedProfileOnly: boolean;
};

function normalizedNullable(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizedEmail(value: string | null) {
  return normalizedNullable(value)?.toLowerCase() ?? null;
}

export function deriveAgentProfileEditorContext(actorRoles: readonly string[]) {
  return { canManageIdentity: actorRoles.includes("admin") };
}

export function decideAgentProfileMutation(
  actorRoles: readonly string[],
  input: AgentProfileIdentityInput,
  target: AgentProfileSecurityTarget | null,
): AgentProfileMutationDecision {
  if (actorRoles.includes("admin")) {
    return { allowed: true, mode: "identity-and-profile" };
  }
  if (!actorRoles.includes("manager")) {
    return { allowed: false, reason: "insufficient-role" };
  }
  if (target?.roles.includes("admin")) {
    return { allowed: false, reason: "privileged-target-admin-only" };
  }

  const inputAuthUserId = normalizedNullable(input.auth_user_id);
  const inputEmail = normalizedEmail(input.email);
  if (!target) {
    if (inputAuthUserId !== null || inputEmail !== null || input.active !== true) {
      return { allowed: false, reason: "identity-access-admin-only" };
    }
    return { allowed: true, mode: "public-profile-only" };
  }

  if (
    inputAuthUserId !== normalizedNullable(target.authUserId) ||
    inputEmail !== normalizedEmail(target.email) ||
    input.active !== target.active
  ) {
    return { allowed: false, reason: "identity-access-admin-only" };
  }
  return { allowed: true, mode: "public-profile-only" };
}

export function isFirstAdminBootstrapEligible(rows: readonly BootstrapStaffRow[]) {
  return !rows.some((row) => normalizedNullable(row.authUserId) !== null || row.roles.length > 0);
}

export function shouldBootstrapFirstAdmin(input: {
  email: string | null;
  allowlistedEmails: ReadonlySet<string>;
  access: FirstAdminBootstrapAccess | null;
  staffRows: readonly BootstrapStaffRow[];
}) {
  const email = normalizedEmail(input.email);
  if (!email || !input.allowlistedEmails.has(email)) return false;
  if (input.access && (!input.access.matchedProfileOnly || input.access.roles.length > 0)) {
    return false;
  }
  return isFirstAdminBootstrapEligible(input.staffRows);
}

export type StaffRoleChangeDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "not-admin" | "self-admin-removal" | "last-admin" | "protected-account";
    };

export type StaffDeactivationDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "not-admin"
        | "self"
        | "last-admin"
        | "successor-required"
        | "successor-is-target"
        | "protected-account";
    };

function losesAdmin(current: readonly string[], next: readonly string[]) {
  return current.includes("admin") && !next.includes("admin");
}

/**
 * Role changes are privilege changes, so the guards are about lockout rather
 * than tidiness: you may drop your own `manager`, but never your own `admin`,
 * and the system must always retain at least one admin.
 *
 * `otherAdminCount` counts admins EXCLUDING the target, and must be read
 * server-side inside the same transaction as the write -- a client-supplied
 * count is a TOCTOU hole.
 */
export function decideStaffRoleChange(input: {
  actorRoles: readonly string[];
  actorStaffId: string;
  targetStaffId: string;
  currentRoles: readonly string[];
  nextRoles: readonly string[];
  otherAdminCount: number;
  /** True when the target's email is in ADMIN_BOOTSTRAP_EMAILS. */
  targetIsProtected: boolean;
}): StaffRoleChangeDecision {
  if (!input.actorRoles.includes("admin")) return { allowed: false, reason: "not-admin" };

  if (losesAdmin(input.currentRoles, input.nextRoles)) {
    // Owner accounts cannot be demoted by anyone, including another admin.
    // Gaining roles is still allowed -- only losing admin is blocked.
    if (input.targetIsProtected) return { allowed: false, reason: "protected-account" };
    if (input.actorStaffId === input.targetStaffId) {
      return { allowed: false, reason: "self-admin-removal" };
    }
    if (input.otherAdminCount < 1) return { allowed: false, reason: "last-admin" };
  }

  return { allowed: true };
}

export function decideStaffDeactivation(input: {
  actorRoles: readonly string[];
  actorStaffId: string;
  targetStaffId: string;
  targetRoles: readonly string[];
  otherAdminCount: number;
  ownedTotal: number;
  reassignToStaffId: string | null;
  /** True when the target's email is in ADMIN_BOOTSTRAP_EMAILS. */
  targetIsProtected: boolean;
}): StaffDeactivationDecision {
  if (!input.actorRoles.includes("admin")) return { allowed: false, reason: "not-admin" };
  if (input.targetIsProtected) return { allowed: false, reason: "protected-account" };
  if (input.actorStaffId === input.targetStaffId) return { allowed: false, reason: "self" };
  if (input.targetRoles.includes("admin") && input.otherAdminCount < 1) {
    return { allowed: false, reason: "last-admin" };
  }
  if (input.ownedTotal > 0) {
    if (!input.reassignToStaffId) return { allowed: false, reason: "successor-required" };
    if (input.reassignToStaffId === input.targetStaffId) {
      return { allowed: false, reason: "successor-is-target" };
    }
  }
  return { allowed: true };
}
