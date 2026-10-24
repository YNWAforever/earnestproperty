import test from "node:test";
import assert from "node:assert/strict";
import { publishDaily, publicationDecision } from "./daily-publication.mjs";
import { batch, row } from "./ingestion-test-fixtures.mjs";
import { hashPayload } from "./ingestion-contract.mjs";

const capture = "2026-10-01T01:00:00.123456Z";
const canonical = "11111111-1111-4111-8111-111111111111";
const observation = "22222222-2222-4222-8222-222222222222";
const linkId = "33333333-3333-4333-8333-333333333333";
const historicId = "44444444-4444-4444-8444-444444444444";
const conflict = { field: "bedrooms", dom: 2, json_ld: 1, resolution: "dom", status: "review" };

function fixture({ conflicts = false, historical = false } = {}) {
  const rows = ["4000001", "4000002"].map((id, index) =>
    row(id, {
      source_url: `https://www.28hse.com/buy/apartment/property-${id}`,
      agency_property_no: "A12345" + (6 + index),
      source_status: "active",
      saleable_area: 500,
      bedrooms: 2,
      bathrooms: 1,
      captured_at: capture,
      publication: {
        description: "Synthetic listing description",
        images: [`https://i1.28hse.com/${id}.jpg`],
      },
      ...(index === 0 && conflicts
        ? {
            raw_payload: {
              source_conflicts: [{ ...conflict }],
              provider_provenance: {
                contentSha256: "b".repeat(64),
                fetchedAt: capture,
                resolvedUrl: `https://www.28hse.com/buy/apartment/property-${id}`,
              },
            },
          }
        : {}),
    }),
  );
  const payload = batch(rows, capture);
  const properties = rows.map((r, index) => ({
    id: index === 0 ? canonical : historicId,
    status: "draft",
    ingestion_owner: "no-hermes-v2",
    canonical_property_no: r.agency_property_no,
    deal_type: "sale",
    price: r.price,
    rent: null,
    source_status: "active",
    source_count: 1,
    bedrooms: 2,
    external_listing_id: r.property_id,
    estate_id: "estate",
    saleable_area: 500,
    images: [],
    description: null,
    source_url: null,
    public_listing_no: r.agency_property_no,
    observation_id: observation,
    canonical_row_hash: "a".repeat(32),
    blocked: false,
    historical_review_pending: false,
  }));
  const target = {
    external_id: "4000001",
    deal_type: "sale",
    property_id: canonical,
    agency_property_no: "A123456",
    observation_id: observation,
    source_link_id: linkId,
    canonical_row_hash: "a".repeat(32),
    dom_conflict: conflicts
      ? {
          decision: "accept_dom",
          captured_at: capture,
          content_sha256: "b".repeat(64),
          conflicts_hash: hashPayload([conflict]),
        }
      : null,
    historical: historical
      ? [
          {
            review_key: "c".repeat(64),
            row_hash: "d".repeat(32),
            external_id: "3999999",
            previous_agency_no: "C123456",
            proposed_agency_no: "A123456",
            bound_property_id: historicId,
            decision: "reject_reassignment",
          },
        ]
      : [],
  };
  const plan = {
    version: "named-publication-v1",
    source: "28hse_agent_540",
    scope_id: "agent:540",
    policy_version: "no-hermes-v2",
    payload_hash: hashPayload(payload),
    approval_ref: "PUBLICATION-synthetic-offline-only",
    targets: [target],
  };
  const calls = [],
    audits = [];
  let targetReads = 0;
  const f = {
    payload,
    plan,
    properties,
    calls,
    audits,
    targetReads: () => targetReads,
    historyRow: {
      ...target.historical[0],
      source: plan.source,
      external_listing_id: "3999999",
      deal_type: "sale",
      reason: "company_number_changed",
      status: "open",
      scope_id: plan.scope_id,
      policy_version: plan.policy_version,
      accepted_agency_no: "C123456",
      observation_agency_no: "A123456",
      property_id: historicId,
      link_property_id: historicId,
      link_status: "active",
      held: true,
    },
    client: {
      query: async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes("SELECT r.id FROM mls_ingestion_receipts"))
          return {
            rows:
              params[2] === hashPayload(payload) && !f.receiptMissing
                ? [{ id: "full-receipt" }]
                : [],
          };
        if (sql.startsWith("SELECT p.*")) {
          targetReads++;
          const p = structuredClone(properties.find((p) => p.external_listing_id === params[0]));
          if (targetReads > 1 && f.drift) Object.assign(p, f.drift);
          return { rows: [p] };
        }
        if (sql.includes("publication_source_link"))
          return {
            rows: [
              {
                id: linkId,
                source: plan.source,
                external_listing_id: params[1],
                deal_type: "sale",
                property_id: canonical,
                status: "active",
                ...f.linkDrift,
              },
            ],
          };
        if (sql.includes("controlled_patch_review_decisions")) return { rows: [f.historyRow] };
        if (sql.includes("publication_unchanged_fields"))
          return { rows: [{ unchanged_hash: "e".repeat(32) }] };
        if (sql.includes("SELECT mr.source_url"))
          return {
            rows: rows.flatMap((r) =>
              r.publication.images.map((url) => ({
                source_url: url,
                url: "https://owned.invalid/photo.jpg",
              })),
            ),
          };
        if (sql.includes("SELECT to_jsonb(p) AS value"))
          return { rows: [{ value: structuredClone(properties[0]) }] };
        if (sql.includes("INSERT INTO audit_logs")) audits.push(params);
        return { rows: [] };
      },
    },
    options(extra = {}) {
      return {
        payload,
        client: f.client,
        blobStore: {},
        publicationPlan: plan,
        publicationPlanHash: hashPayload(plan),
        now: () => Date.parse("2026-10-01T02:00:00Z"),
        ...extra,
      };
    },
  };
  return f;
}
test("named dry-run selects exactly one target without slicing the full receipt payload", async () => {
  const f = fixture();
  const result = await publishDaily(f.options());
  assert.deepEqual(
    result.ready.map((x) => x.sourceId),
    ["4000001"],
  );
  assert.equal(result.eligibleBacklog, 1);
  assert.equal(f.payload.listings.length, 2);
});
test("named live path publishes only that canonical and audits the scoped decision", async () => {
  const f = fixture();
  const result = await publishDaily(f.options({ apply: true }));
  assert.deepEqual(
    result.published.map((x) => x.sourceId),
    ["4000001"],
  );
  assert.ok(
    f.calls
      .filter((c) => c.sql.startsWith("UPDATE properties SET status"))
      .every((c) => c.params[0] === canonical),
  );
  assert.ok(
    f.audits.some((args) =>
      args.some((x) => typeof x === "string" && x.includes("PUBLICATION-synthetic-offline-only")),
    ),
  );
});
for (const [label, mutate] of [
  [
    "null approval",
    (f) => {
      f.plan.approval_ref = null;
    },
  ],
  [
    "price-patch approval",
    (f) => {
      f.plan.approval_ref = "USER-APPROVED-price-patch";
    },
  ],
  [
    "two targets",
    (f) => {
      f.plan.targets.push(structuredClone(f.plan.targets[0]));
    },
  ],
  [
    "wrong source",
    (f) => {
      f.plan.source = "propertyhk";
    },
  ],
  [
    "missing target",
    (f) => {
      f.plan.targets[0].external_id = "4000009";
    },
  ],
  [
    "wrong canonical",
    (f) => {
      f.plan.targets[0].property_id = historicId;
    },
  ],
  [
    "wrong observation",
    (f) => {
      f.plan.targets[0].observation_id = historicId;
    },
  ],
  [
    "wrong row hash",
    (f) => {
      f.plan.targets[0].canonical_row_hash = "f".repeat(32);
    },
  ],
])
  test(`named mode rejects ${label} without media or writes`, async () => {
    const f = fixture();
    mutate(f);
    await assert.rejects(publishDaily(f.options()));
    assert.equal(
      f.calls.some((c) => /^\s*(?:INSERT|UPDATE|DELETE|BEGIN)/.test(c.sql)),
      false,
    );
  });
test("a mismatched or unpaired plan hash never falls back to whole-batch mode", async () => {
  const f = fixture();
  await assert.rejects(publishDaily(f.options({ publicationPlanHash: "f".repeat(64) })));
  await assert.rejects(publishDaily(f.options({ publicationPlanHash: undefined })));
});
test("full-current receipt and source capture freshness remain mandatory", async () => {
  const f = fixture();
  f.receiptMissing = true;
  await assert.rejects(publishDaily(f.options()), /ACCEPTED_CURRENT/);
  const g = fixture();
  g.payload.listings[0].captured_at = "2026-09-28T01:00:00Z";
  g.plan.payload_hash = hashPayload(g.payload);
  await assert.rejects(publishDaily(g.options()), /STALE_PUBLICATION_SOURCE/);
});
test("default publisher holds proposed-number historical reviews", () => {
  const f = fixture();
  assert.equal(
    publicationDecision(f.payload.listings[0], {
      ...f.properties[0],
      historical_review_pending: true,
    }),
    "historical_review_required",
  );
});
test("unacknowledged raw DOM conflict is held; exact named DOM acknowledgement remains raw review evidence", async () => {
  const f = fixture({ conflicts: true });
  const legacy = await publishDaily(
    f.options({ publicationPlan: undefined, publicationPlanHash: undefined }),
  );
  assert.ok(
    legacy.held.some(
      (x) => x.sourceId === "4000001" && x.reason === "source_conflict_requires_review",
    ),
  );
  const named = await publishDaily(f.options());
  assert.equal(named.ready.length, 1);
  assert.equal(f.payload.listings[0].raw_payload.source_conflicts[0].status, "review");
});
test("changed DOM hash or unsupported conflict cannot be acknowledged", async () => {
  const f = fixture({ conflicts: true });
  f.plan.targets[0].dom_conflict.content_sha256 = "f".repeat(64);
  await assert.rejects(publishDaily(f.options()));
  const g = fixture({ conflicts: true });
  g.payload.listings[0].raw_payload.source_conflicts[0].field = "price";
  g.plan.payload_hash = hashPayload(g.payload);
  g.plan.targets[0].dom_conflict.conflicts_hash = hashPayload(
    g.payload.listings[0].raw_payload.source_conflicts,
  );
  await assert.rejects(publishDaily(g.options()));
});
test("exact historical acknowledgement reuses native row validation and rejects drift", async () => {
  const f = fixture({ historical: true });
  assert.equal((await publishDaily(f.options())).ready.length, 1);
  f.historyRow.row_hash = "f".repeat(32);
  await assert.rejects(publishDaily(f.options()));
});
test("named approval never suppresses a direct/manual hold", async () => {
  const f = fixture({ historical: true });
  f.properties[0].blocked = true;
  const result = await publishDaily(f.options());
  assert.equal(result.ready.length, 0);
  assert.equal(result.held[0].reason, "staff_or_source_review");
});
test("source link or locked observation drift aborts the publication transaction", async () => {
  const f = fixture();
  f.linkDrift = { status: "inactive" };
  await assert.rejects(publishDaily(f.options()));
  const g = fixture();
  g.drift = { observation_id: historicId };
  await assert.rejects(publishDaily(g.options({ apply: true })));
  assert.equal(
    g.calls.some((c) => c.sql.startsWith("UPDATE properties SET status")),
    false,
  );
});

test("provider provenance cannot hide stale capture behind a fresh batch", async () => {
  for (const missingCapture of [true, false]) {
    const f = fixture();
    if (missingCapture) delete f.payload.listings[0].captured_at;
    f.payload.listings[0].raw_payload = {
      provider_provenance: { fetchedAt: "2026-09-28T01:00:00Z" },
    };
    f.plan.payload_hash = hashPayload(f.payload);
    await assert.rejects(publishDaily(f.options()));
    assert.equal(
      f.calls.some((c) => /^\s*(?:INSERT|UPDATE|BEGIN)/.test(c.sql)),
      false,
    );
  }
});

test("DOM confirmation binds original fresh capture, not a later batch envelope", async () => {
  const f = fixture({ conflicts: true });
  f.payload.scraped_at = "2026-10-01T01:10:00Z";
  f.plan.payload_hash = hashPayload(f.payload);
  const result = await publishDaily(f.options());
  assert.equal(result.ready.length, 1);
  assert.equal(f.payload.listings[0].captured_at, capture);
});

test("DOM acknowledgement cannot publish a canonical with a different bedroom count", async () => {
  const f = fixture({ conflicts: true });
  f.properties[0].bedrooms = 1;
  await assert.rejects(publishDaily(f.options()), /PUBLICATION_DOM_CANONICAL_CHANGED/);
});
