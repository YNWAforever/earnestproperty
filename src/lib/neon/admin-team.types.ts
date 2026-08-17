import type { StaffRole } from "./auth.server.ts";

export type AdminTeamInvitationState = "none" | "pending" | "sent" | "expired" | "failed";
export type AdminTeamAccessState = "active" | "suspended";
export type AdminTeamFilterState = AdminTeamAccessState | "invited" | "attention";

export type AdminTeamMember = {
  id: string;
  name: string | null;
  email: string | null;
  roles: StaffRole[];
  accessState: AdminTeamAccessState;
  invitationState: AdminTeamInvitationState;
  invitationRetryAfter: string | null;
  invitationExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  needsAttention: boolean;
};

export type AdminTeamList = {
  members: AdminTeamMember[];
  counts: { active: number; invited: number; suspended: number; attention: number };
  nextCursor: string | null;
};

export type AdminTeamListInput = {
  q?: string;
  role?: StaffRole;
  state?: AdminTeamFilterState;
  cursor?: string;
  limit?: number;
};

export type AdminTeamMemberDetail = {
  member: AdminTeamMember;
  identity: { authUserLinked: boolean };
  ownership: { counts: Record<string, number>; total: number };
  latestOperation: {
    action: "invite" | "resend_invitation" | "password_reset" | "session_revocation" | null;
    state: "pending" | "succeeded" | "retryable_failure" | "terminal_failure" | null;
    safeErrorCode: string | null;
    retryAfter: string | null;
  };
  recentActivity: Array<{ id: string; action: string; outcome: string; createdAt: string }>;
  version: string;
};

// Task 4 owns the lifecycle implementation. These declarations keep its public
// contract explicit without exposing a callable mutation in this read module.
export type InviteStaffMemberInput = { email: string; name?: string | null; roles: StaffRole[] };
export type ResendStaffInvitationInput = { staffId: string };
export type SendStaffPasswordResetInput = { staffId: string };
export type ChangeStaffRolesInput = { staffId: string; roles: StaffRole[] };
export type ChangeStaffActiveInput = {
  staffId: string;
  active: boolean;
  reassignToStaffId?: string | null;
};
export type StaffLifecycleFailureCode =
  | "SELF_RESET_NOT_ALLOWED"
  | "STAFF_IDENTITY_UNAVAILABLE"
  | "STAFF_ACTION_STORE_UNAVAILABLE";
export type StaffLifecycleResult = {
  requestId: string;
  accepted: boolean;
  retryAfter: string | null;
  failureCode?: StaffLifecycleFailureCode;
};
