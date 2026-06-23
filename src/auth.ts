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
  getJWTToken?: () => Promise<string | null>;
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

  const client = authClient as NeonAuthClientWithStaffToken;
  const jwt = await client.getJWTToken?.().catch(() => null);
  if (jwt) return jwt;

  const session = await client.getSession?.().catch(() => null);
  return sessionTokenFromValue(session);
}

export async function withStaffAuthHeaders<TOptions extends ServerFnCallOptions>(
  options?: TOptions,
): Promise<TOptions & { headers: Headers }> {
  const headers = new Headers(options?.headers);
  const token = await readStaffAuthToken();

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return {
    ...(options ?? ({} as TOptions)),
    headers,
  };
}
