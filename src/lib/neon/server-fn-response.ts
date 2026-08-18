/**
 * TanStack Start RESOLVES -- it does not reject -- when a server function
 * handler throws a `Response`.
 *
 * Traced through the installed packages:
 *   - @tanstack/start-server-core/src/server-functions-handler.ts: a thrown
 *     Response lands in `res.error`, and `const unwrapped = res.result ||
 *     res.error` cannot distinguish it from one the handler deliberately
 *     returned. Either way it sets `x-tss-raw-response: true` and returns it
 *     (see the `unwrapped instanceof Response` branch).
 *   - @tanstack/start-client-core/src/client-rpc/serverFnFetcher.ts: the
 *     `X_TSS_RAW_RESPONSE` check returns that response immediately, BEFORE the
 *     content-type / `.ok` / status handling further down.
 *
 * So `await someServerFn(...)` resolves with a `Response` object whenever the
 * handler rejected the call -- an expired session, a missing permission, a
 * not-found row, a serialization conflict. Two consequences, both bad:
 *
 *   1. `try { await fn(); toast.success(...) } catch {...}` reports SUCCESS on a
 *      change the database never applied.
 *   2. Client code that branches on `error instanceof Response` inside a `catch`
 *      is unreachable, because nothing was ever thrown.
 *
 * Unwrapping at the boundary converts that resolved Response into a genuinely
 * thrown error carrying its status, so the try/catch every caller already writes
 * does the right thing with no caller changes.
 *
 * The status is preserved as a property rather than re-derived from the body,
 * because body text is prose that drifts; `status` is the contract.
 */
export class ServerFnResponseError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ServerFnResponseError";
    this.status = status;
  }
}

/**
 * Convert a server function result that is actually a rejected `Response` into a
 * thrown {@link ServerFnResponseError}. Pass-through for genuine results.
 *
 * Exported for direct unit testing: `createServerFn`'s client/server split (and
 * therefore this resolve-not-reject behaviour) only exists after Vite's
 * build-time macro transform, so calling the `*Server` stubs in a plain test
 * process does not reproduce it.
 */
export async function unwrapServerFnResponse<T>(promise: Promise<T>): Promise<T> {
  const result = await promise;
  if (result instanceof Response) {
    const text = (await result.text().catch(() => "")).trim();
    throw new ServerFnResponseError(text || `HTTP ${result.status}`, result.status);
  }
  return result;
}
