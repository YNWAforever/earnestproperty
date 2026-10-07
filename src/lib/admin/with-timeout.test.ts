import { afterEach, describe, expect, test } from "bun:test";

import { BACKGROUND_READ_TIMEOUT_MS, withTimeout } from "./with-timeout";

type PendingTimer = { run: () => void; ms: number };

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

/** Replaces the global timer pair so a test can see, fire and count the helper's one timer. */
function fakeTimers() {
  const pending = new Map<number, PendingTimer>();
  let nextId = 1;
  globalThis.setTimeout = ((run: () => void, ms: number) => {
    const id = nextId++;
    pending.set(id, { run, ms });
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    pending.delete(id);
  }) as unknown as typeof clearTimeout;
  return {
    pending,
    fireAll() {
      for (const [id, timer] of [...pending]) {
        pending.delete(id);
        timer.run();
      }
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

describe("withTimeout", () => {
  test("background reads give up after 30 seconds", () => {
    expect(BACKGROUND_READ_TIMEOUT_MS).toBe(30_000);
  });

  test("passes a value through and clears its timer", async () => {
    const timers = fakeTimers();
    const read = deferred<string>();
    const result = withTimeout(read.promise, 30_000);
    expect([...timers.pending.values()].map((timer) => timer.ms)).toEqual([30_000]);

    read.resolve("合成結果");
    await expect(result).resolves.toBe("合成結果");
    expect(timers.pending.size).toBe(0);
  });

  test("passes a failure through unchanged and clears its timer", async () => {
    const timers = fakeTimers();
    const read = deferred<string>();
    const failure = new Error("合成讀取失敗");
    const result = withTimeout(read.promise, 30_000);

    read.reject(failure);
    await expect(result).rejects.toBe(failure);
    expect(timers.pending.size).toBe(0);
  });

  test("rejects with a TimeoutError when the read hangs, and ignores a late answer", async () => {
    const timers = fakeTimers();
    const read = deferred<string>();
    const result = withTimeout(read.promise, 30_000);

    timers.fireAll();
    const error = await result.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("TimeoutError");

    // A late answer or a late failure settles nothing and surfaces nowhere.
    read.reject(new Error("合成遲來失敗"));
    await Promise.resolve();
    expect(timers.pending.size).toBe(0);
  });

  test("a real hung read settles once the time is up", async () => {
    const error = await withTimeout(new Promise<never>(() => undefined), 5).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect((error as Error).name).toBe("TimeoutError");
  });
});
