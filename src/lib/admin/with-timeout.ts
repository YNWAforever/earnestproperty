/**
 * How long any background read may take before the admin gives up on it. Polling is
 * single-flight, so a read that never settled would otherwise stop every later refresh.
 */
export const BACKGROUND_READ_TIMEOUT_MS = 30_000;

/**
 * Settles like `promise`, or rejects with an Error named "TimeoutError" once `ms` have passed.
 * The timer is cleared as soon as `promise` settles, and an answer that arrives after the
 * timeout is ignored (a late rejection is observed, so it never surfaces as unhandled).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      const error = new Error(`Background read timed out after ${ms} ms`);
      error.name = "TimeoutError";
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
