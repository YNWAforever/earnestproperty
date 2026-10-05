import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  IDLE_CUTOFF_MS,
  MIN_VISIBLE_INTERVAL_MS,
  startVisibleInterval,
  useVisibleInterval,
  type VisibleIntervalEnv,
} from "./use-visible-interval";

type FakeTimer = { at: number; run: () => void };

type InputType = "pointerdown" | "keydown" | "wheel" | "touchstart";

/** A window stand-in that records its input listeners, so a test can see them added and removed. */
function fakeInput() {
  const listeners = new Map<string, Set<() => void>>();
  const options: { type: string; passive: unknown }[] = [];
  return {
    source: {
      addEventListener(type: InputType, listener: () => void, opts: { passive: true }) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
        options.push({ type, passive: opts?.passive });
      },
      removeEventListener(type: InputType, listener: () => void) {
        listeners.get(type)?.delete(listener);
      },
    },
    options,
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    types: () => [...listeners].filter(([, set]) => set.size > 0).map(([type]) => type),
    dispatch(type: InputType) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
  };
}

function fakeEnv(initial: "visible" | "hidden" = "visible") {
  let time = 0;
  let nextId = 1;
  const timers = new Map<number, FakeTimer>();
  const document = Object.assign(new EventTarget(), { visibilityState: initial as string });
  const input = fakeInput();

  const env: VisibleIntervalEnv = {
    now: () => time,
    setTimeout: (run, ms) => {
      const id = nextId++;
      timers.set(id, { at: time + ms, run });
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
    document,
    input: input.source,
  };

  function dueTimer(limit: number) {
    let found: [number, FakeTimer] | undefined;
    for (const entry of timers) {
      if (entry[1].at <= limit && (!found || entry[1].at < found[1].at)) found = entry;
    }
    return found;
  }

  return {
    env,
    document,
    input,
    now: () => time,
    /** Moves the wall clock without firing timers, as a system clock change would. */
    setNow(next: number) {
      time = next;
    },
    pendingTimers: () => timers.size,
    advance(ms: number) {
      const target = time + ms;
      for (let due = dueTimer(target); due; due = dueTimer(target)) {
        const [id, timer] = due;
        timers.delete(id);
        time = timer.at;
        timer.run();
      }
      time = target;
    },
    setVisibility(state: "visible" | "hidden") {
      document.visibilityState = state;
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("startVisibleInterval", () => {
  test("exposes the 60 second floor", () => {
    expect(MIN_VISIBLE_INTERVAL_MS).toBe(60_000);
  });

  test("does not run on start or while hidden", () => {
    const fake = fakeEnv("hidden");
    let calls = 0;
    const stop = startVisibleInterval(() => void calls++, 60_000, fake.env);

    expect(calls).toBe(0);
    fake.advance(300_000);
    expect(calls).toBe(0);
    stop();
  });

  test("runs every 60 s while visible", () => {
    const fake = fakeEnv();
    const calledAt: number[] = [];
    const stop = startVisibleInterval(() => void calledAt.push(fake.now()), 60_000, fake.env);

    fake.advance(59_999);
    expect(calledAt).toEqual([]);
    fake.advance(180_000 - 59_999);
    expect(calledAt).toEqual([60_000, 120_000, 180_000]);
    stop();
  });

  test("keeps exactly one pending timeout while visible", () => {
    const fake = fakeEnv();
    const stop = startVisibleInterval(() => {}, 60_000, fake.env);

    expect(fake.pendingTimers()).toBe(1);
    fake.advance(60_000);
    expect(fake.pendingTimers()).toBe(1);
    fake.setVisibility("visible");
    expect(fake.pendingTimers()).toBe(1);
    stop();
  });

  test("clamps periods below 60 s, NaN and 0 to 60 s", () => {
    for (const ms of [1_000, 0, Number.NaN]) {
      const fake = fakeEnv();
      let calls = 0;
      const stop = startVisibleInterval(() => void calls++, ms, fake.env);

      fake.advance(59_999);
      expect(calls).toBe(0);
      fake.advance(1);
      expect(calls).toBe(1);
      stop();
    }
  });

  test("honours a period longer than 60 s", () => {
    const fake = fakeEnv();
    const calledAt: number[] = [];
    const stop = startVisibleInterval(() => void calledAt.push(fake.now()), 90_000, fake.env);

    fake.advance(180_000);
    expect(calledAt).toEqual([90_000, 180_000]);
    stop();
  });

  test("pauses while hidden and runs once promptly when visible after a missed tick", () => {
    const fake = fakeEnv();
    const calledAt: number[] = [];
    const stop = startVisibleInterval(() => void calledAt.push(fake.now()), 60_000, fake.env);

    fake.advance(10_000);
    fake.setVisibility("hidden");
    expect(fake.pendingTimers()).toBe(0);
    fake.advance(190_000);
    expect(calledAt).toEqual([]);
    expect(fake.pendingTimers()).toBe(0);

    fake.setVisibility("visible");
    expect(calledAt).toEqual([200_000]);

    fake.advance(59_999);
    expect(calledAt).toEqual([200_000]);
    fake.advance(1);
    expect(calledAt).toEqual([200_000, 260_000]);
    stop();
  });

  test("becoming visible before the next tick is due waits for the remainder", () => {
    const fake = fakeEnv();
    let calls = 0;
    const stop = startVisibleInterval(() => void calls++, 60_000, fake.env);

    fake.advance(10_000);
    fake.setVisibility("hidden");
    fake.advance(20_000);
    fake.setVisibility("visible");
    expect(fake.now()).toBe(30_000);
    expect(calls).toBe(0);

    fake.advance(29_999);
    expect(calls).toBe(0);
    fake.advance(1);
    expect(fake.now()).toBe(60_000);
    expect(calls).toBe(1);
    stop();
  });

  test("a timer that fires while hidden pauses instead of running", () => {
    const fake = fakeEnv();
    let calls = 0;
    const stop = startVisibleInterval(() => void calls++, 60_000, fake.env);

    // Flip the state without dispatching the event, as if the timer won the race.
    fake.document.visibilityState = "hidden";
    fake.advance(300_000);
    expect(calls).toBe(0);
    expect(fake.pendingTimers()).toBe(0);
    stop();
  });

  test("skips ticks while the previous run is still pending", async () => {
    const fake = fakeEnv();
    const run = deferred();
    let calls = 0;
    const stop = startVisibleInterval(
      () => {
        calls++;
        return run.promise;
      },
      60_000,
      fake.env,
    );

    fake.advance(60_000);
    expect(calls).toBe(1);
    fake.advance(60_000);
    expect(calls).toBe(1);
    expect(fake.pendingTimers()).toBe(1);

    run.resolve();
    await Promise.resolve();
    await Promise.resolve();

    fake.advance(60_000);
    expect(calls).toBe(2);
    stop();
  });

  test("a rejected run does not stop polling or raise an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const fake = fakeEnv();
      let calls = 0;
      const stop = startVisibleInterval(
        () => {
          calls++;
          return Promise.reject(new Error("合成失敗"));
        },
        60_000,
        fake.env,
      );

      fake.advance(60_000);
      expect(calls).toBe(1);
      await Promise.resolve();
      await Promise.resolve();
      fake.advance(60_000);
      expect(calls).toBe(2);
      await Promise.resolve();
      await Promise.resolve();
      // Let the runtime's unhandled-rejection check run before asserting.
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      stop();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("a throwing callback keeps the schedule", () => {
    const fake = fakeEnv();
    let calls = 0;
    const stop = startVisibleInterval(
      () => {
        calls++;
        if (calls === 1) throw new Error("合成失敗");
      },
      60_000,
      fake.env,
    );

    expect(() => fake.advance(60_000)).toThrow();
    expect(calls).toBe(1);
    expect(fake.pendingTimers()).toBe(1);

    fake.advance(60_000);
    expect(calls).toBe(2);
    stop();
  });

  test("stop removes the listener and the timer, and late callbacks do nothing", () => {
    const fake = fakeEnv();
    let calls = 0;
    const stop = startVisibleInterval(() => void calls++, 60_000, fake.env);

    stop();
    expect(fake.pendingTimers()).toBe(0);

    fake.setVisibility("hidden");
    fake.setVisibility("visible");
    fake.advance(600_000);
    expect(calls).toBe(0);
    expect(fake.pendingTimers()).toBe(0);
  });
});

describe("startVisibleInterval attended-time cutoff", () => {
  const MINUTE = 60_000;

  test("exposes the 30 minute cutoff", () => {
    expect(IDLE_CUTOFF_MS).toBe(30 * MINUTE);
  });

  test("goes dormant 30 min after the last input even though the tab stays visible", () => {
    const fake = fakeEnv();
    const calledAt: number[] = [];
    const stop = startVisibleInterval(() => void calledAt.push(fake.now()), MINUTE, fake.env);

    fake.advance(120 * MINUTE);
    // Runs at 1..29 min; the tick due at 30 min finds no input for 30 min and stops there.
    expect(calledAt).toEqual(Array.from({ length: 29 }, (_, n) => (n + 1) * MINUTE));
    expect(fake.pendingTimers()).toBe(0);
    stop();
  });

  test("the first input after dormancy runs once at once when due, then resumes the period", () => {
    const fake = fakeEnv();
    const calledAt: number[] = [];
    const stop = startVisibleInterval(() => void calledAt.push(fake.now()), MINUTE, fake.env);
    fake.advance(120 * MINUTE);
    expect(calledAt).toHaveLength(29);

    fake.input.dispatch("pointerdown");
    expect(calledAt).toHaveLength(30);
    expect(calledAt.at(-1)).toBe(120 * MINUTE);
    expect(fake.pendingTimers()).toBe(1);

    // Further input while active adds nothing; the period carries on from the wake-up run.
    fake.input.dispatch("keydown");
    fake.input.dispatch("wheel");
    expect(calledAt).toHaveLength(30);
    fake.advance(MINUTE - 1);
    expect(calledAt).toHaveLength(30);
    fake.advance(1);
    expect(calledAt.at(-1)).toBe(121 * MINUTE);
    stop();
  });

  test("the first input after dormancy waits for the remainder when the next run is not due", () => {
    const fake = fakeEnv();
    let calls = 0;
    const stop = startVisibleInterval(() => void calls++, MINUTE, fake.env);
    fake.advance(40 * MINUTE);
    expect(calls).toBe(29);
    expect(fake.pendingTimers()).toBe(0);

    // The wall clock moved back while dormant (a system clock change): the next run (30 min) is
    // still ahead, so the wake-up schedules the remainder instead of running early.
    fake.setNow(29 * MINUTE + 20_000);
    fake.input.dispatch("touchstart");
    expect(calls).toBe(29);
    expect(fake.pendingTimers()).toBe(1);
    fake.advance(40_000 - 1);
    expect(calls).toBe(29);
    fake.advance(1);
    expect(calls).toBe(30);
    stop();
  });

  test("input while active causes no extra runs and keeps the poll going past 30 min", () => {
    const fake = fakeEnv();
    let calls = 0;
    const stop = startVisibleInterval(() => void calls++, MINUTE, fake.env);

    for (let minute = 0; minute < 90; minute += 1) {
      // Someone works in the tab: several inputs a minute.
      fake.input.dispatch("pointerdown");
      fake.input.dispatch("keydown");
      fake.advance(MINUTE);
    }
    expect(calls).toBe(90);
    expect(fake.pendingTimers()).toBe(1);
    stop();
  });

  test("becoming visible counts as activity", () => {
    const fake = fakeEnv();
    let calls = 0;
    const stop = startVisibleInterval(() => void calls++, MINUTE, fake.env);

    fake.advance(25 * MINUTE + 10_000);
    fake.setVisibility("hidden");
    fake.advance(20 * MINUTE);
    fake.setVisibility("visible");
    expect(calls).toBe(26);

    // 29 more minutes without input still poll: the return to the tab reset the cutoff.
    fake.advance(29 * MINUTE);
    expect(calls).toBe(55);
    fake.advance(10 * MINUTE);
    expect(calls).toBe(55);
    expect(fake.pendingTimers()).toBe(0);
    stop();
  });

  test("an input while dormant and hidden waits for the tab to become visible", () => {
    const fake = fakeEnv();
    let calls = 0;
    const stop = startVisibleInterval(() => void calls++, MINUTE, fake.env);
    fake.advance(40 * MINUTE);
    expect(calls).toBe(29);

    fake.document.visibilityState = "hidden";
    fake.input.dispatch("keydown");
    expect(calls).toBe(29);
    expect(fake.pendingTimers()).toBe(0);
    fake.setVisibility("visible");
    expect(calls).toBe(30);
    stop();
  });

  test("listens for input passively on four event types, and stop() removes those listeners", () => {
    const fake = fakeEnv();
    const stop = startVisibleInterval(() => {}, MINUTE, fake.env);

    expect(fake.input.types().sort()).toEqual(["keydown", "pointerdown", "touchstart", "wheel"]);
    expect(fake.input.options.every((entry) => entry.passive === true)).toBe(true);

    stop();
    expect(fake.input.count()).toBe(0);
  });

  test("nothing runs on start or on input while active, and the 60 s floor still applies", () => {
    const fake = fakeEnv();
    let calls = 0;
    const stop = startVisibleInterval(() => void calls++, 1_000, fake.env);

    fake.input.dispatch("pointerdown");
    expect(calls).toBe(0);
    fake.advance(MINUTE - 1);
    expect(calls).toBe(0);
    fake.advance(1);
    expect(calls).toBe(1);
    stop();
  });
});

describe("useVisibleInterval", () => {
  test("renders on the server without touching document", () => {
    function Probe() {
      useVisibleInterval(() => {}, 1);
      return createElement("p", null, "ok");
    }

    expect(renderToStaticMarkup(createElement(Probe))).toBe("<p>ok</p>");
  });
});
