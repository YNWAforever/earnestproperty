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
