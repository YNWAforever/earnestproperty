import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyIngestion } from "./ingestion-repository.mjs";
import { decodeSnapshot, hashPayload } from "./ingestion-contract.mjs";
import { batch, row } from "./ingestion-test-fixtures.mjs";
import { reviewFixture } from "./controlled-review-fixtures.mjs";

const captured = "2026-09-07T00:00:00.123456Z";
const accepted = "2026-09-08T00:00:00.654321Z";

function reviewedMemoryPort({ directReview = false, manualPrice = false } = {}) {
  const f = reviewFixture(),
    port = memoryPort({ status: "draft", manualPrice });
  port.data.property.canonical_property_no = "A123456";
  const base = port.client.query.bind(port.client);
  port.client.query = async (sql, args = []) => {
    if (sql.startsWith("SELECT * FROM property_source_links")) {
      port.calls.push({ sql, args });
      return { rows: [f.link] };
    }
    if (sql.includes("controlled_patch_review_decisions")) {
      assert.ok(
        port.calls.some(
          (c) => c.sql === "LOCK TABLE mls_ingestion_reviews IN SHARE ROW EXCLUSIVE MODE",
        ),
      );
      port.calls.push({ sql, args });
      return { rows: [f.historical] };
    }
    if (sql.includes("AS pending_review")) {
      port.calls.push({ sql, args });
      assert.ok(sql.includes("AND NOT(r.review_key=ANY($9::text[]))"));
      return {
        rows: [{ pending_review: directReview || !args[8].includes(f.historical.review_key) }],
      };
    }
    return base(sql, args);
  };
  return { f, port };
}

test("native review plan applies one draft observation without clearing historical review or touching its binding", async () => {
  const { f, port } = reviewedMemoryPort(),
    oldDescription = port.data.property.description,
    oldImages = structuredClone(port.data.property.images);
  const result = await applyIngestion(port.client, f.payload, f.options);
  assert.equal(result.full_snapshot, false);
  assert.equal(result.summary.properties_created, 0);
  assert.equal(port.data.property.status, "draft");
  assert.equal(port.data.property.description, oldDescription);
  assert.deepEqual(port.data.property.images, oldImages);
  assert.equal(port.data.observation.raw.raw_payload.source_conflicts[0].status, "review");
  assert.equal(port.data.observation.reviewAdjudication.planHash, f.options.reviewPlanHash);
  assert.equal(port.data.observation.reviewAdjudication.formalReviewMutation, false);
  assert.equal(f.historical.status, "open");
  assert.equal(f.historical.held, true);
  assert.equal(
    port.calls.some((c) =>
      /^UPDATE mls_ingestion_reviews|^DELETE FROM mls_ingestion_reviews/.test(c.sql),
    ),
    false,
  );
  assert.equal(
    port.calls
      .filter((c) => c.sql.startsWith("INSERT INTO mls_source_state"))
      .every((c) => c.args[1] === "123"),
    true,
  );
  const reads = port.calls.filter((c) =>
    c.sql.includes("controlled_patch_review_decisions"),
  ).length;
  assert.deepEqual(await applyIngestion(port.client, f.payload, f.options), result);
  assert.equal(
    port.calls.filter((c) => c.sql.includes("controlled_patch_review_decisions")).length,
    reads,
  );
});

test("other native pending reviews are never excluded by a historical disposition", async () => {
  const { f, port } = reviewedMemoryPort({ directReview: true });
  await assert.rejects(
    () => applyIngestion(port.client, f.payload, f.options),
    (e) => e.code === "patch_review_required",
  );
  assert.equal(port.data.observation, null);
  assert.equal(port.data.receipt, null);
  assert.equal(f.historical.status, "open");
});

test("review-plan write failure rolls back observations and preserves draft", async () => {
  const { f, port } = reviewedMemoryPort();
  await assert.rejects(
    () =>
      applyIngestion(port.client, f.payload, {
        ...f.options,
        beforeCommit() {
          throw Error("synthetic failure");
        },
      }),
    /synthetic failure/,
  );
  assert.equal(port.data.observation, null);
  assert.equal(port.data.receipt, null);
  assert.equal(port.data.property.price, 5000000);
  assert.equal(port.data.property.status, "draft");
});

test("review acknowledgement does not overwrite manual price", async () => {
  const { f, port } = reviewedMemoryPort({ manualPrice: true });
  await assert.rejects(
    () => applyIngestion(port.client, f.payload, f.options),
    (e) => e.code === "patch_projection_requires_review",
  );
  assert.equal(port.data.observation, null);
  assert.equal(port.data.receipt, null);
  assert.equal(port.data.property.price, 5000000);
  assert.equal(port.data.property.status, "draft");
});

test("review plan cannot recreate a missing target source link", async () => {
  const { f, port } = reviewedMemoryPort();
  const base = port.client.query.bind(port.client);
  port.client.query = (sql, args) =>
    sql.startsWith("SELECT * FROM property_source_links") ? { rows: [] } : base(sql, args);
  await assert.rejects(
    () => applyIngestion(port.client, f.payload, f.options),
    (e) => e.code === "patch_review_plan_target_changed",
  );
  assert.equal(port.data.observation, null);
  assert.equal(port.data.receipt, null);
  assert.equal(
    port.calls.some((c) => c.sql.startsWith("INSERT INTO property_source_links")),
    false,
  );
});

const patch = (fields = ["price"]) => {
  const p = batch([row("123", { captured_at: captured })], accepted);
  p.meta.controlled_patch = {
    mode: "controlled",
    record_count: 1,
    absence_allowed: false,
    evidence_mode: "saved-capture-v1",
    projection_fields: fields,
    atomic_guards: {
      version: "before-images-v1",
      sources: [{ external_id: "123", deal_type: "sale", contact: null, promotion: null }],
      canonicals: [
        {
          property_id: "11111111-1111-4111-8111-111111111111",
          row_hash: "a".repeat(32),
          sync_fields: [],
          groups: [],
          members: [],
          overrides: [],
        },
      ],
    },
    expectations: [
      {
        external_id: "123",
        deal_type: "sale",
        property_id: "11111111-1111-4111-8111-111111111111",
        observation_id: "old",
        fields: { price: 5000000 },
      },
    ],
  };
  p.meta.eligible_for_absence = false;
  return p;
};

// In-memory SQL port: exercises the real writer without a database or credentials.
function memoryPort({
  status = "active",
  sourceStatus = "active",
  openReview = false,
  priorCapture = "2026-09-01T00:00:00Z",
  manualPrice = false,
  unassignedPrice = false,
  newTarget = false,
  secondaryConflict = false,
} = {}) {
  const calls = [];
  let data = {
    property: {
      id: "11111111-1111-4111-8111-111111111111",
      title_zh: "Source title",
      district_slug: "test",
      deal_type: "sale",
      status,
      price: 5000000,
      description: "Keep imported description",
      images: ["owned.jpg"],
      agent_id: "staff-original",
    },
    state: null,
    observation: null,
    observationFetchedAt: null,
    receipt: null,
  };
  data.state = {
    source: "28hse_agent_540",
    external_listing_id: "123",
    deal_type: "sale",
    property_id: data.property.id,
    observation_id: "old",
    source_status: sourceStatus,
    raw_identity: {},
    captured_at: priorCapture,
  };
  if (newTarget) {
    data.property = null;
    data.state = null;
  }
  const owned = newTarget
    ? []
    : ["description", "price", "status"].map((field_name) => ({
        field_name,
        winning_observation_id: field_name === "price" && unassignedPrice ? null : "old",
        last_published_value: data.property[field_name],
        selection_reason: field_name === "price" && manualPrice ? "manual_override" : "primary",
        active_override: false,
      }));
  let backup;
  const client = {
    async query(sql, args = []) {
      calls.push({ sql, args });
      let rows = [];
      if (sql === "BEGIN") backup = structuredClone(data);
      else if (sql.includes("/* controlled_patch_sources */"))
        rows = [{ external_id: "123", deal_type: "sale", contact: null, promotion: null }];
      else if (sql.includes("/* controlled_patch_canonicals */"))
        rows = data.property
          ? [
              {
                property_id: data.property.id,
                row_hash: "a".repeat(32),
                sync_fields: [],
                groups: [],
                members: [],
                overrides: [],
              },
            ]
          : [];
      else if (sql.includes("/* controlled_patch_protected */"))
        rows =
          data.property && args[0].includes(data.property.id)
            ? [
                {
                  property_id: data.property.id,
                  protected_hash: hashPayload({
                    status: data.property.status,
                    description: data.property.description,
                    images: data.property.images,
                    agent_id: data.property.agent_id,
                  }),
                  manual_fields: owned
                    .filter(
                      (f) =>
                        f.active_override ||
                        f.selection_reason === "manual_override" ||
                        (sql.includes("f.winning_observation_id IS NULL") &&
                          f.winning_observation_id === null),
                    )
                    .map((f) => ({
                      ...f,
                      ...(sql.includes("canonical_value_hash")
                        ? { canonical_value_hash: hashPayload(data.property[f.field_name] ?? null) }
                        : {}),
                    })),
                },
              ]
            : [];
      else if (sql === "ROLLBACK") data = backup;
      else if (sql === "COMMIT") {
      } else if (sql.startsWith("SELECT payload_hash,response"))
        rows = data.receipt ? [data.receipt] : [];
      else if (sql.includes("FROM mls_ingestion_policies WHERE"))
        rows = [
          {
            source: "28hse_agent_540",
            scope_id: "agent:540",
            owner: "no-hermes-v2",
            publish_enabled: true,
            parser_version: "fixture-v2",
            bootstrap_approved_at: accepted,
            config: { district_slugs: { Test: "test" } },
          },
        ];
      else if (sql.startsWith("SELECT s.*,r.parser_version")) rows = [];
      else if (sql.startsWith("SELECT EXISTS(SELECT 1 FROM mls_ingestion_scopes"))
        rows = [{ stale: false }];
      else if (sql.startsWith("SELECT count(*)::int AS n")) rows = [{ n: 0 }];
      else if (
        sql.startsWith("SELECT s.*,to_char(o.fetched_at") ||
        sql.startsWith("SELECT * FROM mls_source_state")
      )
        rows = data.state ? [data.state] : [];
      else if (sql.startsWith("SELECT * FROM property_source_links")) rows = [];
      else if (sql.startsWith("SELECT s.*,o.payload") && sql.includes("s.unit_key=")) rows = [];
      else if (sql.includes("AS pending_review")) rows = [{ pending_review: openReview }];
      else if (sql.startsWith("SELECT estate_id,district_slug")) rows = [data.property];
      else if (sql.startsWith("SELECT * FROM properties")) rows = [structuredClone(data.property)];
      else if (sql.startsWith("SELECT s.*,o.fetched_at,ip.config AS policy_config,"))
        rows = [
          {
            ...data.state,
            fetched_at: data.observationFetchedAt ?? data.state?.captured_at,
            hold_projection: String(data.observation?.holdProjection ?? false),
            fields: data.observation?.fields ?? {},
            projection: data.observation?.projection ?? null,
            source_status_reason: data.observation?.sourceStatusReason ?? null,
          },
          ...(secondaryConflict
            ? [
                {
                  source: "propertyhk",
                  external_listing_id: "secondary",
                  deal_type: "sale",
                  source_status: "active",
                  fields: { price: "1" },
                  fetched_at: captured,
                  projection: null,
                  observation_id: "other",
                },
              ]
            : []),
        ];
      else if (sql.startsWith("SELECT * FROM property_sync_fields")) rows = owned;
      else if (sql.startsWith("SELECT * FROM property_sync_state"))
        rows = [{ inactive_reason: "accepted_full_28hse_absence" }];
      else if (sql.startsWith("SELECT o.shared")) rows = [];
      else if (sql.startsWith("INSERT INTO listing_source_observations")) {
        data.observation = JSON.parse(args[6]);
        data.observationFetchedAt = args[8];
      } else if (sql.startsWith("INSERT INTO mls_source_state"))
        data.state = {
          ...data.state,
          source: args[0],
          external_listing_id: args[1],
          deal_type: args[2],
          property_id: args[7],
          observation_id: args[5],
          source_status: args[11],
        };
      else if (sql.startsWith("INSERT INTO properties(")) {
        data.property = {
          id: args[0],
          listing_no: args[1],
          title_zh: args[2],
          deal_type: args[3],
          district_slug: args[4],
          status: "draft",
        };
        rows = [data.property];
      } else if (sql.startsWith("UPDATE properties SET") && !sql.includes("ingestion_owner=")) {
        for (const match of sql.matchAll(/([a-z_]+)=\$(\d+)/g))
          if (match[1] !== "id") data.property[match[1]] = args[Number(match[2]) - 1];
        rows = [structuredClone(data.property)];
      } else if (sql.startsWith("INSERT INTO mls_ingestion_receipts"))
        data.receipt = { payload_hash: args[6], response: null };
      else if (sql.startsWith("UPDATE mls_ingestion_receipts SET response"))
        data.receipt.response = JSON.parse(args[1]);
      else if (
        /^(INSERT INTO|UPDATE|LOCK TABLE|SET LOCAL|SET TRANSACTION|SELECT pg_advisory|SELECT set_config)/.test(
          sql,
        )
      ) {
      } else throw Error("UNEXPECTED_SQL: " + sql);
      return { rows };
    },
  };
  return {
    client,
    calls,
    get data() {
      return data;
    },
  };
}

test("saved capture time is distinct from accepted envelope time", () => {
  const decoded = decodeSnapshot(patch(), { controlledPatch: true });
  assert.equal(decoded.records[0].fetchedAt, captured);
  assert.equal(decoded.scrapedAt, accepted);
});
for (const [name, change] of [
  ["missing", (p) => delete p.listings[0].captured_at],
  ["future", (p) => (p.listings[0].captured_at = "2099-01-01T00:00:00Z")],
  ["invalid", (p) => (p.listings[0].captured_at = "yesterday")],
  [
    "conflicting provider",
    (p) =>
      (p.listings[0].raw_payload = { provider_provenance: { fetchedAt: "2026-09-07T01:00:00Z" } }),
  ],
  ["forbidden projection", (p) => (p.meta.controlled_patch.projection_fields = ["status"])],
  ["missing field mask", (p) => delete p.meta.controlled_patch.projection_fields],
  ["missing frozen identities", (p) => delete p.meta.controlled_patch.expectations],
])
  test("saved controlled patch rejects " + name, () => {
    const p = patch();
    change(p);
    assert.throws(() => decodeSnapshot(p, { controlledPatch: true }));
  });

test("real native writer preserves description, staff and images while applying only named fields", async () => {
  const port = memoryPort(),
    p = patch();
  p.listings[0].description = "Saved description outside the reviewed projection";
  const result = await applyIngestion(port.client, p, { controlledPatch: true });
  assert.equal(port.data.property.description, "Keep imported description");
  assert.equal(
    port.data.observation.fields.description,
    "Saved description outside the reviewed projection",
  );
  assert.deepEqual(port.data.observation.projection, {
    mode: "controlled-patch-v1",
    fields: ["price"],
  });
  assert.equal(port.data.property.price, "5380000");
  assert.equal(port.data.property.agent_id, "staff-original");
  assert.deepEqual(port.data.property.images, ["owned.jpg"]);
  assert.equal(result.full_snapshot, false);
  const obs = port.calls.find((x) => x.sql.startsWith("INSERT INTO listing_source_observations"));
  assert.equal(obs.args[8], captured);
});
test("empty field mask is observation-only even when price differs", async () => {
  const port = memoryPort();
  const result = await applyIngestion(port.client, patch([]), { controlledPatch: true });
  assert.equal(port.data.property.price, 5000000);
  assert.equal(port.data.property.description, "Keep imported description");
  assert.equal(result.summary.fields_changed, 0);
});

test("capture guard reads PostgreSQL timestamps without losing microseconds", async () => {
  const port = memoryPort();
  await applyIngestion(port.client, patch(), { controlledPatch: true });
  const read = port.calls.find((c) => c.sql.includes("AS captured_at FROM mls_source_state"));
  assert.match(read.sql, /to_char\(o\.fetched_at AT TIME ZONE 'UTC'/);
  assert.match(read.sql, /SS\.US/);
});

test("saved patch requires prior values for every projected existing field", () => {
  const p = patch();
  p.meta.controlled_patch.expectations[0].fields = {};
  assert.throws(() => decodeSnapshot(p, { controlledPatch: true }));
});
test("observation-only patch cannot implicitly create a canonical", async () => {
  const port = memoryPort({ newTarget: true }),
    p = patch([]);
  p.meta.controlled_patch.expectations[0] = {
    external_id: "123",
    deal_type: "sale",
    property_id: null,
    observation_id: null,
    fields: {},
  };
  p.meta.controlled_patch.atomic_guards.canonicals = [];
  await assert.rejects(
    () => applyIngestion(port.client, p, { controlledPatch: true }),
    (e) => e.code === "patch_creation_fields_required",
  );
  assert.equal(port.data.property, null);
});
test("incoming source review cannot silently commit a projected value", async () => {
  const port = memoryPort(),
    p = patch();
  p.listings[0].raw_payload = {
    source_conflicts: [
      { field: "price", dom: 5380000, json_ld: 1, resolution: "dom", status: "review" },
    ],
  };
  await assert.rejects(
    () => applyIngestion(port.client, p, { controlledPatch: true }),
    (e) => e.code === "patch_source_conflict_requires_review",
  );
  assert.equal(port.data.observation, null);
});

for (const [order, reviewFirst] of [
  ["clean then review", false],
  ["review then clean", true],
])
  test("duplicate source review veto survives " + order, async () => {
    const port = memoryPort(),
      p = patch();
    const clean = { ...p.listings[0], raw_payload: { source_conflicts: [] } };
    const reviewed = {
      ...p.listings[0],
      raw_payload: {
        source_conflicts: [
          { field: "price", dom: 5380000, json_ld: 1, resolution: "dom", status: "review" },
        ],
      },
    };
    p.listings = reviewFirst ? [reviewed, clean] : [clean, reviewed];
    const decoded = decodeSnapshot(p, { controlledPatch: true });
    assert.equal(decoded.records.length, 1);
    assert.equal(decoded.duplicates, 1);
    assert.equal(decoded.records[0].sourceOccurrences.length, 2);
    assert.deepEqual(
      decoded.records[0].sourceOccurrences.map(
        (occurrence) => occurrence.raw.raw_payload.source_conflicts[0]?.status ?? "clean",
      ),
      reviewFirst ? ["review", "clean"] : ["clean", "review"],
    );
    const before = structuredClone(port.data);
    await assert.rejects(
      () => applyIngestion(port.client, p, { controlledPatch: true }),
      (e) => e.code === "patch_source_conflict_requires_review" && e.status === 409,
    );
    assert.deepEqual(port.data, before);
    assert.ok(port.calls.some((call) => call.sql === "ROLLBACK"));
    assert.equal(
      port.calls.some((call) => call.sql === "COMMIT"),
      false,
    );
    assert.equal(
      port.calls.some((call) => call.sql.startsWith("INSERT INTO listing_source_observations")),
      false,
    );
  });

test("clean duplicate source occurrences remain accepted as one observation", async () => {
  const port = memoryPort(),
    p = patch();
  p.listings.push(structuredClone(p.listings[0]));
  const result = await applyIngestion(port.client, p, { controlledPatch: true });
  assert.equal(result.summary.duplicate_count, 1);
  assert.equal(port.data.property.price, "5380000");
  assert.equal(port.data.observation.sourceOccurrences.length, 2);
  assert.equal(
    port.calls.filter((call) => call.sql.startsWith("INSERT INTO listing_source_observations"))
      .length,
    1,
  );
});

test("new cross-source conflict rolls back even without a queued field review", async () => {
  const port = memoryPort({ secondaryConflict: true });
  await assert.rejects(
    () => applyIngestion(port.client, patch(), { controlledPatch: true }),
    (e) => e.code === "patch_projection_requires_review",
  );
  assert.equal(port.data.observation, null);
});
test("new draft checks existing company-group peers before creating a property", async () => {
  const port = memoryPort({ newTarget: true }),
    p = patch();
  p.listings[0].agency_property_no = "A000123";
  p.meta.controlled_patch.projection_fields = ["title_zh", "district_slug", "price"];
  p.meta.controlled_patch.expectations[0] = {
    external_id: "123",
    deal_type: "sale",
    property_id: null,
    observation_id: null,
    fields: {},
  };
  p.meta.controlled_patch.atomic_guards.canonicals = [];
  const base = port.client.query.bind(port.client);
  port.client.query = async (sql, args) => {
    if (sql.startsWith("SELECT g.* FROM property_public_groups g WHERE"))
      return {
        rows: [
          {
            canonical_property_no: "A000123",
            public_listing_no: "A000123",
            review_required: false,
          },
        ],
      };
    if (sql.startsWith("SELECT p.* FROM properties p JOIN")) return { rows: [] };
    if (sql.includes("AS pending_review"))
      return { rows: [{ pending_review: args[4] === "A000123" }] };
    const result = await base(sql, args);
    if (sql.includes("FROM mls_ingestion_policies WHERE"))
      result.rows[0].config.company_number_identity = {
        approved: true,
        version: "company-number-v1",
        approved_by: "synthetic-review",
      };
    return result;
  };
  await assert.rejects(
    () => applyIngestion(port.client, p, { controlledPatch: true }),
    (e) => e.code === "patch_review_required",
  );
  assert.equal(port.data.property, null);
});
test("historical review lookup binds approved company number independently of public group", async () => {
  const port = memoryPort({ newTarget: true }),
    p = patch();
  p.listings[0].agency_property_no = "A000123";
  p.meta.controlled_patch.projection_fields = ["title_zh", "district_slug", "price"];
  p.meta.controlled_patch.expectations[0] = {
    external_id: "123",
    deal_type: "sale",
    property_id: null,
    observation_id: null,
    fields: {},
  };
  p.meta.controlled_patch.atomic_guards.canonicals = [];
  const base = port.client.query.bind(port.client);
  let checked = false;
  port.client.query = async (sql, args) => {
    if (sql.startsWith("SELECT g.* FROM property_public_groups g WHERE"))
      return {
        rows: [
          {
            canonical_property_no: "A000123",
            public_listing_no: "PUBLIC-ALIAS",
            review_required: false,
          },
        ],
      };
    if (sql.startsWith("SELECT p.* FROM properties p JOIN")) return { rows: [] };
    if (sql.includes("AS pending_review")) {
      assert.equal(args[4], "PUBLIC-ALIAS");
      assert.equal(args[5], "A000123");
      assert.equal(args[6], "agent:540");
      assert.equal(args[7], "no-hermes-v2");
      checked = true;
      return { rows: [{ pending_review: true }] };
    }
    const result = await base(sql, args);
    if (sql.includes("FROM mls_ingestion_policies WHERE"))
      result.rows[0].config.company_number_identity = {
        approved: true,
        version: "company-number-v1",
        approved_by: "synthetic-review",
      };
    return result;
  };
  await assert.rejects(
    () => applyIngestion(port.client, p, { controlledPatch: true }),
    (e) => e.code === "patch_review_required",
  );
  assert.equal(checked, true);
  assert.equal(port.data.property, null);
});

test("unapproved company identity policy supplies no historical company matching authority", async () => {
  const port = memoryPort(),
    p = patch();
  p.listings[0].agency_property_no = "A000123";
  const base = port.client.query.bind(port.client);
  let checked = false;
  port.client.query = async (sql, args) => {
    if (sql.includes("AS pending_review")) {
      assert.equal(args[5], null);
      checked = true;
    }
    return base(sql, args);
  };
  await applyIngestion(port.client, p, { controlledPatch: true });
  assert.equal(checked, true);
});

for (const [name, options, code] of [
  ["inactive canonical", { status: "inactive" }, "patch_inactive_requires_review"],
  ["terminal source", { sourceStatus: "delisted" }, "patch_source_lifecycle_requires_review"],
  ["open review", { openReview: true }, "patch_review_required"],
  [
    "newer saved observation",
    { priorCapture: "2026-09-07T00:00:00.123457Z" },
    "patch_capture_stale",
  ],
  ["missing prior capture", { priorCapture: null }, "patch_capture_unverified"],
])
  test("controlled patch refuses " + name + " atomically", async () => {
    const port = memoryPort(options);
    await assert.rejects(
      () => applyIngestion(port.client, patch(), { controlledPatch: true }),
      (e) => e.code === code,
    );
    assert.equal(port.data.observation, null);
    assert.ok(port.calls.some((x) => x.sql === "ROLLBACK"));
  });
test("manual field remains untouched and patch is held instead of silently claiming success", async () => {
  const port = memoryPort({ manualPrice: true });
  await assert.rejects(
    () => applyIngestion(port.client, patch(), { controlledPatch: true }),
    (e) => e.code === "patch_projection_requires_review",
  );
  assert.equal(port.data.property.price, 5000000);
});
test("same payload replay returns its receipt without another observation", async () => {
  const port = memoryPort();
  const p = patch();
  const a = await applyIngestion(port.client, p, { controlledPatch: true });
  const b = await applyIngestion(port.client, p, { controlledPatch: true });
  assert.deepEqual(a, b);
  assert.equal(
    port.calls.filter((x) => x.sql.startsWith("INSERT INTO listing_source_observations")).length,
    1,
  );
});

for (const [name, change] of [
  ["missing guards", (p) => delete p.meta.controlled_patch.atomic_guards],
  [
    "missing contact before-image",
    (p) => delete p.meta.controlled_patch.atomic_guards.sources[0].contact,
  ],
  [
    "missing promotion before-image",
    (p) => delete p.meta.controlled_patch.atomic_guards.sources[0].promotion,
  ],
  ["missing canonical", (p) => (p.meta.controlled_patch.atomic_guards.canonicals = [])],
  [
    "duplicate source",
    (p) =>
      p.meta.controlled_patch.atomic_guards.sources.push(
        p.meta.controlled_patch.atomic_guards.sources[0],
      ),
  ],
  ["null source", (p) => (p.meta.controlled_patch.atomic_guards.sources[0] = null)],
  ["wrong deal", (p) => (p.meta.controlled_patch.atomic_guards.sources[0].deal_type = "rent")],
  [
    "invalid row hash",
    (p) => (p.meta.controlled_patch.atomic_guards.canonicals[0].row_hash = "unknown"),
  ],
])
  test("atomic schema rejects " + name, () => {
    const p = patch();
    change(p);
    assert.throws(
      () => decodeSnapshot(p, { controlledPatch: true }),
      (e) => e.code === "invalid_patch_atomic_guards",
    );
  });

for (const [name, kind, mutate] of [
  [
    "new contact in absent slot",
    "sources",
    (r) =>
      (r.contact = { contact: { name: "Synthetic staff", phone: "synthetic", licence: null } }),
  ],
  ["new tier in absent slot", "sources", (r) => (r.promotion = { promotion_tier: "gold" })],
  ["draft or manual property edit", "canonicals", (r) => (r.row_hash = "c".repeat(32))],
  [
    "manual ownership",
    "canonicals",
    (r) => r.sync_fields.push({ field_name: "description", selection_reason: "manual_override" }),
  ],
  ["group review", "canonicals", (r) => r.groups.push({ review_required: true })],
  ["new group peer", "canonicals", (r) => r.members.push({ property_id: "other" })],
  ["new admin override", "canonicals", (r) => r.overrides.push({ row_hash: "d".repeat(32) })],
])
  test("atomic before-image rejects " + name + " before writes", async () => {
    const port = memoryPort();
    const base = port.client.query.bind(port.client);
    port.client.query = async (sql, args) => {
      const result = await base(sql, args);
      if (sql.includes(`/* controlled_patch_${kind} */`)) mutate(result.rows[0]);
      return result;
    };
    await assert.rejects(
      () => applyIngestion(port.client, patch(), { controlledPatch: true }),
      (e) => e.code === "patch_atomic_precondition_changed",
    );
    assert.equal(port.data.observation, null);
    assert.ok(port.calls.some((c) => c.sql === "ROLLBACK"));
    assert.equal(
      port.calls.some((c) => /^(INSERT|UPDATE|DELETE)/.test(c.sql)),
      false,
    );
  });

test("controlled locks protect absent contacts, tiers and review phantoms before guard reads", async () => {
  const port = memoryPort();
  await applyIngestion(port.client, patch(), { controlledPatch: true });
  const reads = port.calls.findIndex((c) => c.sql.includes("/* controlled_patch_sources */"));
  for (const table of [
    "properties",
    "mls_source_contacts",
    "mls_source_promotion_tiers",
    "property_sync_fields",
    "admin_property_overrides",
    "property_public_groups",
    "property_public_members",
    "mls_ingestion_reviews",
    "mls_ingestion_conflicts",
    "mls_source_state",
    "property_source_links",
  ]) {
    const lock = port.calls.findIndex((c) =>
      c.sql.includes(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`),
    );
    assert.ok(lock >= 0 && lock < reads, table);
  }
  assert.ok(port.calls.some((c) => c.sql === "SET LOCAL lock_timeout = '3s'"));
});

test("matching nonempty contact cannot be cleared by empty incoming fields", async () => {
  const port = memoryPort(),
    p = patch();
  const before = {
    contact: { name: "Synthetic staff", phone: "synthetic", licence: null },
    branches: [],
  };
  p.meta.controlled_patch.atomic_guards.sources[0].contact = before;
  const base = port.client.query.bind(port.client);
  port.client.query = async (sql, args) =>
    sql.includes("/* controlled_patch_sources */")
      ? { rows: [{ external_id: "123", deal_type: "sale", contact: before, promotion: null }] }
      : base(sql, args);
  await assert.rejects(
    () => applyIngestion(port.client, p, { controlledPatch: true }),
    (e) => e.code === "patch_contact_clear_requires_review",
  );
  assert.equal(port.data.observation, null);
});

test("draft and manual fields are checked again before commit", async () => {
  const port = memoryPort({ status: "draft" });
  const base = port.client.query.bind(port.client);
  port.client.query = async (sql, args) => {
    const result = await base(sql, args);
    if (sql.startsWith("INSERT INTO mls_source_contacts")) port.data.property.status = "active";
    return result;
  };
  await assert.rejects(
    () => applyIngestion(port.client, patch(), { controlledPatch: true }),
    (e) => e.code === "patch_protected_fields_changed",
  );
  assert.equal(port.data.property.status, "draft");
  assert.equal(port.data.observation, null);
});

test("promotion writes bind the accepted observation for rollback provenance", async () => {
  const port = memoryPort(),
    p = patch();
  p.listings[0].promotion_tier_raw = "\u9ec3\u91d1";
  const base = port.client.query.bind(port.client);
  port.client.query = async (sql, args) =>
    sql.includes("FROM mls_source_promotion_tiers") && !sql.includes("controlled_patch")
      ? { rows: [] }
      : base(sql, args);
  await applyIngestion(port.client, p, { controlledPatch: true });
  const insert = port.calls.find((c) => c.sql.startsWith("INSERT INTO mls_source_promotion_tiers"));
  const obs = port.calls.find((c) => c.sql.startsWith("INSERT INTO listing_source_observations"));
  assert.deepEqual(insert.args[7], [obs.args[0]]);
});

test("legacy controlled mode cannot bypass atomic guards on a new apply", async () => {
  const port = memoryPort(),
    p = patch();
  delete p.meta.controlled_patch.evidence_mode;
  delete p.meta.controlled_patch.atomic_guards;
  delete p.listings[0].captured_at;
  await assert.rejects(
    () => applyIngestion(port.client, p, { controlledPatch: true }),
    (e) => e.code === "patch_atomic_guards_required",
  );
  assert.equal(
    port.calls.some((c) => /^(INSERT|UPDATE|DELETE)/.test(c.sql)),
    false,
  );
});

test("transaction isolation and timeout are fixed before advisory or row locks", async () => {
  const port = memoryPort();
  await applyIngestion(port.client, patch(), { controlledPatch: true });
  const isolation = port.calls.findIndex(
    (c) => c.sql === "SET TRANSACTION ISOLATION LEVEL READ COMMITTED",
  );
  const firstLock = port.calls.findIndex((c) => c.sql.startsWith("SELECT pg_advisory"));
  assert.ok(isolation > 0 && isolation < firstLock);
});

for (const code of ["55P03", "40P01", "57014"])
  test("lock failure " + code + " rolls back without retry", async () => {
    const port = memoryPort();
    const base = port.client.query.bind(port.client);
    let attempts = 0;
    port.client.query = async (sql, args) => {
      if (sql === "LOCK TABLE mls_source_contacts IN SHARE ROW EXCLUSIVE MODE") {
        attempts++;
        throw Object.assign(Error("synthetic lock failure"), { code });
      }
      return base(sql, args);
    };
    await assert.rejects(
      () => applyIngestion(port.client, patch(), { controlledPatch: true }),
      (e) => e.code === code,
    );
    assert.equal(attempts, 1);
    assert.equal(port.data.observation, null);
    assert.ok(port.calls.some((c) => c.sql === "ROLLBACK"));
  });

test("matching existing empty contact and tier before-images remain admissible", async () => {
  const port = memoryPort(),
    p = patch();
  const expected = p.meta.controlled_patch.atomic_guards.sources[0];
  expected.contact = { contact: { name: null, phone: null, licence: null }, branches: [] };
  expected.promotion = { promotion_tier: "normal" };
  const base = port.client.query.bind(port.client);
  port.client.query = async (sql, args) =>
    sql.includes("/* controlled_patch_sources */")
      ? { rows: [structuredClone(expected)] }
      : base(sql, args);
  const result = await applyIngestion(port.client, p, { controlledPatch: true });
  assert.equal(result.full_snapshot, false);
});

test("previously receipted saved capture without new guards can replay exact hash only", async () => {
  const port = memoryPort(),
    p = patch();
  delete p.meta.controlled_patch.atomic_guards;
  const response = { success: true, receipt_id: "old-receipt", full_snapshot: false };
  port.data.receipt = { payload_hash: hashPayload(p), response };
  assert.deepEqual(await applyIngestion(port.client, p, { controlledPatch: true }), response);
  assert.equal(
    port.calls.some((c) => c.sql === "BEGIN"),
    false,
  );
  p.listings[0].price = 1;
  await assert.rejects(
    () => applyIngestion(port.client, p, { controlledPatch: true }),
    (e) => e.code === "receipt_conflict",
  );
});

test("new saved capture without guards still cannot write", async () => {
  const port = memoryPort(),
    p = patch();
  delete p.meta.controlled_patch.atomic_guards;
  await assert.rejects(
    () => applyIngestion(port.client, p, { controlledPatch: true }),
    (e) => e.code === "invalid_patch_atomic_guards",
  );
  assert.equal(
    port.calls.some((c) => /^(INSERT|UPDATE|DELETE)/.test(c.sql)),
    false,
  );
});

test("newly created draft is also protected immediately before commit", async () => {
  const port = memoryPort({ newTarget: true }),
    p = patch(["title_zh", "district_slug", "price"]);
  p.meta.controlled_patch.atomic_guards.canonicals = [];
  Object.assign(p.meta.controlled_patch.expectations[0], {
    property_id: null,
    observation_id: null,
    fields: {},
  });
  await assert.rejects(
    () =>
      applyIngestion(port.client, p, {
        controlledPatch: true,
        beforeCommit() {
          port.data.property.status = "active";
        },
      }),
    (e) => e.code === "patch_protected_fields_changed",
  );
  assert.equal(port.data.property, null);
});

test("manual canonical value cannot change while its ownership row stays identical", async () => {
  const port = memoryPort({ manualPrice: true }),
    p = patch(["floor"]);
  p.meta.controlled_patch.expectations[0].fields = { floor: null };
  await assert.rejects(
    () =>
      applyIngestion(port.client, p, {
        controlledPatch: true,
        beforeCommit() {
          port.data.property.price = 123;
        },
      }),
    (e) => e.code === "patch_protected_fields_changed",
  );
  assert.equal(port.data.property.price, 5000000);
});

for (const [field, changed] of [
  ["status", "active"],
  ["description", "Unexpected trigger description"],
  ["images", ["unexpected.jpg"]],
  ["agent_id", "unexpected-staff"],
])
  test("post-insert trigger cannot establish an altered draft baseline: " + field, async () => {
    const port = memoryPort({ newTarget: true }),
      p = patch(["title_zh", "district_slug", "price"]);
    p.meta.controlled_patch.atomic_guards.canonicals = [];
    Object.assign(p.meta.controlled_patch.expectations[0], {
      property_id: null,
      observation_id: null,
      fields: {},
    });
    const base = port.client.query.bind(port.client);
    port.client.query = async (sql, args) => {
      const result = structuredClone(await base(sql, args));
      if (sql.startsWith("INSERT INTO properties(")) port.data.property[field] = changed;
      return result;
    };
    await assert.rejects(
      () => applyIngestion(port.client, p, { controlledPatch: true }),
      (e) => e.code === "patch_protected_fields_changed",
    );
    assert.equal(port.data.property, null);
    assert.equal(
      port.calls.some((c) => c.sql === "COMMIT"),
      false,
    );
  });

test("null-winning ownership value cannot change outside the projection mask", async () => {
  const port = memoryPort({ unassignedPrice: true }),
    p = patch(["floor"]);
  p.meta.controlled_patch.expectations[0].fields = { floor: null };
  await assert.rejects(
    () =>
      applyIngestion(port.client, p, {
        controlledPatch: true,
        beforeCommit() {
          port.data.property.price = 123;
        },
      }),
    (e) => e.code === "patch_protected_fields_changed",
  );
  assert.equal(port.data.property.price, 5000000);
});

test("unchanged null-winning ownership is not a false veto", async () => {
  const port = memoryPort({ unassignedPrice: true }),
    p = patch(["floor"]);
  p.meta.controlled_patch.expectations[0].fields = { floor: null };
  const result = await applyIngestion(port.client, p, { controlledPatch: true });
  assert.equal(result.success, true);
  assert.equal(port.data.property.price, 5000000);
});

test("protected ownership exports redact both last and override values", async () => {
  const { readPatchBeforeImages } = await import("./controlled-patch-preconditions.mjs");
  const r = await readPatchBeforeImages(
    async (sql) =>
      sql.includes("controlled_patch_sources")
        ? []
        : [
            {
              property_id: "11111111-1111-4111-8111-111111111111",
              row_hash: "a".repeat(32),
              groups: [],
              members: [],
              overrides: [],
              sync_fields: [
                {
                  field_name: "description",
                  last_published_value: null,
                  last_published_hash: "b".repeat(32),
                  override_value: "SYNTHETIC_PRIVATE_OVERRIDE",
                },
              ],
            },
          ],
    "28hse_agent_540",
    [],
  );
  assert.equal(JSON.stringify(r).includes("SYNTHETIC_PRIVATE_OVERRIDE"), false);
  assert.equal(
    r.canonicals[0].sync_fields[0].override_value_hash,
    hashPayload("SYNTHETIC_PRIVATE_OVERRIDE"),
  );
});

test("isolated native DB fixtures create their own promotion table and observation FK", () => {
  const source = readFileSync(
    new URL("./ingestion-repository.db.test.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes('"20260909120000_source_promotion_tiers.sql"'));
});

for (const [name, change] of [
  [
    "canonical binding",
    (p) =>
      (p.meta.controlled_patch.expectations[0].property_id =
        "22222222-2222-4222-8222-222222222222"),
  ],
  [
    "source observation",
    (p) => (p.meta.controlled_patch.expectations[0].observation_id = "newer-id"),
  ],
  ["prior field value", (p) => (p.meta.controlled_patch.expectations[0].fields.price = 1)],
])
  test("frozen " + name + " drift refuses the entire patch", async () => {
    const port = memoryPort(),
      p = patch();
    change(p);
    await assert.rejects(
      () => applyIngestion(port.client, p, { controlledPatch: true }),
      (e) =>
        e.code ===
        (name === "canonical binding"
          ? "invalid_patch_atomic_guards"
          : "patch_expectation_changed"),
    );
    assert.equal(port.data.observation, null);
  });
