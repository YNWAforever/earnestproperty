import test from "node:test";
import assert from "node:assert/strict";
const m = () => import("./withdrawal-review.mjs");
const now = Date.parse("2026-10-01T06:00:00Z");
const snapshots = [
  { full: true, missing: true, covered: true, collectedAt: "2026-10-01T02:00:00Z" },
  { full: true, missing: true, covered: true, collectedAt: "2026-09-30T01:00:00Z" },
];
const evidence = {
  source: "28hse_agent_540",
  kind: "absence",
  status: "active",
  snapshots,
  failedBetween: false,
  otherActiveSources: [],
  protected: false,
  currentPresent: false,
};
test("132 historical missing advertisements cannot authorize automatic withdrawal", async () => {
  const { evaluateWithdrawalEvidence } = await m();
  const rows = Array.from({ length: 132 }, () =>
    evaluateWithdrawalEvidence(
      { ...evidence, kind: "historical_absence", snapshots: [snapshots[0]] },
      now,
    ),
  );
  assert.ok(rows.every((r) => r.allowed === false && r.approval === "NOT_APPROVED"));
});
test("absence needs two complete observations 24h apart no failed interval and fresh collection", async () => {
  const { evaluateWithdrawalEvidence: f } = await m();
  assert.equal(f(evidence, now).allowed, true);
  for (const patch of [
    { failedBetween: true },
    { snapshots: [snapshots[0]] },
    { snapshots: [snapshots[0], { ...snapshots[1], covered: false }] },
    { snapshots: [snapshots[0], { ...snapshots[1], collectedAt: "2026-09-30T04:00:00Z" }] },
    { currentPresent: true },
    { protected: true },
    { otherActiveSources: ["propertyhk"] },
    { status: "draft" },
  ])
    assert.equal(f({ ...evidence, ...patch }, now).allowed, false);
  assert.equal(f(evidence, now + 40 * 3600000).allowed, false);
  assert.equal(f({ ...evidence, source: "propertyhk" }, now).allowed, false);
});
test("explicit terminal and source disagreement remain distinct from inferred missing", async () => {
  const { evaluateWithdrawalEvidence: f } = await m();
  assert.equal(
    f({ ...evidence, kind: "explicit_terminal", currentPresent: true, terminalReason: "sold" }, now)
      .allowed,
    true,
  );
  assert.equal(
    f({ ...evidence, kind: "explicit_terminal", terminalReason: null }, now).allowed,
    false,
  );
  assert.equal(
    f(
      {
        ...evidence,
        kind: "explicit_terminal",
        terminalReason: "sold",
        otherActiveSources: ["propertyhk"],
      },
      now,
    ).reason,
    "active_source_conflict",
  );
});

test("invalid duplicate oversized selection and agent escalation stop before DB access", async () => {
  const { previewWithdrawals } = await m();
  const actor = { staffId: "10000000-0000-0000-0000-000000000001", roles: ["manager"] };
  let queries = 0;
  const client = { query: () => queries++ };
  for (const ids of [
    [],
    [actor.staffId, actor.staffId],
    Array.from({ length: 101 }, () => actor.staffId),
  ])
    await assert.rejects(
      previewWithdrawals({ client, actor, source: "28hse_agent_540", candidateIds: ids }),
      /INVALID/,
    );
  await assert.rejects(
    previewWithdrawals({
      client,
      actor: { ...actor, roles: ["agent"] },
      source: "28hse_agent_540",
      candidateIds: [actor.staffId],
    }),
    /FORBIDDEN/,
  );
  assert.equal(queries, 0);
});

test("candidate pagination never includes the lookahead row on the current page", async () => {
  const { listWithdrawalCandidates } = await m();
  const actor = { staffId: "10000000-0000-0000-0000-000000000001", roles: ["manager"] };
  const row = (n) => ({
    id: `20000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
    title_zh: "候選",
    status: "active",
    property_no: `A${n}`,
    deal_type: "sale",
    version: "v1",
    states: [],
    protected: false,
    latest_present: false,
    prior_present: false,
  });
  const client = {
    query: async (sql) => ({
      rows: sql.includes("FROM staff_users")
        ? [{ ok: 1 }]
        : sql.includes("FROM properties p")
          ? [row(1), row(2), row(3)]
          : [],
    }),
  };
  const result = await listWithdrawalCandidates({
    client,
    actor,
    source: "28hse_agent_540",
    limit: 2,
    now,
  });
  assert.deepEqual(
    result.rows.map((r) => r.candidateId),
    [row(1).id, row(2).id],
  );
  assert.equal(result.nextCursor, row(2).id);
  // Filtering current observations must not pull the lookahead record into this page.
  client.query = async (sql) => ({
    rows: sql.includes("FROM staff_users")
      ? [{ ok: 1 }]
      : sql.includes("FROM properties p")
        ? [{ ...row(1), latest_present: true }, row(2), row(3)]
        : [],
  });
  const filtered = await listWithdrawalCandidates({
    client,
    actor,
    source: "28hse_agent_540",
    limit: 2,
    now,
  });
  assert.deepEqual(
    filtered.rows.map((r) => r.candidateId),
    [row(2).id],
  );
  assert.equal(filtered.nextCursor, row(2).id);
});

test("actual failure-interval SQL rejects failed or unresolved observations without blocking unrelated history", async (t) => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { listWithdrawalCandidates } = await m();
  const db = new PGlite();
  const actor = { staffId: "10000000-0000-0000-0000-000000000001", roles: ["manager"] };
  const receipts = snapshots.map((r, i) => ({
    id: "receipt-" + i,
    scraped_at: r.collectedAt,
    accepted_at: new Date(Date.parse(r.collectedAt) + 10 * 60000).toISOString(),
    covered: true,
    payload_hash: "a".repeat(64),
  }));
  const candidate = {
    id: "20000000-0000-0000-0000-000000000001",
    title_zh: "合成候選",
    status: "active",
    property_no: "FIXTURE-1",
    deal_type: "sale",
    version: "v1",
    states: [],
    protected: false,
    latest_present: false,
    prior_present: false,
  };
  const cases = [
    {
      name: "definite rejected dispatch with no stages",
      started: "2026-10-01T03:00:00Z",
      finished: "2026-10-01T03:01:00Z",
      dispatch: "failed",
      stages: {},
      allowed: false,
    },
    {
      name: "failed run crosses the first observation boundary",
      started: "2026-09-30T00:30:00Z",
      finished: "2026-09-30T01:01:00Z",
      dispatch: "accepted",
      stages: { collection: { status: "failed" } },
      allowed: false,
    },
    {
      name: "older unresolved run still overlaps the observation interval",
      started: "2026-09-29T01:00:00Z",
      finished: null,
      dispatch: "unknown",
      stages: {},
      allowed: false,
    },
    {
      name: "failure between collection and delayed receipt acceptance",
      started: "2026-09-30T01:02:00Z",
      finished: "2026-09-30T01:05:00Z",
      dispatch: "accepted",
      stages: { ingestion: { status: "failed" } },
      allowed: false,
    },
    {
      name: "fully finished failure before both observations is outside the interval",
      started: "2026-09-29T22:00:00Z",
      finished: "2026-09-30T00:55:00Z",
      dispatch: "failed",
      stages: {},
      allowed: true,
    },
    {
      name: "another source failure cannot block this scope",
      source: "propertyhk",
      started: "2026-10-01T03:00:00Z",
      finished: "2026-10-01T03:01:00Z",
      dispatch: "failed",
      stages: {},
      allowed: true,
    },
  ];
  try {
    await db.exec(
      "CREATE TABLE property_sync_runs(id text,source text,stages jsonb,dispatch_status text,started_at timestamptz,finished_at timestamptz)",
    );
    const client = {
      query: async (sql, params) => {
        if (sql.includes("FROM property_sync_runs WHERE source=$1")) return db.query(sql, params);
        if (sql.includes("FROM staff_users")) return { rows: [{ ok: 1 }] };
        if (sql.includes("FROM mls_ingestion_receipts r")) return { rows: receipts };
        if (sql.includes("FROM mls_ingestion_scopes")) return { rows: [] };
        if (sql.includes("FROM properties p")) return { rows: [candidate] };
        throw Error("Unexpected fixture SQL");
      },
    };
    assert.equal(
      (await listWithdrawalCandidates({ client, actor, source: "28hse_agent_540", now })).rows[0]
        .decision.allowed,
      true,
    );
    for (const entry of cases)
      await t.test(entry.name, async () => {
        await db.exec("DELETE FROM property_sync_runs");
        await db.query("INSERT INTO property_sync_runs VALUES($1,$2,$3,$4,$5,$6)", [
          "synthetic-failure",
          entry.source ?? "28hse_agent_540",
          JSON.stringify(entry.stages),
          entry.dispatch,
          entry.started,
          entry.finished,
        ]);
        const result = await listWithdrawalCandidates({
          client,
          actor,
          source: "28hse_agent_540",
          now,
        });
        assert.equal(result.rows[0].decision.allowed, entry.allowed);
        if (!entry.allowed)
          assert.equal(result.rows[0].decision.reason, "failed_or_unknown_interval");
      });
  } finally {
    await db.close();
  }
});
