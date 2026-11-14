import assert from "node:assert/strict";
import test from "node:test";
import { SOURCE_28HSE } from "./source-contract.mjs";
import { POLICY_VERSION } from "./ingestion-contract.mjs";
import { SOURCE_AUTHORITY_POLICY } from "./source-authority-policy.mjs";
import { planAuthorityOverrides, applyAuthorityOverrides } from "./source-authority-overrides.mjs";

const propertyId = "11111111-1111-4111-8111-111111111111";
const otherPropertyId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const approval = {
  version: SOURCE_AUTHORITY_POLICY,
  approved: true,
  approval_ref: "owner:28hse-authority-2026-11-14",
  source: SOURCE_28HSE,
  scope_id: "agent:540",
  policy_version: POLICY_VERSION,
};
const input = (fields = ["bedrooms", "price"]) => ({
  propertyNo: "C014574",
  propertyId,
  dealType: "sale",
  fields,
  approval,
  inputSha256: "a".repeat(64),
  runId,
});
const override = (value = {}) => ({
  property_no: "C014574",
  shared: {},
  sale: {},
  rent: {},
  revision: "7",
  updated_by: otherPropertyId,
  ...value,
});

function port({ overrides = null, fields = [], auditError = null } = {}) {
  const calls = [];
  const q = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT * FROM admin_property_overrides"))
      return overrides ? [structuredClone(overrides)] : [];
    if (sql.startsWith("SELECT * FROM property_sync_fields"))
      return structuredClone(
        fields.filter(
          (field) => field.property_id === params[0] && params[1].includes(field.field_name),
        ),
      );
    if (sql.startsWith("INSERT INTO audit_logs")) {
      if (auditError) throw auditError;
      return [];
    }
    if (sql.startsWith("UPDATE admin_property_overrides")) return [{ property_no: params[0] }];
    if (sql.startsWith("UPDATE property_sync_fields"))
      return params[1].map((field_name) => ({ field_name }));
    throw Error("Unexpected SQL");
  };
  return { q, calls };
}

const field = (field_name, values = {}) => ({
  property_id: propertyId,
  field_name,
  active_override: true,
  override_value: 4,
  last_published_value: 4,
  winning_observation_id: null,
  selection_reason: "manual_override",
  policy_version: "owner-keep-current-v1",
  ...values,
});

test("observed shared facts transfer only this deal while opposite effective values remain", () => {
  const before = override({
    shared: {
      bedrooms: 4,
      images: ["retained.jpg"],
      status: "inactive",
      agent_id: otherPropertyId,
    },
    sale: { bedrooms: 3, price: 123, featured: true },
    rent: { rent: 24000 },
  });
  const saved = structuredClone(before);
  const result = planAuthorityOverrides(before, "sale", ["bedrooms", "images", "status", "price"]);
  assert.equal(result.changed, true);
  assert.deepEqual(result.changedFields, ["bedrooms", "images", "price", "status"]);
  assert.deepEqual(result.shared, { agent_id: otherPropertyId });
  assert.deepEqual(result.sale, { featured: true });
  assert.deepEqual(result.rent, {
    rent: 24000,
    bedrooms: 4,
    images: ["retained.jpg"],
    status: "inactive",
  });
  assert.deepEqual(before, saved);
});

test("explicit opposite deal keys including null win over previous shared overrides", () => {
  const result = planAuthorityOverrides(
    override({ shared: { bedrooms: 4, floor: "high" }, rent: { bedrooms: null, floor: "low" } }),
    "sale",
    ["bedrooms", "floor"],
  );
  assert.deepEqual(result.shared, {});
  assert.deepEqual(result.rent, { bedrooms: null, floor: "low" });
});

test("price and rent are scoped to their deal and never copied to the opposite patch", () => {
  const before = override({
    shared: { price: 100, rent: 20 },
    sale: { price: 110, rent: 30 },
    rent: { rent: 40, price: 200 },
  });
  const sale = planAuthorityOverrides(before, "sale", ["price", "rent"]);
  assert.deepEqual(sale.fields, ["price"]);
  assert.deepEqual(sale.shared, { rent: 20 });
  assert.deepEqual(sale.sale, { rent: 30 });
  assert.deepEqual(sale.rent, before.rent);
  const rent = planAuthorityOverrides(before, "rent", ["price", "rent"]);
  assert.deepEqual(rent.fields, ["rent"]);
  assert.deepEqual(rent.shared, { price: 100 });
  assert.deepEqual(rent.sale, before.sale);
  assert.deepEqual(rent.rent, { price: 200 });
});

test("unobserved data, staff assignment and SEO are preserved despite requested unrelated keys", () => {
  const before = override({
    shared: {
      agent_id: otherPropertyId,
      seo_title: "staff SEO",
      address: "old address",
      bedrooms: 4,
    },
    sale: { description: "unobserved description", featured: true },
  });
  const result = planAuthorityOverrides(before, "sale", [
    "bedrooms",
    "agent_id",
    "seo_title",
    "featured",
  ]);
  assert.deepEqual(result.fields, ["bedrooms"]);
  assert.deepEqual(result.shared, {
    agent_id: otherPropertyId,
    seo_title: "staff SEO",
    address: "old address",
  });
  assert.deepEqual(result.sale, before.sale);
  assert.deepEqual(result.rent, { bedrooms: 4 });
});

test("absent overrides and unobserved fields are no-ops; malformed input fails closed", () => {
  assert.equal(planAuthorityOverrides(null, "sale", ["price"]).changed, false);
  assert.equal(
    planAuthorityOverrides(override({ shared: { bedrooms: 4 } }), "sale", []).changed,
    false,
  );
  assert.throws(() => planAuthorityOverrides(null, "invalid", []), /DEAL_INVALID/);
  assert.throws(() => planAuthorityOverrides(null, "sale", "price"), /FIELDS_INVALID/);
  assert.throws(
    () => planAuthorityOverrides(override({ shared: [] }), "sale", []),
    /OVERRIDES_INVALID/,
  );
});

test("invalid approval or identity is rejected before any SQL", async () => {
  for (const edit of [
    { approval: null },
    { approval: { ...approval, approved: false } },
    { approval: { ...approval, version: "wrong" } },
    { approval: { ...approval, source: "propertyhk" } },
    { approval: { ...approval, scope_id: "agent:999" } },
    { approval: { ...approval, policy_version: "wrong" } },
    { approval: { ...approval, approval_ref: "" } },
    { approval: { ...approval, approval_ref: "contains whitespace" } },
    { approval: { ...approval, approval_ref: 123 } },
    { propertyNo: "not canonical" },
    { propertyId: [propertyId] },
    { propertyId: "not UUID" },
    { runId: "not UUID" },
    { inputSha256: "not hash" },
    { fields: [null] },
  ]) {
    const db = port();
    await assert.rejects(() => applyAuthorityOverrides(db.q, { ...input(), ...edit }));
    assert.equal(db.calls.length, 0);
  }
});

test("writer audits complete previous state before removing only target observed protections", async () => {
  const before = override({
    shared: { bedrooms: 4, agent_id: otherPropertyId },
    sale: { price: 1 },
  });
  const observedField = field("bedrooms");
  const db = port({
    overrides: before,
    fields: [observedField, field("agent_id"), field("bedrooms", { property_id: otherPropertyId })],
  });
  const result = await applyAuthorityOverrides(db.q, input());
  assert.deepEqual(result, {
    changed: true,
    overrideFields: ["bedrooms", "price"],
    syncFields: ["bedrooms"],
  });
  assert.deepEqual(db.calls[0].params, ["C014574"]);
  assert.match(db.calls[0].sql, /FOR UPDATE$/);
  assert.deepEqual(db.calls[1].params, [propertyId, ["bedrooms", "price"]]);
  assert.match(db.calls[1].sql, /FOR UPDATE$/);
  assert.match(db.calls[2].sql, /^INSERT INTO audit_logs/);
  const audit = JSON.parse(db.calls[2].params[1]);
  assert.deepEqual(audit.overrides_before, before);
  assert.deepEqual(audit.sync_fields_before, [observedField]);
  assert.equal(audit.approval_ref, approval.approval_ref);
  assert.equal(audit.input_sha256, input().inputSha256);
  assert.equal(audit.run_id, runId);
  assert.deepEqual(audit.overrides_after, {
    shared: { agent_id: otherPropertyId },
    sale: {},
    rent: { bedrooms: 4 },
  });
  const flags = db.calls.find((call) => call.sql.startsWith("UPDATE property_sync_fields"));
  assert.deepEqual(flags.params, [propertyId, ["bedrooms"]]);
  assert.match(flags.sql, /active_override=false,override_value=NULL/);
  assert.doesNotMatch(
    flags.sql,
    /SET[^]*selection_reason=|SET[^]*winning_observation_id=|SET[^]*last_published_value=/,
  );
  assert.ok(db.calls.slice(3).every((call) => call.sql.startsWith("UPDATE ")));
  assert.ok(db.calls.every((call) => !/^(BEGIN|COMMIT|ROLLBACK|DELETE)/.test(call.sql)));
});

test("only changed JSON scopes are updated and revisions advance once", async () => {
  const db = port({ overrides: override({ sale: { price: 123 }, rent: { rent: 30 } }) });
  await applyAuthorityOverrides(db.q, input(["price", "rent"]));
  const update = db.calls.find((call) => call.sql.startsWith("UPDATE admin_property_overrides"));
  assert.match(update.sql, /SET sale=\$2::jsonb,revision=revision\+1,updated_at=/);
  assert.doesNotMatch(update.sql, /shared=|rent=/);
  assert.deepEqual(update.params, ["C014574", "{}"]);
});

test("flags-only handover is audited without inventing an override row", async () => {
  const db = port({
    fields: [
      field("bedrooms", { active_override: false, override_value: 0 }),
      field("price", { active_override: false, override_value: null }),
    ],
  });
  const result = await applyAuthorityOverrides(db.q, input());
  assert.deepEqual(result, { changed: true, overrideFields: [], syncFields: ["bedrooms"] });
  assert.equal(
    db.calls.some((call) => call.sql.startsWith("UPDATE admin_property_overrides")),
    false,
  );
  const audit = JSON.parse(
    db.calls.find((call) => call.sql.startsWith("INSERT INTO audit_logs")).params[1],
  );
  assert.equal(audit.overrides_before, null);
});

test("no protections causes no audit or mutations; unrelated-only fields cause no SQL", async () => {
  const db = port({ fields: [field("price", { active_override: false, override_value: null })] });
  assert.deepEqual(await applyAuthorityOverrides(db.q, input()), {
    changed: false,
    overrideFields: [],
    syncFields: [],
  });
  assert.equal(db.calls.length, 2);
  const unrelated = port();
  await applyAuthorityOverrides(unrelated.q, input(["agent_id", "seo_title", "rent"]));
  assert.equal(unrelated.calls.length, 0);
});

test("an audit failure prevents every override mutation", async () => {
  const db = port({
    overrides: override({ sale: { price: 1 } }),
    fields: [field("price")],
    auditError: Error("audit unavailable"),
  });
  await assert.rejects(() => applyAuthorityOverrides(db.q, input()), /audit unavailable/);
  assert.equal(db.calls.length, 3);
  assert.equal(
    db.calls.some((call) => call.sql.startsWith("UPDATE ")),
    false,
  );
});
