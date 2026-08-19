import { describe, expect, test } from "bun:test";

import { providerSessionTokenFromResponse } from "./auth";

describe("providerSessionTokenFromResponse", () => {
  test("reads the set-auth-token response header", () => {
    const response = new Response(null, {
      headers: { "set-auth-token": "raw-session-value.hmac-signature" },
    });

    expect(providerSessionTokenFromResponse(response)).toBe("raw-session-value.hmac-signature");
  });

  test("returns null when the header is absent, without touching the JSON body", () => {
    // No fallback to the response body is intentional: the body's session
    // token is the JWT readStaffAuthToken() already uses, which is confirmed
    // NOT to be accepted by Neon Auth's admin API (see the doc comment on
    // this function in auth.ts) -- falling back to it here would just
    // reproduce the same failure silently.
    const response = new Response(JSON.stringify({ session: { token: "a-jwt.payload.sig" } }));

    expect(providerSessionTokenFromResponse(response)).toBeNull();
  });

  test("returns null for a blank header", () => {
    const response = new Response(null, { headers: { "set-auth-token": "   " } });

    expect(providerSessionTokenFromResponse(response)).toBeNull();
  });
});
