import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateRunGate, evaluateSourceHealth, median } from "./health.mjs";

const SOURCES = {
  hse28: "28hse_agent_540",
  oldSite: "old_site",
};

function observation(source, index, overrides = {}) {
  const dealType = overrides.dealType ?? (index < 60 ? "sale" : "rent");
  const validationState = overrides.validationState ?? "valid";
  return {
    source,
    externalId: String(index + 1),
    dealType,
    propertyNoNormalized: `P-${index + 1}`,
    fields: dealType === "sale" ? { price: 1_000_000 } : { rent: 10_000 },
    validationState,
    quarantineReasons: validationState === "valid" ? [] : ["fixture_quarantine"],
    ...overrides,
  };
}

function observationsFor(source, { sale, rent, quarantined = 0 }) {
  const rows = [
    ...Array.from({ length: sale }, (_, index) => observation(source, index, { dealType: "sale" })),
    ...Array.from({ length: rent }, (_, offset) =>
      observation(source, sale + offset, { dealType: "rent" }),
    ),
  ];
  for (let index = rows.length - quarantined; index < rows.length; index += 1) {
    rows[index] = {
      ...rows[index],
      validationState: "quarantined",
      quarantineReasons: ["fixture_quarantine"],
    };
  }
  return rows;
}

function healthyResult(source = SOURCES.hse28, overrides = {}) {
  return {
    source,
    identityValid: true,
    robotsAllowed: true,
    paginationComplete: true,
    challengeDetected: false,
    advertisedCounts: { sale: 60, rent: 40 },
    pageCounts: { sale: 3, rent: 2 },
    discovered: 100,
    observations: observationsFor(source, { sale: 60, rent: 40, quarantined: 1 }),
    failures: [{ externalId: "100", code: "parse_failed", detail: "fixture" }],
    diagnostics: [],
    conflictingDuplicateIds: [],
    ...overrides,
  };
}

const history = {
  previousSuccessful: { sale: 62, rent: 39 },
  rollingCounts: [
    { sale: 61, rent: 40 },
    { sale: 60, rent: 41 },
    { sale: 59, rent: 39 },
  ],
};

function gateDecision(source, { healthy = true, baselineRequired = false } = {}) {
  return { source, healthy, baselineRequired, reasons: [] };
}

test("median is deterministic for odd and even histories without mutating input", () => {
  const values = [8, 2, 5];
  assert.equal(median(values), 5);
  assert.deepEqual(values, [8, 2, 5]);
  assert.equal(median([2, 4, 6, 8]), 5);
  assert.equal(median([]), null);
  assert.throws(() => median([1, Number.NaN]), /finite numbers/i);
});

test("healthy source requires complete structure, count floors, and 98 percent parsing", () => {
  const decision = evaluateSourceHealth(healthyResult(), history);

  assert.equal(decision.source, SOURCES.hse28);
  assert.equal(decision.healthy, true);
  assert.equal(decision.baselineRequired, false);
  assert.equal(decision.parseRate, 0.99);
  assert.deepEqual(decision.reasons, []);
});

test("a structurally healthy first run requires a baseline and cannot publish", () => {
  const hse28 = evaluateSourceHealth(healthyResult(), {
    previousSuccessful: null,
    rollingCounts: [],
  });
  const oldSite = gateDecision(SOURCES.oldSite);

  assert.equal(hse28.healthy, true);
  assert.equal(hse28.baselineRequired, true);
  assert.deepEqual(evaluateRunGate({ oldSite, hse28 }), {
    mode: "full",
    mayPublishUpserts: false,
    mayAdvanceInactivity: false,
    reasons: ["28hse_baseline_required"],
  });
});

for (const scenario of [
  {
    name: "zero inventory",
    overrides: {
      advertisedCounts: { sale: 0, rent: 0 },
      discovered: 0,
      observations: [],
      failures: [],
    },
    reason: "zero_inventory",
  },
  { name: "invalid identity", overrides: { identityValid: false }, reason: "identity_invalid" },
  { name: "robots prohibition", overrides: { robotsAllowed: false }, reason: "robots_disallowed" },
  {
    name: "incomplete pagination",
    overrides: { paginationComplete: false },
    reason: "pagination_incomplete",
  },
  {
    name: "access challenge",
    overrides: { challengeDetected: true },
    reason: "challenge_detected",
  },
  {
    name: "parse rate below 98 percent",
    overrides: {
      observations: observationsFor(SOURCES.hse28, { sale: 60, rent: 40, quarantined: 3 }),
    },
    reason: "parse_rate_below_minimum",
  },
  {
    name: "conflicting source identity",
    overrides: { conflictingDuplicateIds: ["123"] },
    reason: "conflicting_duplicate_ids",
  },
]) {
  test(`source health rejects ${scenario.name}`, () => {
    const decision = evaluateSourceHealth(
      healthyResult(SOURCES.hse28, scenario.overrides),
      history,
    );
    assert.equal(decision.healthy, false);
    assert.ok(decision.reasons.includes(scenario.reason));
  });
}

test("exactly 98 percent valid unique discovered identities is healthy", () => {
  const decision = evaluateSourceHealth(
    healthyResult(SOURCES.hse28, {
      observations: observationsFor(SOURCES.hse28, { sale: 60, rent: 40, quarantined: 2 }),
    }),
    history,
  );

  assert.equal(decision.parseRate, 0.98);
  assert.equal(decision.healthy, true);
});

for (const scenario of [
  {
    name: "missing observation",
    mutate(rows) {
      return rows.slice(0, -1);
    },
  },
  {
    name: "extra observation",
    mutate(rows) {
      return [...rows, observation(SOURCES.hse28, 100, { dealType: "sale" })];
    },
  },
  {
    name: "duplicate observation",
    mutate(rows) {
      return [...rows, { ...rows[0] }];
    },
  },
  {
    name: "blank external ID",
    mutate(rows) {
      return [{ ...rows[0], externalId: "   " }, ...rows.slice(1)];
    },
  },
  {
    name: "external ID containing whitespace",
    mutate(rows) {
      return [{ ...rows[0], externalId: "bad id" }, ...rows.slice(1)];
    },
  },
  {
    name: "invalid deal type",
    mutate(rows) {
      return [{ ...rows[0], dealType: "lease" }, ...rows.slice(1)];
    },
  },
]) {
  test(`identity evidence rejects a ${scenario.name}`, () => {
    const rows = observationsFor(SOURCES.hse28, { sale: 60, rent: 40, quarantined: 1 });
    const decision = evaluateSourceHealth(
      healthyResult(SOURCES.hse28, { observations: scenario.mutate(rows) }),
      history,
    );

    assert.equal(decision.healthy, false);
    assert.ok(decision.reasons.includes("identity_evidence_invalid"));
    assert.ok(decision.parseRate >= 0 && decision.parseRate <= 1);
  });
}

test("duplicate valid evidence is excluded from the valid-rate numerator", () => {
  const rows = observationsFor(SOURCES.hse28, { sale: 60, rent: 40, quarantined: 1 });
  const decision = evaluateSourceHealth(
    healthyResult(SOURCES.hse28, { observations: [...rows, { ...rows[0] }] }),
    history,
  );

  assert.equal(decision.parseRate, 0.98);
  assert.equal(decision.healthy, false);
});

test("an extra unique observation cannot increase the valid-rate numerator", () => {
  const rows = observationsFor(SOURCES.hse28, { sale: 60, rent: 40, quarantined: 1 });
  const decision = evaluateSourceHealth(
    healthyResult(SOURCES.hse28, {
      observations: [...rows, observation(SOURCES.hse28, 100, { dealType: "sale" })],
    }),
    history,
  );

  assert.equal(decision.parseRate, 0.99);
  assert.equal(decision.healthy, false);
});

test("a validation-state lie cannot count a malformed core observation as valid", () => {
  const rows = observationsFor(SOURCES.hse28, { sale: 60, rent: 40 });
  rows[0] = {
    ...rows[0],
    propertyNoNormalized: null,
    fields: { price: 0 },
    validationState: "valid",
    quarantineReasons: [],
  };
  const decision = evaluateSourceHealth(
    healthyResult(SOURCES.hse28, { observations: rows }),
    history,
  );

  assert.equal(decision.parseRate, 0.99);
  assert.equal(decision.healthy, true);
});

test("a drop greater than 30 percent fails per deal and combined", () => {
  const decision = evaluateSourceHealth(
    healthyResult(SOURCES.oldSite, {
      advertisedCounts: { sale: 20, rent: 40 },
      discovered: 60,
      observations: observationsFor(SOURCES.oldSite, { sale: 20, rent: 40 }),
      failures: [],
    }),
    {
      previousSuccessful: { sale: 60, rent: 40 },
      rollingCounts: [{ sale: 60, rent: 40 }],
    },
  );

  assert.equal(decision.healthy, false);
  assert.ok(decision.reasons.includes("sale_count_below_floor"));
  assert.ok(decision.reasons.includes("combined_count_below_floor"));
});

test("old-site observations supply deal counts when that adapter has no advertised totals", () => {
  const decision = evaluateSourceHealth(
    healthyResult(SOURCES.oldSite, {
      advertisedCounts: { sale: 0, rent: 0 },
      observations: observationsFor(SOURCES.oldSite, { sale: 60, rent: 40, quarantined: 1 }),
    }),
    {
      previousSuccessful: { sale: 60, rent: 40 },
      rollingCounts: [{ sale: 60, rent: 40 }],
    },
  );

  assert.deepEqual(decision.counts, { sale: 60, rent: 40, combined: 100 });
  assert.equal(decision.healthy, true);
});

test("count floors do not round an observed count upward", () => {
  const below = evaluateSourceHealth(
    healthyResult(SOURCES.hse28, {
      advertisedCounts: { sale: 43, rent: 27 },
      discovered: 70,
      observations: observationsFor(SOURCES.hse28, { sale: 43, rent: 27 }),
    }),
    {
      previousSuccessful: { sale: 60, rent: 39 },
      rollingCounts: [{ sale: 60, rent: 39 }],
    },
  );
  const atOrAbove = evaluateSourceHealth(
    healthyResult(SOURCES.hse28, {
      advertisedCounts: { sale: 42, rent: 28 },
      discovered: 70,
      observations: observationsFor(SOURCES.hse28, { sale: 42, rent: 28 }),
    }),
    {
      previousSuccessful: { sale: 60, rent: 39 },
      rollingCounts: [{ sale: 60, rent: 39 }],
    },
  );

  assert.ok(below.reasons.includes("rent_count_below_floor"));
  assert.equal(atOrAbove.healthy, true);
});

test("the larger previous-run or rolling-median floor wins", () => {
  const decision = evaluateSourceHealth(
    healthyResult(SOURCES.hse28, {
      advertisedCounts: { sale: 69, rent: 31 },
      observations: observationsFor(SOURCES.hse28, { sale: 69, rent: 31 }),
    }),
    {
      previousSuccessful: { sale: 50, rent: 30 },
      rollingCounts: [
        { sale: 100, rent: 30 },
        { sale: 100, rent: 30 },
        { sale: 100, rent: 30 },
      ],
    },
  );

  assert.ok(decision.reasons.includes("sale_count_below_floor"));
});

test("per-deal floors apply only to nonzero historical baselines", () => {
  const decision = evaluateSourceHealth(
    healthyResult(SOURCES.hse28, {
      advertisedCounts: { sale: 0, rent: 70 },
      discovered: 70,
      observations: observationsFor(SOURCES.hse28, { sale: 0, rent: 70 }),
    }),
    {
      previousSuccessful: { sale: 0, rent: 100 },
      rollingCounts: [{ sale: 0, rent: 100 }],
    },
  );

  assert.equal(decision.healthy, true);
  assert.ok(!decision.reasons.includes("sale_count_below_floor"));
});

test("only the last seven successful rolling snapshots affect the median", () => {
  const decision = evaluateSourceHealth(
    healthyResult(SOURCES.hse28, {
      advertisedCounts: { sale: 7, rent: 0 },
      discovered: 7,
      observations: observationsFor(SOURCES.hse28, { sale: 7, rent: 0 }),
    }),
    {
      previousSuccessful: null,
      rollingCounts: [
        { sale: 1_000, rent: 0 },
        { sale: 1_000, rent: 0 },
        { sale: 1_000, rent: 0 },
        ...Array.from({ length: 7 }, () => ({ sale: 10, rent: 0 })),
      ],
    },
  );

  assert.equal(decision.baselineRequired, false);
  assert.equal(decision.healthy, true);
});

test("malformed history is rejected deterministically while empty history means bootstrap", () => {
  const malformed = evaluateSourceHealth(healthyResult(), {
    previousSuccessful: { sale: -1, rent: 40 },
    rollingCounts: [null, { sale: 60, rent: 40 }],
  });
  const empty = evaluateSourceHealth(healthyResult(), {
    previousSuccessful: null,
    rollingCounts: [],
  });

  assert.equal(malformed.healthy, false);
  assert.ok(malformed.reasons.includes("history_invalid"));
  assert.equal(malformed.baselineRequired, false);
  assert.equal(empty.healthy, true);
  assert.equal(empty.baselineRequired, true);
});

test("a zero-inventory snapshot cannot masquerade as successful history", () => {
  const decision = evaluateSourceHealth(healthyResult(), {
    previousSuccessful: { sale: 0, rent: 0 },
    rollingCounts: [],
  });

  assert.equal(decision.healthy, false);
  assert.equal(decision.baselineRequired, true);
  assert.ok(decision.reasons.includes("history_invalid"));
});

test("28Hse failure blocks; old-site failure degrades; two healthy sources run fully", () => {
  const good28 = gateDecision(SOURCES.hse28);
  const bad28 = gateDecision(SOURCES.hse28, { healthy: false });
  const goodOld = gateDecision(SOURCES.oldSite);
  const badOld = gateDecision(SOURCES.oldSite, { healthy: false });

  assert.deepEqual(evaluateRunGate({ oldSite: goodOld, hse28: bad28 }), {
    mode: "blocked",
    mayPublishUpserts: false,
    mayAdvanceInactivity: false,
    reasons: ["28hse_unhealthy"],
  });
  assert.deepEqual(evaluateRunGate({ oldSite: badOld, hse28: good28 }), {
    mode: "degraded",
    mayPublishUpserts: true,
    mayAdvanceInactivity: false,
    reasons: ["old_site_unhealthy"],
  });
  assert.deepEqual(evaluateRunGate({ oldSite: goodOld, hse28: good28 }), {
    mode: "full",
    mayPublishUpserts: true,
    mayAdvanceInactivity: true,
    reasons: [],
  });
});

test("any source awaiting baseline approval suppresses all publication effects", () => {
  const result = evaluateRunGate({
    hse28: gateDecision(SOURCES.hse28, { baselineRequired: true }),
    oldSite: gateDecision(SOURCES.oldSite, { baselineRequired: true }),
  });

  assert.deepEqual(result, {
    mode: "full",
    mayPublishUpserts: false,
    mayAdvanceInactivity: false,
    reasons: ["28hse_baseline_required", "old_site_baseline_required"],
  });
});

test("run gate treats malformed or mislabeled decisions conservatively", () => {
  const good28 = gateDecision(SOURCES.hse28);
  const malformed28 = { source: SOURCES.hse28, healthy: "yes" };
  const mislabeledOld = gateDecision(SOURCES.hse28);

  assert.deepEqual(
    evaluateRunGate({ oldSite: gateDecision(SOURCES.oldSite), hse28: malformed28 }),
    {
      mode: "blocked",
      mayPublishUpserts: false,
      mayAdvanceInactivity: false,
      reasons: ["28hse_decision_invalid"],
    },
  );
  assert.deepEqual(evaluateRunGate({ oldSite: mislabeledOld, hse28: good28 }), {
    mode: "degraded",
    mayPublishUpserts: true,
    mayAdvanceInactivity: false,
    reasons: ["old_site_decision_invalid"],
  });
  assert.deepEqual(evaluateRunGate({}), {
    mode: "blocked",
    mayPublishUpserts: false,
    mayAdvanceInactivity: false,
    reasons: ["28hse_decision_invalid", "old_site_decision_invalid"],
  });
});

test("28Hse cannot replace zero advertised totals with observation counts", () => {
  const decision = evaluateSourceHealth(
    healthyResult(SOURCES.hse28, {
      advertisedCounts: { sale: 0, rent: 0 },
    }),
    history,
  );

  assert.equal(decision.healthy, false);
  assert.ok(decision.reasons.includes("counts_inconsistent"));
});

test("advertised per-deal counts must equal unique observed identities", () => {
  const decision = evaluateSourceHealth(
    healthyResult(SOURCES.hse28, {
      advertisedCounts: { sale: 60, rent: 40 },
      observations: observationsFor(SOURCES.hse28, { sale: 50, rent: 50, quarantined: 1 }),
    }),
    history,
  );

  assert.equal(decision.healthy, false);
  assert.ok(decision.reasons.includes("counts_inconsistent"));
});

test("advertised combined count must equal discovered identity cardinality", () => {
  const decision = evaluateSourceHealth(
    healthyResult(SOURCES.hse28, {
      advertisedCounts: { sale: 60, rent: 40 },
      discovered: 99,
      observations: observationsFor(SOURCES.hse28, { sale: 60, rent: 39, quarantined: 1 }),
    }),
    history,
  );

  assert.equal(decision.healthy, false);
  assert.ok(decision.reasons.includes("counts_inconsistent"));
});

test("old-site zero-total fallback rejects inconsistent identity cardinality", () => {
  const decision = evaluateSourceHealth(
    healthyResult(SOURCES.oldSite, {
      advertisedCounts: { sale: 0, rent: 0 },
      discovered: 99,
      observations: observationsFor(SOURCES.oldSite, { sale: 60, rent: 40, quarantined: 1 }),
    }),
    history,
  );

  assert.equal(decision.healthy, false);
  assert.ok(decision.reasons.includes("counts_inconsistent"));
});

for (const source of [undefined, null, "third_party"]) {
  test(`source health rejects unsupported source ${String(source)}`, () => {
    const result = healthyResult(SOURCES.hse28, { source });
    result.observations = result.observations.map((row) => ({ ...row, source }));
    const decision = evaluateSourceHealth(result, history);

    assert.equal(decision.healthy, false);
    assert.ok(decision.reasons.includes("source_invalid"));
  });
}

for (const scenario of [
  { name: "missing object", pageCounts: undefined },
  { name: "zero sale page", pageCounts: { sale: 0, rent: 2 } },
  { name: "zero rent page", pageCounts: { sale: 3, rent: 0 } },
  { name: "negative page", pageCounts: { sale: -1, rent: 2 } },
  { name: "fractional page", pageCounts: { sale: 3, rent: 1.5 } },
  { name: "string field", pageCounts: { sale: "3", rent: 2 } },
  { name: "malformed value", pageCounts: "3/2" },
]) {
  test(`complete pagination rejects ${scenario.name} evidence`, () => {
    const decision = evaluateSourceHealth(
      healthyResult(SOURCES.hse28, { pageCounts: scenario.pageCounts }),
      history,
    );

    assert.equal(decision.healthy, false);
    assert.ok(decision.reasons.includes("pagination_evidence_invalid"));
  });
}

for (const scenario of [
  { name: "sale numeric string", dealType: "sale", value: "1000000" },
  { name: "rent numeric string", dealType: "rent", value: "10000" },
  { name: "sale boolean", dealType: "sale", value: true },
  { name: "rent boolean", dealType: "rent", value: true },
  { name: "sale infinity", dealType: "sale", value: Number.POSITIVE_INFINITY },
  { name: "rent infinity", dealType: "rent", value: Number.POSITIVE_INFINITY },
  { name: "sale NaN", dealType: "sale", value: Number.NaN },
  { name: "rent NaN", dealType: "rent", value: Number.NaN },
]) {
  test(`${scenario.name} cannot count as a valid core price`, () => {
    const rows = observationsFor(SOURCES.hse28, { sale: 60, rent: 40 });
    const index = scenario.dealType === "sale" ? 0 : 60;
    const fieldName = scenario.dealType === "sale" ? "price" : "rent";
    rows[index] = { ...rows[index], fields: { [fieldName]: scenario.value } };
    const decision = evaluateSourceHealth(
      healthyResult(SOURCES.hse28, { observations: rows, failures: [] }),
      history,
    );

    assert.equal(decision.validDiscovered, 99);
    assert.equal(decision.parseRate, 0.99);
  });
}

test("three malformed core prices fail the 98 percent parse floor", () => {
  const rows = observationsFor(SOURCES.hse28, { sale: 60, rent: 40 });
  for (const index of [0, 1, 60]) {
    const fieldName = rows[index].dealType === "sale" ? "price" : "rent";
    rows[index] = { ...rows[index], fields: { [fieldName]: "100" } };
  }
  const decision = evaluateSourceHealth(
    healthyResult(SOURCES.hse28, { observations: rows, failures: [] }),
    history,
  );

  assert.equal(decision.validDiscovered, 97);
  assert.equal(decision.parseRate, 0.97);
  assert.equal(decision.healthy, false);
  assert.ok(decision.reasons.includes("parse_rate_below_minimum"));
});

test("contradictory healthy decisions with failure reasons are invalid", () => {
  const good28 = gateDecision(SOURCES.hse28);
  const goodOld = gateDecision(SOURCES.oldSite);
  const contradictory28 = { ...good28, reasons: ["identity_invalid"] };
  const contradictoryOld = { ...goodOld, reasons: ["pagination_incomplete"] };

  assert.deepEqual(evaluateRunGate({ oldSite: goodOld, hse28: contradictory28 }), {
    mode: "blocked",
    mayPublishUpserts: false,
    mayAdvanceInactivity: false,
    reasons: ["28hse_decision_invalid"],
  });
  assert.deepEqual(evaluateRunGate({ oldSite: contradictoryOld, hse28: good28 }), {
    mode: "degraded",
    mayPublishUpserts: true,
    mayAdvanceInactivity: false,
    reasons: ["old_site_decision_invalid"],
  });
});

test("run gate accepts the Task 5 brief's minimal source decisions", () => {
  const ok28 = { healthy: true, source: SOURCES.hse28 };
  const bad28 = { healthy: false, source: SOURCES.hse28 };
  const badOld = { healthy: false, source: SOURCES.oldSite };

  assert.equal(evaluateRunGate({ oldSite: badOld, hse28: bad28 }).mode, "blocked");
  assert.deepEqual(evaluateRunGate({ oldSite: badOld, hse28: ok28 }), {
    mode: "degraded",
    mayPublishUpserts: true,
    mayAdvanceInactivity: false,
    reasons: ["old_site_unhealthy"],
  });
});

test("optional health-decision fields are validated when present", () => {
  const invalid28 = {
    source: SOURCES.hse28,
    healthy: true,
    baselineRequired: "false",
  };
  const invalidOld = {
    source: SOURCES.oldSite,
    healthy: false,
    reasons: "identity_invalid",
  };

  assert.deepEqual(evaluateRunGate({ oldSite: gateDecision(SOURCES.oldSite), hse28: invalid28 }), {
    mode: "blocked",
    mayPublishUpserts: false,
    mayAdvanceInactivity: false,
    reasons: ["28hse_decision_invalid"],
  });
  assert.deepEqual(evaluateRunGate({ oldSite: invalidOld, hse28: gateDecision(SOURCES.hse28) }), {
    mode: "degraded",
    mayPublishUpserts: true,
    mayAdvanceInactivity: false,
    reasons: ["old_site_decision_invalid"],
  });
});
