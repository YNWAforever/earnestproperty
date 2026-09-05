import assert from "node:assert/strict";
import test from "node:test";
import * as analytics from "./events.ts";

test("dispatch boundary rejects unknown keys and PII even in development", () => {
  assert.equal(
    typeof analytics.createAnalyticsDispatcher,
    "function",
    "strict dispatcher must exist",
  );
  const calls = [];
  const d = analytics.createAnalyticsDispatcher({
    enabled: true,
    sink: (e, c) => calls.push([e, c]),
    getPath: () => "/contact",
  });
  for (const e of [
    { name: "made_up", payload: {} },
    { name: "contact_form_submit", payload: { hasPhone: true, email: "person@example.com" } },
    { name: "listing_view", payload: { listingNo: "91234567", dealType: "sale" } },
  ])
    assert.equal(d.track(e, { route: "/contact" }), false);
  assert.equal(calls.length, 0);
});
test("valid events preserve taxonomy and strip query/hash route data", () => {
  assert.equal(typeof analytics.createAnalyticsDispatcher, "function");
  const calls = [];
  const d = analytics.createAnalyticsDispatcher({
    enabled: true,
    sink: (...a) => calls.push(a),
    getPath: () => "/property/L1",
  });
  assert.equal(
    d.track(
      { name: "listing_view", payload: { listingNo: "L1", dealType: "sale" } },
      { route: "/property/person@example.com?token=secret#x" },
    ),
    true,
  );
  assert.equal(calls[0][1].route, "/property/:listingNo");
});
test("disabled invalid configuration and live private route block all dispatch", () => {
  assert.equal(typeof analytics.createAnalyticsDispatcher, "function");
  let calls = 0;
  let path = "/contact";
  for (const config of [
    {},
    { enabled: "true", sink: () => calls++ },
    { enabled: true, sink: "invalid" },
  ])
    analytics
      .createAnalyticsDispatcher({ ...config, getPath: () => path })
      .track({ name: "contact_form_submit", payload: { hasPhone: true } }, { route: "/contact" });
  const d = analytics.createAnalyticsDispatcher({
    enabled: true,
    sink: () => calls++,
    getPath: () => path,
  });
  for (const privatePath of [
    "/admin",
    "/admin/cms",
    "/auth/login",
    "/account/me",
    "/%61dmin/team",
    "/api/x",
  ]) {
    path = privatePath;
    assert.equal(
      d.track({ name: "contact_form_submit", payload: { hasPhone: true } }, { route: "/contact" }),
      false,
    );
  }
  assert.equal(calls, 0);
});
test("throwing and rejecting sinks cannot break user action", async () => {
  assert.equal(typeof analytics.createAnalyticsDispatcher, "function");
  for (const sink of [
    () => {
      throw Error("offline");
    },
    () => Promise.reject(Error("offline")),
  ]) {
    const d = analytics.createAnalyticsDispatcher({
      enabled: true,
      sink,
      getPath: () => "/contact",
    });
    assert.doesNotThrow(() =>
      d.track({ name: "contact_form_submit", payload: { hasPhone: true } }, { route: "/contact" }),
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("approved current video category taxonomy remains measurable without allowing free text", () => {
  const calls = [];
  const d = analytics.createAnalyticsDispatcher({
    enabled: true,
    sink: (...args) => calls.push(args),
    getPath: () => "/videos",
  });
  assert.equal(
    d.track(
      { name: "video_click", payload: { videoId: "abc123", category: "屋苑開箱" } },
      { route: "/videos" },
    ),
    true,
  );
  assert.equal(
    d.track(
      { name: "video_click", payload: { videoId: "abc123", category: "客戶私人內容" } },
      { route: "/videos" },
    ),
    false,
  );
  assert.equal(calls.length, 1);
});

test("public UUID transaction identities are allowed while phone-shaped listing dimensions remain denied", () => {
  const d = analytics.createAnalyticsDispatcher({
    enabled: true,
    sink: () => {},
    getPath: () => "/transactions",
  });
  assert.equal(
    d.track(
      {
        name: "transaction_share",
        payload: { transactionId: "12345678-1234-4123-8123-123456789012" },
      },
      { route: "/transactions" },
    ),
    true,
  );
  assert.equal(
    d.track({ name: "listing_share", payload: { listingNo: "91234567" } }, { route: "/listings" }),
    false,
  );
});
