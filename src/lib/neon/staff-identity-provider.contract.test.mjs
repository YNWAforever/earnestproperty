import assert from "node:assert/strict";
import test from "node:test";

import * as identityProviderModule from "./staff-identity-provider.server.ts";

const { StaffIdentityProviderError, createStaffIdentityProvider, staffPasswordResetRedirect } =
  identityProviderModule;

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFetchFixture(responses) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({
      method: init.method,
      path: new URL(url).pathname,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body ? JSON.parse(init.body) : null,
    });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, requests };
}

function createProvider(responses, options = {}) {
  const fixture = createFetchFixture(responses);
  return {
    ...fixture,
    provider: createStaffIdentityProvider({
      fetchImpl: fixture.fetchImpl,
      authBaseUrl: "https://auth.example.test/",
      organizationId: options.organizationId ?? "org-earnest",
    }),
  };
}

const authorizedRequest = new Request("https://earnest.example.test/admin/team", {
  headers: {
    cookie: "better-auth.session_token=provider-secret",
    authorization: "Bearer access-secret",
  },
});

test("password-reset redirects are derived from the current request origin", () => {
  assert.equal(
    staffPasswordResetRedirect(
      new Request("https://earnest.example.test/admin/team?member=staff-1"),
    ),
    "https://earnest.example.test/auth/reset-password",
  );
});

test("provider adapter uses the configured base URL, forwards only auth headers, and never sends app roles", async () => {
  const { provider, requests } = createProvider([
    response({
      data: {
        user: { id: "auth-1", email: "agent@example.test", name: "Agent", emailVerified: true },
      },
    }),
  ]);

  assert.deepEqual(
    await provider.resolveUser({ authUserId: "auth-1", request: authorizedRequest }),
    {
      id: "auth-1",
      email: "agent@example.test",
      name: "Agent",
      emailVerified: true,
    },
  );
  assert.deepEqual(requests, [
    {
      method: "POST",
      path: "/admin/get-user",
      headers: {
        accept: "application/json",
        authorization: "Bearer access-secret",
        "content-type": "application/json",
        cookie: "better-auth.session_token=provider-secret",
      },
      body: { id: "auth-1" },
    },
  ]);
  assert.equal("role" in requests[0].body, false);
});

test("provider adapter sends member-only invitations and resends", async () => {
  const { provider, requests } = createProvider([
    response({
      data: { invitation: { status: "pending", expiresAt: "2026-09-01T00:00:00.000Z" } },
    }),
    response({ data: { invitation: { status: "sent", expiresAt: null } } }),
  ]);

  assert.deepEqual(
    await provider.sendInvitation({
      email: "new@example.test",
      organizationId: "org-earnest",
      request: authorizedRequest,
    }),
    { state: "pending", expiresAt: "2026-09-01T00:00:00.000Z" },
  );
  assert.deepEqual(
    await provider.resendInvitation({
      email: "new@example.test",
      organizationId: "org-earnest",
      request: authorizedRequest,
    }),
    { state: "sent", expiresAt: null },
  );
  assert.deepEqual(
    requests.map(({ method, path, body }) => ({ method, path, body })),
    [
      {
        method: "POST",
        path: "/organization/invite-member",
        body: { email: "new@example.test", role: "member", organizationId: "org-earnest" },
      },
      {
        method: "POST",
        path: "/organization/invite-member",
        body: {
          email: "new@example.test",
          role: "member",
          organizationId: "org-earnest",
          resend: true,
        },
      },
    ],
  );
});

test("provider adapter requests reset and session revocation without exposing provider payloads", async () => {
  const { provider, requests } = createProvider([
    response({ data: { token: "never-return", raw: { password: "never-return" } } }),
    response({ data: { token: "never-return" } }),
  ]);

  assert.equal(
    await provider.requestPasswordReset({
      email: "agent@example.test",
      redirectTo: "https://earnest.example.test/auth/reset-password",
      request: authorizedRequest,
    }),
    undefined,
  );
  assert.equal(
    await provider.revokeUserSessions({ userId: "auth-1", request: authorizedRequest }),
    undefined,
  );
  assert.deepEqual(
    requests.map(({ method, path, body }) => ({ method, path, body })),
    [
      {
        method: "POST",
        path: "/request-password-reset",
        body: {
          email: "agent@example.test",
          redirectTo: "https://earnest.example.test/auth/reset-password",
        },
      },
      { method: "POST", path: "/admin/revoke-user-sessions", body: { userId: "auth-1" } },
    ],
  );
});

test("provider statuses and network errors map to safe stable codes", async (t) => {
  const cases = [
    [400, "PROVIDER_INVALID_REQUEST"],
    [401, "PROVIDER_UNAUTHORIZED"],
    [403, "PROVIDER_FORBIDDEN"],
    [409, "PROVIDER_CONFLICT"],
    [429, "PROVIDER_RATE_LIMITED"],
  ];
  for (const [status, code] of cases) {
    await t.test(String(status), async () => {
      const { provider } = createProvider([
        response({ message: "token=secret", raw: "cookie=secret" }, status),
      ]);
      await assert.rejects(
        provider.requestPasswordReset({
          email: "agent@example.test",
          redirectTo: "https://example.test/reset",
          request: authorizedRequest,
        }),
        (error) =>
          error instanceof StaffIdentityProviderError &&
          error.code === code &&
          error.status === status &&
          !/secret/.test(error.message),
      );
    });
  }

  const missingIdentity = createProvider([response({ raw: "token=secret" }, 404)]);
  await assert.rejects(
    missingIdentity.provider.resolveUser({ authUserId: "gone", request: authorizedRequest }),
    (error) =>
      error instanceof StaffIdentityProviderError &&
      error.code === "PROVIDER_IDENTITY_NOT_FOUND" &&
      error.status === 404,
  );
  const missingInvitation = createProvider([response({ raw: "token=secret" }, 404)]);
  await assert.rejects(
    missingInvitation.provider.sendInvitation({
      email: "gone@example.test",
      organizationId: "org-earnest",
      request: authorizedRequest,
    }),
    (error) =>
      error instanceof StaffIdentityProviderError &&
      error.code === "PROVIDER_INVITATION_NOT_FOUND" &&
      error.status === 404,
  );
  const unavailable = createProvider([new Error("authorization=secret password=secret")]);
  await assert.rejects(
    unavailable.provider.resolveUser({ authUserId: "auth-1", request: authorizedRequest }),
    (error) =>
      error instanceof StaffIdentityProviderError &&
      error.code === "PROVIDER_UNAVAILABLE" &&
      error.status === 503 &&
      !/secret/.test(error.message),
  );
});

test("missing organization capability fails closed and all returned values remain secret-free", async () => {
  const { provider } = createProvider([], { organizationId: "" });
  await assert.rejects(
    provider.sendInvitation({
      email: "new@example.test",
      organizationId: "org-earnest",
      request: authorizedRequest,
    }),
    (error) =>
      error instanceof StaffIdentityProviderError &&
      error.code === "PROVIDER_CAPABILITY_UNAVAILABLE",
  );
});
