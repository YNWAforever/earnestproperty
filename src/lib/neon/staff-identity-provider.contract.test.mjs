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
      path: new URL(url).pathname + new URL(url).search,
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
    // Not `authorization`: Neon Auth's admin API rejects the JWT this app's
    // own requireStaffAccess uses there (confirmed live -- see the doc
    // comment on providerSessionTokenFromResponse in src/auth.ts). The
    // provider adapter reads this separate, provider-compatible credential
    // instead when forwarding Authorization to Neon Auth.
    "x-neon-provider-session": "provider-session-secret",
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

test("provider adapter uses the configured base URL, forwards the provider-session credential (not this app's own JWT), and never sends app roles", async () => {
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
      method: "GET",
      path: "/admin/get-user?id=auth-1",
      headers: {
        accept: "application/json",
        authorization: "Bearer provider-session-secret",
        "content-type": "application/json",
        cookie: "better-auth.session_token=provider-secret",
      },
      body: null,
    },
  ]);
  assert.equal(requests[0].body, null);
});

test("provider adapter never forwards this app's own authorization header to Neon Auth", async () => {
  const { provider, requests } = createProvider([
    response({ data: { user: { id: "auth-1", email: null, name: null } } }),
  ]);
  const requestWithOnlyAppAuth = new Request("https://earnest.example.test/admin/team", {
    headers: { authorization: "Bearer this-apps-own-jwt" },
  });

  await provider.resolveUser({ authUserId: "auth-1", request: requestWithOnlyAppAuth });

  assert.equal("authorization" in requests[0].headers, false);
});

test("a base URL with a path prefix keeps that prefix on every provider call", async () => {
  // Production's Neon Auth base URL is not a bare origin -- it carries a path,
  // e.g. https://<endpoint>.neonauth.<region>.aws.neon.tech/neondb/auth. Joining a
  // leading-slash path against it makes the reference root-relative and silently
  // DROPS "/neondb/auth", so every provider call 404s. Every fixture above uses a
  // path-less base, where the bug is invisible -- hence this case.
  const fixture = createFetchFixture([
    response({ data: { user: { id: "auth-1", email: "agent@example.test", name: null } } }),
    response({ data: {} }),
    response({ data: { invitation: { status: "sent", expiresAt: null } } }),
    response({ data: {} }),
  ]);
  const provider = createStaffIdentityProvider({
    fetchImpl: fixture.fetchImpl,
    authBaseUrl: "https://auth.example.test/neondb/auth",
    organizationId: "org-earnest",
  });

  await provider.resolveUser({ authUserId: "auth-1", request: authorizedRequest });
  await provider.requestPasswordReset({
    email: "agent@example.test",
    redirectTo: "https://earnest.example.test/auth/reset-password",
    request: authorizedRequest,
  });
  await provider.sendInvitation({
    email: "new@example.test",
    organizationId: "org-earnest",
    request: authorizedRequest,
  });
  await provider.revokeUserSessions({ userId: "auth-1", request: authorizedRequest });

  assert.deepEqual(
    fixture.requests.map((entry) => entry.path),
    [
      "/neondb/auth/admin/get-user?id=auth-1",
      "/neondb/auth/request-password-reset",
      "/neondb/auth/organization/invite-member",
      "/neondb/auth/admin/revoke-user-sessions",
    ],
  );
});

test("empty server auth URL falls back to the configured VITE auth URL", async () => {
  const previousBaseUrl = process.env.NEON_AUTH_BASE_URL;
  const previousViteUrl = process.env.VITE_NEON_AUTH_URL;
  process.env.NEON_AUTH_BASE_URL = "";
  process.env.VITE_NEON_AUTH_URL = "https://vite-auth.example.test";

  try {
    const provider = createStaffIdentityProvider({
      fetchImpl: async (url) => {
        assert.equal(new URL(url).origin, "https://vite-auth.example.test");
        return response({
          data: { user: { id: "auth-1", email: null, name: null, emailVerified: false } },
        });
      },
      organizationId: "org-earnest",
    });
    await provider.resolveUser({ authUserId: "auth-1", request: authorizedRequest });
  } finally {
    if (previousBaseUrl === undefined) delete process.env.NEON_AUTH_BASE_URL;
    else process.env.NEON_AUTH_BASE_URL = previousBaseUrl;
    if (previousViteUrl === undefined) delete process.env.VITE_NEON_AUTH_URL;
    else process.env.VITE_NEON_AUTH_URL = previousViteUrl;
  }
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

test("provider adapter rejects malformed successful invitation responses", async () => {
  const { provider } = createProvider([response({ data: { invitation: { status: "unknown" } } })]);

  await assert.rejects(
    provider.sendInvitation({
      email: "new@example.test",
      organizationId: "org-earnest",
      request: authorizedRequest,
    }),
    (error) =>
      error instanceof StaffIdentityProviderError &&
      error.code === "PROVIDER_UNAVAILABLE" &&
      error.status === 502,
  );
});

test("provider adapter rejects a per-call organization that differs from configured authority", async () => {
  const { provider } = createProvider([]);

  await assert.rejects(
    provider.sendInvitation({
      email: "new@example.test",
      organizationId: "wrong-organization",
      request: authorizedRequest,
    }),
    (error) =>
      error instanceof StaffIdentityProviderError &&
      error.code === "PROVIDER_INVALID_REQUEST" &&
      error.status === 400,
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
