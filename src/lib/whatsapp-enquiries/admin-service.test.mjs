import test from "node:test";
import assert from "node:assert/strict";
import {
  listServicePolicies,
  saveServicePolicyDraft,
  approveServicePolicy,
} from "./policy-admin.server.ts";
import { getServiceHealth } from "./service-health.server.ts";
import { draftServicePolicy } from "./service-policy.ts";
const id = "11111111-1111-4111-8111-111111111111",
  actor = { staffId: id, roles: ["admin"] };
test("policy and health reject browser roles absent active database authority", async () => {
  for (const fn of [listServicePolicies, getServiceHealth]) {
    let calls = 0;
    await assert.rejects(
      fn({ staffId: id, roles: ["agent"] }, async () => {
        calls++;
        return [{ id }];
      }),
      (e) => e.status === 403,
    );
    assert.equal(calls, 0);
    await assert.rejects(
      fn(actor, async () => []),
      (e) => e.status === 403,
    );
  }
});
test("draft saves reject client supplied approval authority", async () => {
  await assert.rejects(
    saveServicePolicyDraft(
      {
        rules: draftServicePolicy().rules,
        afterHoursCopy: null,
        copyVersion: null,
        status: "approved",
      },
      actor,
      async () => [{ id }],
    ),
    /Unrecognized key/,
  );
});
test("incomplete policy cannot reach approval transaction", async () => {
  let writes = 0;
  const query = async (sql) =>
    sql.includes("SELECT *")
      ? [{ id, version: 1, status: "draft", rules: draftServicePolicy().rules, copy_version: null }]
      : [{ id }];
  await assert.rejects(
    approveServicePolicy(
      { id, version: 1, effectiveAt: "2026-09-12T00:00:00Z", decisionEvidenceRef: "synthetic" },
      actor,
      {
        query,
        transaction: async () => {
          writes++;
          return [];
        },
      },
    ),
    (e) => e.status === 400,
  );
  assert.equal(writes, 0);
});
test("health explicitly reports unavailable schema instead of pretending live counts", async () => {
  let calls = 0;
  const health = await getServiceHealth(actor, async () =>
    ++calls === 1 ? [{ id }] : [{ available: false }],
  );
  assert.equal(health.schemaAvailable, false);
  assert.deepEqual(health.reasons, ["SERVICE_SCHEMA_UNAVAILABLE"]);
  assert.equal(calls, 2);
});
test("health separates opens, enquiry attribution and human evidence; unknowns require reconciliation", async () => {
  let calls = 0;
  const rows = [
    [{ id }],
    [{ available: true, heartbeat: true }],
    [],
    [
      {
        opens: 12,
        enquiries: 7,
        attributable: 3,
        confirmed_assignments: 2,
        human_responses: 1,
        survey_answers: 0,
        routing_unknown: 1,
        sending_unknown: 2,
        blocked_surveys: 3,
        overdue_jobs: 1,
        oldest_due: "2026-01-01T00:00:00Z",
      },
    ],
    [],
    [{ id }],
  ];
  const health = await getServiceHealth(actor, async () => rows[calls++], { readiness: [] });
  assert.deepEqual(health.counts, {
    opens: 12,
    enquiries: 7,
    attributable: 3,
    confirmedAssignments: 2,
    humanResponses: 1,
    surveyAnswers: 0,
  });
  assert.ok(health.reasons.includes("SEND_RECONCILIATION_REQUIRED"));
  assert.ok(health.reasons.includes("SERVICE_DUE_WORK_OVERDUE"));
});

test("FX-19c-1: legacy WhatsApp names are a note for admins, never a health reason", async () => {
  const fullRows = () => [[{ id }], [{ available: true, heartbeat: true }], [], [{}], [], [{ id }]];
  const run = async (values) => {
    const keys = Object.keys(values);
    const saved = keys.map((key) => [key, Object.hasOwn(process.env, key), process.env[key]]);
    for (const key of keys) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    try {
      const rows = fullRows();
      let calls = 0;
      return await getServiceHealth(actor, async () => rows[calls++] ?? [], { readiness: [] });
    } finally {
      for (const [key, had, value] of saved) {
        if (had) process.env[key] = value;
        else delete process.env[key];
      }
    }
  };
  const legacy = await run({
    EP_WA_TRACKED_LINKS_ENABLED: "true",
    EP_WA_COMPANY_PHONE: "85291234567",
  });
  const clean = await run({
    EP_WA_TRACKED_LINKS_ENABLED: undefined,
    EP_WA_COMPANY_PHONE: undefined,
  });
  assert.deepEqual(legacy.legacyNames, ["EP_WA_COMPANY_PHONE", "EP_WA_TRACKED_LINKS_ENABLED"]);
  assert.ok(!JSON.stringify(legacy.legacyNames).includes("85291234567"));
  assert.deepEqual(legacy.reasons, clean.reasons);
  assert.ok(!legacy.reasons.some((reason) => /LEGACY|EP_WA_/.test(reason)));
});

test("routing-only policy can be approved without customer-service rules", async () => {
  const rules = {
    ...draftServicePolicy().rules,
    purpose: "routing_notifications",
    managerStaffId: id,
    freshnessSeconds: 300,
  };
  const row = { id, version: 1, status: "draft", rules, copy_version: "routing-v1" };
  let writes = 0;
  const result = await approveServicePolicy(
    {
      id,
      version: 1,
      effectiveAt: "2026-09-12T00:00:00Z",
      decisionEvidenceRef: "synthetic-routing-only",
    },
    actor,
    {
      query: async (sql) => (sql.includes("SELECT *") ? [row] : [{ id }]),
      transaction: async () => {
        writes++;
        return [[], [{ id }]];
      },
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(writes, 1);
});
