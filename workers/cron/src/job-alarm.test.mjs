import assert from "node:assert/strict";
import test from "node:test";

import { JOB_LANES, createJobAlarm, createLaneDrain, sweepLanes } from "./job-alarm.js";

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

test("scheduled() signals both lanes", async () => {
  assert.deepEqual(JOB_LANES, ["service", "general"]);
  const requested = [];
  const swept = { service: 0, general: 0 };
  await sweepLanes((lane) => {
    requested.push(lane);
    return {
      sweep: async () => {
        swept[lane]++;
      },
    };
  });
  assert.deepEqual(requested, ["service", "general"]);
  assert.deepEqual(swept, { service: 1, general: 1 });

  const reports = [];
  let generalSwept = 0;
  await sweepLanes(
    (lane) => ({
      sweep: async () => {
        if (lane === "service") throw new Error("service object unavailable");
        generalSwept++;
      },
    }),
    (code) => reports.push(code),
  );
  assert.equal(generalSwept, 1);
  assert.deepEqual(reports, ["JOB_SWEEP_FAILED:service"]);
});

test("a sweep arms an idle lane in one second without touching failures or generation", async () => {
  const storage = fakeStorage();
  const scheduler = createJobAlarm({ storage, now: () => 1_000, drain: async () => null });
  assert.equal(await storage.getAlarm(), null);
  await scheduler.sweep();
  assert.equal(await storage.getAlarm(), 2_000);
  assert.equal(await storage.get("failures"), undefined);
  assert.equal(await storage.get("generation"), undefined);

  await storage.put("failures", 3);
  await storage.put("generation", 5);
  await storage.deleteAlarm();
  await scheduler.sweep();
  assert.equal(await storage.getAlarm(), 2_000);
  assert.equal(await storage.get("failures"), 3);
  assert.equal(await storage.get("generation"), 5);
});

test("a sweep pulls a far healthy alarm forward", async () => {
  const storage = fakeStorage();
  const scheduler = createJobAlarm({
    storage,
    now: () => 1_000,
    drain: async () => "1970-01-01T00:00:30.000Z",
  });
  await scheduler.signal();
  await scheduler.fire();
  assert.equal(await storage.getAlarm(), 30_000);
  await scheduler.sweep();
  assert.equal(await storage.getAlarm(), 2_000);
});

test("a sweep keeps a failure backoff", async () => {
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
  assert.equal(await storage.get("failures"), 1);
  await scheduler.sweep();
  assert.equal(await storage.getAlarm(), 61_000);
  assert.equal(await storage.get("failures"), 1);
});

test("a sweep re-arms an exhausted lane once per tick, and a success clears the failures", async () => {
  const storage = fakeStorage();
  const reports = [];
  let clock = 1_000;
  let calls = 0;
  let healthy = false;
  const scheduler = createJobAlarm({
    storage,
    now: () => clock,
    drain: async () => {
      calls++;
      if (!healthy) throw new Error("JOB_DRAIN_HTTP_503");
      return null;
    },
    report: (code) => reports.push(code),
  });
  await scheduler.signal();
  for (let attempt = 0; attempt < 7; attempt++) {
    clock = await storage.getAlarm();
    await scheduler.fire();
  }
  assert.equal(calls, 7);
  assert.equal(await storage.getAlarm(), null);
  assert.ok(reports.includes("JOB_DRAIN_FAILED:JOB_DRAIN_HTTP_503"));

  clock += 600_000;
  await scheduler.sweep();
  assert.equal(await storage.getAlarm(), clock + 1_000);
  clock += 1_000;
  await scheduler.fire();
  assert.equal(calls, 8);
  assert.equal(await storage.getAlarm(), null);
  assert.equal(reports.filter((code) => code === "JOB_DRAIN_RETRY_EXHAUSTED").length, 2);

  healthy = true;
  clock += 600_000;
  await scheduler.sweep();
  clock += 1_000;
  await scheduler.fire();
  assert.equal(calls, 9);
  assert.equal(await storage.get("failures"), 0);
  assert.equal(await storage.getAlarm(), null);
});

test("drain refuses redirects so Authorization is never replayed elsewhere", async () => {
  const seen = [];
  const respond = (response) => async (url, init) => {
    seen.push({ url: String(url), init });
    return response();
  };
  const drain = (fetcher, origin = "https://www.earnestproperty.com") =>
    createLaneDrain({ origin, path: "/api/admin/control-plane/worker", secret: "s", fetcher });

  await assert.rejects(
    drain(
      respond(
        () =>
          new Response(null, {
            status: 308,
            headers: { location: "https://elsewhere.example/api/admin/control-plane/worker" },
          }),
      ),
    )(),
    /JOB_DRAIN_REDIRECTED/,
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://www.earnestproperty.com/api/admin/control-plane/worker");
  assert.equal(seen[0].init.method, "POST");
  assert.equal(seen[0].init.redirect, "manual");
  assert.equal(new Headers(seen[0].init.headers).get("authorization"), "Bearer s");

  assert.equal(await drain(respond(() => Response.json({ nextDueAt: null })))(), null);
  assert.equal(seen.at(-1).init.redirect, "manual");
  await assert.rejects(drain(respond(() => Response.json({})))(), /JOB_DRAIN_NEXT_DUE_MISSING/);
  await assert.rejects(
    drain(respond(() => new Response("nope", { status: 503 })))(),
    /JOB_DRAIN_HTTP_503/,
  );

  const before = seen.length;
  for (const origin of ["http://example.com", "https://www.earnestproperty.com/x"]) {
    await assert.rejects(
      drain(
        respond(() => Response.json({ nextDueAt: null })),
        origin,
      )(),
      /JOB_DRAIN_ORIGIN_INVALID/,
    );
  }
  assert.equal(seen.length, before, "an invalid origin is never fetched");
});

test("drain allows plain http only for a loopback app origin", async () => {
  const seen = [];
  const fetcher = async (url) => {
    seen.push(String(url));
    return Response.json({ nextDueAt: null });
  };
  const drain = (origin) =>
    createLaneDrain({ origin, path: "/api/admin/control-plane/worker", secret: "s", fetcher });

  for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
    assert.equal(await drain(origin)(), null, origin);
  }
  assert.deepEqual(seen, [
    "http://localhost:3000/api/admin/control-plane/worker",
    "http://127.0.0.1:3000/api/admin/control-plane/worker",
    "http://[::1]:3000/api/admin/control-plane/worker",
  ]);

  for (const origin of ["http://10.0.0.1", "http://localhost.example.com", "http://0.0.0.0"]) {
    await assert.rejects(drain(origin)(), /JOB_DRAIN_ORIGIN_INVALID/, origin);
  }
  assert.equal(seen.length, 3, "a non-loopback http origin is never fetched");
});
