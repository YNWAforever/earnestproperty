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
