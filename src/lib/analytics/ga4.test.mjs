import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
async function api() {
  assert.ok(existsSync(new URL("./ga4.ts", import.meta.url)), "validated GA4 adapter must exist");
  return import("./ga4.ts");
}
test("blank and malformed GA4 IDs and private routes never load a provider", async () => {
  const { createGa4Adapter } = await api();
  let loads = 0;
  for (const id of ["", undefined, "G-<script>", "UA-123", "G-short"]) {
    const a = createGa4Adapter({
      measurementId: id,
      documentIsolationApproved: true,
      getPath: () => "/contact",
      load: () => loads++,
      gtag: () => {},
    });
    assert.equal(a.start(), false);
  }
  const a = createGa4Adapter({
    measurementId: "G-ABCDEFGHIJ",
    documentIsolationApproved: true,
    getPath: () => "/admin/cms",
    load: () => loads++,
    gtag: () => {},
  });
  assert.equal(a.start(), false);
  assert.equal(loads, 0);
});
test("valid isolated GA4 uses explicit sanitized page fields and no automatic page view", async () => {
  const { createGa4Adapter } = await api();
  const calls = [];
  let loads = 0;
  const a = createGa4Adapter({
    measurementId: "G-ABCDEFGHIJ",
    documentIsolationApproved: true,
    getPath: () => "/contact",
    origin: "https://www.earnest.com.hk",
    load: () => loads++,
    gtag: (...args) => calls.push(args),
  });
  assert.equal(a.start(), true);
  assert.equal(a.start(), true);
  assert.equal(loads, 1);
  assert.equal(calls.find((c) => c[0] === "config")[2].send_page_view, false);
  a.sink(
    { name: "page_view", payload: {} },
    { route: "/property/L1?email=secret@example.com#token" },
  );
  assert.equal(calls.at(-1)[2].page_location, "https://www.earnest.com.hk/property/:listingNo");
  assert.doesNotMatch(JSON.stringify(calls), /secret@example|#token/);
});
test("adapter cannot bypass the single validated boundary with unknown event/PII or private live URL", async () => {
  const { createGa4Adapter } = await api();
  const calls = [];
  let path = "/contact";
  const a = createGa4Adapter({
    measurementId: "G-ABCDEFGHIJ",
    documentIsolationApproved: true,
    getPath: () => path,
    gtag: (...args) => calls.push(args),
    load: () => {},
  });
  a.start();
  const before = calls.length;
  a.sink({ name: "unknown", payload: { email: "person@example.com" } }, { route: "/contact" });
  path = "/account/me";
  a.sink({ name: "page_view", payload: {} }, { route: "/contact" });
  assert.equal(calls.length, before);
});
