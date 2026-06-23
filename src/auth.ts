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

type NeonAuthClientWithJwt = typeof authClient & {
  getJWTToken?: () => Promise<string | null>;
};

export async function withStaffAuthHeaders<TOptions extends ServerFnCallOptions>(
  options?: TOptions,
): Promise<TOptions & { headers: Headers }> {
  const headers = new Headers(options?.headers);
  const token =
    typeof window === "undefined"
      ? null
      : await (authClient as NeonAuthClientWithJwt).getJWTToken?.();

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return {
    ...(options ?? ({} as TOptions)),
    headers,
  };
}
