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

type StaffAuthSession = { actorId: string; token: string };

function staffAuthUnavailable() {
  return new Error("登入服務暫時無法使用，請稍後再試。");
}

async function readStaffAuthSession(): Promise<StaffAuthSession | null> {
  if (typeof window === "undefined") return null;
  const authUrl = import.meta.env.VITE_NEON_AUTH_URL?.replace(/\/$/, "");
  if (!authUrl) throw staffAuthUnavailable();

  // Neon Auth's SDK replaces getSession().data.session.token with a JWT from
  // set-auth-jwt. Staff access requires the opaque token in neon_auth.session
  // so revocation takes effect immediately. Read the unmodified response with
  // the same cookie credentials used by the SDK.
  const response = await fetch(`${authUrl}/get-session`, {
    credentials: "include",
    headers: { accept: "application/json" },
    cache: "no-store",
  }).catch(() => {
    throw staffAuthUnavailable();
  });
  if (response.status === 401) return null;
  if (!response.ok) throw staffAuthUnavailable();

  const raw = await response.json().catch(() => {
    throw staffAuthUnavailable();
  });
  if (raw === null) return null;
  const value = asRecord(raw);
  if (!value) throw staffAuthUnavailable();

  const data = asRecord(value.data) ?? value;
  const actorId = stringToken(asRecord(data.user)?.id);
  const token = sessionTokenFromValue(data);
  if (!actorId && !token) return null;
  if (!actorId || !token) throw staffAuthUnavailable();
  return { actorId, token };
}

async function readStaffAuthToken() {
  return (await readStaffAuthSession())?.token ?? null;
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

/** Read identity and credential from one session snapshot for actor-scoped recovery. */
export async function withStaffUploadIdentity(): Promise<{ actorId: string; headers: Headers }> {
  const session = await readStaffAuthSession();
  if (!session) throw new Error("請重新登入後再上載。");
  const headers = new Headers();
  headers.set("authorization", `Bearer ${session.token}`);
  return { actorId: session.actorId, headers };
}
