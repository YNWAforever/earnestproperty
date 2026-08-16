export type ProviderIdentity = {
  id: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
};

export type ProviderInvitationState = "sent" | "pending" | "expired";

export type ProviderInvitation = {
  state: ProviderInvitationState;
  expiresAt: string | null;
};

export type ProviderOutcomeCode =
  | "PROVIDER_CAPABILITY_UNAVAILABLE"
  | "PROVIDER_CONFLICT"
  | "PROVIDER_FORBIDDEN"
  | "PROVIDER_IDENTITY_NOT_FOUND"
  | "PROVIDER_INVALID_REQUEST"
  | "PROVIDER_INVITATION_NOT_FOUND"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAUTHORIZED"
  | "PROVIDER_UNAVAILABLE";

export type StaffIdentityProvider = {
  resolveUser(input: { authUserId: string; request: Request }): Promise<ProviderIdentity>;
  sendInvitation(input: {
    email: string;
    organizationId: string;
    request: Request;
  }): Promise<ProviderInvitation>;
  resendInvitation(input: {
    email: string;
    organizationId: string;
    request: Request;
  }): Promise<ProviderInvitation>;
  requestPasswordReset(input: {
    email: string;
    redirectTo: string;
    request: Request;
  }): Promise<void>;
  revokeUserSessions(input: { userId: string; request: Request }): Promise<void>;
};
