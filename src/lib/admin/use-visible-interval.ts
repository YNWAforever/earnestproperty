import { useEffect, useRef } from "react";

/** Nothing in the admin refreshes faster than this, whatever period a caller asks for. */
export const MIN_VISIBLE_INTERVAL_MS = 60_000;

/** A poll goes dormant once nobody has used the tab for this long, even while it stays visible. */
export const IDLE_CUTOFF_MS = 30 * 60_000;

export type VisibilitySource = {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

/** The user inputs that count as someone attending the tab. */
export const ATTENDED_INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

export type AttendedInputEvent = (typeof ATTENDED_INPUT_EVENTS)[number];

/** Where user input is heard (the window). Only the moment of an input is kept, never the event. */
export type InputSource = {
  addEventListener(
    type: AttendedInputEvent,
    listener: () => void,
    options: { passive: true },
  ): void;
  removeEventListener(type: AttendedInputEvent, listener: () => void): void;
};

export type VisibleIntervalEnv = {
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  document: VisibilitySource;
  input: InputSource;
};

/** Built per call so importing this module never touches `window` or `document` (SSR). */
function defaultEnv(): VisibleIntervalEnv {
  return {
    now: () => Date.now(),
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    document: globalThis.document,
    input: window,
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
 *
 * Attended time: a visible tab nobody uses (left open overnight) must not keep waking the
 * database. A tick that comes due `IDLE_CUTOFF_MS` or more after the last user input (or the
 * last return to the tab, or the start) neither runs nor reschedules: the poll is dormant. The
 * first input while dormant and visible resumes it by the same rule as becoming visible.
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
  let lastInputAt = lastRunAt;
  let handle: unknown;
  let hasPendingTimer = false;
  let inFlight = false;
  let stopped = false;
  let dormant = false;

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

  /** Runs now if a run is due, otherwise waits for the remainder. */
  function resume() {
    const remaining = lastRunAt + period - env.now();
    if (remaining <= 0) tick();
    else scheduleIn(remaining);
  }

  function onTimer() {
    hasPendingTimer = false;
    handle = undefined;
    if (stopped || isHidden()) return;
    if (env.now() - lastInputAt >= IDLE_CUTOFF_MS) {
      dormant = true;
      return;
    }
    tick();
  }

  function onVisibilityChange() {
    if (stopped) return;
    if (isHidden()) {
      clearPendingTimer();
      return;
    }
    // Returning to the tab is someone attending it.
    lastInputAt = env.now();
    dormant = false;
    resume();
  }

  function onInput() {
    lastInputAt = env.now();
    if (stopped || !dormant || isHidden()) return;
    dormant = false;
    resume();
  }

  env.document.addEventListener("visibilitychange", onVisibilityChange);
  for (const type of ATTENDED_INPUT_EVENTS)
    env.input.addEventListener(type, onInput, { passive: true });
  if (!isHidden()) scheduleIn(period);

  return () => {
    stopped = true;
    clearPendingTimer();
    env.document.removeEventListener("visibilitychange", onVisibilityChange);
    for (const type of ATTENDED_INPUT_EVENTS) env.input.removeEventListener(type, onInput);
  };
}

/**
 * Runs `callback` about once a minute while the tab is visible and attended (see
 * `startVisibleInterval`).
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
