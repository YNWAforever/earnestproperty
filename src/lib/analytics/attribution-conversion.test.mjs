import assert from "node:assert/strict";
import test from "node:test";
import * as events from "./events.ts";
import { captureFirstTouch, ATTRIBUTION_STORAGE_KEY, safePublicPath } from "./attribution.ts";
const id = "11111111-1111-4111-8111-111111111111";
function storage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
}
test("first touch is bounded write-once and never stores query/hash or unapproved campaign values", () => {
  const s = storage();
  const first = captureFirstTouch({
    enabled: true,
    pathname: "/property/customer@example.com?secret=1#x",
    search: "?utm_source=google&utm_campaign=customer@example.com&email=secret",
    referrer: "https://example.org/path?secret=1#x",
    approvedTokens: ["google"],
    storage: s,
  });
  assert.deepEqual(first, {
    landingPath: "/property/:listingNo",
    referrerHost: "example.org",
    utm: { utm_source: "google" },
  });
  assert.deepEqual(
    captureFirstTouch({
      enabled: true,
      pathname: "/contact",
      storage: s,
      approvedTokens: ["google"],
    }),
    first,
  );
  assert.doesNotMatch(s.getItem(ATTRIBUTION_STORAGE_KEY), /secret|customer|@|\?|#/);
});
test("private and disabled attribution never touches storage; corrupt and blocked storage are harmless", () => {
  let calls = 0;
  const bad = {
    getItem: () => {
      calls++;
      throw Error("blocked");
    },
    setItem: () => {
      calls++;
      throw Error("blocked");
    },
    removeItem: () => {
      calls++;
      throw Error("blocked");
    },
  };
  for (const pathname of ["/admin", "/auth/login", "/account/settings", "/%61dmin/cms"])
    assert.equal(captureFirstTouch({ enabled: true, pathname, storage: bad }), null);
  assert.equal(captureFirstTouch({ enabled: false, pathname: "/contact", storage: bad }), null);
  assert.equal(calls, 0);
  assert.doesNotThrow(() =>
    captureFirstTouch({ enabled: true, pathname: "/contact", storage: bad }),
  );
  const s = storage();
  s.setItem(ATTRIBUTION_STORAGE_KEY, "{bad");
  assert.deepEqual(captureFirstTouch({ enabled: true, pathname: "/contact", storage: s }), {
    landingPath: "/contact",
  });
});
test("path classifier excludes private, unknown, encoded and protocol-relative paths", () => {
  for (const path of [
    "/admin",
    "/administer",
    "//evil.example/a",
    "/unknown/person@example.com",
    "/%2561dmin",
    "/auth/login",
    "/api/x",
  ])
    assert.equal(safePublicPath(path), null, path);
  assert.equal(safePublicPath("/listings?q=phone#secret"), "/listings");
});
test("successful conversion emits once per persisted inquiry and survives runtime recreation", () => {
  assert.equal(typeof events.createInquiryConversionTracker, "function");
  const s = storage();
  const sent = [];
  const make = () =>
    events.createInquiryConversionTracker({
      storage: s,
      emit: () => {
        sent.push(1);
        return true;
      },
      getPath: () => "/contact",
      enabled: () => true,
    });
  const track = make();
  assert.equal(track(""), false);
  assert.equal(track(id), true);
  assert.equal(track(id), false);
  assert.equal(make()(id), false);
  assert.equal(sent.length, 1);
});
test("conversion private/disabled and persistence failure produce no event or writes", () => {
  assert.equal(typeof events.createInquiryConversionTracker, "function");
  let writes = 0,
    emits = 0;
  const s = {
    getItem: () => null,
    setItem: () => {
      writes++;
      throw Error("quota");
    },
    removeItem: () => {},
  };
  for (const [enabled, path] of [
    [false, "/contact"],
    [true, "/admin"],
    [true, "/contact"],
  ]) {
    const track = events.createInquiryConversionTracker({
      storage: s,
      emit: () => {
        emits++;
        return true;
      },
      getPath: () => path,
      enabled: () => enabled,
    });
    assert.equal(track(id), false);
  }
  assert.equal(writes, 1);
  assert.equal(emits, 0);
});
test("PII in optional UTM context blocks dispatch rather than being forwarded", () => {
  let calls = 0;
  const d = events.createAnalyticsDispatcher({
    enabled: true,
    sink: () => calls++,
    getPath: () => "/contact",
  });
  assert.equal(
    d.track(
      { name: "contact_form_submit", payload: { hasPhone: true } },
      { route: "/contact", utm: { utm_campaign: "person@example.com" } },
    ),
    false,
  );
  assert.equal(calls, 0);
});

test("buildContext retains original approved campaign instead of rebasing on later URL campaign", () => {
  const s = storage();
  const previousWindow = globalThis.window,
    previousDocument = globalThis.document;
  try {
    globalThis.window = {
      location: { pathname: "/contact", search: "?utm_source=google" },
      sessionStorage: s,
    };
    globalThis.document = { referrer: "" };
    events.configureAnalytics({
      enabled: true,
      sink: () => {},
      approvedCampaignTokens: ["google", "facebook"],
    });
    assert.equal(events.buildContext().utm.utm_source, "google");
    window.location.search = "?utm_source=facebook";
    assert.equal(events.buildContext().utm.utm_source, "google");
  } finally {
    events.configureAnalytics();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test("conversion identity is canonical and corrupt/full ledgers fail closed", () => {
  const s = storage();
  let sent = 0;
  const make = () =>
    events.createInquiryConversionTracker({
      storage: s,
      emit: () => {
        sent++;
        return true;
      },
      getPath: () => "/contact",
      enabled: () => true,
    });
  const identity = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
  const t = make();
  assert.equal(t(identity), true);
  assert.equal(t(identity.toUpperCase()), false);
  assert.equal(sent, 1);
  s.setItem("earnest:analytics:inquiry-conversions:v1", '{"phone":"secret"}');
  assert.equal(make()(id), false);
  assert.equal(sent, 1);
});
