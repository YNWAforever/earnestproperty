import { groupNewCompanyProperty } from "./company-number.mjs";
import { randomUUID } from "node:crypto";
import { hashPayload, normalizeDecimal } from "./ingestion-contract.mjs";
import { cachedMediaInput } from "./saved-capture-import.mjs";
import { resolveSavedEstate, readSavedEstateCatalog } from "./saved-capture-estates.mjs";
import { createObservation, SOURCE_28HSE } from "./source-contract.mjs";
import { createSyncRepository } from "./sync-repository.mjs";
import { prepareListingMedia } from "./media.mjs";
import { writeSyncFields } from "./ingestion-batch-writes.mjs";
import {
  configurePatchTransaction,
  lockPatchPreconditions,
} from "./controlled-patch-preconditions.mjs";
import { createImportedDraft } from "./ingestion-repository.mjs";
import { CURRENT_PUBLIC_OFFERING_ORDER } from "../neon/public-listing-query.js";
export const OWNER_PUBLICATION_POLICY = "owner-publication-v1";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const ownerSourceKey = (row) => `owner-capture-${row.record.agency_property_no}-${row.deal}`;
export function decideOwnerTarget(row, snapshot, choices = {}) {
  if (row.id === "4028435") return { action: "skip", reason: "owner_sold_leave_untouched" };
  if (row.failures.length) return { action: "held", reason: "capture_validation_failed" };
  const candidates = snapshot.candidates,
    choice = choices[row.record.agency_property_no];
  if (choice && (!uuid.test(choice) || !candidates.some((p) => p.id === choice)))
    return { action: "held", reason: "choice_not_a_matching_candidate" };
  if (candidates.length > 1 && !choice) return { action: "held", reason: "ambiguous_ref_and_deal" };
  const target = choice ? candidates.find((p) => p.id === choice) : candidates[0];
  if (target && !["draft", "inactive", "active"].includes(target.status))
    return { action: "held", reason: "target_status_requires_review", target };
  return { action: target ? "update" : "create", target: target ?? null, chosen: Boolean(choice) };
}
export function ownerValues(row, resolution, images) {
  return {
    title_zh: row.record.title,
    canonical_property_no: row.record.agency_property_no,
    deal_type: row.deal,
    status: "active",
    description: row.record.description,
    price: row.record.price,
    rent: row.record.rent,
    saleable_area: row.record.saleable_area,
    gross_area: row.record.gross_area,
    bedrooms: row.record.bedrooms,
    bathrooms: row.record.bathrooms,
    floor: row.record.floor,
    orientation: row.record.orientation,
    estate_id: resolution.estate_id,
    district_slug: ["4044249", "4062592"].includes(row.id) ? "" : (resolution.district_slug ?? ""),
    address: row.extras.address,
    features: row.extras.features,
    images,
    video_url: row.extras.video_url ?? null,
    floorplan_url: null,
    source_site: "28hse",
    source_url: row.record.source_url,
    source_updated_at: row.ownerSourceDate ?? null,
  };
}
export async function readOwnerTarget(client, row) {
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  const ref = row.record.agency_property_no,
    deal = row.deal;
  const candidates = await q(
    `SELECT p.*,m.public_listing_no,md5(to_jsonb(p)::text) AS row_hash
 FROM properties p LEFT JOIN property_public_members m ON m.property_id=p.id
 LEFT JOIN property_public_groups g ON g.public_listing_no=m.public_listing_no
 WHERE p.deal_type=$2 AND (p.canonical_property_no=$1 OR p.legacy_property_no=$1 OR p.listing_no=$1 OR m.public_listing_no=$1 OR g.canonical_property_no=$1) ORDER BY p.id`,
    [ref, deal],
  );
  const ids = candidates.map((p) => p.id);
  const groups = await q(
    "SELECT * FROM property_public_groups WHERE public_listing_no=$1 OR canonical_property_no=$1 OR public_listing_no=ANY($2::text[]) ORDER BY public_listing_no",
    [ref, candidates.map((p) => p.public_listing_no).filter(Boolean)],
  );
  const scope = groups.map((g) => g.public_listing_no);
  const overrides = await q(
    "SELECT * FROM admin_property_overrides WHERE property_no=ANY($1::text[]) AND (shared<>'{}'::jsonb OR CASE $2 WHEN 'sale' THEN sale ELSE rent END<>'{}'::jsonb)",
    [scope, deal],
  );
  const fields = await q(
    "SELECT * FROM property_sync_fields WHERE property_id=ANY($1::uuid[]) ORDER BY property_id,field_name",
    [ids],
  );
  const conflicts = await q(
    "SELECT * FROM mls_ingestion_conflicts WHERE property_id=ANY($1::uuid[]) AND review_status='unreviewed'",
    [ids],
  );
  // Resolve a review only when its binding is this property (never a stale reused-ID target),
  // or it is unbound and its immutable observation identifies this ref+deal.
  const reviews = await q(
    `SELECT r.*,coalesce(nullif(o.property_no_normalized,''),nullif(o.payload#>>'{identity,agency_property_no}',''),nullif(o.payload#>>'{raw,agency_property_no}','')) AS observation_ref,
 ARRAY(SELECT DISTINCT b.property_id::text FROM (
 SELECT l.property_id FROM property_source_links l WHERE l.source=r.source AND l.external_listing_id=r.external_listing_id AND l.deal_type=r.deal_type AND l.status='active'
 UNION SELECT s.property_id FROM mls_source_state s WHERE s.source=r.source AND s.external_listing_id=r.external_listing_id AND s.deal_type=r.deal_type AND s.property_id IS NOT NULL) b ORDER BY b.property_id::text) AS bound_ids
 FROM mls_ingestion_reviews r LEFT JOIN listing_source_observations o ON o.id=r.observation_id AND o.source=r.source AND o.external_listing_id=r.external_listing_id AND o.deal_type=r.deal_type
 WHERE r.source='28hse_agent_540' AND r.deal_type=$2 AND r.status='open' AND
 (coalesce(nullif(o.property_no_normalized,''),nullif(o.payload#>>'{identity,agency_property_no}',''),nullif(o.payload#>>'{raw,agency_property_no}',''))=$1 OR EXISTS(SELECT 1 FROM property_source_links l WHERE l.source=r.source AND l.external_listing_id=r.external_listing_id AND l.deal_type=r.deal_type AND l.property_id=ANY($3::uuid[])) OR EXISTS(SELECT 1 FROM mls_source_state s WHERE s.source=r.source AND s.external_listing_id=r.external_listing_id AND s.deal_type=r.deal_type AND s.property_id=ANY($3::uuid[]))) ORDER BY r.review_key`,
    [ref, deal, ids],
  );
  const links = await q(
    "SELECT * FROM property_source_links WHERE source=$1 AND external_listing_id=$2 AND deal_type=$3",
    [SOURCE_28HSE, ownerSourceKey(row), deal],
  );
  const audits = await q(
    "SELECT subject_id,metadata FROM audit_logs WHERE action=$1 AND subject_id=ANY($2::uuid[]) ORDER BY created_at,id",
    [OWNER_PUBLICATION_POLICY, ids],
  );
  return { candidates, groups, overrides, fields, conflicts, reviews, links, audits };
}
function targetReviews(row, snapshot, target) {
  return snapshot.reviews.filter((r) => {
    const ids = Array.isArray(r.bound_ids) ? r.bound_ids : [];
    return ids.length
      ? Boolean(target && ids.every((id) => id === target.id))
      : r.observation_ref === row.record.agency_property_no;
  });
}
export function ownerDecision(row, snapshot, resolution, choices = {}, inputSha256) {
  const decision = decideOwnerTarget(row, snapshot, choices);
  if (["skip", "held"].includes(decision.action))
    return { ...decision, snapshot, resolution, reviews: [] };
  const ref = row.record.agency_property_no,
    target = decision.target;
  const reviews = targetReviews(row, snapshot, target);
  let reason = null;
  if (target?.canonical_property_no && target.canonical_property_no !== ref)
    reason = "target_company_reference_disagrees";
  if (resolution.status === "ambiguous") reason = "estate_match_ambiguous";
  if (!resolution.district_slug && !["4044249", "4062592"].includes(row.id))
    reason = "district_unresolved";
  if (
    snapshot.overrides.length ||
    snapshot.fields.some(
      (f) =>
        (!target || f.property_id === target.id) &&
        (f.active_override || f.selection_reason === "manual_override"),
    )
  )
    reason = "manual_ownership_requires_review";
  if (snapshot.conflicts.some((c) => !target || c.property_id === target.id))
    reason = "unreviewed_conflict";
  if (snapshot.groups.some((g) => g.public_listing_no === ref && g.canonical_property_no !== ref))
    reason = "agency_group_collision";
  if (snapshot.groups.some((g) => g.review_required) && !decision.chosen)
    reason = "group_review_requires_choice";
  if (snapshot.links.some((l) => !target || l.property_id !== target.id))
    reason = "owner_provenance_collision";
  // Same frozen input and capture fingerprint is already published, even if staff
  // later set the row inactive or draft. A new hash is a new publication.
  const sameCapture =
    Boolean(target) &&
    snapshot.audits.some((audit) => {
      const metadata =
        typeof audit.metadata === "string" ? JSON.parse(audit.metadata) : (audit.metadata ?? {});
      return (
        audit.subject_id === target.id &&
        metadata.input_sha256 === inputSha256 &&
        metadata.capture_fingerprint === row.fingerprint
      );
    });
  if (target?.status === "active" && !sameCapture)
    reason = reason ?? "active_row_changed_or_not_owner_published";
  return {
    ...decision,
    action: reason ? "held" : sameCapture ? "already-published" : decision.action,
    reason,
    snapshot,
    resolution,
    reviews,
  };
}
const fingerprint = (d) =>
  hashPayload({
    snapshot: d.snapshot,
    resolution: d.resolution,
    reviews: d.reviews,
    action: d.action,
    target: d.target?.id ?? null,
  });
export async function inspectOwnerPublication(client, plan, { choices = {}, inputSha256 } = {}) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    if ((await client.query("SHOW transaction_read_only")).rows[0]?.transaction_read_only !== "on")
      throw Error("OWNER_READ_ONLY_REQUIRED");
    const catalog = await readSavedEstateCatalog(client.query.bind(client)),
      items = [];
    for (const row of plan.rows) {
      if (row.id === "4028435") {
        items.push({
          row,
          action: "skip",
          reason: "owner_sold_leave_untouched",
          reviews: [],
          snapshot: { candidates: [] },
        });
        continue;
      }
      const snapshot = await readOwnerTarget(client, row);
      const resolution = resolveSavedEstate(
        row.record,
        row.extras,
        catalog.estates,
        catalog.districts,
      );
      items.push({ row, ...ownerDecision(row, snapshot, resolution, choices, inputSha256) });
    }
    return items;
  } finally {
    await client.query("ROLLBACK");
  }
}
export function ownerReportItems(items) {
  return items.map((item) => ({
    source_id: item.row.id,
    ref: item.row.record.agency_property_no,
    deal: item.row.deal,
    action: item.action,
    reason: item.reason ?? null,
    target_id: item.target?.id ?? null,
    before: item.target
      ? {
          status: item.target.status,
          listing_no: item.target.listing_no,
          public_listing_no: item.target.public_listing_no,
          price: item.target.price,
          rent: item.target.rent,
          photo_count: item.target.images?.length ?? 0,
        }
      : null,
    after: ["skip", "held"].includes(item.action)
      ? null
      : item.action === "already-published"
        ? {
            status: item.target?.status ?? null,
            internal_listing_no: item.target?.listing_no ?? null,
            public_listing_no: item.target?.public_listing_no ?? null,
            price: item.target?.price ?? null,
            rent: item.target?.rent ?? null,
            photo_count: item.target?.images?.length ?? 0,
            images: "unchanged",
          }
        : {
            ...ownerValues(item.row, item.resolution, []),
            internal_listing_no: item.target?.listing_no ?? "SYNC-<generated UUID>",
            public_listing_no: item.row.record.agency_property_no,
            photo_count: item.row.photos.length,
            images: "ALL validated captured photos -> owned Blob URLs",
          },
    saved_map_open_review_count: item.reported_open_reviews ?? null,
    reviews_resolved: (["create", "update"].includes(item.action) ? (item.reviews ?? []) : []).map(
      (r) => ({
        review_key: r.review_key,
        reason: r.reason,
        resolution: "owner-publication",
      }),
    ),
    candidates: (item.snapshot?.candidates ?? []).map((p) => ({
      id: p.id,
      listing_no: p.listing_no,
      status: p.status,
      created_at: p.created_at,
      price: p.price,
      rent: p.rent,
      photos: p.images ?? [],
      photo_count: p.images?.length ?? 0,
    })),
    warnings: item.row.warnings,
    validation_failures: item.row.failures,
  }));
}
// node-pg builds a DATE as local midnight. Local calendar fields stay on that
// day; toISOString() moves it to the previous UTC day east of UTC.
export function sourceCalendarDay(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${day}`;
  }
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    if (match) return match[1];
  }
  return null;
}
export function sameField(actual, expected, field) {
  if (["price", "rent", "saleable_area", "gross_area", "bedrooms", "bathrooms"].includes(field))
    return normalizeDecimal(actual) === normalizeDecimal(expected);
  if (field === "source_updated_at") {
    if (actual == null && expected == null) return true;
    const left = sourceCalendarDay(actual);
    const right = sourceCalendarDay(expected);
    return left !== null && left === right;
  }
  return hashPayload(actual ?? null) === hashPayload(expected ?? null);
}
// Media registration is buffered: no DB writes, even temporary ones, before upload succeeds.
async function stageMedia(client, row, propertyId, observationId, blobStore, expectedHost) {
  const repository = createSyncRepository({ client }),
    registrations = [],
    records = [];
  const buffered = {
    findMediaByUrls: repository.findMediaByUrls,
    findMediaByHash: async (hash) => {
      const asset = await repository.findMediaByHash(hash);
      if (asset && new URL(asset.url).hostname !== expectedHost)
        throw Error("OWNER_MEDIA_STORE_MISMATCH");
      return asset;
    },
    registerOwnedMedia: async (input) => {
      const asset = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
      registrations.push({ input, asset });
      return { outcome: "inserted", asset };
    },
    saveMediaRecord: async (record) => {
      records.push(record);
    },
  };
  const cached = await cachedMediaInput(row);
  const observation = createObservation({
    ...cached.observation,
    externalId: ownerSourceKey(row),
    rawFields: { capture_source_id: row.id, capture_fingerprint: row.fingerprint },
  });
  const media = await prepareListingMedia({
    ...cached,
    observation,
    rightsConfirmed: true,
    observationId,
    propertyId,
    isNew: false,
    currentImages: [],
    mode: "upload",
    allowedMediaHosts: ["i1.28hse.com", "i2.28hse.com", "i3.28hse.com"],
    repository: buffered,
    blobStore,
  });
  if (
    !media.publishable ||
    records.length !== row.photos.length ||
    records.some((r) => r.eligibility !== "eligible")
  )
    throw Error("OWNER_OWNED_MEDIA_INCOMPLETE");
  return { observation, registrations, records, uploadCount: media.uploadCount };
}
async function agencyGroup(q, ref, propertyId, chosen) {
  await q(
    "INSERT INTO property_public_groups(public_listing_no,canonical_property_no) VALUES($1,$1) ON CONFLICT(public_listing_no) DO NOTHING",
    [ref],
  );
  const group = (
    await q("SELECT * FROM property_public_groups WHERE public_listing_no=$1 FOR UPDATE", [ref])
  )[0];
  if (group.canonical_property_no !== ref || (group.review_required && !chosen))
    throw Error("OWNER_GROUP_CHANGED");
  await q(
    "INSERT INTO property_public_members(property_id,public_listing_no) VALUES($1,$2) ON CONFLICT(property_id) DO UPDATE SET public_listing_no=EXCLUDED.public_listing_no",
    [propertyId, ref],
  );
  if (chosen)
    await q(
      "UPDATE property_public_groups SET review_required=false,updated_at=now() WHERE public_listing_no=$1",
      [ref],
    );
}
export async function applyOwnerPublication(
  client,
  items,
  {
    choices = {},
    inputSha256,
    blobStore,
    expectedHost,
    onProgress = async () => {},
    onFailure = async () => {},
  } = {},
) {
  if (!/^[a-f0-9]{64}$/.test(inputSha256 ?? "") || !expectedHost)
    throw Error("OWNER_AUTHORIZATION_REQUIRED");
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  const result = { published: [], alreadyPublished: [], held: [], skipped: [], unknown: [] };
  const ownedGroups = new Map();
  for (const original of items) {
    let item = original;
    const row = item.row,
      ref = row.record.agency_property_no;
    if (item.action === "skip") {
      result.skipped.push(row.id);
      continue;
    }
    if (item.action === "held") {
      result.held.push({ id: row.id, ref, reason: item.reason });
      continue;
    }
    if (item.action === "already-published") {
      result.alreadyPublished.push({ id: row.id, ref, propertyId: item.target.id });
      continue;
    }
    if (ownedGroups.has(ref))
      item = { ...item, snapshot: { ...item.snapshot, groups: ownedGroups.get(ref) } };
    const propertyId = item.target?.id ?? randomUUID(),
      observationId = randomUUID(),
      runId = randomUUID();
    let commitSent = false,
      staged;
    try {
      staged = await stageMedia(client, row, propertyId, observationId, blobStore, expectedHost);
      await q("BEGIN");
      await configurePatchTransaction(q);
      await q("SELECT pg_advisory_xact_lock(hashtext('earnestproperty:mls-sync'))");
      await q("LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE");
      await lockPatchPreconditions(q);
      const catalog = await readSavedEstateCatalog(client.query.bind(client));
      const current = ownerDecision(
        row,
        await readOwnerTarget(client, row),
        resolveSavedEstate(row.record, row.extras, catalog.estates, catalog.districts),
        choices,
        inputSha256,
      );
      if (fingerprint(current) !== fingerprint(item))
        throw Error("OWNER_TARGET_CHANGED_AFTER_UPLOAD");
      await q("SELECT set_config('app.mls_writer_policy','no-hermes-v2',true)");
      let createdProperty;
      if (!item.target)
        createdProperty = await createImportedDraft(q, {
          id: propertyId,
          record: { fields: { title: row.record.title }, dealType: row.deal },
          districtSlug: item.resolution.district_slug ?? "",
          estateId: item.resolution.estate_id,
          companyNumber: ref,
        });
      const before = (
        await q("SELECT to_jsonb(p) AS value FROM properties p WHERE id=$1 FOR UPDATE", [
          propertyId,
        ])
      )[0].value;
      if (createdProperty)
        await groupNewCompanyProperty(q, createdProperty, { companyNumber: ref, publicGroup: ref });
      else await agencyGroup(q, ref, propertyId, item.chosen);
      await q(
        "INSERT INTO listing_sync_runs(id,scheduled_for,mode,status,parser_version) VALUES($1,current_date,'publish','running','saved-capture-owner-v1')",
        [runId],
      );
      const observation = staged.observation;
      await q(
        `INSERT INTO listing_source_observations(id,run_id,source,external_listing_id,deal_type,source_url,property_no_raw,property_no_normalized,payload,media_candidates,content_hash,validation_state,quarantine_reasons,parse_warnings,discovered_at,fetched_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,'valid','{}','{}',$11,$11)`,
        [
          observationId,
          runId,
          SOURCE_28HSE,
          ownerSourceKey(row),
          row.deal,
          row.record.source_url,
          ref,
          JSON.stringify({
            ...observation,
            owner_publication: {
              input_sha256: inputSha256,
              capture_source_id: row.id,
              capture_aliases: row.aliases,
              policy: OWNER_PUBLICATION_POLICY,
            },
          }),
          JSON.stringify(observation.mediaCandidates),
          observation.contentHash,
          observation.fetchedAt,
        ],
      );
      const repository = createSyncRepository({ client }),
        assets = new Map();
      for (const { input, asset } of staged.registrations) {
        const registration = await repository.registerOwnedMedia(input);
        assets.set(asset.id, registration.asset);
      }
      const images = [];
      for (const record of staged.records) {
        let asset =
          assets.get(record.ownedMediaAssetId) ??
          (await repository.findMediaByHash(record.contentHash));
        if (
          !asset ||
          asset.contentHash !== record.contentHash ||
          new URL(asset.url).hostname !== expectedHost
        )
          throw Error("OWNER_MEDIA_CHANGED");
        await repository.saveMediaRecord({ ...record, ownedMediaAssetId: asset.id });
        images.push(asset.url);
      }
      const values = ownerValues(row, item.resolution, images);
      await q(
        "INSERT INTO admin_property_source_snapshots(property_no,property_id,operation,payload) VALUES($1,$2,'ADMIN_BEFORE',$3)",
        [ref, propertyId, JSON.stringify(before)],
      );
      await q("SELECT set_config('app.admin_property_write','on',true)");
      const updated = await q(
        `UPDATE properties SET ${Object.keys(values)
          .map((k, i) => `${k}=$${i + 2}`)
          .join(
            ",",
          )},ingestion_owner='no-hermes-v2',ingestion_identity_policy='no-hermes-v2',last_seen_at=now(),last_scraped_at=now(),updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
        [propertyId, ...Object.values(values)],
      );
      await q("SELECT set_config('app.admin_property_write','',true)");
      if (
        updated.length !== 1 ||
        Object.entries(values).some(([field, value]) => !sameField(updated[0][field], value, field))
      )
        throw Error("OWNER_EFFECTIVE_FIELDS_CHANGED");
      const effective = (
        await q(
          "SELECT to_jsonb(p) AS value,md5(to_jsonb(p)::text) AS row_hash FROM properties p WHERE id=$1",
          [propertyId],
        )
      )[0];
      if (
        Object.entries(values).some(
          ([field, value]) => !sameField(effective.value[field], value, field),
        )
      )
        throw Error("OWNER_EFFECTIVE_FIELDS_CHANGED");
      const winner = (
        await q(
          `SELECT p.id FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE m.public_listing_no=$1 AND p.deal_type=$2 ORDER BY ${CURRENT_PUBLIC_OFFERING_ORDER} LIMIT 1`,
          [ref, row.deal],
        )
      )[0];
      if (winner?.id !== propertyId) throw Error("OWNER_PUBLIC_OFFERING_NOT_CURRENT");
      await writeSyncFields(
        q,
        Object.entries(values)
          .filter(([field]) => !["deal_type", "canonical_property_no"].includes(field))
          .map(([field_name, value]) => ({
            property_id: propertyId,
            field_name,
            last_published_value: value,
            winning_observation_id: observationId,
            selection_reason: "operator_publication",
            policy_version: OWNER_PUBLICATION_POLICY,
          })),
      );
      for (const [field, value] of Object.entries(values))
        await q(
          "INSERT INTO listing_change_events(property_id,run_id,change_type,field_name,old_value,new_value,winning_observation_id,reason) VALUES($1,$2,'changed',$3,$4,$5,$6,$7)",
          [
            propertyId,
            runId,
            field,
            JSON.stringify(before[field] ?? null),
            JSON.stringify(value),
            observationId,
            OWNER_PUBLICATION_POLICY,
          ],
        );
      await q(
        "INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,match_key,link_reason,status,first_seen_at,last_seen_at,last_seen_run_id) VALUES($1,$2,$3,$4,$5,'exact_property_no_and_deal_type','active',now(),now(),$6) ON CONFLICT(source,external_listing_id,deal_type) DO UPDATE SET last_seen_at=now(),last_seen_run_id=EXCLUDED.last_seen_run_id WHERE property_source_links.property_id=EXCLUDED.property_id",
        [propertyId, SOURCE_28HSE, ownerSourceKey(row), row.deal, `${row.deal}:${ref}`, runId],
      );
      const reviewKeys = item.reviews.map((r) => r.review_key);
      const resolved = await q(
        "UPDATE mls_ingestion_reviews SET status='resolved' WHERE review_key=ANY($1::text[]) AND status='open' RETURNING review_key",
        [reviewKeys],
      );
      if (resolved.length !== reviewKeys.length) throw Error("OWNER_REVIEWS_CHANGED");
      await q(
        "INSERT INTO admin_property_source_snapshots(property_no,property_id,operation,payload) VALUES($1,$2,'UPDATE',$3)",
        [ref, propertyId, JSON.stringify(effective.value)],
      );
      await q(
        "INSERT INTO audit_logs(action,subject_type,subject_id,metadata) VALUES($1,'property',$2,$3)",
        [
          OWNER_PUBLICATION_POLICY,
          propertyId,
          JSON.stringify({
            approval_ref: `owner-publication:${inputSha256}`,
            resolution: "owner-publication",
            input_sha256: inputSha256,
            capture_source_id: row.id,
            capture_fingerprint: row.fingerprint,
            after_row_hash: effective.row_hash,
            before,
            after: effective.value,
            observation_id: observationId,
            chosen: item.chosen,
            reviews_resolved: reviewKeys,
            groups_before: item.snapshot.groups,
          }),
        ],
      );
      await q(
        "UPDATE listing_sync_runs SET status='healthy',finished_at=now(),counts=$2 WHERE id=$1",
        [
          runId,
          JSON.stringify({
            owner_publication: 1,
            photo_count: images.length,
            reviews_resolved: reviewKeys.length,
            full_snapshot: false,
          }),
        ],
      );
      const committedGroups = (await readOwnerTarget(client, row)).groups;
      commitSent = true;
      await q("COMMIT");
      ownedGroups.set(ref, committedGroups);
      result.published.push({
        id: row.id,
        ref,
        propertyId,
        action: item.action,
        photoCount: images.length,
        reviewsResolved: reviewKeys.length,
      });
    } catch (error) {
      await q("ROLLBACK").catch(() => {});
      await onFailure(error);
      const reason = /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "OWNER_PUBLICATION_FAILED";
      if (commitSent) {
        result.unknown.push({ id: row.id, ref, reason: "commit_outcome_unknown" });
        await onProgress(result);
        throw Error("OWNER_COMMIT_OUTCOME_UNKNOWN");
      }
      result.held.push({
        id: row.id,
        ref,
        reason,
        uploadedBeforeFailure: staged?.uploadCount ?? null,
        phase: staged ? "database-publication" : "media-preparation",
        databaseCode: /^[A-Z0-9]{5}$/.test(error.code ?? "") ? error.code : null,
      });
    }
    await onProgress(result);
  }
  return result;
}
