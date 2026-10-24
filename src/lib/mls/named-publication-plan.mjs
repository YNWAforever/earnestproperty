import { canonicalJson, hashPayload } from "./ingestion-contract.mjs";
import {
  assertReviewEvidence,
  hasUnreviewedSourceConflict,
  rejectedHistoricalReviewKeys,
} from "./controlled-review-plan.mjs";

const keys = (value, names) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  canonicalJson(Object.keys(value).sort()) === canonicalJson([...names].sort());
const uuid = (value) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value ?? "");
const fail = (code) => {
  throw Error(code);
};

export function validateNamedPublicationPlan(batch, { publicationPlan, publicationPlanHash } = {}) {
  if (publicationPlan === undefined && publicationPlanHash === undefined) return null;
  if (
    !publicationPlan ||
    !/^[a-f0-9]{64}$/.test(publicationPlanHash ?? "") ||
    hashPayload(publicationPlan) !== publicationPlanHash
  )
    fail("PUBLICATION_PLAN_HASH_MISMATCH");
  const plan = structuredClone(publicationPlan);
  if (
    !keys(plan, [
      "version",
      "source",
      "scope_id",
      "policy_version",
      "payload_hash",
      "approval_ref",
      "targets",
    ]) ||
    plan.version !== "named-publication-v1" ||
    plan.source !== "28hse_agent_540" ||
    plan.source !== batch.source ||
    plan.scope_id !== "agent:540" ||
    plan.scope_id !== batch.scopeId ||
    plan.policy_version !== batch.policyVersion ||
    plan.payload_hash !== batch.hash ||
    !/^PUBLICATION-[A-Za-z0-9][A-Za-z0-9._:/-]{0,140}$/.test(plan.approval_ref ?? "") ||
    !Array.isArray(plan.targets) ||
    plan.targets.length !== 1
  )
    fail("INVALID_PUBLICATION_PLAN");
  const target = plan.targets[0];
  if (
    !keys(target, [
      "external_id",
      "deal_type",
      "property_id",
      "agency_property_no",
      "observation_id",
      "source_link_id",
      "canonical_row_hash",
      "dom_conflict",
      "historical",
    ]) ||
    !/^\d+$/.test(target.external_id ?? "") ||
    !["sale", "rent"].includes(target.deal_type) ||
    !uuid(target.property_id) ||
    !uuid(target.observation_id) ||
    !uuid(target.source_link_id) ||
    !/^[a-f0-9]{32}$/.test(target.canonical_row_hash ?? "") ||
    !/^[A-Z]\d{6}$/.test(target.agency_property_no ?? "")
  )
    fail("INVALID_PUBLICATION_TARGET");
  const records = publicationRecords(batch, plan).filter(
    (r) => r.externalId === target.external_id && r.dealType === target.deal_type,
  );
  if (records.length !== 1 || records[0].agencyPropertyNo !== target.agency_property_no)
    fail("PUBLICATION_TARGET_MISSING_OR_CHANGED");
  assertReviewEvidence(records[0], target);
  if (hasUnreviewedSourceConflict(records[0], plan)) fail("PUBLICATION_SOURCE_CONFLICT_UNREVIEWED");
  return plan;
}

export function publicationRecords(batch, plan) {
  const records = plan
    ? batch.records.filter(
        (r) =>
          r.externalId === plan.targets[0].external_id && r.dealType === plan.targets[0].deal_type,
      )
    : batch.records;
  return records.map((record) => ({
    ...record,
    fetchedAt: originalCapture(record.raw, record.fetchedAt),
  }));
}

function originalCapture(raw, envelope) {
  const provider = raw.raw_payload?.provider_provenance;
  if (provider && (!raw.captured_at || raw.captured_at !== provider.fetchedAt)) return "";
  return raw.captured_at ?? envelope;
}

export function sourceCaptureFresh(record, now) {
  return [
    record.fetchedAt,
    ...(record.sourceOccurrences ?? []).map((o) => originalCapture(o.raw ?? {}, record.fetchedAt)),
  ].every(
    (stamp) =>
      Number.isFinite(Date.parse(stamp)) &&
      now - Date.parse(stamp) <= 36 * 3600000 &&
      Date.parse(stamp) <= now + 60000,
  );
}

export async function assertNamedPublicationTarget(q, batch, record, property, plan) {
  if (!plan) return;
  const target = plan.targets[0];
  if (
    !property ||
    property.id !== target.property_id ||
    property.status !== "draft" ||
    property.observation_id !== target.observation_id ||
    property.canonical_row_hash !== target.canonical_row_hash ||
    property.canonical_property_no !== target.agency_property_no ||
    property.external_listing_id !== target.external_id ||
    property.deal_type !== target.deal_type
  )
    fail("PUBLICATION_TARGET_CHANGED");
  if (target.dom_conflict && property.bedrooms !== record.fields.bedrooms)
    fail("PUBLICATION_DOM_CANONICAL_CHANGED");
  const link = (
    await q(
      `SELECT /* publication_source_link */ * FROM property_source_links
    WHERE source=$1 AND external_listing_id=$2 AND deal_type=$3`,
      [batch.source, record.externalId, record.dealType],
    )
  )[0];
  if (link?.id !== target.source_link_id) fail("PUBLICATION_SOURCE_LINK_CHANGED");
  await rejectedHistoricalReviewKeys(
    q,
    batch,
    record,
    { property_id: property.id },
    { propertyId: property.id },
    property,
    plan,
    link,
  );
}
