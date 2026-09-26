import { afterAll, mock, test } from "bun:test";
import assert from "node:assert/strict";

const authUrl = "https://auth.example.test/neondb/auth";
process.env.VITE_NEON_AUTH_URL = authUrl;

mock.module("@neondatabase/neon-js/auth", () => ({
  createAuthClient: () => ({
    // Neon Auth's onSuccess replaces session.token with set-auth-jwt.
    getSession: async () => ({
      data: {
        session: { id: "session-1", token: "header.payload.signature" },
        user: { id: "user-1", email: "staff@example.test" },
      },
    }),
  }),
}));
mock.module("@neondatabase/neon-js/auth/react/adapters", () => ({
  BetterAuthReactAdapter: () => ({}),
}));

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
globalThis.window = {} as Window & typeof globalThis;

afterAll(() => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
});

test("staff requests send the live session token when the SDK substitutes a JWT", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== authUrl + "/get-session" || init?.credentials !== "include") {
      return Response.json(null, { status: 401 });
    }
    return Response.json({
      session: { id: "session-1", token: "opaque-live-session" },
      user: { id: "user-1", email: "staff@example.test" },
    });
  }) as unknown as typeof fetch;

  const { withStaffAuthHeaders } = await import("./auth");
  const { headers } = await withStaffAuthHeaders();
  assert.equal(headers.get("authorization"), "Bearer opaque-live-session");
});

test("staff uploads use the live session token for the authenticated actor", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== authUrl + "/get-session" || init?.credentials !== "include") {
      return Response.json(null, { status: 401 });
    }
    return Response.json({
      session: { id: "session-1", token: "opaque-live-session" },
      user: { id: "user-1", email: "staff@example.test" },
    });
  }) as unknown as typeof fetch;

  const { withStaffUploadIdentity } = await import("./auth");
  const identity = await withStaffUploadIdentity();
  assert.equal(identity.actorId, "user-1");
  assert.equal(identity.headers.get("authorization"), "Bearer opaque-live-session");
});

test("staff upload identity and credential come from the same live response", async () => {
  globalThis.fetch = (async () =>
    Response.json({
      session: { id: "session-2", token: "opaque-other-session" },
      user: { id: "user-2", email: "other@example.test" },
    })) as unknown as typeof fetch;

  const { withStaffUploadIdentity } = await import("./auth");
  const identity = await withStaffUploadIdentity();
  assert.equal(identity.actorId, "user-2");
  assert.equal(identity.headers.get("authorization"), "Bearer opaque-other-session");
});

test("an Auth service failure is not reported as a missing login token", async () => {
  globalThis.fetch = (async () => Response.json({ error: "unavailable" }, { status: 503 })) as unknown as typeof fetch;

  const { withStaffAuthHeaders } = await import("./auth");
  await assert.rejects(withStaffAuthHeaders());
});

test("a new account does not reuse another account's pending session response", async () => {
  let completeFirst!: (response: Response) => void;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Promise<Response>((resolve) => {
        completeFirst = resolve;
      });
    }
    return Response.json({
      session: { id: "session-2", token: "opaque-session-2" },
      user: { id: "user-2", email: "other@example.test" },
    });
  }) as unknown as typeof fetch;

  const { withStaffUploadIdentity } = await import("./auth");
  const first = withStaffUploadIdentity();
  const second = withStaffUploadIdentity();
  completeFirst(Response.json({
    session: { id: "session-1", token: "opaque-session-1" },
    user: { id: "user-1", email: "staff@example.test" },
  }));

  assert.equal((await first).actorId, "user-1");
  const identity = await second;
  assert.equal(identity.actorId, "user-2");
  assert.equal(identity.headers.get("authorization"), "Bearer opaque-session-2");
});

test("a malformed Auth response is not reported as a missing login token", async () => {
  globalThis.fetch = (async () => new Response("not-json", { status: 200 })) as unknown as typeof fetch;

  const { withStaffAuthHeaders } = await import("./auth");
  await assert.rejects(withStaffAuthHeaders());
});
