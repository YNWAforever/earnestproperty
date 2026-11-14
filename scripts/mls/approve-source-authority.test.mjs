import assert from "node:assert/strict";
import test from "node:test";
import { approveSourceAuthority } from "./approve-source-authority.mjs";
import {
  hashPayload,
  POLICY_VERSION,
  SnapshotError,
} from "../../src/lib/mls/ingestion-contract.mjs";
import { SOURCE_28HSE } from "../../src/lib/mls/source-contract.mjs";
import { SOURCE_AUTHORITY_POLICY } from "../../src/lib/mls/source-authority-policy.mjs";

const APPROVAL = "USER-20261114:reviewed-property-authority";
const desired = (approval_ref = APPROVAL) => ({
  version: SOURCE_AUTHORITY_POLICY,
  approved: true,
  approval_ref,
});
function policy(overrides = {}) {
  return {
    source: SOURCE_28HSE,
    scope_id: "agent:540",
    policy_version: POLICY_VERSION,
    parser_version: "python-v2.2",
    owner: POLICY_VERSION,
    publish_enabled: true,
    config: {
      unrelated: { keep: ["one", "two"], enabled: true },
      company_number_identity: { version: "company-number-v1", approved: true },
    },
    ...overrides,
  };
}
function database(initial = policy(), { failAt, failRollback = false } = {}) {
  const state = { policy: structuredClone(initial), audits: [], calls: [], transaction: null };
  const failure = Error("OFFLINE_SQL_FAILURE");
  let failureRaised = false;
  const client = {
    query: async (sql, params = []) => {
      state.calls.push({ sql, params: structuredClone(params) });
      if (failAt?.test(sql) && !failureRaised) {
        failureRaised = true;
        throw failure;
      }
      if (/^BEGIN/.test(sql)) {
        assert.equal(state.transaction, null);
        state.transaction = structuredClone({ policy: state.policy, audits: state.audits });
        return { rows: [] };
      }
      if (sql === "ROLLBACK") {
        if (failRollback) throw Error("OFFLINE_ROLLBACK_FAILURE");
        if (state.transaction) {
          state.policy = state.transaction.policy;
          state.audits = state.transaction.audits;
        }
        state.transaction = null;
        return { rows: [] };
      }
      if (sql === "COMMIT") {
        state.transaction = null;
        return { rows: [] };
      }
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (/^SELECT \* FROM mls_ingestion_policies/.test(sql)) {
        assert.deepEqual(params, [SOURCE_28HSE, "agent:540", POLICY_VERSION]);
        return { rows: state.policy ? [structuredClone(state.policy)] : [] };
      }
      if (/^INSERT INTO audit_logs/.test(sql)) {
        assert.equal(params[0], SOURCE_AUTHORITY_POLICY);
        state.audits.push(JSON.parse(params[1]));
        return { rows: [] };
      }
      if (/^UPDATE mls_ingestion_policies/.test(sql)) {
        assert.match(
          sql,
          /config=jsonb_set\(coalesce\(config,'\{\}'::jsonb\),'\{source_authority\}',\$4::jsonb\)/,
        );
        assert.deepEqual(params.slice(0, 3), [SOURCE_28HSE, "agent:540", POLICY_VERSION]);
        state.policy.config = { ...state.policy.config, source_authority: JSON.parse(params[3]) };
        return { rows: [], rowCount: 1 };
      }
      throw Error("UNEXPECTED_OFFLINE_QUERY");
    },
  };
  return { client, state, failure };
}
const updates = (state) => state.calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)/.test(sql));

test("default approval preview uses a read-only transaction and returns the full configuration review hash", async () => {
  const db = database();
  const before = structuredClone(db.state.policy);
  const result = await approveSourceAuthority(db.client, { approvalRef: APPROVAL });
  assert.deepEqual(result, {
    dryRun: true,
    scopeId: "agent:540",
    policy: SOURCE_AUTHORITY_POLICY,
    approvalRef: APPROVAL,
    configHash: hashPayload(before.config),
    changed: true,
  });
  assert.equal(db.state.calls[0].sql, "BEGIN READ ONLY");
  assert.equal(db.state.calls.at(-1).sql, "ROLLBACK");
  assert.ok(
    !db.state.calls.some(({ sql }) => sql.includes("FOR UPDATE") || sql.includes("advisory")),
  );
  assert.deepEqual(updates(db.state), []);
  assert.deepEqual(db.state.policy, before);
  assert.deepEqual(db.state.audits, []);
});

for (const value of [
  undefined,
  null,
  "",
  " ",
  false,
  0,
  "a".repeat(161),
  "review\nforged",
  "review';DROP TABLE properties;--",
])
  test(
    "invalid approval reference is rejected before any SQL: " + JSON.stringify(value),
    async () => {
      const db = database();
      await assert.rejects(
        approveSourceAuthority(db.client, {
          approvalRef: value,
          apply: true,
          expectedConfigHash: "a".repeat(64),
        }),
        (error) =>
          error instanceof SnapshotError &&
          error.code === "invalid_source_authority_policy" &&
          error.status === 503,
      );
      assert.deepEqual(db.state.calls, []);
    },
  );

for (const expectedConfigHash of [
  undefined,
  "",
  "wrong",
  "A".repeat(64),
  "a".repeat(63),
  "a".repeat(65),
])
  test(
    "apply requires an exact bounded lowercase review hash before SQL: " +
      String(expectedConfigHash),
    async () => {
      const db = database();
      await assert.rejects(
        approveSourceAuthority(db.client, {
          approvalRef: APPROVAL,
          apply: true,
          expectedConfigHash,
        }),
        /SOURCE_AUTHORITY_REVIEW_HASH_REQUIRED/,
      );
      assert.deepEqual(db.state.calls, []);
    },
  );

for (const [name, row] of [
  ["missing policy", null],
  ["disabled owner", policy({ owner: "disabled" })],
  ["legacy owner", policy({ owner: "legacy" })],
  ["publishing off", policy({ publish_enabled: false })],
])
  for (const apply of [false, true])
    test(
      (apply ? "apply" : "preview") + " rejects " + name + " without audit or policy update",
      async () => {
        const db = database(row);
        const before = structuredClone(row);
        await assert.rejects(
          approveSourceAuthority(db.client, {
            approvalRef: APPROVAL,
            apply,
            expectedConfigHash: hashPayload(row?.config ?? {}),
          }),
          /SOURCE_AUTHORITY_NATIVE_PUBLISHING_REQUIRED/,
        );
        assert.equal(db.state.calls.at(-1).sql, "ROLLBACK");
        assert.deepEqual(updates(db.state), []);
        assert.deepEqual(db.state.audits, []);
        assert.deepEqual(db.state.policy, before);
      },
    );

test("apply under the exact reviewed hash audits the complete before image before changing only source_authority", async () => {
  const db = database();
  const before = structuredClone(db.state.policy);
  const expectedConfigHash = hashPayload(before.config);
  const result = await approveSourceAuthority(db.client, {
    approvalRef: APPROVAL,
    apply: true,
    expectedConfigHash,
  });
  assert.equal(result.dryRun, false);
  assert.equal(result.changed, true);
  assert.equal(db.state.calls[0].sql, "BEGIN");
  assert.ok(db.state.calls.some(({ sql }) => sql.includes("pg_advisory_xact_lock")));
  assert.ok(
    db.state.calls.some(
      ({ sql }) =>
        /^SELECT \* FROM mls_ingestion_policies/.test(sql) && sql.endsWith(" FOR UPDATE"),
    ),
  );
  const auditIndex = db.state.calls.findIndex(({ sql }) => /^INSERT INTO audit_logs/.test(sql));
  const updateIndex = db.state.calls.findIndex(({ sql }) =>
    /^UPDATE mls_ingestion_policies/.test(sql),
  );
  assert.ok(auditIndex > 0 && updateIndex > auditIndex);
  assert.equal(db.state.calls.at(-1).sql, "COMMIT");
  assert.deepEqual(db.state.audits, [
    { approval_ref: APPROVAL, before, after_rule: desired(), config_hash: expectedConfigHash },
  ]);
  assert.deepEqual(db.state.policy.config, { ...before.config, source_authority: desired() });
  assert.deepEqual(db.state.policy.config.unrelated, before.config.unrelated);
  assert.deepEqual(
    db.state.policy.config.company_number_identity,
    before.config.company_number_identity,
  );
});

test("a configuration change after preview causes rollback rather than silently widening approval", async () => {
  const db = database();
  const preview = await approveSourceAuthority(db.client, { approvalRef: APPROVAL });
  db.state.policy.config.unrelated.enabled = false;
  db.state.policy.config.added_after_review = { retained: true };
  const raced = structuredClone(db.state.policy);
  db.state.calls = [];
  await assert.rejects(
    approveSourceAuthority(db.client, {
      approvalRef: APPROVAL,
      apply: true,
      expectedConfigHash: preview.configHash,
    }),
    /SOURCE_AUTHORITY_POLICY_CHANGED/,
  );
  assert.equal(db.state.calls.at(-1).sql, "ROLLBACK");
  assert.deepEqual(updates(db.state), []);
  assert.deepEqual(db.state.audits, []);
  assert.deepEqual(db.state.policy, raced);
});

test("native publishing revocation between review and apply is rechecked under the row lock", async () => {
  const db = database();
  const preview = await approveSourceAuthority(db.client, { approvalRef: APPROVAL });
  db.state.policy.publish_enabled = false;
  await assert.rejects(
    approveSourceAuthority(db.client, {
      approvalRef: APPROVAL,
      apply: true,
      expectedConfigHash: preview.configHash,
    }),
    /SOURCE_AUTHORITY_NATIVE_PUBLISHING_REQUIRED/,
  );
  assert.equal(db.state.policy.publish_enabled, false);
  assert.deepEqual(db.state.audits, []);
});

test("reapplying the same approved rule is a no-op without duplicate audit", async () => {
  const db = database(
    policy({ config: { unrelated: { keep: true }, source_authority: desired() } }),
  );
  const before = structuredClone(db.state.policy);
  const result = await approveSourceAuthority(db.client, {
    approvalRef: APPROVAL,
    apply: true,
    expectedConfigHash: hashPayload(before.config),
  });
  assert.equal(result.changed, false);
  assert.equal(result.dryRun, false);
  assert.deepEqual(updates(db.state), []);
  assert.deepEqual(db.state.audits, []);
  assert.deepEqual(db.state.policy, before);
  assert.equal(db.state.calls.at(-1).sql, "COMMIT");
});

test("a second explicit approval reference is a separately reviewed audited policy change", async () => {
  const db = database(
    policy({ config: { unrelated: { keep: true }, source_authority: desired("PRIOR-APPROVAL") } }),
  );
  const before = structuredClone(db.state.policy);
  await approveSourceAuthority(db.client, {
    approvalRef: APPROVAL,
    apply: true,
    expectedConfigHash: hashPayload(before.config),
  });
  assert.equal(db.state.audits.length, 1);
  assert.equal(db.state.audits[0].before.config.source_authority.approval_ref, "PRIOR-APPROVAL");
  assert.equal(db.state.policy.config.source_authority.approval_ref, APPROVAL);
});

for (const [name, failAt] of [
  ["policy lookup", /^SELECT \* FROM mls_ingestion_policies/],
  ["advisory lock", /pg_advisory_xact_lock/],
  ["audit insert", /^INSERT INTO audit_logs/],
  ["configuration update", /^UPDATE mls_ingestion_policies/],
  ["commit", /^COMMIT$/],
])
  test("SQL failure rolls back the entire audited approval: " + name, async () => {
    const db = database(policy(), { failAt });
    const before = structuredClone(db.state.policy);
    await assert.rejects(
      approveSourceAuthority(db.client, {
        approvalRef: APPROVAL,
        apply: true,
        expectedConfigHash: hashPayload(before.config),
      }),
      (error) => error === db.failure,
    );
    assert.equal(db.state.calls.at(-1).sql, "ROLLBACK");
    assert.deepEqual(db.state.policy, before);
    assert.deepEqual(db.state.audits, []);
  });

test("a rollback failure does not replace the original SQL error", async () => {
  const db = database(policy(), { failAt: /^INSERT INTO audit_logs/, failRollback: true });
  await assert.rejects(
    approveSourceAuthority(db.client, {
      approvalRef: APPROVAL,
      apply: true,
      expectedConfigHash: hashPayload(db.state.policy.config),
    }),
    (error) => error === db.failure,
  );
  assert.equal(db.state.calls.at(-1).sql, "ROLLBACK");
  assert.ok(!db.state.calls.some(({ sql }) => /^UPDATE mls_ingestion_policies/.test(sql)));
});
