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
  // however, a credential Neon Auth's own admin API accepts -- no forwardable
  // credential is (Neon's docs: admin operations are cookie-session only), so
  // the server stopped calling that API entirely: identity reads, session
  // revocation and invitations are served from the local neon_auth tables
  // (see staff-lifecycle.server.ts), and the one remaining provider call
  // (request-password-reset) is public.
  const client = authClient as NeonAuthClientWithStaffToken;
  const session = await client.getSession?.().catch(() => null);
  return sessionTokenFromValue(session);
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
  const token = await readStaffAuthToken();

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return {
    ...(options ?? {}),
    headers,
  };
}
