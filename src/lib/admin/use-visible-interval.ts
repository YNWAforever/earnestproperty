import { useEffect, useRef } from "react";

/** Nothing in the admin refreshes faster than this, whatever period a caller asks for. */
export const MIN_VISIBLE_INTERVAL_MS = 60_000;

export type VisibilitySource = {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

export type VisibleIntervalEnv = {
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  document: VisibilitySource;
};

/** Built per call so importing this module never touches `window` or `document` (SSR). */
function defaultEnv(): VisibleIntervalEnv {
  return {
    now: () => Date.now(),
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    document: globalThis.document,
  };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Calls `callback` at most once per period while the document is visible, never on start, and
 * never while a previous run is still unsettled. Returns `stop()`.
 *
 * Timing: the next run is due at `lastRunAt + period`. Hiding the document clears the pending
 * timeout; showing it again runs at once only if that moment has already passed, and otherwise
 * waits for the remainder. A background tab therefore makes no calls, and returning to the tab
 * triggers one refresh rather than a burst.
 */
export function startVisibleInterval(
  callback: () => unknown,
  ms: number,
  env: VisibleIntervalEnv = defaultEnv(),
): () => void {
  const period = Number.isFinite(ms)
    ? Math.max(ms, MIN_VISIBLE_INTERVAL_MS)
    : MIN_VISIBLE_INTERVAL_MS;
  let lastRunAt = env.now();
  let handle: unknown;
  let hasPendingTimer = false;
  let inFlight = false;
  let stopped = false;

  const isHidden = () => env.document.visibilityState === "hidden";

  function clearPendingTimer() {
    if (!hasPendingTimer) return;
    hasPendingTimer = false;
    env.clearTimeout(handle);
    handle = undefined;
  }

  function scheduleIn(delay: number) {
    clearPendingTimer();
    handle = env.setTimeout(onTimer, Math.max(0, delay));
    hasPendingTimer = true;
  }

  function settle() {
    inFlight = false;
  }

  function tick() {
    lastRunAt = env.now();
    // Schedule before running so a throwing callback cannot stop the polling.
    scheduleIn(period);
    if (inFlight) return;
    const result = callback();
    if (isThenable(result)) {
      inFlight = true;
      // Observing both outcomes means a rejection never surfaces as an unhandled rejection;
      // consumers own their own error handling.
      result.then(settle, settle);
    }
  }

  function onTimer() {
    hasPendingTimer = false;
    handle = undefined;
    if (stopped || isHidden()) return;
    tick();
  }

  function onVisibilityChange() {
    if (stopped) return;
    if (isHidden()) {
      clearPendingTimer();
      return;
    }
    const remaining = lastRunAt + period - env.now();
    if (remaining <= 0) tick();
    else scheduleIn(remaining);
  }

  env.document.addEventListener("visibilitychange", onVisibilityChange);
  if (!isHidden()) scheduleIn(period);

  return () => {
    stopped = true;
    clearPendingTimer();
    env.document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

/**
 * Runs `callback` about once a minute while the tab is visible (see `startVisibleInterval`).
 * The latest callback is read through a ref, so passing a new function each render never resets
 * the schedule; only a change of `ms` does. Does nothing on the server.
 */
export function useVisibleInterval(callback: () => void, ms: number): void {
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    // The callback's return value is passed through so a promise from an async callback reaches
    // the single-flight guard.
    return startVisibleInterval(() => latest.current(), ms);
  }, [ms]);
}
