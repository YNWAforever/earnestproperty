import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

// The strict dispatcher tests replace the old unvalidated DEV console transport.
test("disabled analytics has no development console transport", () => {
  const source = readFileSync(new URL("./events.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.(debug|log)/);
});
const source = readFileSync(new URL("./events.ts", import.meta.url), "utf8");
test("no event payload/context field is a name/phone/email -- no PII in the taxonomy source", () => {
  const eventsBlock = source.slice(
    source.indexOf("export interface ListingSearchPayload"),
    source.indexOf("export type AnalyticsEvent"),
  );
  assert.doesNotMatch(eventsBlock, /\b(name|phone|email|whatsapp)\s*:\s*string/i);
});
