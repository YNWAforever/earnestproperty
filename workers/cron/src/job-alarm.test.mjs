import assert from "node:assert/strict";
import test from "node:test";

import { createJobAlarm } from "./job-alarm.js";

function fakeStorage() {
  const values = new Map();
  let alarm = null;
  return {
    get: async (key) => values.get(key),
    put: async (key, value) => values.set(key, value),
    getAlarm: async () => alarm,
    setAlarm: async (at) => {
      alarm = at;
    },
    deleteAlarm: async () => {
      alarm = null;
    },
    transaction: async (run) => run(),
  };
}

test("an idle queue clears its alarm and never schedules another database call", async () => {
  const storage = fakeStorage();
  let calls = 0;
  const scheduler = createJobAlarm({
    storage,
    now: () => 1_000,
    drain: async () => {
      calls++;
      return null;
    },
  });
  await scheduler.signal();
  assert.equal(await storage.getAlarm(), 2_000);
  await scheduler.fire();
  assert.equal(calls, 1);
  assert.equal(await storage.getAlarm(), null);
});

test("the next queued job sets one alarm at its due time", async () => {
  const storage = fakeStorage();
  const scheduler = createJobAlarm({
    storage,
    now: () => 1_000,
    drain: async () => "1970-01-01T00:00:30.000Z",
  });
  await scheduler.signal();
  await scheduler.fire();
  assert.equal(await storage.getAlarm(), 30_000);
  await scheduler.signal();
  assert.equal(await storage.getAlarm(), 2_000);
});

test("a new signal during a drain is not erased by an empty response", async () => {
  const storage = fakeStorage();
  let release;
  const draining = new Promise((resolve) => {
    release = resolve;
  });
  const scheduler = createJobAlarm({ storage, now: () => 1_000, drain: () => draining });
  await scheduler.signal();
  const firing = scheduler.fire();
  await scheduler.signal();
  release(null);
  await firing;
  assert.equal(await storage.getAlarm(), 2_000);
});

test("a failed drain schedules a bounded retry while work may remain", async () => {
  const storage = fakeStorage();
  const scheduler = createJobAlarm({
    storage,
    now: () => 1_000,
    drain: async () => {
      throw new Error("offline");
    },
  });
  await scheduler.signal();
  await scheduler.fire();
  assert.equal(await storage.getAlarm(), 61_000);
});

test("repeated drain failures back off instead of waking Neon every minute", async () => {
  const storage = fakeStorage();
  let clock = 1_000;
  const scheduler = createJobAlarm({
    storage,
    now: () => clock,
    drain: async () => {
      throw new Error("offline");
    },
  });
  await scheduler.signal();
  await scheduler.fire();
  assert.equal(await storage.getAlarm(), 61_000);
  clock = 61_000;
  await scheduler.fire();
  assert.equal(await storage.getAlarm(), 181_000);
});

test("persistent drain failures stop automatic wakes until a new committed signal", async () => {
  const storage = fakeStorage();
  const reports = [];
  let clock = 1_000;
  let calls = 0;
  const scheduler = createJobAlarm({
    storage,
    now: () => clock,
    drain: async () => {
      calls++;
      throw new Error("unavailable");
    },
    report: (code) => reports.push(code),
  });
  await scheduler.signal();
  for (let attempt = 0; attempt < 7; attempt++) {
    const alarm = await storage.getAlarm();
    assert.notEqual(alarm, null, "a retry is expected before the final failure");
    clock = alarm;
    await scheduler.fire();
  }
  assert.equal(calls, 7);
  assert.equal(await storage.getAlarm(), null);
  assert.equal(reports.filter((code) => code === "JOB_DRAIN_RETRY_EXHAUSTED").length, 1);

  await scheduler.signal();
  assert.equal(await storage.getAlarm(), clock + 1_000);
  clock += 1_000;
  await scheduler.fire();
  assert.equal(await storage.getAlarm(), clock + 60_000);
});
