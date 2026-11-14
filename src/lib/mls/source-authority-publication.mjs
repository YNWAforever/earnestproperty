import { randomUUID } from "node:crypto";
import {
  decodeSnapshot,
  hashPayload,
  normalizeDecimal,
  POLICY_VERSION,
} from "./ingestion-contract.mjs";
import { SOURCE_28HSE, createObservation } from "./source-contract.mjs";
import {
  SOURCE_AUTHORITY_POLICY,
  sourceAuthorityPolicy,
  preferredAuthorityRecords,
  authorityDomConflictApproved,
} from "./source-authority-policy.mjs";
import { authorityRecordsFromEvidence } from "./source-authority-evidence.mjs";
import { applyAuthorityOverrides, planAuthorityOverrides } from "./source-authority-overrides.mjs";
import { readOwnerTarget } from "./owner-publication.mjs";
import { resolveSavedEstate, readSavedEstateCatalog } from "./saved-capture-estates.mjs";
import { createImportedDraft } from "./ingestion-repository.mjs";
import { groupNewCompanyProperty } from "./company-number.mjs";
import {
  configurePatchTransaction,
  lockPatchPreconditions,
} from "./controlled-patch-preconditions.mjs";
import { createSyncRepository } from "./sync-repository.mjs";
import { prepareListingMedia } from "./media.mjs";
import { HSE_PUBLICATION_SOURCE } from "./publication-source-policy.mjs";
import { writeSyncFields } from "./ingestion-batch-writes.mjs";
import { CURRENT_PUBLIC_OFFERING_ORDER } from "../neon/public-listing-query.js";

const numeric = new Set(["price", "rent", "gross_area", "saleable_area", "bedrooms", "bathrooms"]);
const map = {
  title: "title_zh",
  floor: "floor",
  price: "price",
  rent: "rent",
  gross_area: "gross_area",
  saleable_area: "saleable_area",
  bedrooms: "bedrooms",
  bathrooms: "bathrooms",
  orientation: "orientation",
};
const equal = (field, a, b) =>
  numeric.has(field) && a != null && b != null
    ? normalizeDecimal(a) === normalizeDecimal(b)
    : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const present = (value) => value !== null && value !== undefined && value !== "";
const directions = new Map([
  ["北", "N"],
  ["東北", "NE"],
  ["東", "E"],
  ["東南", "SE"],
  ["南", "S"],
  ["西南", "SW"],
  ["西", "W"],
  ["西北", "NW"],
]);
function orientationDirection(value) {
  if (typeof value !== "string") return null;
  const label = value
    .trim()
    .replace(/^座向\s*[:：]\s*/, "")
    .toUpperCase();
  return directions.get(label) ?? (/^(?:N|NE|E|SE|S|SW|W|NW)$/.test(label) ? label : null);
}
const fail = (code) => {
  throw Error(code);
};
const rowFor = (record) => ({
  id: record.externalId,
  deal: record.dealType,
  record: { agency_property_no: record.agencyPropertyNo },
});
async function policy(q, batch, lock = false) {
  const row = (
    await q(
      "SELECT * FROM mls_ingestion_policies WHERE source=$1 AND scope_id=$2 AND policy_version=$3" +
        (lock ? " FOR UPDATE" : ""),
      [SOURCE_28HSE, "agent:540", POLICY_VERSION],
    )
  )[0];
  const rule = sourceAuthorityPolicy(row);
  if (rule && (row.owner !== POLICY_VERSION || row.publish_enabled !== true))
    fail("SOURCE_AUTHORITY_PUBLISH_DISABLED");
  if (rule && batch && row.parser_version !== batch.parserVersion)
    fail("SOURCE_AUTHORITY_PARSER_CHANGED");
  return rule;
}
async function accepted(q, batch, receiptId) {
  const row = (
    await q(
      "SELECT * FROM mls_ingestion_receipts WHERE id=$1 AND source=$2 AND scope_id=$3 AND policy_version=$4",
      [receiptId, batch.source, batch.scopeId, batch.policyVersion],
    )
  )[0];
  if (
    !row ||
    row.payload_hash !== batch.hash ||
    row.full_snapshot !== false ||
    row.response?.success !== true ||
    row.response?.incremental !== true
  )
    fail("SOURCE_AUTHORITY_ACCEPTED_RECEIPT_REQUIRED");
  return row;
}
async function sources(q, records, receiptId) {
  const rows = await q(
    `SELECT s.*,to_jsonb(l) AS link,o.fetched_at AS observation_fetched_at
    FROM mls_source_state s LEFT JOIN property_source_links l ON l.source=s.source AND l.external_listing_id=s.external_listing_id AND l.deal_type=s.deal_type
    JOIN listing_source_observations o ON o.id=s.observation_id
    WHERE s.source=$1 AND s.deal_type=$2 AND s.external_listing_id=ANY($3::text[]) ORDER BY s.external_listing_id`,
    [SOURCE_28HSE, records[0].dealType, records.map((r) => r.externalId)],
  );
  if (rows.length !== records.length || rows.some((s) => s.last_receipt_id !== receiptId))
    fail("SOURCE_AUTHORITY_SOURCE_STATE_CHANGED");
  return rows;
}
export function authorityValues(record, target, resolution) {
  const values = {};
  for (const [field, column] of Object.entries(map)) {
    const value = record.fields[field];
    if (
      !present(value) ||
      (field === "price" && record.dealType !== "sale") ||
      (field === "rent" && record.dealType !== "rent")
    )
      continue;
    if (
      ["gross_area", "saleable_area", "bedrooms", "bathrooms"].includes(field) &&
      (!Number.isSafeInteger(Number(value)) || Number(value) > 2147483647)
    )
      fail("SOURCE_AUTHORITY_PRECISION_UNSUPPORTED");
    values[column] = value;
  }
  const orientation = orientationDirection(record.fields.orientation);
  if (orientation && Array.isArray(target?.features)) {
    const features = target.features.filter((feature) => {
      const direction = orientationDirection(feature);
      return !direction || direction === orientation;
    });
    if (features.length !== target.features.length) values.features = features;
  }
  const description = record.raw.publication?.description ?? record.fields.description;
  if (typeof description === "string" && description.trim() && description.length <= 2000)
    values.description = description;
  if (present(record.fields.estate)) values.estate_id = resolution.estate_id ?? null;
  if (resolution.district_slug) values.district_slug = resolution.district_slug;
  if (!values.district_slug && !target?.district_slug) fail("SOURCE_AUTHORITY_DISTRICT_UNRESOLVED");
  return {
    ...values,
    canonical_property_no: record.agencyPropertyNo,
    source_site: "28hse",
    source_url: record.sourceUrl,
    source_updated_at: null,
    source_authority: "28hse",
    status: record.sourceStatus === "active" ? "active" : "inactive",
  };
}
function validExistingImages(images) {
  return (
    Array.isArray(images) &&
    images.length > 0 &&
    images.every((url) => {
      try {
        const u = new URL(url);
        return u.protocol === "https:" && !u.username && !u["pass" + "word"];
      } catch {
        return false;
      }
    })
  );
}
async function inspectItem(client, q, record, aliases, rule, batch, receiptId, catalog) {
  const snapshot = await readOwnerTarget(client, rowFor(record));
  const groups = snapshot.groups.filter(
    (g) =>
      g.canonical_property_no === record.agencyPropertyNo ||
      g.public_listing_no === record.agencyPropertyNo,
  );
  if (
    groups.some(
      (g) => g.canonical_property_no && g.canonical_property_no !== record.agencyPropertyNo,
    ) ||
    groups.length > 1
  )
    fail("SOURCE_AUTHORITY_GROUP_COLLISION");
  const groupNo = groups[0]?.public_listing_no ?? record.agencyPropertyNo;
  const current = await q(
    `SELECT p.id FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE m.public_listing_no=$1 AND p.deal_type=$2 ORDER BY ${CURRENT_PUBLIC_OFFERING_ORDER} LIMIT 1`,
    [groupNo, record.dealType],
  );
  const target =
    snapshot.candidates.find((p) => p.id === current[0]?.id) ?? snapshot.candidates[0] ?? null;
  if (target?.canonical_property_no && target.canonical_property_no !== record.agencyPropertyNo)
    fail("SOURCE_AUTHORITY_TARGET_REFERENCE_CHANGED");
  const resolution = resolveSavedEstate(record.fields, {}, catalog.estates, catalog.districts);
  if (resolution.status === "ambiguous") fail("SOURCE_AUTHORITY_ESTATE_AMBIGUOUS");
  const values = authorityValues(record, target, resolution);
  const newer = await q(
    `SELECT 1 FROM mls_source_state s JOIN listing_source_observations o ON o.id=s.observation_id
    WHERE s.source=$1 AND s.scope_id=$2 AND s.deal_type=$3
      AND coalesce(o.payload#>>'{identity,agency_property_no}',s.raw_identity->>'agency_property_no')=$4
      AND o.fetched_at>$5::timestamptz LIMIT 1`,
    [SOURCE_28HSE, batch.scopeId, record.dealType, record.agencyPropertyNo, record.fetchedAt],
  );
  if (newer.length) fail("SOURCE_AUTHORITY_NEWER_COMPANY_CAPTURE");
  const sourceRows = await sources(q, aliases, receiptId);
  const key = hashPayload({
    receiptId,
    payloadHash: batch.hash,
    authority: rule,
    ref: record.agencyPropertyNo,
    deal: record.dealType,
    winner: record.externalId,
    captures: aliases.map((r) => [r.externalId, r.fetchedAt]),
  });
  const audit = target
    ? (
        await q(
          "SELECT id,metadata->'after' AS last_after FROM audit_logs WHERE action=$1 AND subject_id=$2 AND metadata->>'authority_key'=$3 ORDER BY created_at DESC LIMIT 1",
          [SOURCE_AUTHORITY_POLICY, target.id, key],
        )
      )[0]
    : null;
  const observedFields = [
    ...Object.keys(values),
    ...((record.raw.publication?.images?.length ?? 0) > 0 ? ["images"] : []),
  ];
  const overridePending = snapshot.overrides.some(
    (o) => planAuthorityOverrides(o, record.dealType, observedFields).changed,
  );
  const unchanged =
    Boolean(audit) &&
    Object.entries(values).every(([field, value]) => equal(field, target[field], value)) &&
    (!observedFields.includes("images") ||
      equal("images", audit.last_after?.images, target.images)) &&
    sourceRows.every(
      (s) =>
        s.property_id === target.id &&
        s.link?.property_id === target.id &&
        s.link?.status === "active",
    ) &&
    !snapshot.fields.some(
      (f) =>
        f.property_id === target.id &&
        observedFields.includes(f.field_name) &&
        (f.active_override || f.selection_reason === "manual_override"),
    ) &&
    !overridePending &&
    groups.every((g) => !g.review_required);
  return {
    record,
    aliases,
    rule,
    snapshot,
    target,
    groupNo,
    values,
    sourceRows,
    key,
    unchanged,
    resolution,
  };
}
const fingerprint = (item) =>
  hashPayload({
    snapshot: item.snapshot,
    sourceRows: item.sourceRows,
    target: item.target?.id ?? null,
    groupNo: item.groupNo,
    values: item.values,
    rule: item.rule,
    key: item.key,
    unchanged: item.unchanged,
  });
async function stageMedia(
  client,
  record,
  propertyId,
  observationId,
  blobStore,
  expectedHost,
  prepare,
) {
  const urls = record.sourceStatus === "active" ? (record.raw.publication?.images ?? []) : [];
  if (!Array.isArray(urls) || urls.length > 6) fail("SOURCE_AUTHORITY_MEDIA_INVALID");
  const observation = createObservation({
    source: SOURCE_28HSE,
    externalId: record.externalId,
    dealType: record.dealType,
    sourceUrl: record.sourceUrl,
    propertyNoRaw: record.agencyPropertyNo,
    fields: record.fields,
    fetchedAt: record.fetchedAt,
    mediaCandidates: urls.map((url, i) => ({ url, category: "listing_photo", isPrimary: i === 0 })),
  });
  const repository = createSyncRepository({ client }),
    registrations = [],
    records = [];
  if (!urls.length) return { observation, registrations, records };
  if (!blobStore || !/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(expectedHost ?? ""))
    fail("SOURCE_AUTHORITY_BLOB_TARGET_REQUIRED");
  const buffered = {
    findMediaByUrls: repository.findMediaByUrls,
    findMediaByHash: async (hash) => {
      const asset = await repository.findMediaByHash(hash);
      if (asset && new URL(asset.url).hostname !== expectedHost)
        fail("SOURCE_AUTHORITY_MEDIA_STORE_MISMATCH");
      return asset;
    },
    registerOwnedMedia: async (input) => {
      const asset = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
      registrations.push({ input, asset });
      return { outcome: "inserted", asset };
    },
    saveMediaRecord: async (row) => {
      records.push(row);
    },
  };
  const media = await prepare({
    rightsConfirmed: HSE_PUBLICATION_SOURCE.rightsConfirmed,
    observation,
    observationId,
    propertyId,
    isNew: false,
    currentImages: [],
    mode: "upload",
    allowedMediaHosts: HSE_PUBLICATION_SOURCE.mediaHosts,
    repository: buffered,
    blobStore,
  });
  if (
    !media.publishable ||
    records.length !== urls.length ||
    records.some((r) => r.eligibility !== "eligible")
  )
    fail("SOURCE_AUTHORITY_OWNED_MEDIA_INCOMPLETE");
  return { observation, registrations, records };
}
async function saveObservation(q, observation, record, runId, id, receiptId, batch, rule) {
  const payload = {
    ...observation,
    schemaVersion: "2.0",
    fields: record.fields,
    raw: record.raw,
    identity: { ...record.identity, agency_property_no: record.agencyPropertyNo },
    unitKey: record.unitKey,
    sourceStatus: record.sourceStatus,
    sourceStatusReason: record.sourceStatusReason,
    holdProjection: false,
    capturedAt: record.fetchedAt,
    sourceAuthority: { rule, receiptId, payloadHash: batch.hash },
  };
  await q(
    `INSERT INTO listing_source_observations(id,run_id,source,external_listing_id,deal_type,source_url,property_no_raw,property_no_normalized,payload,media_candidates,content_hash,validation_state,quarantine_reasons,parse_warnings,discovered_at,fetched_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,'valid','{}','{}',$11,$11)`,
    [
      id,
      runId,
      SOURCE_28HSE,
      record.externalId,
      record.dealType,
      record.sourceUrl,
      record.agencyPropertyNo,
      JSON.stringify(payload),
      JSON.stringify(observation.mediaCandidates ?? []),
      hashPayload(payload),
      record.fetchedAt,
    ],
  );
}
async function reconcileLinks(
  q,
  aliases,
  propertyId,
  runId,
  winner,
  winnerObservationId,
  receiptId,
  batch,
  rule,
) {
  for (const record of aliases) {
    const id = record.externalId === winner.externalId ? winnerObservationId : randomUUID();
    if (id !== winnerObservationId)
      await saveObservation(
        q,
        { fields: record.fields, mediaCandidates: [] },
        record,
        runId,
        id,
        receiptId,
        batch,
        rule,
      );
    await q(
      `UPDATE mls_source_state SET property_id=$4,observation_id=$5,unit_key=$6,source_status=$7,raw_identity=$8 WHERE source=$1 AND external_listing_id=$2 AND deal_type=$3 AND last_receipt_id=$9`,
      [
        SOURCE_28HSE,
        record.externalId,
        record.dealType,
        propertyId,
        id,
        record.unitKey,
        record.sourceStatus,
        JSON.stringify({ ...record.identity, agency_property_no: record.agencyPropertyNo }),
        receiptId,
      ],
    );
    await q(
      "UPDATE mls_source_contacts SET observation_id=$4 WHERE source=$1 AND external_listing_id=$2 AND deal_type=$3",
      [SOURCE_28HSE, record.externalId, record.dealType, id],
    );
    await q(
      "UPDATE mls_source_promotion_tiers SET observation_id=$4 WHERE source=$1 AND external_listing_id=$2 AND deal_type=$3",
      [SOURCE_28HSE, record.externalId, record.dealType, id],
    );
    await q(
      `INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,match_key,link_reason,status,first_seen_at,last_seen_at,last_seen_run_id) VALUES($1,$2,$3,$4,$5,'source_id_v2','active',$6,$6,$7) ON CONFLICT(source,external_listing_id,deal_type) DO UPDATE SET property_id=EXCLUDED.property_id,match_key=EXCLUDED.match_key,link_reason=EXCLUDED.link_reason,status='active',last_seen_at=GREATEST(property_source_links.last_seen_at,EXCLUDED.last_seen_at),last_seen_run_id=EXCLUDED.last_seen_run_id,updated_at=now()`,
      [
        propertyId,
        SOURCE_28HSE,
        record.externalId,
        record.dealType,
        record.unitKey,
        record.fetchedAt,
        runId,
      ],
    );
  }
}
export async function reconcileSourceAuthority(
  client,
  payload,
  {
    receiptId,
    evidence,
    blobStore,
    expectedHost,
    now = Date.now,
    maxPublications = 20,
    prepare = prepareListingMedia,
    verifyFacts,
    onReport = async () => {},
  } = {},
) {
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  const rule = await policy(q);
  if (!rule) return null;
  const batch = decodeSnapshot(payload, { incremental: true });
  if (
    batch.rejects.length ||
    batch.duplicates ||
    batch.source !== SOURCE_28HSE ||
    batch.scopeId !== "agent:540"
  )
    fail("SOURCE_AUTHORITY_INVALID_BATCH");
  await policy(q, batch);
  await accepted(q, batch, receiptId);
  if (!Number.isSafeInteger(maxPublications) || maxPublications < 1 || maxPublications > 20)
    fail("SOURCE_AUTHORITY_INVALID_PUBLICATION_LIMIT");
  if (typeof verifyFacts !== "function") fail("SOURCE_AUTHORITY_NATIVE_FACT_PROOF_REQUIRED");
  const facts = await verifyFacts({ payload, evidence });
  if (facts?.payloadHash !== batch.hash || facts?.parserVersion !== batch.parserVersion)
    fail("SOURCE_AUTHORITY_NATIVE_FACT_PROOF_MISMATCH");
  const records = authorityRecordsFromEvidence(batch, evidence);
  const winners = preferredAuthorityRecords(records, rule, { now });
  if (records.some((r) => !authorityDomConflictApproved(r, rule, { now })))
    fail("SOURCE_AUTHORITY_UNSUPPORTED_SOURCE_CONFLICT");
  const report = {
    receiptId,
    authority: SOURCE_AUTHORITY_POLICY,
    published: [],
    ready: [],
    held: [],
    unknown: [],
    alreadyPublic: 0,
    duplicateCanonical: records.length - winners.length,
    attempted: 0,
    eligibleBacklog: 0,
    oldestWaitingAt: null,
  };
  try {
    for (const record of winners) {
      const itemInfo = {
        propertyNo: record.agencyPropertyNo,
        sourceId: record.externalId,
        dealType: record.dealType,
      };
      if (report.attempted >= maxPublications) {
        report.held.push({ ...itemInfo, reason: "daily_publication_limit" });
        continue;
      }
      const aliases = records.filter(
        (r) => r.agencyPropertyNo === record.agencyPropertyNo && r.dealType === record.dealType,
      );
      let item;
      await q("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try {
        item = await inspectItem(
          client,
          q,
          record,
          aliases,
          rule,
          batch,
          receiptId,
          await readSavedEstateCatalog(client.query.bind(client)),
        );
      } finally {
        await q("ROLLBACK");
      }
      if (item.unchanged) {
        report.alreadyPublic++;
        continue;
      }
      if (!record.offerValid && record.sourceStatus === "active") {
        report.held.push({ ...itemInfo, reason: "source_offer_invalid" });
        continue;
      }
      const urls = record.sourceStatus === "active" ? (record.raw.publication?.images ?? []) : [];
      if (
        record.sourceStatus === "active" &&
        !urls.length &&
        !(item.target?.status === "active" && validExistingImages(item.target.images))
      ) {
        report.held.push({ ...itemInfo, reason: "source_media_missing" });
        continue;
      }
      const propertyId = item.target?.id ?? randomUUID(),
        observationId = randomUUID(),
        runId = randomUUID();
      report.attempted++;
      const staged = await stageMedia(
        client,
        record,
        propertyId,
        observationId,
        blobStore,
        expectedHost,
        prepare,
      );
      let commitSent = false;
      await q("BEGIN");
      try {
        await configurePatchTransaction(q);
        await q("SELECT pg_advisory_xact_lock(hashtext('earnestproperty:mls-sync'))");
        await q("LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE");
        await lockPatchPreconditions(q);
        const currentRule = await policy(q, batch, true);
        if (hashPayload(currentRule) !== hashPayload(rule)) fail("SOURCE_AUTHORITY_POLICY_CHANGED");
        await accepted(q, batch, receiptId);
        preferredAuthorityRecords(aliases, currentRule, { now });
        const current = await inspectItem(
          client,
          q,
          record,
          aliases,
          currentRule,
          batch,
          receiptId,
          await readSavedEstateCatalog(client.query.bind(client)),
        );
        if (fingerprint(current) !== fingerprint(item))
          fail("SOURCE_AUTHORITY_TARGET_CHANGED_AFTER_UPLOAD");
        await q("SELECT set_config('app.mls_writer_policy','no-hermes-v2',true)");
        if (!item.target) {
          const created = await createImportedDraft(q, {
            id: propertyId,
            record,
            districtSlug: item.values.district_slug,
            estateId: item.values.estate_id,
            companyNumber: record.agencyPropertyNo,
          });
          await groupNewCompanyProperty(q, created, {
            companyNumber: record.agencyPropertyNo,
            publicGroup: item.groupNo,
          });
        }
        const before = (
          await q("SELECT to_jsonb(p) AS value FROM properties p WHERE id=$1 FOR UPDATE", [
            propertyId,
          ])
        )[0].value;
        await q(
          "INSERT INTO listing_sync_runs(id,scheduled_for,mode,status,parser_version) VALUES($1,current_date,'publish','running',$2)",
          [runId, SOURCE_AUTHORITY_POLICY],
        );
        await saveObservation(
          q,
          staged.observation,
          record,
          runId,
          observationId,
          receiptId,
          batch,
          rule,
        );
        const repository = createSyncRepository({ client }),
          assets = new Map(),
          uploadedImages = [];
        for (const { input, asset } of staged.registrations)
          assets.set(asset.id, (await repository.registerOwnedMedia(input)).asset);
        for (const media of staged.records) {
          const asset =
            assets.get(media.ownedMediaAssetId) ??
            (await repository.findMediaByHash(media.contentHash));
          if (
            !asset ||
            asset.contentHash !== media.contentHash ||
            new URL(asset.url).hostname !== expectedHost
          )
            fail("SOURCE_AUTHORITY_MEDIA_CHANGED");
          await repository.saveMediaRecord({ ...media, ownedMediaAssetId: asset.id });
          uploadedImages.push(asset.url);
        }
        const values = { ...item.values };
        if (uploadedImages.length) {
          const manualImages =
            item.snapshot.fields.some(
              (f) =>
                f.property_id === propertyId &&
                f.field_name === "images" &&
                (f.active_override || f.selection_reason === "manual_override"),
            ) ||
            item.snapshot.overrides.some((o) =>
              Object.hasOwn({ ...o.shared, ...o[record.dealType] }, "images"),
            );
          const retained =
            !manualImages &&
            before.status === "active" &&
            validExistingImages(before.images) &&
            before.images.every((url) => new URL(url).hostname === expectedHost)
              ? before.images
              : [];
          values.images = [...new Set([...uploadedImages, ...retained])];
        }
        await applyAuthorityOverrides(q, {
          propertyNo: item.groupNo,
          propertyId,
          dealType: record.dealType,
          fields: Object.keys(values),
          approval: rule,
          inputSha256: batch.hash,
          runId,
        });
        await q(
          "INSERT INTO admin_property_source_snapshots(property_no,property_id,operation,payload) VALUES($1,$2,'ADMIN_BEFORE',$3)",
          [item.groupNo, propertyId, JSON.stringify(before)],
        );
        await q("SELECT set_config('app.admin_property_write','on',true)");
        await q(
          `UPDATE properties SET ${Object.keys(values)
            .map((field, i) => `${field}=$${i + 2}`)
            .join(
              ",",
            )},ingestion_owner='no-hermes-v2',ingestion_identity_policy='no-hermes-v2',last_seen_at=$${Object.keys(values).length + 2},last_scraped_at=$${Object.keys(values).length + 2},updated_at=clock_timestamp() WHERE id=$1`,
          [propertyId, ...Object.values(values), record.fetchedAt],
        );
        await q("SELECT set_config('app.admin_property_write','',true)");
        const after = (
          await q("SELECT to_jsonb(p) AS value FROM properties p WHERE id=$1", [propertyId])
        )[0].value;
        if (Object.entries(values).some(([field, value]) => !equal(field, after[field], value)))
          fail("SOURCE_AUTHORITY_EFFECTIVE_FIELDS_CHANGED");
        await writeSyncFields(
          q,
          Object.entries(values).map(([field, value]) => ({
            property_id: propertyId,
            field_name: field,
            last_published_value: value,
            winning_observation_id: observationId,
            selection_reason: "operator_publication",
            policy_version: SOURCE_AUTHORITY_POLICY,
          })),
        );
        for (const [field, value] of Object.entries(values)) {
          if (!equal(field, before[field], after[field]))
            await q(
              "INSERT INTO listing_change_events(property_id,run_id,change_type,field_name,old_value,new_value,winning_observation_id,reason) VALUES($1,$2,'changed',$3,$4,$5,$6,$7)",
              [
                propertyId,
                runId,
                field,
                JSON.stringify(before[field] ?? null),
                JSON.stringify(value),
                observationId,
                SOURCE_AUTHORITY_POLICY,
              ],
            );
        }
        if (after.status === "active")
          await q(
            "UPDATE property_sync_state SET inactive_reason=NULL,inactive_at=NULL,last_evaluated_run_id=$2 WHERE property_id=$1",
            [propertyId, runId],
          );
        else
          await q(
            "INSERT INTO property_sync_state(property_id,last_evaluated_run_id,inactive_reason,inactive_at) VALUES($1,$2,$3,now()) ON CONFLICT(property_id) DO UPDATE SET last_evaluated_run_id=EXCLUDED.last_evaluated_run_id,inactive_reason=EXCLUDED.inactive_reason,inactive_at=EXCLUDED.inactive_at",
            [propertyId, runId, SOURCE_AUTHORITY_POLICY],
          );
        await reconcileLinks(
          q,
          aliases,
          propertyId,
          runId,
          record,
          observationId,
          receiptId,
          batch,
          rule,
        );
        const reviews = item.snapshot.reviews.filter((r) => {
          const ids = Array.isArray(r.bound_ids) ? r.bound_ids : [];
          const groupIds = new Set(
            item.snapshot.candidates
              .filter((p) => p.public_listing_no === item.groupNo)
              .map((p) => p.id),
          );
          return (
            (ids.length && ids.every((id) => id === propertyId)) ||
            (r.observation_ref === record.agencyPropertyNo &&
              (!ids.length ||
                ids.every((id) => groupIds.has(id)) ||
                aliases.some((a) => a.externalId === r.external_listing_id)))
          );
        });
        for (const review of reviews)
          await q(
            "UPDATE mls_ingestion_reviews SET status='resolved' WHERE review_key=$1 AND status='open'",
            [review.review_key],
          );
        const groupIds = new Set([
          ...item.snapshot.candidates
            .filter((p) => p.public_listing_no === item.groupNo)
            .map((p) => p.id),
          propertyId,
        ]);
        const conflicts = item.snapshot.conflicts.filter((c) => groupIds.has(c.property_id));
        for (const conflict of conflicts)
          await q(
            "UPDATE mls_ingestion_conflicts SET review_status='reviewed' WHERE conflict_key=$1 AND property_id=$2",
            [conflict.conflict_key, conflict.property_id],
          );
        await q(
          "UPDATE property_public_groups SET canonical_property_no=$2,review_required=false,updated_at=now() WHERE public_listing_no=$1 AND (canonical_property_no=$2 OR canonical_property_no IS NULL)",
          [item.groupNo, record.agencyPropertyNo],
        );
        const winner = (
          await q(
            `SELECT p.id FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE m.public_listing_no=$1 AND p.deal_type=$2 ORDER BY ${CURRENT_PUBLIC_OFFERING_ORDER} LIMIT 1`,
            [item.groupNo, record.dealType],
          )
        )[0];
        if (winner?.id !== propertyId) fail("SOURCE_AUTHORITY_PUBLIC_REPRESENTATIVE_CHANGED");
        const metadata = {
          authority_key: item.key,
          rule,
          input_sha256: batch.hash,
          semantic_proof: facts.semanticProof ?? null,
          receipt_id: receiptId,
          before,
          after,
          sources_before: item.sourceRows,
          captures: aliases.map((a) => ({ sourceId: a.externalId, capturedAt: a.fetchedAt })),
          reviews_resolved: reviews,
          conflicts_reviewed: conflicts,
          groups_before: item.snapshot.groups,
          retained_legacy_images: uploadedImages.length ? 0 : (before.images?.length ?? 0),
        };
        await q(
          "INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) VALUES(NULL,$1,'property',$2,$3)",
          [SOURCE_AUTHORITY_POLICY, propertyId, JSON.stringify(metadata)],
        );
        await q(
          "UPDATE listing_sync_runs SET status='healthy',finished_at=now(),counts=$2 WHERE id=$1",
          [
            runId,
            JSON.stringify({
              source_authority: 1,
              advertisements: aliases.length,
              full_snapshot: false,
            }),
          ],
        );
        commitSent = true;
        await q("COMMIT");
        report.published.push({
          ...itemInfo,
          publicListingNo: item.groupNo,
          propertyId,
          newlyPublished: before.status !== "active" && after.status === "active",
          updatedExisting: Boolean(item.target),
          fieldsChanged: Object.keys(values).filter(
            (field) => !equal(field, before[field], after[field]),
          ),
          linkedSources: aliases.map((a) => a.externalId),
          retainedLegacyImages: metadata.retained_legacy_images,
        });
      } catch (error) {
        await q("ROLLBACK").catch(() => {});
        if (commitSent) report.unknown.push({ ...itemInfo, reason: "commit_outcome_unknown" });
        else
          report.held.push({
            ...itemInfo,
            reason: /^[A-Z_]+$/.test(error.message)
              ? error.message
              : "source_authority_write_failed",
          });
        throw error;
      }
      await onReport(report);
    }
    report.eligibleBacklog = report.held.filter(
      (r) => r.reason === "daily_publication_limit",
    ).length;
    return report;
  } finally {
    await onReport(report);
  }
}
