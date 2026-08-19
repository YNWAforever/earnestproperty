import { createAuthClient } from "@neondatabase/neon-js/auth";
import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react/adapters";

export const authClient = createAuthClient(import.meta.env.VITE_NEON_AUTH_URL ?? "", {
  adapter: BetterAuthReactAdapter(),
});

type ServerFnCallOptions = {
  headers?: HeadersInit;
  data?: unknown;
  [key: string]: unknown;
};

type NeonAuthClientWithStaffToken = typeof authClient & {
  getSession?: () => Promise<unknown>;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringToken(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function sessionTokenFromValue(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;

  const directToken = stringToken(record.token) ?? stringToken(record.access_token);
  if (directToken) return directToken;

  const data = asRecord(record.data);
  const session = asRecord(record.session) ?? asRecord(data?.session);
  return stringToken(session?.token) ?? stringToken(session?.access_token);
}

async function readStaffAuthToken() {
  if (typeof window === "undefined") return null;

  // getJWTToken() is not called here: on the installed @neondatabase/auth
  // 0.4.2-beta, calling it always 404s. createAuthClient() returns the raw
  // better-auth client instance (not NeonAuthAdapterCore), so
  // authClient.getJWTToken routes through better-auth's dynamic-path Proxy,
  // which derives the REST endpoint by kebab-casing the method name letter by
  // letter -- "getJWTToken" becomes "/get-j-w-t-token" instead of the real
  // "/get-jwt-token", since it does not recognise "JWT" as one acronym. Every
  // call was therefore a guaranteed-failing round-trip before falling back to
  // getSession() below, which already covers every case this app needs.
  // Revisit if the SDK is upgraded past this version.
  //
  // This JWT is verified successfully by this app's OWN requireStaffAccess
  // (auth.server.ts's verifyNeonJwt) -- do not replace it here. It is NOT,
  // however, a credential Neon Auth's own admin API accepts; see
  // providerSessionTokenFromResponse below for that separate problem.
  const client = authClient as NeonAuthClientWithStaffToken;
  const session = await client.getSession?.().catch(() => null);
  return sessionTokenFromValue(session);
}

/**
 * Extract Neon Auth's own bearer-compatible session credential from a raw
 * `/get-session` response.
 *
 * This is a DIFFERENT credential from readStaffAuthToken()'s JWT, and the two
 * must not be conflated -- confirmed live (production diagnostic on a real
 * admin session) that swapping the JWT out for this one everywhere would
 * break this app's own login too. What each is for:
 *
 * - readStaffAuthToken()'s JWT authenticates the browser to THIS APP's own
 *   requireStaffAccess (auth.server.ts), which accepts a JWT (verifyNeonJwt)
 *   or, as a fallback, a raw value looked up with `WHERE session.token = $1`
 *   -- an exact match against the DB's unsigned session id. This already
 *   works; nothing here should touch it.
 * - Neon Auth's OWN admin API (e.g. /admin/get-user, used by
 *   staff-identity-provider.server.ts to resolve a staff member's
 *   authoritative email before a password reset) authenticates
 *   `Authorization: Bearer` through better-auth's separate "bearer" plugin,
 *   which converts the token into an equivalent session cookie for lookup --
 *   but only understands a plain, single-signature session value
 *   ("value.hmac"). Its parsing (`token.split(".")[0]` as the value,
 *   `split(".")[1]` as the signature) silently misreads a real JWT's first
 *   two segments as that pair and ignores the JWT's actual third-segment
 *   signature entirely, so verification fails and the request is treated as
 *   unauthenticated -- exactly the 401 observed in production (empty body,
 *   no permission message, i.e. rejected before any role check ran).
 *
 * The plain session value the bearer plugin actually expects is exposed only
 * via the `set-auth-token` RESPONSE HEADER (better-auth's bearer plugin
 * "after" hook, same /get-session endpoint) -- a header the SDK's
 * parsed-JSON getSession() never surfaces, so it has to be read directly.
 */
export function providerSessionTokenFromResponse(response: Response): string | null {
  return stringToken(response.headers.get("set-auth-token"));
}

async function readNeonProviderSessionToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const authBaseUrl = import.meta.env.VITE_NEON_AUTH_URL;
  if (!authBaseUrl) return null;
  try {
    const response = await fetch(new URL("get-session", `${authBaseUrl.replace(/\/$/, "")}/`), {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    return providerSessionTokenFromResponse(response);
  } catch {
    return null;
  }
}

// Overloaded so the no-argument form resolves to exactly `{ headers: Headers }`.
// With a single signature, `TOptions` fell back to the `ServerFnCallOptions`
// constraint and carried `data?: unknown`, which every server function declared
// without an input validator rejects (`data` must be `undefined` there) -- that
// alone accounted for most of the repo's TypeScript baseline.
export async function withStaffAuthHeaders(): Promise<{ headers: Headers }>;
export async function withStaffAuthHeaders<TOptions extends ServerFnCallOptions>(
  options: TOptions,
): Promise<TOptions & { headers: Headers }>;
export async function withStaffAuthHeaders(
  options?: ServerFnCallOptions,
): Promise<ServerFnCallOptions & { headers: Headers }> {
  const headers = new Headers(options?.headers);
  const [token, providerToken] = await Promise.all([
    readStaffAuthToken(),
    readNeonProviderSessionToken(),
  ]);

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  // Separate from `authorization` above -- see providerSessionTokenFromResponse's
  // doc comment. staff-identity-provider.server.ts reads this header
  // specifically when forwarding a credential to Neon Auth's own admin API.
  if (providerToken) {
    headers.set("x-neon-provider-session", providerToken);
  }

  return {
    ...(options ?? {}),
    headers,
  };
}
