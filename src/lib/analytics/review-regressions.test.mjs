import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import * as attribution from "./attribution.ts";
import * as privacy from "./privacy.ts";
import { createGa4Adapter } from "./ga4.ts";

test("formatted phone values never cross dispatch or GA4, including approved UTM tokens", () => {
  const calls = [];
  const a = createGa4Adapter({
    measurementId: "G-ABCDEFGHIJ",
    documentIsolationApproved: true,
    getPath: () => "/contact",
    gtag: (...v) => calls.push(v),
    load: () => {},
    approvedTokens: ["852-9123-4567"],
  });
  a.start();
  for (const value of ["9123-4567", "852-9123-4567", "852_9123_4567", "phone-9123-4567"]) {
    a.sink({ name: "whatsapp_cta_click", payload: { source: value } }, { route: "/contact" });
    a.sink({ name: "page_view", payload: {} }, { route: "/contact", listingNo: value });
  }
  assert.equal(
    attribution.safeCampaignParams({ utm_source: "852-9123-4567" }, ["852-9123-4567"]).utm_source,
    undefined,
  );
  assert.equal(calls.filter((c) => c[0] === "event").length, 0);
  assert.equal(attribution.safeToken("estate-phase-2"), true);
});
function hookModule() {
  const pending = [];
  const refs = [];
  let index = 0;
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync(new URL("./events.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  new Function("exports", "require", code)(
    exports,
    (id) =>
      ({
        react: {
          useEffect: (fn) => pending.push(fn),
          useRef: (initial) => refs[index++] ?? (refs[index - 1] = { current: initial }),
        },
        "./attribution.ts": attribution,
        "./privacy.ts": privacy,
      })[id],
  );
  return {
    api: exports,
    mount(build) {
      index = 0;
      exports.useTrackPageView(build, []);
      return pending.shift()();
    },
  };
}
const build = () => ({
  event: { name: "listing_view", payload: { listingNo: "L1", dealType: "sale" } },
  context: { route: "/property/L1" },
});
test("landing child view waits for provider readiness, emits once, and cleans up pending mount", () => {
  const { api, mount } = hookModule();
  const calls = [];
  const cleanup = mount(build);
  assert.equal(calls.length, 0);
  api.configureAnalytics({
    enabled: true,
    getPath: () => "/property/L1",
    sink: (...v) => calls.push(v),
  });
  assert.equal(calls.length, 1);
  api.configureAnalytics({
    enabled: true,
    getPath: () => "/property/L1",
    sink: (...v) => calls.push(v),
  });
  assert.equal(calls.length, 1);
  cleanup?.();
  const other = hookModule();
  const dispose = other.mount(build);
  dispose?.();
  other.api.configureAnalytics({
    enabled: true,
    getPath: () => "/property/L1",
    sink: (...v) => calls.push(v),
  });
  assert.equal(calls.length, 1);
});
test("pending view does not dispatch on a private route when provider becomes ready", () => {
  const { api, mount } = hookModule();
  let calls = 0;
  const cleanup = mount(build);
  api.configureAnalytics({ enabled: true, getPath: () => "/admin/cms", sink: () => calls++ });
  assert.equal(calls, 0);
  cleanup?.();
});
