import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
async function runtime() {
  assert.ok(
    existsSync(new URL("./runtime.ts", import.meta.url)),
    "public analytics lifecycle must exist",
  );
  return import("./runtime.ts");
}
test("disabled and private lifecycle creates no storage writes, page events, or vital imports", async () => {
  const { createAnalyticsRuntime } = await runtime();
  let calls = 0;
  let path = "/admin";
  const r = createAnalyticsRuntime({
    enabled: () => true,
    getPath: () => path,
    emit: () => {
      calls++;
      return true;
    },
    storage: {
      getItem: () => {
        calls++;
        return null;
      },
      setItem: () => calls++,
      removeItem: () => calls++,
    },
    loadVitals: async () => {
      calls++;
      return {};
    },
  });
  await r.enter("/admin");
  assert.equal(calls, 0);
  path = "/contact";
  r.disable();
  await r.enter(path);
  assert.equal(calls, 0);
});
test("public SPA page views use safe templates; default keeps document-lifetime vital observers unmounted", async () => {
  const { createAnalyticsRuntime } = await runtime();
  let path = "/contact",
    imports = 0;
  const events = [];
  const r = createAnalyticsRuntime({
    enabled: () => true,
    getPath: () => path,
    emit: (e, c) => {
      events.push([e, c]);
      return true;
    },
    loadVitals: async () => {
      imports++;
      return {};
    },
  });
  await r.enter(path);
  await r.enter(path);
  path = "/property/person@example.com";
  await r.enter(path);
  assert.equal(events.length, 2);
  assert.equal(events[1][1].route, "/property/:listingNo");
  assert.equal(imports, 0);
});
test("explicit isolated-document vitals register once, retain CLS precision, report later lifecycle changes, and suppress after private transition", async () => {
  const { createAnalyticsRuntime } = await runtime();
  let path = "/contact",
    loads = 0;
  const callbacks = {},
    events = [];
  const r = createAnalyticsRuntime({
    enabled: () => true,
    getPath: () => path,
    documentIsolationApproved: true,
    emit: (e, c) => {
      events.push([e, c]);
      return true;
    },
    loadVitals: async () => {
      loads++;
      return Object.fromEntries(
        ["CLS", "LCP", "INP"].map((n) => ["on" + n, (cb) => (callbacks[n] = cb)]),
      );
    },
  });
  await r.enter(path);
  path = "/listings";
  await r.enter(path);
  assert.equal(loads, 1);
  callbacks.CLS({
    name: "CLS",
    value: 0.023,
    delta: 0.023,
    rating: "good",
    id: "v6-1234567890123-1234567890",
  });
  callbacks.CLS({
    name: "CLS",
    value: 0.03,
    delta: 0.007,
    rating: "good",
    id: "v6-1234567890123-1234567890",
  });
  const vitals = events.filter(([e]) => e.name === "web_vital");
  assert.equal(vitals.length, 2);
  assert.equal(vitals[0][0].payload.value, 0.023);
  assert.equal(vitals[0][1].route, "/contact");
  path = "/admin";
  await r.enter(path);
  callbacks.INP({
    name: "INP",
    value: 180,
    delta: 180,
    rating: "good",
    id: "v6-1234567890123-1234567891",
  });
  assert.equal(events.filter(([e]) => e.name === "web_vital").length, 2);
  path = "/contact";
  await r.enter(path);
  callbacks.INP({
    name: "INP",
    value: 200,
    delta: 20,
    rating: "good",
    id: "v6-1234567890123-1234567891",
  });
  assert.equal(events.filter(([e]) => e.name === "web_vital").length, 2);
});
