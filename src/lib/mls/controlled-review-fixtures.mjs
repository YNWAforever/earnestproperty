import { batch, row } from "./ingestion-test-fixtures.mjs";
import { hashPayload } from "./ingestion-contract.mjs";

export function reviewFixture() {
  const id = "11111111-1111-4111-8111-111111111111";
  const capture = "2026-09-07T00:00:00.123456Z";
  const conflict = { field: "bedrooms", dom: 2, json_ld: 1, resolution: "dom", status: "review" };
  const payload = batch(
    [
      row("123", {
        agency_property_no: "A123456",
        captured_at: capture,
        bedrooms: 2,
        bathrooms: 1,
        floor: "\u4f4e\u5c64",
        unit: null,
        raw_payload: {
          source_conflicts: [conflict],
          provider_provenance: {
            fetchedAt: capture,
            contentSha256: "b".repeat(64),
            resolvedUrl: "https://www.28hse.com/buy/example/property-123",
            requestId: "22222222-2222-4222-8222-222222222222",
          },
        },
      }),
    ],
    "2026-09-08T00:00:00.654321Z",
  );
  payload.meta.eligible_for_absence = false;
  payload.meta.full_snapshot = false;
  payload.meta.controlled_patch = {
    mode: "controlled",
    record_count: 1,
    absence_allowed: false,
    evidence_mode: "saved-capture-v1",
    projection_fields: ["price"],
    expectations: [
      {
        external_id: "123",
        deal_type: "sale",
        property_id: id,
        observation_id: "old",
        fields: { price: 5000000 },
      },
    ],
    atomic_guards: {
      version: "before-images-v1",
      sources: [{ external_id: "123", deal_type: "sale", contact: null, promotion: null }],
      canonicals: [
        {
          property_id: id,
          row_hash: "a".repeat(32),
          sync_fields: [],
          groups: [],
          members: [],
          overrides: [],
        },
      ],
    },
  };
  const plan = {
    version: "controlled-review-v1",
    source: "28hse_agent_540",
    scope_id: "agent:540",
    policy_version: "no-hermes-v2",
    payload_hash: hashPayload(payload),
    approval_ref: "synthetic-offline-approval",
    targets: [
      {
        external_id: "123",
        deal_type: "sale",
        property_id: id,
        agency_property_no: "A123456",
        dom_conflict: {
          decision: "accept_dom",
          captured_at: capture,
          content_sha256: "b".repeat(64),
          conflicts_hash: hashPayload([conflict]),
        },
        historical: [
          {
            review_key: "c".repeat(64),
            row_hash: "d".repeat(32),
            external_id: "456",
            previous_agency_no: "C123456",
            proposed_agency_no: "A123456",
            bound_property_id: "33333333-3333-4333-8333-333333333333",
            decision: "reject_reassignment",
          },
        ],
      },
    ],
  };
  const planHash = hashPayload(plan);
  payload.meta.controlled_patch.review_plan_hash = planHash;
  const options = { controlledPatch: true, reviewPlan: plan, reviewPlanHash: planHash };
  const state = {
    property_id: id,
    observation_id: "old",
    captured_at: "2026-09-01T00:00:00Z",
    source_status: "active",
  };
  const property = { id, status: "draft", canonical_property_no: "A123456" };
  const relation = { propertyId: id, holdProjection: false };
  const link = {
    source: "28hse_agent_540",
    external_listing_id: "123",
    deal_type: "sale",
    property_id: id,
    status: "active",
  };
  const historical = {
    review_key: "c".repeat(64),
    row_hash: "d".repeat(32),
    status: "open",
    reason: "company_number_changed",
    source: plan.source,
    external_listing_id: "456",
    deal_type: "sale",
    scope_id: plan.scope_id,
    policy_version: plan.policy_version,
    previous_agency_no: "C123456",
    proposed_agency_no: "A123456",
    accepted_agency_no: "C123456",
    observation_agency_no: "A123456",
    property_id: "33333333-3333-4333-8333-333333333333",
    link_property_id: "33333333-3333-4333-8333-333333333333",
    link_status: "active",
    held: true,
  };
  return { payload, plan, options, state, property, relation, historical, link };
}
