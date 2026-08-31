import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { ANALYTICS_EVENT_NAMES, buildContext, collectUtmParams } from "./events.ts";

// --- taxonomy stays in sync with its own docs -----------------------------

const EXPECTED_EVENT_NAMES = [
  "listing_search",
  "listing_view",
  "listing_share",
  "listing_whatsapp_click",
  "zero_results_notify",
  "estate_view",
  "district_view",
  "transaction_share",
  "transaction_filter",
  "agent_view",
  "agent_whatsapp_click",
  "whatsapp_cta_click",
  "contact_form_submit",
  "valuation_form_submit",
  "mortgage_calculate",
  "mortgage_scenario_save",
  "article_view",
  "video_click",
];

test("the taxonomy has exactly the 18 events the master plan calls for, no more, no fewer", () => {
  assert.equal(ANALYTICS_EVENT_NAMES.length, 18);
  assert.deepEqual([...ANALYTICS_EVENT_NAMES].sort(), [...EXPECTED_EVENT_NAMES].sort());
});

test("every event name is snake_case with no duplicates", () => {
  assert.equal(new Set(ANALYTICS_EVENT_NAMES).size, ANALYTICS_EVENT_NAMES.length);
  for (const name of ANALYTICS_EVENT_NAMES) {
    assert.match(name, /^[a-z]+(_[a-z]+)*$/, `"${name}" must be snake_case`);
  }
});

// --- collectUtmParams / buildContext (pure, no import.meta.env) ----------

test("collectUtmParams returns {} when window is undefined (SSR)", () => {
  assert.deepEqual(collectUtmParams(), {});
});

test("buildContext merges route/utm with whatever the caller passes, without window", () => {
  const context = buildContext({ listingNo: "C024131-6714584-S" });
  assert.equal(context.route, "");
  assert.equal(context.listingNo, "C024131-6714584-S");
  assert.equal("utm" in context, false, "utm key must be omitted, not an empty object");
});

test("buildContext never invents a districtSlug/estateSlug/agentSlug the caller didn't pass", () => {
  const context = buildContext();
  assert.equal("districtSlug" in context, false);
  assert.equal("estateSlug" in context, false);
  assert.equal("agentSlug" in context, false);
});

// --- track() DEV-gating -----------------------------------------------------
//
// track() reads import.meta.env.DEV, which only exists under Vite (same
// constraint documented in src/config/site.test.mjs for whatsappUrl()) -- so
// this slices out just the function body, replaces the one import.meta.env
// reference with a literal, and evaluates it directly rather than importing
// the whole module (which also pulls in React, unneeded for this one check).

const source = readFileSync(new URL("./events.ts", import.meta.url), "utf8");

function loadTrackWithInjectedDev(devValue, calls) {
  const start = source.indexOf("export function track(");
  const end = source.indexOf("\n}\n", start) + 3;
  const body = source
    .slice(start, end)
    .replace("import.meta.env.DEV", String(devValue))
    .replace("export function track", "function track");
  const { outputText } = ts.transpileModule(`${body}\nexports.track = track;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exportsObj = {};
  new Function("exports", "console", outputText)(exportsObj, {
    debug: (...args) => calls.push(args),
  });
  return exportsObj.track;
}

test("track() calls console.debug in DEV, with the event name and merged payload/context", () => {
  const calls = [];
  const track = loadTrackWithInjectedDev(true, calls);
  track(
    { name: "listing_view", payload: { listingNo: "L1", dealType: "sale" } },
    { route: "/property/L1" },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "[analytics]");
  assert.equal(calls[0][1], "listing_view");
  assert.deepEqual(calls[0][2], { listingNo: "L1", dealType: "sale", route: "/property/L1" });
});

test("track() is a real no-op outside DEV -- never calls console.debug", () => {
  const calls = [];
  const track = loadTrackWithInjectedDev(false, calls);
  track(
    { name: "listing_view", payload: { listingNo: "L1", dealType: "sale" } },
    { route: "/property/L1" },
  );
  assert.equal(calls.length, 0);
});

test("no event payload/context field is a name/phone/email -- no PII in the taxonomy source", () => {
  const eventsBlock = source.slice(
    source.indexOf("export interface ListingSearchPayload"),
    source.indexOf("export type AnalyticsEvent"),
  );
  assert.doesNotMatch(eventsBlock, /\b(name|phone|email|whatsapp)\s*:\s*string/i);
});
