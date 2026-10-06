import { withStaffAuthHeaders } from "@/auth";
import { unwrapServerFnResponse } from "./server-fn-response";
import { dispatchWorkspaceRequest } from "../admin/workspace-request";

type StaffCallOptions = { data?: unknown; headers?: HeadersInit };

/**
 * Every staff server-function call from the browser goes through here:
 *   withStaffAuthHeaders(options ?? {}) → dispatchWorkspaceRequest gate → serverFn(prepared)
 *   → unwrapServerFnResponse. A resolved Response (401/403/404/409/…) THROWS
 *   ServerFnResponseError(body, status). Never reloads the page (poll-safe).
 *
 * TanStack Start resolves -- it does not reject -- when a handler throws a Response, so
 * without the unwrap a denied save reads as success (see server-fn-response.ts).
 *
 * `@/auth` is imported through the alias on purpose: every admin browser fixture aliases
 * it to a stub, so a relative import would pull the real Neon auth client into fixtures.
 */
export async function callStaffServerFn<
  TResult,
  TOptions extends StaffCallOptions = StaffCallOptions,
>(
  serverFn: (options: TOptions & { headers: Headers }) => Promise<TResult> | TResult,
  options?: TOptions,
  isWorkspaceCurrent?: () => boolean,
): Promise<Exclude<Awaited<TResult>, Response>> {
  const result = await unwrapServerFnResponse(
    dispatchWorkspaceRequest(
      () => withStaffAuthHeaders(options ?? ({} as TOptions)),
      (prepared) => serverFn(prepared),
      isWorkspaceCurrent,
    ),
  );
  return result as Exclude<Awaited<TResult>, Response>;
}
