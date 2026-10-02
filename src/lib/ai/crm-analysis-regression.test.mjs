import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { repoRoot } from "../../../scripts/acceptance/owned-postgres-test.mjs";

// Adapted from immutable audit AI01-03; PASS now means safe product behavior.
const dbUrl = new URL("src/lib/neon/db.server.ts", repoRoot).href;
const actual = await import(dbUrl);
let saved;
let fixture;
mock.module(dbUrl, {
  exports: {
    ...actual,
    queryRows: async (sql, params = []) =>
      sql.includes("ep_begin_crm_analysis_run")
        ? [
            {
              run: {
                id: params[0],
                source_fingerprint: "synthetic-revision",
                status: "running",
                started: true,
              },
            },
          ]
        : sql.includes("FROM crm_ai_analysis_runs") && saved
          ? [
              {
                id: "55555555-5555-4555-8555-555555555555",
                status: "completed",
                result_kind: saved.result_kind,
                output: { profile: saved, tags: [] },
              },
            ]
          : sql.includes("FROM crm_leads l")
            ? [fixture]
            : sql.includes("FROM crm_ai_profiles") && saved
              ? [saved]
              : [],
    getSql: () => ({
      transaction: async (build) => {
        const statements = build({ query: (sql, params = []) => ({ sql, params }) });
        for (const s of statements)
          if (s.params.length >= 12 && s.sql.includes("crm_ai_profiles")) {
            saved = {
              id: "22222222-2222-4222-8222-222222222222",
              lead_id: fixture.id,
              contact_id: fixture.contact_id,
              next_best_action: s.params[9],
              summary: s.params[10],
              generated_by: s.params[11],
              lead_score: s.params[8],
              result_kind: s.params[12],
              action_type: s.params[13],
            };
          }
        return statements.map(() => []);
      },
    }),
  },
});
const { analyzeCrmLead } = await import("./crm-enrichment.server.ts");
const actor = {
  staffId: "44444444-4444-4444-8444-444444444444",
  authUserId: "synthetic-agent",
  email: null,
  name: null,
  roles: ["agent"],
  bootstrap: false,
};
const envKeys = ["AI_GATEWAY_API_KEY", "AI_GATEWAY_MODEL"];
const previous = envKeys.map((k) => process.env[k]);
test.after(() =>
  envKeys.forEach((k, i) =>
    previous[i] === undefined ? delete process.env[k] : (process.env[k] = previous[i]),
  ),
);
function fresh(overrides = {}) {
  saved = null;
  fixture = {
    id: "11111111-1111-4111-8111-111111111111",
    contact_id: null,
    intent: null,
    budget_min: null,
    budget_max: null,
    preferred_estates: [],
    source: "test",
    note: "測試記錄：沒有客戶聯絡資料，請勿聯絡任何人。",
    opt_in_whatsapp: false,
    last_activity_days: 0,
    is_test: true,
    has_verified_contact: false,
    source_verified: false,
    service_reply_allowed: false,
    marketing_eligible: false,
    ...overrides,
  };
  envKeys.forEach((k) => delete process.env[k]);
}
async function analyzeModel(value) {
  process.env.AI_GATEWAY_API_KEY = "synthetic-unused";
  process.env.AI_GATEWAY_MODEL = "synthetic-model";
  const f = mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  try {
    await analyzeCrmLead(fixture.id, actor);
    assert.equal(f.mock.callCount(), 1);
  } finally {
    f.mock.restore();
  }
}
test("AI01 disabled model cannot suggest contact for a test record without contact", async () => {
  fresh();
  const f = mock.method(globalThis, "fetch", () => {
    throw Error("External network forbidden");
  });
  try {
    await analyzeCrmLead(fixture.id, actor);
    assert.equal(saved.generated_by, "fallback");
    assert.doesNotMatch(saved.next_best_action, /WhatsApp|電話|即時聯絡|推廣/);
    assert.equal(saved.action_type, "mark_test");
    assert.equal(f.mock.callCount(), 0);
  } finally {
    f.mock.restore();
  }
});
test("AI02 schema-empty JSON cannot be persisted as model validated", async () => {
  fresh();
  await analyzeModel({});
  assert.equal(saved.generated_by, "fallback");
  assert.equal(saved.result_kind, "fallback");
  assert.equal(saved.action_type, "mark_test");
});
test("AI03 unknown enums and hostile raw action cannot be persisted", async () => {
  fresh();
  await analyzeModel({
    summary: "測試",
    urgency: "unsupported",
    timeline: "invented",
    next_best_action: "立即 WhatsApp 聯絡此沒有聯絡資料的測試客戶，並發送推廣。",
    suggested_tags: [],
  });
  assert.equal(saved.generated_by, "fallback");
  assert.doesNotMatch(saved.next_best_action, /WhatsApp|推廣/);
});
test("a domain-valid model action still must pass deterministic contact eligibility", async () => {
  fresh({ is_test: false, source: "website", note: null, source_verified: true });
  await analyzeModel({
    summary: "查詢",
    urgency: "normal",
    timeline: null,
    action: { type: "service_reply", reason: "立即聯絡" },
    suggested_tags: [],
  });
  assert.equal(saved.generated_by, "fallback");
  assert.equal(saved.action_type, "complete_contact");
  assert.doesNotMatch(saved.next_best_action, /WhatsApp|電話|推廣/);
});
test("valid eligible model is accepted but its reason cannot become executable action text", async () => {
  fresh({
    is_test: false,
    source: "website",
    note: null,
    contact_id: "33333333-3333-4333-8333-333333333333",
    has_verified_contact: true,
    source_verified: true,
    service_reply_allowed: true,
  });
  await analyzeModel({
    summary: "客戶查詢租盤",
    urgency: "normal",
    timeline: null,
    action: { type: "service_reply", reason: "MODEL_REASON_UNTRUSTED" },
    suggested_tags: [],
  });
  assert.equal(saved.generated_by, "ai");
  assert.equal(saved.result_kind, "model_validated");
  assert.equal(saved.action_type, "service_reply");
  assert.doesNotMatch(saved.next_best_action, /MODEL_REASON_UNTRUSTED/);
});
test("strict schema and ordered action policy reject unsafe or malformed outputs", async () => {
  const { validateCrmAnalysis } = await import("./crm-analysis-contract.ts");
  const { allowedCrmActions } = await import("./crm-analysis-eligibility.ts");
  const value = {
    summary: "有效摘要",
    urgency: "normal",
    timeline: null,
    action: { type: "review_enquiry", reason: "覆核" },
    suggested_tags: [],
  };
  assert.equal(validateCrmAnalysis(value).ok, true);
  const invalid = [
    {},
    null,
    [],
    { ...value, extra: true },
    { ...value, summary: " " },
    { ...value, summary: "x".repeat(2001) },
    { ...value, urgency: "urgent" },
    { ...value, timeline: "tomorrow" },
    { ...value, action: { type: "send_now", reason: "覆核" } },
    { ...value, suggested_tags: [{ tag: "a", confidence: 2, reason: "a" }] },
    { ...value, suggested_tags: Array(13).fill({ tag: "a", confidence: 0.5, reason: "a" }) },
  ];
  for (const candidate of invalid) assert.equal(validateCrmAnalysis(candidate).ok, false);
  const context = {
    isTest: false,
    hasVerifiedContact: true,
    sourceVerified: true,
    serviceReplyAllowed: true,
    marketingEligible: false,
  };
  assert.deepEqual(allowedCrmActions({ ...context, isTest: true }), ["mark_test"]);
  assert.deepEqual(allowedCrmActions({ ...context, hasVerifiedContact: false }), [
    "complete_contact",
    "review_enquiry",
  ]);
  assert.deepEqual(allowedCrmActions({ ...context, sourceVerified: false }), [
    "verify_source",
    "review_enquiry",
  ]);
  assert.ok(allowedCrmActions(context).includes("service_reply"));
  assert.ok(
    !allowedCrmActions(context).includes("marketing_review"),
    "Opt-out service can be eligible without marketing consent",
  );
});
