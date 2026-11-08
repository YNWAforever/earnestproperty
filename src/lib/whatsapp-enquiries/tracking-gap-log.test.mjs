import assert from "node:assert/strict";
import test from "node:test";

import {
  GAP_SAMPLE_LIMIT,
  UNPROVISIONED_LOG_INTERVAL_MS,
  classifyTrackingGaps,
  trackingGapLogEntries,
  unprovisionedLogDue,
} from "./tracking-gap-log.mjs";

const covered = (id) => ({ propertyId: id, candidateCount: 1 });
const missing = (id) => ({ propertyId: id, candidateCount: 0 });
const ambiguous = (id, n = 2) => ({ propertyId: id, candidateCount: n });

// Production today: 3 tracking links exist, none is a website:primary sales
// link, so all 629 canonical listings miss. Every property page view used to
// emit one WA_TRACKING_LINK_GAP line for this.
test("a page where nothing is provisioned is classified as unprovisioned, not as a gap", () => {
  const classification = classifyTrackingGaps([missing("a"), missing("b"), missing("c")]);

  assert.equal(classification.total, 3);
  assert.equal(classification.missing.length, 3);
  assert.equal(classification.ambiguous.length, 0);
  assert.equal(classification.unprovisioned, true);

  const entries = trackingGapLogEntries(classification);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].code, "WA_TRACKING_LINKS_UNPROVISIONED");
  assert.equal(entries[0].throttled, true, "an unconfigured site must not log per request");
  assert.equal(entries[0].payload.listings, 3);
  assert.match(String(entries[0].payload.note), /untracked company link/);
});

// The distinction that matters: if ANY listing has a link, a missing one is a
// real regression (lost link, half-finished import) and must always be logged.
test("partial coverage is a gap and is never throttled", () => {
  const classification = classifyTrackingGaps([covered("a"), missing("b")]);

  assert.equal(classification.unprovisioned, false);
  const entries = trackingGapLogEntries(classification);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].code, "WA_TRACKING_LINK_GAP");
  assert.equal(entries[0].throttled, false);
  assert.deepEqual(entries[0].payload.gaps, [{ propertyId: "b", candidateCount: 0 }]);
  assert.equal(entries[0].payload.covered, 1);
});

// More than one usable link means the site picks arbitrarily; that is a data
// integrity problem, not a coverage one.
test("ambiguous candidates are always logged, even alongside a full miss", () => {
  const classification = classifyTrackingGaps([ambiguous("a", 3), missing("b")]);

  assert.equal(
    classification.unprovisioned,
    false,
    "an ambiguous candidate proves provisioning exists",
  );
  const entries = trackingGapLogEntries(classification);
  const codes = entries.map((entry) => entry.code).sort();
  assert.deepEqual(codes, ["WA_TRACKING_LINK_AMBIGUOUS", "WA_TRACKING_LINK_GAP"]);

  const ambiguousEntry = entries.find((entry) => entry.code === "WA_TRACKING_LINK_AMBIGUOUS");
  assert.equal(ambiguousEntry.throttled, false);
  assert.deepEqual(ambiguousEntry.payload.ambiguous, [{ propertyId: "a", candidateCount: 3 }]);
});

test("a fully covered page logs nothing", () => {
  const classification = classifyTrackingGaps([covered("a"), covered("b")]);

  assert.equal(classification.missing.length, 0);
  assert.equal(classification.ambiguous.length, 0);
  assert.equal(classification.unprovisioned, false);
  assert.deepEqual(trackingGapLogEntries(classification), []);
});

// An empty page is not a coverage problem; it is an empty page.
test("an empty candidate list logs nothing", () => {
  const classification = classifyTrackingGaps([]);

  assert.equal(classification.total, 0);
  assert.equal(classification.unprovisioned, false);
  assert.deepEqual(trackingGapLogEntries(classification), []);
});

// The payload goes into a single log line, so it must stay bounded. The sample is
// for eyeballing which listings are affected, not for accounting.
test("the sample is bounded so one log line cannot grow with the page", () => {
  const many = Array.from({ length: GAP_SAMPLE_LIMIT + 25 }, (_, index) => covered(`c${index}`));
  many.push(missing("lost"));
  const entries = trackingGapLogEntries(classifyTrackingGaps(many));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].payload.gaps.length, 1, "only the one missing listing is sampled");

  const ambiguousMany = Array.from({ length: GAP_SAMPLE_LIMIT + 25 }, (_, index) =>
    ambiguous(`a${index}`),
  );
  const ambiguousEntries = trackingGapLogEntries(classifyTrackingGaps(ambiguousMany));
  assert.equal(ambiguousEntries[0].payload.ambiguous.length, GAP_SAMPLE_LIMIT);
});

test("candidate counts arrive as strings from pg and are still classified", () => {
  const classification = classifyTrackingGaps([
    { propertyId: "a", candidateCount: "0" },
    { propertyId: "b", candidateCount: "2" },
  ]);

  assert.equal(classification.missing.length, 1);
  assert.equal(classification.ambiguous.length, 1);
});

test("the unprovisioned line is written once, then rate limited", () => {
  const now = 1_700_000_000_000;

  assert.equal(unprovisionedLogDue(now, 0), true, "never logged on this instance");
  assert.equal(unprovisionedLogDue(now, now - 1), false, "one millisecond later is too soon");
  assert.equal(
    unprovisionedLogDue(now, now - UNPROVISIONED_LOG_INTERVAL_MS),
    true,
    "exactly one interval later is due",
  );
  assert.equal(unprovisionedLogDue(now, now - UNPROVISIONED_LOG_INTERVAL_MS - 1), true);
});

// A shorter interval must be honoured so the behaviour is testable and tunable
// without touching the module constant.
test("the interval is a parameter, not a hardcoded comparison", () => {
  const now = 1_700_000_000_000;
  assert.equal(unprovisionedLogDue(now, now - 5_000, 1_000), true);
  assert.equal(unprovisionedLogDue(now, now - 500, 1_000), false);
});
