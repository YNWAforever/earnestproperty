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

test("only known search and AI referrer origins reach GA4, with no path or query", async () => {
  const { createGa4Adapter } = await api();
  for (const [referrer, expected] of [
    ["https://chatgpt.com/c/person@example.com?token=secret#private", "https://chatgpt.com/"],
    ["https://www.google.com.hk/search?q=secret", "https://www.google.com.hk/"],
    ["https://www.perplexity.ai/search/private", "https://www.perplexity.ai/"],
    ["https://gemini.google.com/app/private", "https://gemini.google.com/"],
    ["https://chatgpt.com.evil.example/path", ""],
    ["https://user:pass@chatgpt.com/private", ""],
    ["https://chatgpt.com:8443/private", ""],
    ["http://chatgpt.com/private", ""],
    ["https://unknown.example/private", ""],
    ["not a URL", ""],
  ]) {
    const calls = [];
    const a = createGa4Adapter({
      measurementId: "G-ABCDEFGHIJ",
      documentIsolationApproved: true,
      getPath: () => "/contact",
      getReferrer: () => referrer,
      origin: "https://www.earnestproperty.com",
      gtag: (...args) => calls.push(args),
      load: () => {},
    });
    assert.equal(a.start(), true);
    a.sink({ name: "page_view", payload: {} }, { route: "/contact" });
    assert.equal(calls.find((call) => call[0] === "config")[2].page_referrer, expected);
    assert.equal(calls.at(-1)[2].page_referrer, expected);
    assert.doesNotMatch(JSON.stringify(calls), /person@example|token=secret|\/private|user:pass/);
  }
});

test("SPA page views use the prior sanitized public path as their referrer", async () => {
  const { createGa4Adapter } = await api();
  const calls = [];
  let path = "/contact";
  const a = createGa4Adapter({
    measurementId: "G-ABCDEFGHIJ",
    documentIsolationApproved: true,
    getPath: () => path,
    getReferrer: () => "https://chatgpt.com/c/private",
    origin: "https://www.earnestproperty.com",
    gtag: (...args) => calls.push(args),
    load: () => {},
  });
  a.start();
  a.sink({ name: "page_view", payload: {} }, { route: path });
  path = "/property/secret@example.com";
  a.sink({ name: "page_view", payload: {} }, { route: path });
  assert.equal(calls.at(-1)[2].page_referrer, "https://www.earnestproperty.com/contact");
  path = "/about";
  a.sink({ name: "page_view", payload: {} }, { route: path });
  assert.equal(
    calls.at(-1)[2].page_referrer,
    "https://www.earnestproperty.com/property/:listingNo",
  );
  assert.doesNotMatch(JSON.stringify(calls), /secret@example|\/c\/private/);
});

test("an event emitted before the SPA page view already uses the prior public route", async () => {
  const { createGa4Adapter } = await api();
  const calls = [];
  let path = "/contact";
  const a = createGa4Adapter({
    measurementId: "G-ABCDEFGHIJ",
    documentIsolationApproved: true,
    getPath: () => path,
    getReferrer: () => "https://chatgpt.com/private",
    origin: "https://www.earnestproperty.com",
    gtag: (...args) => calls.push(args),
    load: () => {},
  });
  a.start();
  a.sink({ name: "page_view", payload: {} }, { route: path });
  path = "/estate/bellagio";
  a.sink({ name: "estate_view", payload: { estateSlug: "bellagio" } }, { route: path });
  assert.equal(calls.at(-1)[2].page_referrer, "https://www.earnestproperty.com/contact");
  a.sink({ name: "page_view", payload: {} }, { route: path });
  assert.equal(calls.at(-1)[2].page_referrer, "https://www.earnestproperty.com/contact");
  path = "/estate/sea-crest-villa";
  a.sink({ name: "estate_view", payload: { estateSlug: "sea-crest-villa" } }, { route: path });
  assert.equal(calls.at(-1)[2].page_referrer, "https://www.earnestproperty.com/estate/:slug");
  a.sink({ name: "page_view", payload: {} }, { route: path });
  assert.equal(calls.at(-1)[2].page_referrer, "https://www.earnestproperty.com/estate/:slug");
});

test("the custom first-touch field does not send unapproved referrer hostnames", async () => {
  const { createGa4Adapter } = await api();
  for (const [host, expected] of [
    ["unknown-person.example", undefined],
    ["chatgpt.com", "chatgpt.com"],
  ]) {
    const calls = [];
    const a = createGa4Adapter({
      measurementId: "G-ABCDEFGHIJ",
      documentIsolationApproved: true,
      getPath: () => "/contact",
      getReferrer: () => `https://${host}/private`,
      gtag: (...args) => calls.push(args),
      load: () => {},
    });
    a.start();
    a.sink({ name: "page_view", payload: {} }, { route: "/contact", referrerHost: host });
    assert.equal(calls.at(-1)[2].referrerHost, expected);
    if (!expected) assert.doesNotMatch(JSON.stringify(calls), /unknown-person\.example/);
  }
});

test("a delayed document vital keeps its landing referrer without changing the current page", async () => {
  const { createGa4Adapter } = await api();
  const calls = [];
  let path = "/contact";
  const a = createGa4Adapter({
    measurementId: "G-ABCDEFGHIJ",
    documentIsolationApproved: true,
    getPath: () => path,
    getReferrer: () => "https://chatgpt.com/private",
    origin: "https://www.earnestproperty.com",
    gtag: (...args) => calls.push(args),
    load: () => {},
  });
  a.start();
  a.sink({ name: "page_view", payload: {} }, { route: path });
  path = "/about";
  a.sink({ name: "page_view", payload: {} }, { route: path });
  const setsBeforeVital = calls.filter((call) => call[0] === "set").length;
  a.sink(
    {
      name: "web_vital",
      payload: {
        metric: "CLS",
        value: 0.01,
        delta: 0.01,
        rating: "good",
        metricId: "v6-1234567890123-1234567890",
        device: "mobile",
      },
    },
    { route: "/contact" },
  );
  assert.equal(calls.at(-1)[2].page_location, "https://www.earnestproperty.com/contact");
  assert.equal(calls.at(-1)[2].page_referrer, "https://chatgpt.com/");
  assert.equal(calls.filter((call) => call[0] === "set").length, setsBeforeVital);
  a.sink({ name: "page_view", payload: {} }, { route: path });
  assert.equal(calls.at(-1)[2].page_referrer, "https://www.earnestproperty.com/contact");
});

test("referrer is not read on an unapproved or private document", async () => {
  const { createGa4Adapter } = await api();
  let reads = 0;
  for (const [path, approved] of [
    ["/admin", true],
    ["/contact", false],
  ]) {
    const a = createGa4Adapter({
      measurementId: "G-ABCDEFGHIJ",
      documentIsolationApproved: approved,
      getPath: () => path,
      getReferrer: () => {
        reads++;
        return "https://chatgpt.com/";
      },
      gtag: () => {},
      load: () => {},
    });
    assert.equal(a.start(), false);
  }
  assert.equal(reads, 0);
});
