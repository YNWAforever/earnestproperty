import type { StaffWhatsappReadiness } from "./whatsapp-readiness.types.ts";
import type { AdminTeamAccountState, AdminTeamInvitationState } from "./admin-team.types.ts";

export type OnboardingStepState = "ready" | "blocked" | "attention" | "unknown" | "not_required";
export type TeamOnboarding = {
  steps: {
    staffActive: OnboardingStepState;
    invitation: OnboardingStepState;
    emailVerified: OnboardingStepState;
    identityBound: OnboardingStepState;
    roleBranch: OnboardingStepState;
    inboxAssignment: OnboardingStepState;
    inboxPrivateNote: OnboardingStepState;
    staffPhone: OnboardingStepState;
  };
  attentionReasons: string[];
};

export function deriveTeamOnboarding(input: {
  active: boolean;
  email: string | null;
  roles: readonly string[];
  branchId: string | null;
  account: AdminTeamAccountState;
  emailVerified: boolean | null;
  invitation: AdminTeamInvitationState;
  readiness: StaffWhatsappReadiness | null;
}): TeamOnboarding {
  const agent = input.roles.includes("agent");
  const linked = input.account === "linked";
  const verified = input.emailVerified === true || input.account === "verified";
  const steps: TeamOnboarding["steps"] = {
    staffActive: input.active ? "ready" : "attention",
    invitation: linked
      ? "not_required"
      : input.invitation === "sent"
        ? "attention"
        : input.invitation === "pending"
          ? "unknown"
          : "attention",
    emailVerified: !input.email
      ? "attention"
      : verified
        ? "ready"
        : input.account === "unregistered"
          ? "unknown"
          : "attention",
    identityBound: linked ? "ready" : "attention",
    roleBranch: input.roles.length && (!agent || input.branchId) ? "ready" : "attention",
    inboxAssignment: !agent
      ? "not_required"
      : input.readiness
        ? input.readiness.assignment.state
        : "unknown",
    inboxPrivateNote: !agent
      ? "not_required"
      : input.readiness
        ? input.readiness.inboxPrivateNote.state
        : "unknown",
    staffPhone:
      input.readiness?.endpointVersion == null
        ? "not_required"
        : input.readiness.staffWhatsapp.state,
  };
  const reasons: string[] = [];
  if (input.active) {
    if (!input.email) reasons.push("EMAIL_MISSING");
    else if (input.emailVerified === false || input.account === "unverified")
      reasons.push("EMAIL_UNVERIFIED");
    else if (input.account === "unregistered") reasons.push("ACCOUNT_UNREGISTERED");
    else if (input.emailVerified === null) reasons.push("EMAIL_VERIFICATION_UNKNOWN");
    if (!linked) reasons.push("IDENTITY_UNBOUND");
    if (input.invitation === "expired") reasons.push("INVITATION_EXPIRED");
    if (input.invitation === "failed") reasons.push("INVITATION_FAILED");
    if (input.invitation === "sent" && !linked) reasons.push("INVITATION_MANUAL_SHARE");
    if (!input.roles.length) reasons.push("ROLE_MISSING");
    if (agent && !input.branchId) reasons.push("AGENT_BRANCH_MISSING");
    if (agent && input.readiness?.assignment.state === "blocked")
      reasons.push("INBOX_MAPPING_BLOCKED");
    if (agent && !input.readiness) reasons.push("INBOX_READINESS_UNKNOWN");
    if (
      input.readiness?.endpointVersion != null &&
      input.readiness.staffWhatsapp.state === "blocked"
    )
      reasons.push("STAFF_PHONE_ROUTE_BLOCKED");
  }
  return { steps, attentionReasons: reasons };
}
