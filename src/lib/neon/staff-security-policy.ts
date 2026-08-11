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
 * These counts are read from the database, so an authorization boundary
 * cannot trust that they always arrive as clean numbers -- a malformed row
 * or an upstream `Number(...)` on non-numeric input can hand us `NaN`.
 * `NaN < 1` and `NaN > 0` are both `false`, so an unguarded comparison would
 * silently skip the check it guards: a false ALLOW at an authorization
 * boundary. Normalize non-finite input to the most restrictive value instead
 * of trusting it -- fail closed, not open.
 */
function normalizedAdminCount(otherAdminCount: number): number {
  return Number.isFinite(otherAdminCount) ? otherAdminCount : 0;
}

/** Same fail-closed posture as {@link normalizedAdminCount}: an unreadable ownership total is treated as "owns work". */
function normalizedOwnedTotal(ownedTotal: number): number {
  return Number.isFinite(ownedTotal) ? ownedTotal : Number.POSITIVE_INFINITY;
}

/**
 * Role changes are privilege changes, so the guards are about lockout rather
 * than tidiness: you may drop your own `manager`, but never your own `admin`,
 * and the system must always retain at least one admin.
 *
 * `otherAdminCount` counts admins EXCLUDING the target, and must be read
 * server-side inside the same transaction as the write -- a client-supplied
 * count is a TOCTOU hole. Non-finite input is normalized to the most
 * restrictive value rather than silently skipping the guard (see
 * `normalizedAdminCount`).
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
  const otherAdminCount = normalizedAdminCount(input.otherAdminCount);

  if (!input.actorRoles.includes("admin")) return { allowed: false, reason: "not-admin" };

  if (losesAdmin(input.currentRoles, input.nextRoles)) {
    // Owner accounts cannot be demoted by anyone, including another admin.
    // Gaining roles is still allowed -- only losing admin is blocked.
    if (input.targetIsProtected) return { allowed: false, reason: "protected-account" };
    if (input.actorStaffId === input.targetStaffId) {
      return { allowed: false, reason: "self-admin-removal" };
    }
    if (otherAdminCount < 1) return { allowed: false, reason: "last-admin" };
  }

  return { allowed: true };
}

/**
 * Deactivating someone hands their work to a colleague, so the guards here
 * are about never leaving the system without an admin and never leaving
 * owned work orphaned -- not about tidiness.
 *
 * `otherAdminCount` (admins EXCLUDING the target) and `ownedTotal` must both
 * be read server-side inside the same transaction as the write -- client-
 * supplied values are a TOCTOU hole. Non-finite input is normalized to the
 * most restrictive value rather than silently skipping the guard it feeds
 * (see `normalizedAdminCount` / `normalizedOwnedTotal`).
 */
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
  const otherAdminCount = normalizedAdminCount(input.otherAdminCount);
  const ownedTotal = normalizedOwnedTotal(input.ownedTotal);

  if (!input.actorRoles.includes("admin")) return { allowed: false, reason: "not-admin" };
  if (input.targetIsProtected) return { allowed: false, reason: "protected-account" };
  if (input.actorStaffId === input.targetStaffId) return { allowed: false, reason: "self" };
  if (input.targetRoles.includes("admin") && otherAdminCount < 1) {
    return { allowed: false, reason: "last-admin" };
  }
  if (ownedTotal > 0) {
    if (!input.reassignToStaffId) return { allowed: false, reason: "successor-required" };
    if (input.reassignToStaffId === input.targetStaffId) {
      return { allowed: false, reason: "successor-is-target" };
    }
  }
  return { allowed: true };
}
