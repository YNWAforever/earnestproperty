import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MIN_VISIBLE_INTERVAL_MS,
  startVisibleInterval,
  useVisibleInterval,
  type VisibleIntervalEnv,
} from "./use-visible-interval";

type FakeTimer = { at: number; run: () => void };

function fakeEnv(initial: "visible" | "hidden" = "visible") {
  let time = 0;
  let nextId = 1;
  const timers = new Map<number, FakeTimer>();
  const document = Object.assign(new EventTarget(), { visibilityState: initial as string });

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
    now: () => time,
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

describe("useVisibleInterval", () => {
  test("renders on the server without touching document", () => {
    function Probe() {
      useVisibleInterval(() => {}, 1);
      return createElement("p", null, "ok");
    }

    expect(renderToStaticMarkup(createElement(Probe))).toBe("<p>ok</p>");
  });
});
