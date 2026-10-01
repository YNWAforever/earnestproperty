import { savePromotionTiers } from "./promotion-tier-repository.mjs";
import { writeSyncFields, writeReviewRows } from "./ingestion-batch-writes.mjs";
import {
  companyPolicy,
  companyRelationship,
  groupNewCompanyProperty,
  adoptCompanyFields,
} from "./company-number.mjs";
import { randomUUID } from "node:crypto";
import {
  decodeSnapshot,
  hashPayload,
  canonicalJson,
  normalizeDecimal,
  SnapshotError,
} from "./ingestion-contract.mjs";
import { evaluateSnapshotGate } from "./source-snapshot-gates.mjs";
import { chooseRelationship, selectSourceFields } from "./source-selection.mjs";
const POLICY = "no-hermes-v2";
const MAP = {
  title: "title_zh",
  description: "description",
  district: "district_slug",
  floor: "floor",
  price: "price",
  rent: "rent",
  gross_area: "gross_area",
  saleable_area: "saleable_area",
  bedrooms: "bedrooms",
  bathrooms: "bathrooms",
  orientation: "orientation",
};
const NUMBER_FIELDS = new Set([
  "price",
  "rent",
  "gross_area",
  "saleable_area",
  "bedrooms",
  "bathrooms",
]);
const same = (a, b, numeric = false) =>
  numeric && a != null && b != null
    ? normalizeDecimal(a) === normalizeDecimal(b)
    : canonicalJson(a ?? null) === canonicalJson(b ?? null);
const json = (value) => JSON.stringify(value ?? null);
function estateMapping(estate, config) {
  const mapped = config?.estate_mappings?.[estate];
  return mapped &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      mapped.estate_id ?? "",
    ) &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(mapped.district_slug ?? "")
    ? mapped
    : null;
}
function districtSlug(raw, config, estate) {
  const value = estateMapping(estate, config)?.district_slug ?? config?.district_slugs?.[raw];
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : null;
}
function verifiedOptions(policy) {
  if (policy.source !== "propertyhk") return { aliases: policy.config.aliases };
  const rule = policy.config.source_url_identity;
  if (
    !["global", "branch"].includes(policy.id_scope) ||
    rule?.verified !== true ||
    typeof rule.path_template !== "string" ||
    !rule.path_template.startsWith("/") ||
    !rule.path_template.includes("{id}") ||
    /[?#%]/.test(rule.path_template) ||
    /\{(?!id\}|branch\})/.test(rule.path_template)
  )
    throw new SnapshotError("source_identity_unverified", 503);
  if (policy.id_scope === "branch" && !rule.path_template.includes("{branch}"))
    throw new SnapshotError("source_identity_unverified", 503);
  return {
    idScope: policy.id_scope,
    aliases: policy.config.aliases,
    verifySourceUrl: (record, url) => {
      const id = String(record.property_id).trim();
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return false;
      const path = rule.path_template
        .replaceAll("{id}", id)
        .replaceAll("{branch}", record.branch_code);
      return url.pathname === path && !url.search && !url.hash;
    },
  };
}
export async function applyIngestion(client, payload, options = {}) {
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  let batch = decodeSnapshot(payload, { idScope: "global" });
  if (options.expectedSource && batch.source !== options.expectedSource)
    throw new SnapshotError("source_mismatch");
  const receipt = async () => {
    const previous = (
      await q(
        "SELECT payload_hash,response FROM mls_ingestion_receipts WHERE source=$1 AND scope_id=$2 AND scraped_at=$3::timestamptz",
        [batch.source, batch.scopeId, batch.scrapedAt],
      )
    )[0];
    if (previous && previous.payload_hash !== batch.hash)
      throw new SnapshotError("receipt_conflict", 409);
    return previous?.response;
  };
  const replay = await receipt();
  if (replay) return replay;
  await q("BEGIN");
  let committing = false;
  try {
    await q("SELECT pg_advisory_xact_lock(hashtext('earnestproperty:mls-sync'))");
    const replay = await receipt();
    if (replay) {
      await q("ROLLBACK");
      return replay;
    }
    // Match the admin lock order before touching canonical rows or public groups.
    await q("LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE");
    await q("SELECT set_config('app.mls_writer_policy',$1,true)", [POLICY]);
    const policy = (
      await q(
        "SELECT * FROM mls_ingestion_policies WHERE source=$1 AND scope_id=$2 AND policy_version=$3 FOR UPDATE",
        [batch.source, batch.scopeId, POLICY],
      )
    )[0];
    if (!policy || policy.owner !== POLICY || !policy.publish_enabled)
      throw new SnapshotError("publishing_disabled", 503);
    if (policy.parser_version !== batch.parserVersion)
      throw new SnapshotError("parser_policy_mismatch", 503);
    const companyRule = companyPolicy(policy);
    batch = decodeSnapshot(payload, verifiedOptions(policy));
    const unverified = batch.records.filter((record) => !record.urlIdentityVerified);
    if (unverified.length) {
      batch.rejects.push(
        ...unverified.flatMap((record) =>
          record.sourceOccurrences.map((occurrence) => ({
            row_index: occurrence.index,
            code: "source_url_identity_mismatch",
          })),
        ),
      );
      batch.records = batch.records.filter((record) => record.urlIdentityVerified);
      batch.advertisementCount = new Set(
        batch.records.map((record) => record.advertisementId),
      ).size;
      batch.offerCount = batch.records.length;
    }
    const scope = (
      await q(
        "SELECT s.*,r.parser_version,r.full_snapshot,r.run_id AS receipt_run_id FROM mls_ingestion_scopes s LEFT JOIN mls_ingestion_receipts r ON r.id=s.full_receipt_id WHERE s.source=$1 AND s.scope_id=$2 AND s.policy_version=$3",
        [batch.source, batch.scopeId, POLICY],
      )
    )[0];
    const stale = (
      await q(
        "SELECT EXISTS(SELECT 1 FROM mls_ingestion_scopes WHERE source=$1 AND scope_id=$2 AND last_accepted_at >= $3::timestamptz) AS stale",
        [batch.source, batch.scopeId, batch.scrapedAt],
      )
    )[0].stale;
    if (stale) throw new SnapshotError("stale_snapshot", 409);
    const baseline = scope?.full_receipt_id
      ? {
          source: batch.source,
          scopeId: batch.scopeId,
          policyVersion: POLICY,
          parserVersion: scope.parser_version,
          fullReceiptId: scope.full_receipt_id,
          fullCount: scope.full_count,
          full: scope.full_snapshot,
          applied: true,
        }
      : null;
    if (baseline && batch.source === "propertyhk") {
      // Reconstruct from immutable observations belonging to the accepted full
      // receipt, never from the evolving current source-state table.
      const counts = await q(
        `SELECT b.branch,count(DISTINCT o.external_listing_id)::int AS n
        FROM listing_source_observations o CROSS JOIN LATERAL (
          SELECT value AS branch FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.payload->'branches')='array' THEN o.payload->'branches' ELSE '[]'::jsonb END)
          UNION SELECT value FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.payload#>'{raw,branch_memberships}')='array' THEN o.payload#>'{raw,branch_memberships}' ELSE '[]'::jsonb END)
          UNION SELECT value->>'branch' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.payload->'sourceOccurrences')='array' THEN o.payload->'sourceOccurrences' ELSE '[]'::jsonb END)
          UNION SELECT o.payload#>>'{raw,branch_code}'
        ) b WHERE o.run_id=$1 AND o.source='propertyhk' AND b.branch IN ('EPW','EPS','EPT') GROUP BY b.branch`,
        [scope.receipt_run_id],
      );
      baseline.branchCounts = {
        EPW: 0,
        EPS: 0,
        EPT: 0,
        ...Object.fromEntries(counts.map((r) => [r.branch, r.n])),
      };
    }
    const gate = evaluateSnapshotGate(batch, baseline, {
      absenceEnabled: policy.config.absence_enabled === true,
    });
    if (!gate.allowed)
      throw new SnapshotError("incomplete_snapshot", 422, { reasons: gate.reasons });
    if (!baseline && !policy.bootstrap_approved_at)
      throw new SnapshotError("bootstrap_required", 503);
    // Replays have returned already. Only a newly accepted full sync consumes this slot.
    if (gate.full) {
      const fullUsage = (
        await q(
          "SELECT count(*)::int AS n, greatest(1,ceil(extract(epoch FROM min(accepted_at)+interval '1 hour'-now())))::int AS retry FROM mls_ingestion_receipts WHERE source=$1 AND scope_id=$2 AND full_snapshot AND accepted_at>now()-interval '1 hour'",
          [batch.source, batch.scopeId],
        )
      )[0];
      if (fullUsage.n >= 1)
        throw new SnapshotError("full_sync_quota_exceeded", 429, { retryAfter: fullUsage.retry });
    }
    const quota = policy.config.max_batches_per_hour ?? 60;
    if (!Number.isInteger(quota) || quota < 1) throw new SnapshotError("invalid_quota_policy", 503);
    const usage = (
      await q(
        "SELECT count(*)::int AS n, greatest(1,ceil(extract(epoch FROM min(accepted_at)+interval '1 hour'-now())))::int AS retry FROM mls_ingestion_receipts WHERE source=$1 AND scope_id=$2 AND accepted_at>now()-interval '1 hour'",
        [batch.source, batch.scopeId],
      )
    )[0];
    if (usage.n >= quota)
      throw new SnapshotError("quota_exceeded", 429, { retryAfter: usage.retry });
    const runId = randomUUID(),
      receiptId = randomUUID();
    await q(
      "INSERT INTO listing_sync_runs(id,scheduled_for,mode,status,parser_version) VALUES($1,$2::timestamptz::date,'publish','running',$3)",
      [runId, batch.scrapedAt, batch.parserVersion],
    );
    await q(
      "INSERT INTO mls_ingestion_receipts(id,source,scope_id,policy_version,parser_version,scraped_at,payload_hash,run_id,response,full_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'{}',$9)",
      [
        receiptId,
        batch.source,
        batch.scopeId,
        POLICY,
        batch.parserVersion,
        batch.scrapedAt,
        batch.hash,
        runId,
        gate.full,
      ],
    );
    const touched = new Set(),
      newProperties = new Set(),
      changedProperties = new Set();
    let fieldsChanged = 0;
    const pendingReviews = [];
    const review = async (record, reason, evidence, observationId) => {
      const key = hashPayload({
        source: record.source,
        id: record.externalId,
        deal: record.dealType,
        reason,
        evidence,
      });
      pendingReviews.push({
        review_key: key,
        source: record.source,
        external_listing_id: record.externalId,
        deal_type: record.dealType,
        reason,
        evidence,
        observation_id: observationId,
        first_run_id: runId,
        last_run_id: runId,
      });
    };
    const event = async (propertyId, type, field, oldValue, newValue, observationId, reason) =>
      q(
        "INSERT INTO listing_change_events(property_id,run_id,change_type,field_name,old_value,new_value,winning_observation_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [propertyId, runId, type, field, json(oldValue), json(newValue), observationId, reason],
      );
    for (const record of batch.records) {
      const identityArgs = [record.source, record.externalId, record.dealType];
      const state = (
        await q(
          "SELECT * FROM mls_source_state WHERE source=$1 AND external_listing_id=$2 AND deal_type=$3",
          identityArgs,
        )
      )[0];
      const link = (
        await q(
          "SELECT * FROM property_source_links WHERE source=$1 AND external_listing_id=$2 AND deal_type=$3",
          identityArgs,
        )
      )[0];
      const candidates = record.unitKey
        ? await q("SELECT * FROM mls_source_state WHERE unit_key=$1 AND deal_type=$2", [
            record.unitKey,
            record.dealType,
          ])
        : [];
      const existing =
        state ??
        (link?.status === "active"
          ? { property_id: link.property_id, unit_key: null, raw_identity: {} }
          : null);
      let relation = chooseRelationship(record, existing, candidates);
      if (existing && !existing.property_id && !relation.holdProjection)
        relation = chooseRelationship(
          record,
          null,
          candidates.filter(
            (c) =>
              !(
                c.source === record.source &&
                c.external_listing_id === record.externalId &&
                c.deal_type === record.dealType
              ),
          ),
        );
      if (link && link.status !== "active")
        relation = {
          propertyId: state?.property_id ?? null,
          unitKey: state?.unit_key ?? record.unitKey,
          reason: "source_link_requires_review",
          holdProjection: true,
        };
      if (state?.property_id && link && state.property_id !== link.property_id)
        relation = {
          propertyId: state.property_id,
          unitKey: state.unit_key,
          reason: "source_link_inconsistent",
          holdProjection: true,
        };
      relation = await companyRelationship(q, record, existing, relation, companyRule);
      const linkedProperty = relation.propertyId
        ? (
            await q("SELECT estate_id,district_slug FROM properties WHERE id=$1", [
              relation.propertyId,
            ])
          )[0]
        : null;
      const mappedDistrict =
        linkedProperty?.district_slug ??
        districtSlug(record.fields.district, policy.config, record.fields.estate);
      if (!mappedDistrict) record.publicationReasons.push("district_mapping_unverified");
      const observationId = randomUUID();
      await q(
        "INSERT INTO listing_source_observations(id,run_id,source,external_listing_id,deal_type,source_url,payload,content_hash,validation_state,discovered_at,fetched_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'valid',$9,$9)",
        [
          observationId,
          runId,
          ...identityArgs,
          record.sourceUrl,
          json({
            schemaVersion: 2,
            policyVersion: POLICY,
            parserVersion: batch.parserVersion,
            sourceKey: record.key,
            unitKey: record.unitKey,
            fields: record.fields,
            sourceStatus: record.sourceStatus,
            sourceStatusReason: record.sourceStatusReason,
            raw: record.raw,
            sourceOccurrences: record.sourceOccurrences,
            branches: record.branches,
            identity: { ...record.identity, agency_property_no: record.agencyPropertyNo },
            publicationReasons: record.publicationReasons,
            holdProjection: relation.holdProjection,
          }),
          hashPayload(record.raw),
          batch.scrapedAt,
        ],
      );
      // Ambiguity and incomplete publication prerequisites stage a source record, never forge fields.
      if (
        !existing?.property_id &&
        !relation.propertyId &&
        !relation.holdProjection &&
        relation.reason !== "ambiguous_exact_unit" &&
        record.urlIdentityVerified &&
        record.offerValid &&
        record.fields.title &&
        mappedDistrict
      ) {
        const id = randomUUID();
        const p = (
          await q(
            "INSERT INTO properties(id,listing_no,title_zh,deal_type,district_slug,status,ingestion_owner,ingestion_identity_policy,canonical_property_no,estate_id) VALUES($1,$2,$3,$4,$5,'draft',$6,$6,$7,$8) RETURNING *",
            [
              id,
              "SYNC-" + id,
              record.fields.title,
              record.dealType,
              mappedDistrict,
              POLICY,
              relation.companyNumber ?? null,
              estateMapping(record.fields.estate, policy.config)?.estate_id ?? null,
            ],
          )
        )[0];
        await groupNewCompanyProperty(q, p, relation);
        relation.propertyId = p.id;
        newProperties.add(p.id);
        await event(p.id, "new", null, null, { status: p.status }, observationId, "source_id_v2");
      }
      if (
        relation.holdProjection ||
        relation.reason === "ambiguous_exact_unit" ||
        !relation.propertyId
      )
        await review(
          record,
          relation.holdProjection || relation.reason === "ambiguous_exact_unit"
            ? relation.reason
            : !mappedDistrict
              ? "district_mapping_unverified"
              : "publication_prerequisites_missing",
          {
            previousIdentity: state?.raw_identity ?? null,
            previousUnitKey: state?.unit_key ?? null,
            identity: { ...record.identity, agency_property_no: record.agencyPropertyNo },
            candidates: relation.candidates ?? [],
            reasons: record.publicationReasons,
          },
          observationId,
        );
      const propertyId = relation.propertyId;
      await q(
        "INSERT INTO mls_source_state(source,external_listing_id,deal_type,scope_id,policy_version,observation_id,last_receipt_id,property_id,unit_key,source_status,first_seen_at,last_accepted_at,raw_identity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$12,$10,$10,$11) ON CONFLICT(source,external_listing_id,deal_type) DO UPDATE SET observation_id=EXCLUDED.observation_id,last_receipt_id=EXCLUDED.last_receipt_id,property_id=EXCLUDED.property_id,unit_key=EXCLUDED.unit_key,source_status=EXCLUDED.source_status,last_accepted_at=EXCLUDED.last_accepted_at,raw_identity=EXCLUDED.raw_identity",
        [
          ...identityArgs,
          batch.scopeId,
          POLICY,
          observationId,
          receiptId,
          propertyId,
          relation.unitKey,
          batch.scrapedAt,
          json(
            relation.holdProjection && state
              ? state.raw_identity
              : {
                  ...state?.raw_identity,
                  ...(record.agencyPropertyNo
                    ? { agency_property_no: record.agencyPropertyNo }
                    : {}),
                  ...Object.fromEntries(
                    Object.entries(record.identity).filter(
                      ([, value]) => value !== null && value !== "",
                    ),
                  ),
                },
          ),
          record.sourceStatus,
        ],
      );
      await q(
        "INSERT INTO mls_source_contacts(source,external_listing_id,deal_type,contact,branches,observation_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source,external_listing_id,deal_type) DO UPDATE SET contact=EXCLUDED.contact,branches=EXCLUDED.branches,observation_id=EXCLUDED.observation_id,updated_at=now()",
        [...identityArgs, json(record.contact), json(record.branches), observationId],
      );
      if (propertyId && !relation.holdProjection) {
        await q(
          "INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,match_key,link_reason,status,first_seen_at,last_seen_at,last_seen_run_id) VALUES($1,$2,$3,$4,$5,$6,'active',$7,$7,$8) ON CONFLICT(source,external_listing_id,deal_type) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at,last_seen_run_id=EXCLUDED.last_seen_run_id,updated_at=now()",
          [
            propertyId,
            ...identityArgs,
            relation.unitKey,
            relation.reason === "exact_unit_v2" ? "exact_unit_v2" : "source_id_v2",
            batch.scrapedAt,
            runId,
          ],
        );
        await q(
          "UPDATE properties SET ingestion_owner=$2,ingestion_identity_policy=$2 WHERE id=$1 AND (ingestion_owner<>$2 OR ingestion_identity_policy<>$2)",
          [propertyId, POLICY],
        );
        touched.add(propertyId);
        if (state?.source_status === "delisted" && record.sourceStatus === "active")
          await event(
            propertyId,
            "reactivated",
            "source_status",
            "delisted",
            "active",
            observationId,
            "source_reappeared",
          );
      }
    }
    if (gate.inferAbsence) {
      // Compare only IDs observed by the previous successful full run, not historical inventory.
      const absent = await q(
        "UPDATE mls_source_state s SET source_status='delisted' WHERE s.source=$1 AND s.scope_id=$2 AND s.policy_version=$3 AND s.source_status='active' AND EXISTS(SELECT 1 FROM listing_source_observations o JOIN mls_ingestion_receipts r ON r.run_id=o.run_id WHERE r.id=$4 AND o.source=s.source AND o.external_listing_id=s.external_listing_id AND o.deal_type=s.deal_type) AND NOT EXISTS(SELECT 1 FROM listing_source_observations o WHERE o.run_id=$5 AND o.source=s.source AND o.external_listing_id=s.external_listing_id AND o.deal_type=s.deal_type) RETURNING s.*",
        [batch.source, batch.scopeId, POLICY, baseline.fullReceiptId, runId],
      );
      for (const s of absent)
        if (s.property_id) {
          touched.add(s.property_id);
          await event(
            s.property_id,
            "inactive",
            "source_status",
            "active",
            "delisted",
            s.observation_id,
            "accepted_full_28hse_absence",
          );
        }
    }

    // 網頁07092026.docx p5: record each source listing's paid placement grade so
    // the homepage feed can order 黃金 > 置頂 > 普通.
    //
    // gate.full is this batch's own completeness signal, the same one the
    // receipt is stamped with. It is what savePromotionTiers uses to decide
    // whether a demotion is trustworthy: a partial snapshot may promote a
    // listing it positively saw badged, but must never demote one whose badge
    // is merely missing from what it managed to fetch.
    await savePromotionTiers(
      q,
      batch.records.map((record) => ({
        source: batch.source,
        externalId: record.externalId,
        dealType: record.dealType,
        promotionTier: record.promotionTier,
        promotionTierRaw: record.promotionTierRaw,
        fetchedAt: batch.scrapedAt,
      })),
      { snapshotComplete: Boolean(gate.full) },
    );

    for (const propertyId of touched) {
      const property = (await q("SELECT * FROM properties WHERE id=$1", [propertyId]))[0];
      const sources = await q(
        "SELECT s.*,ip.config AS policy_config,o.payload->'fields' AS fields,o.payload->>'sourceStatusReason' AS source_status_reason,o.payload->>'holdProjection' AS hold_projection,c.contact FROM mls_source_state s JOIN listing_source_observations o ON o.id=s.observation_id JOIN mls_ingestion_policies ip ON ip.source=s.source AND ip.scope_id=s.scope_id AND ip.policy_version=s.policy_version LEFT JOIN mls_source_contacts c ON c.source=s.source AND c.external_listing_id=s.external_listing_id AND c.deal_type=s.deal_type WHERE s.property_id=$1",
        [propertyId],
      );
      // Any changed source identity holds the entire projection until operator review.
      if (sources.some((s) => s.hold_projection === "true")) continue;
      if (property.status === "draft") {
        const override = (
          await q(
            "SELECT o.shared || CASE p.deal_type::text WHEN 'sale' THEN o.sale ELSE o.rent END AS patch FROM admin_property_overrides o JOIN property_public_members m ON m.public_listing_no=o.property_no JOIN properties p ON p.id=m.property_id WHERE p.id=$1",
            [propertyId],
          )
        )[0]?.patch;
        if (override?.status && override.status !== "draft") {
          await review(
            {
              source: sources[0].source,
              externalId: sources[0].external_listing_id,
              dealType: sources[0].deal_type,
            },
            "draft_status_override_requires_review",
            { status: override.status },
            sources[0].observation_id,
          );
          continue;
        }
      }
      const selected = selectSourceFields(sources);
      if (!selected.ambiguous && companyRule && !newProperties.has(propertyId))
        await adoptCompanyFields(
          q,
          property,
          companyRule,
          [...Object.values(MAP), "status"],
          sources[0].observation_id,
        );
      const fields = await q("SELECT * FROM property_sync_fields WHERE property_id=$1", [
        propertyId,
      ]);
      const representative = sources[0];
      const terminalPrimary = sources.find(
        (s) => s.source === "28hse_agent_540" && s.source_status === "delisted",
      );
      const inactiveReason = ["sold", "rented"].includes(terminalPrimary?.source_status_reason)
        ? `explicit_source_${terminalPrimary.source_status_reason}`
        : "accepted_full_28hse_absence";
      const reviewRecord = {
        source: representative.source,
        externalId: representative.external_listing_id,
        dealType: representative.deal_type,
      };
      for (const conflict of selected.conflicts) {
        const key = hashPayload({
          propertyId,
          field: conflict.field,
          primary: conflict.primaryValue,
          secondary: conflict.secondaryValue,
        });
        await q(
          "INSERT INTO mls_ingestion_conflicts(conflict_key,property_id,field_name,primary_observation_id,secondary_observation_id,primary_value,secondary_value,primary_observed_at,secondary_observed_at,first_run_id,last_run_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) ON CONFLICT(conflict_key) DO UPDATE SET primary_observation_id=EXCLUDED.primary_observation_id,secondary_observation_id=EXCLUDED.secondary_observation_id,primary_observed_at=EXCLUDED.primary_observed_at,secondary_observed_at=EXCLUDED.secondary_observed_at,last_run_id=EXCLUDED.last_run_id,last_seen_at=now()",
          [
            key,
            propertyId,
            conflict.field,
            conflict.primaryObservationId,
            conflict.secondaryObservationId,
            json(conflict.primaryValue),
            json(conflict.secondaryValue),
            conflict.primaryObservedAt,
            conflict.secondaryObservedAt,
            runId,
          ],
        );
      }
      if (selected.ambiguous) {
        await review(reviewRecord, "ambiguous_sources", {}, representative.observation_id);
        continue;
      }
      const proposals = [];
      for (const [field, rawValue] of Object.entries({
        ...Object.fromEntries(selected.clearFields.map((field) => [field, null])),
        ...selected.values,
      })) {
        let value = rawValue;
        if (field === "district") {
          const source = sources.find((s) => s.source === selected.provenance[field].source);
          value =
            property.district_slug ??
            districtSlug(rawValue, source?.policy_config, source?.fields?.estate);
          if (!value) {
            await review(
              reviewRecord,
              "district_mapping_unverified",
              { district: rawValue },
              source?.observation_id ?? representative.observation_id,
            );
            continue;
          }
        }
        const column = MAP[field];
        if (
          !column ||
          (field === "price" && property.deal_type !== "sale") ||
          (field === "rent" && property.deal_type !== "rent")
        )
          continue;
        if (
          ["gross_area", "saleable_area", "bedrooms", "bathrooms"].includes(column) &&
          (!Number.isSafeInteger(Number(value)) || Number(value) > 2147483647)
        ) {
          await review(
            reviewRecord,
            "projection_precision",
            { field, value },
            representative.observation_id,
          );
          continue;
        }
        const owned = fields.find((f) => f.field_name === column);
        // Absence of an authorized winner only clears proven imported nullable values.
        // It never claims unknown fields or changes a value already selected manually.
        if (
          rawValue === null &&
          (!owned?.winning_observation_id ||
            owned.selection_reason === "manual_override" ||
            (column === "description" &&
              owned.selection_reason === "operator_publication" &&
              owned.policy_version === "daily-reviewed-publication-v1"))
        ) {
          if (!owned && property[column] != null && property[column] !== "")
            await review(
              reviewRecord,
              "unknown_field_ownership",
              { field: column, current: property[column] },
              representative.observation_id,
            );
          continue;
        }
        const numeric = NUMBER_FIELDS.has(column);
        if (
          owned?.active_override ||
          (owned && (owned.selection_reason === "manual_override" || !owned.winning_observation_id))
        ) {
          await review(
            reviewRecord,
            "manual_override",
            { field: column },
            representative.observation_id,
          );
          continue;
        }
        if (owned && !same(property[column], owned.last_published_value, numeric)) {
          await review(
            reviewRecord,
            "diverged_field",
            { field: column, current: property[column], lastPublished: owned.last_published_value },
            representative.observation_id,
          );
          continue;
        }
        if (
          !owned &&
          !newProperties.has(propertyId) &&
          property[column] != null &&
          property[column] !== ""
        ) {
          await review(
            reviewRecord,
            "unknown_field_ownership",
            { field: column, current: property[column] },
            representative.observation_id,
          );
          continue;
        }
        proposals.push({ column, value, provenance: selected.provenance[field] });
      }
      // Drafts need a separate owned-media review; crawlers cannot promote them.
      if (
        (selected.lifecycle === "inactive" && property.status === "active") ||
        (selected.lifecycle === "active" && property.status === "inactive")
      ) {
        const owned = fields.find((f) => f.field_name === "status");
        if (!owned)
          await review(
            reviewRecord,
            "unknown_field_ownership",
            { field: "status", current: property.status },
            representative.observation_id,
          );
        const lifecycle = (
          await q("SELECT * FROM property_sync_state WHERE property_id=$1", [propertyId])
        )[0];
        if (
          !owned?.active_override &&
          owned?.selection_reason !== "manual_override" &&
          owned?.winning_observation_id &&
          owned &&
          same(property.status, owned.last_published_value) &&
          (selected.lifecycle === "inactive" ||
            lifecycle?.inactive_reason === "accepted_full_28hse_absence")
        )
          proposals.push({
            column: "status",
            value: selected.lifecycle,
            provenance: {
              source: terminalPrimary?.source ?? representative.source,
              observationId: terminalPrimary?.observation_id ?? representative.observation_id,
              reason: selected.lifecycle === "inactive" ? inactiveReason : "source_lifecycle",
            },
          });
      }
      // Stronger observed terminal evidence replaces an inferred absence even when
      // the canonical status is already inactive. Keep staff ownership and the
      // original inactive time; this metadata change must not UPDATE properties.
      if (
        property.status === "inactive" &&
        selected.lifecycle === "inactive" &&
        inactiveReason.startsWith("explicit_source_")
      ) {
        const owned = fields.find((f) => f.field_name === "status");
        if (
          owned &&
          !owned.active_override &&
          owned.selection_reason !== "manual_override" &&
          same(property.status, owned.last_published_value)
        ) {
          const escalated = await q(
            "UPDATE property_sync_state SET inactive_reason=$3,last_evaluated_run_id=$2 WHERE property_id=$1 AND inactive_reason='accepted_full_28hse_absence' RETURNING property_id",
            [propertyId, runId, inactiveReason],
          );
          if (escalated.length)
            await q(
              "UPDATE property_sync_fields SET winning_observation_id=$2,selection_reason=$3,updated_at=now() WHERE property_id=$1 AND field_name='status'",
              [propertyId, terminalPrimary.observation_id, inactiveReason],
            );
        }
      }
      if (proposals.length) {
        const changed = proposals.filter(
          (p) => !same(property[p.column], p.value, NUMBER_FIELDS.has(p.column)),
        );
        const actual = changed.length
          ? (
              await q(
                `UPDATE properties SET ${changed.map((p, i) => `${p.column}=$${i + 2}`).join(",")},updated_at=now() WHERE id=$1 RETURNING *`,
                [propertyId, ...changed.map((p) => p.value)],
              )
            )[0]
          : property;
        const provenanceRows = [];
        for (const p of proposals) {
          const effective = actual[p.column],
            overridden = !same(effective, p.value, NUMBER_FIELDS.has(p.column));
          provenanceRows.push({
            property_id: propertyId,
            field_name: p.column,
            last_published_value: effective ?? null,
            winning_observation_id: overridden ? null : p.provenance.observationId,
            selection_reason: overridden ? "manual_override" : p.provenance.reason,
            policy_version: POLICY,
          });
          if (!same(property[p.column], effective, NUMBER_FIELDS.has(p.column))) {
            if (!newProperties.has(propertyId)) {
              changedProperties.add(propertyId);
              fieldsChanged++;
            }
            await event(
              propertyId,
              p.column === "status"
                ? effective === "inactive"
                  ? "inactive"
                  : "reactivated"
                : "changed",
              p.column,
              property[p.column],
              effective,
              overridden ? null : p.provenance.observationId,
              overridden ? "manual_override" : p.provenance.reason,
            );
          }
        }
        await writeSyncFields(q, provenanceRows);
        if (actual.status === "inactive" && property.status !== "inactive")
          await q(
            "INSERT INTO property_sync_state(property_id,last_evaluated_run_id,inactive_reason,inactive_at) VALUES($1,$2,$3,now()) ON CONFLICT(property_id) DO UPDATE SET last_evaluated_run_id=EXCLUDED.last_evaluated_run_id,inactive_reason=EXCLUDED.inactive_reason,inactive_at=EXCLUDED.inactive_at",
            [propertyId, runId, inactiveReason],
          );
        else if (actual.status === "active" && property.status === "inactive")
          await q(
            "UPDATE property_sync_state SET inactive_reason=null,inactive_at=null,last_evaluated_run_id=$2 WHERE property_id=$1",
            [propertyId, runId],
          );
      }
    }
    await writeReviewRows(q, pendingReviews);
    const response = {
      success: true,
      status: gate.full ? "success" : "partial_success",
      full_snapshot: gate.full,
      receipt_id: receiptId,
      summary: {
        advertisement_count: batch.advertisementCount,
        offer_count: batch.offerCount,
        rejected_count: batch.rejects.length,
        duplicate_count: batch.duplicates,
        properties_created: newProperties.size,
        properties_changed: changedProperties.size,
        fields_changed: fieldsChanged,
        unchanged_properties: touched.size - newProperties.size - changedProperties.size,
      },
      rejects: batch.rejects,
    };
    await q("UPDATE mls_ingestion_receipts SET response=$2 WHERE id=$1", [
      receiptId,
      json(response),
    ]);
    await q(
      "UPDATE listing_sync_runs SET status=$2,finished_at=now(),counts=$3,source_status=$4 WHERE id=$1",
      [
        runId,
        gate.full ? "healthy" : "degraded",
        json(response.summary),
        json({
          [batch.source]: {
            full: gate.full,
            scope: batch.scopeId,
            policy_version: POLICY,
            publisher: "python-snapshot-v2",
          },
        }),
      ],
    );
    await q(
      "INSERT INTO mls_ingestion_scopes(source,scope_id,policy_version,last_accepted_at,full_receipt_id,full_count) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source,scope_id,policy_version) DO UPDATE SET last_accepted_at=EXCLUDED.last_accepted_at,full_receipt_id=coalesce(EXCLUDED.full_receipt_id,mls_ingestion_scopes.full_receipt_id),full_count=coalesce(EXCLUDED.full_count,mls_ingestion_scopes.full_count),updated_at=now()",
      [
        batch.source,
        batch.scopeId,
        POLICY,
        batch.scrapedAt,
        gate.full ? receiptId : null,
        gate.full ? batch.advertisementCount : null,
      ],
    );
    await options.beforeCommit?.();
    committing = true;
    await q("COMMIT");
    return response;
  } catch (error) {
    try {
      await q("ROLLBACK");
    } catch {}
    // A transport failure during COMMIT may have committed; replay is the only safe recovery.
    if (committing && !/^\d{2}[A-Z0-9]{3}$/.test(String(error.code ?? "")))
      throw new SnapshotError("OUTCOME_UNKNOWN", 503, { retryAfter: 5 });
    throw error;
  }
}
