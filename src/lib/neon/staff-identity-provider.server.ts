import "@tanstack/react-start/server-only";

import { mapProviderOutcome } from "./staff-lifecycle-policy.ts";
import type {
  ProviderIdentity,
  ProviderInvitation,
  ProviderInvitationState,
  ProviderOutcomeCode,
  StaffIdentityProvider,
} from "./staff-identity-provider.types.ts";

type JsonRecord = Record<string, unknown>;
type ProviderResource = "identity" | "invitation" | "general";

export class StaffIdentityProviderError extends Error {
  readonly code: ProviderOutcomeCode;
  readonly status: number;

  constructor(code: ProviderOutcomeCode, status: number) {
    super(code);
    this.name = "StaffIdentityProviderError";
    this.code = code;
    this.status = status;
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function providerData(value: unknown) {
  const body = asRecord(value);
  return asRecord(body.data ?? body);
}

function forwardedHeaders(request: Request) {
  const headers = new Headers({ accept: "application/json", "content-type": "application/json" });
  for (const header of ["cookie", "authorization"]) {
    const value = request.headers.get(header);
    if (value) headers.set(header, value);
  }
  return headers;
}

function invitationFrom(value: unknown): ProviderInvitation {
  const data = providerData(value);
  const invitation = asRecord(data.invitation ?? data);
  const status = invitation.status;
  if (status !== "sent" && status !== "pending" && status !== "expired") {
    throw new StaffIdentityProviderError("PROVIDER_UNAVAILABLE", 502);
  }
  const expiresAt = invitation.expiresAt;
  if (expiresAt !== undefined && expiresAt !== null && typeof expiresAt !== "string") {
    throw new StaffIdentityProviderError("PROVIDER_UNAVAILABLE", 502);
  }
  return { state: status as ProviderInvitationState, expiresAt: stringOrNull(expiresAt) };
}

export function staffPasswordResetRedirect(request: Request) {
  return new URL("/auth/reset-password", request.url).toString();
}

export function createStaffIdentityProvider(input: {
  fetchImpl?: typeof fetch;
  authBaseUrl?: string | null;
  organizationId?: string | null;
}): StaffIdentityProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  const authBaseUrl =
    input.authBaseUrl || process.env.NEON_AUTH_BASE_URL || process.env.VITE_NEON_AUTH_URL || "";
  const organizationId = input.organizationId ?? process.env.NEON_AUTH_ORGANIZATION_ID ?? "";

  async function callProvider<T>(input: {
    path: string;
    body: JsonRecord;
    request: Request;
    resource: ProviderResource;
    parse: (body: unknown) => T;
  }) {
    if (!authBaseUrl) throw new StaffIdentityProviderError("PROVIDER_CAPABILITY_UNAVAILABLE", 503);
    let response: Response;
    try {
      response = await fetchImpl(
        new URL(input.path, `${authBaseUrl.replace(/\/$/, "")}/`).toString(),
        {
          method: "POST",
          headers: forwardedHeaders(input.request),
          body: JSON.stringify(input.body),
        },
      );
    } catch {
      throw new StaffIdentityProviderError("PROVIDER_UNAVAILABLE", 503);
    }
    if (!response.ok) {
      throw new StaffIdentityProviderError(
        mapProviderOutcome({ status: response.status, resource: input.resource }),
        response.status,
      );
    }
    return input.parse(await response.json().catch(() => null));
  }

  function requireOrganization(requestOrganizationId: string) {
    if (!organizationId)
      throw new StaffIdentityProviderError("PROVIDER_CAPABILITY_UNAVAILABLE", 503);
    if (requestOrganizationId !== organizationId) {
      throw new StaffIdentityProviderError("PROVIDER_INVALID_REQUEST", 400);
    }
    return organizationId;
  }

  return {
    async resolveUser({ authUserId, request }) {
      return callProvider({
        path: "/admin/get-user",
        body: { id: authUserId },
        request,
        resource: "identity",
        parse(body): ProviderIdentity {
          const data = providerData(body);
          const user = asRecord(data.user ?? data);
          const id = stringOrNull(user.id);
          if (!id) throw new StaffIdentityProviderError("PROVIDER_UNAVAILABLE", 502);
          return {
            id,
            email: stringOrNull(user.email),
            name: stringOrNull(user.name),
            emailVerified: user.emailVerified === true,
          };
        },
      });
    },
    async sendInvitation({ email, organizationId: requestOrganizationId, request }) {
      return callProvider({
        path: "/organization/invite-member",
        body: { email, role: "member", organizationId: requireOrganization(requestOrganizationId) },
        request,
        resource: "invitation",
        parse: invitationFrom,
      });
    },
    async resendInvitation({ email, organizationId: requestOrganizationId, request }) {
      return callProvider({
        path: "/organization/invite-member",
        body: {
          email,
          role: "member",
          organizationId: requireOrganization(requestOrganizationId),
          resend: true,
        },
        request,
        resource: "invitation",
        parse: invitationFrom,
      });
    },
    async requestPasswordReset({ email, redirectTo, request }) {
      await callProvider({
        path: "/request-password-reset",
        body: { email, redirectTo },
        request,
        resource: "general",
        parse: () => undefined,
      });
    },
    async revokeUserSessions({ userId, request }) {
      await callProvider({
        path: "/admin/revoke-user-sessions",
        body: { userId },
        request,
        resource: "identity",
        parse: () => undefined,
      });
    },
  };
}
