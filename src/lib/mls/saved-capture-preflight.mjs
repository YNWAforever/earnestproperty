import {
  OWNER_REPLACEMENTS,
  SAVED_IMPORT_PARSER_VERSION,
  inspectSavedImport,
} from "./saved-capture-import.mjs";
import { POLICY_VERSION } from "./ingestion-contract.mjs";

// These are the existing writer/media dependencies, not a new schema.
export const REQUIRED_IMPORT_SCHEMA = Object.freeze({
  properties: [
    "id",
    "listing_no",
    "canonical_property_no",
    "title_zh",
    "deal_type",
    "status",
    "estate_id",
    "district_slug",
    "description",
    "images",
    "price",
    "rent",
    "saleable_area",
    "gross_area",
    "bedrooms",
    "bathrooms",
    "floor",
    "orientation",
    "features",
    "address",
    "source_site",
    "source_url",
    "source_updated_at",
    "last_seen_at",
    "last_scraped_at",
    "updated_at",
    "created_at",
    "agent_id",
    "video_url",
    "floorplan_url",
    "ingestion_owner",
    "ingestion_identity_policy",
  ],
  estates: ["id", "slug", "name_zh", "district_slug"],
  property_public_groups: [
    "public_listing_no",
    "canonical_property_no",
    "review_required",
    "updated_at",
  ],
  property_public_members: ["property_id", "public_listing_no"],
  property_source_links: [
    "id",
    "property_id",
    "source",
    "external_listing_id",
    "deal_type",
    "match_key",
    "link_reason",
    "status",
    "first_seen_at",
    "last_seen_at",
    "last_seen_run_id",
    "updated_at",
  ],
  listing_source_observations: [
    "id",
    "run_id",
    "source",
    "external_listing_id",
    "deal_type",
    "source_url",
    "payload",
    "content_hash",
    "validation_state",
    "property_no_raw",
    "property_no_normalized",
    "media_candidates",
    "quarantine_reasons",
    "source_updated_at",
    "discovered_at",
    "fetched_at",
  ],
  listing_sync_runs: [
    "id",
    "scheduled_for",
    "mode",
    "status",
    "parser_version",
    "source_status",
    "counts",
    "baselines",
    "failure_code",
    "failure_summary",
    "started_at",
    "finished_at",
  ],
  listing_change_events: [
    "id",
    "property_id",
    "run_id",
    "change_type",
    "field_name",
    "old_value",
    "new_value",
    "winning_observation_id",
    "reason",
  ],
  property_sync_fields: [
    "property_id",
    "field_name",
    "last_published_value",
    "override_value",
    "active_override",
    "winning_observation_id",
    "selection_reason",
    "policy_version",
    "updated_at",
  ],
  property_sync_state: [
    "property_id",
    "consecutive_absent_healthy_runs",
    "last_evaluated_run_id",
    "inactive_reason",
    "inactive_at",
    "updated_at",
  ],
  media_assets: [
    "id",
    "url",
    "pathname",
    "content_type",
    "size_bytes",
    "content_hash",
    "owner_type",
    "owner_id",
    "created_by",
    "created_at",
  ],
  listing_media_records: [
    "id",
    "observation_id",
    "property_id",
    "source_url",
    "content_hash",
    "owned_media_asset_id",
    "detected_mime",
    "size_bytes",
    "width",
    "height",
    "eligibility",
    "rejection_reason",
    "created_at",
  ],
  mls_ingestion_policies: [
    "source",
    "scope_id",
    "policy_version",
    "parser_version",
    "owner",
    "publish_enabled",
    "bootstrap_approved_at",
    "bootstrap_approved_by",
    "config",
  ],
  mls_ingestion_receipts: [
    "id",
    "source",
    "scope_id",
    "policy_version",
    "parser_version",
    "scraped_at",
    "payload_hash",
    "run_id",
    "response",
    "full_snapshot",
    "accepted_at",
  ],
  mls_ingestion_scopes: [
    "source",
    "scope_id",
    "policy_version",
    "last_accepted_at",
    "full_receipt_id",
    "full_count",
    "updated_at",
  ],
  mls_source_state: [
    "source",
    "external_listing_id",
    "deal_type",
    "scope_id",
    "policy_version",
    "observation_id",
    "last_receipt_id",
    "property_id",
    "unit_key",
    "source_status",
    "first_seen_at",
    "last_accepted_at",
    "raw_identity",
  ],
  mls_source_contacts: [
    "source",
    "external_listing_id",
    "deal_type",
    "contact",
    "branches",
    "observation_id",
    "updated_at",
  ],
  mls_source_promotion_tiers: [
    "source",
    "external_listing_id",
    "deal_type",
    "promotion_tier",
    "observation_id",
  ],
  mls_ingestion_reviews: [
    "review_key",
    "source",
    "external_listing_id",
    "deal_type",
    "reason",
    "evidence",
    "observation_id",
    "status",
    "first_run_id",
    "last_run_id",
    "first_seen_at",
    "last_seen_at",
  ],
  mls_ingestion_conflicts: ["property_id", "review_status"],
  admin_property_overrides: ["property_no", "shared", "sale", "rent"],
  admin_property_source_snapshots: ["property_no", "property_id", "operation", "payload"],
});
export const REQUIRED_IMPORT_KEYS = Object.freeze([
  ["properties", ["listing_no"]],
  ["property_public_members", ["property_id"]],
  ["property_public_groups", ["public_listing_no"]],
  ["property_source_links", ["source", "external_listing_id", "deal_type"]],
  ["mls_source_state", ["source", "external_listing_id", "deal_type"]],
  ["mls_ingestion_policies", ["source", "scope_id", "policy_version"]],
  ["mls_ingestion_receipts", ["source", "scope_id", "scraped_at"]],
  ["property_sync_fields", ["property_id", "field_name"]],
  ["listing_media_records", ["observation_id", "source_url"]],
  ["media_assets", ["content_hash"]],
]);
export const REQUIRED_IMPORT_TRIGGERS = Object.freeze([
  "aaa_mls_ingestion_owner_fence",
  "assign_property_public_identity_after_insert",
  "revalidate_property_public_identity_after_update",
  "admin_property_protect_source",
]);

async function inspectReadOnlyBody(client, plan, { fullDryRun }) {
  const missingItems = [],
    estateMappings = [],
    ownerTargets = [];
  const add = (code, detail) => missingItems.push({ code, detail });
  const q = async (sql, params = []) => {
    if (!/^(SELECT|SHOW)\b/.test(sql) || /\bFOR\s+(UPDATE|SHARE)\b/.test(sql) || /;\s*\S/.test(sql))
      throw Error("IMPORT_PREFLIGHT_WRITE_REJECTED");
    return (await client.query(sql, params)).rows;
  };
  const columns = await q(
    "SELECT /* import_preflight_columns */ requested.name AS table_name,a.attname AS column_name FROM unnest($1::text[]) requested(name) LEFT JOIN pg_attribute a ON a.attrelid=to_regclass(requested.name) AND a.attnum>0 AND NOT a.attisdropped",
    [Object.keys(REQUIRED_IMPORT_SCHEMA)],
  );
  for (const [table, required] of Object.entries(REQUIRED_IMPORT_SCHEMA))
    for (const column of required)
      if (!columns.some((row) => row.table_name === table && row.column_name === column))
        add("schema_column_missing", `${table}.${column}`);
  const keys = await q(
    "SELECT /* import_preflight_keys */ requested.name AS table_name,ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.ord) AS columns,(i.indisvalid AND i.indisready) AS valid FROM unnest($1::text[]) requested(name) JOIN pg_index i ON i.indrelid=to_regclass(requested.name) WHERE i.indisunique",
    [Object.keys(REQUIRED_IMPORT_SCHEMA)],
  );
  for (const [table, required] of REQUIRED_IMPORT_KEYS)
    if (
      !keys.some(
        (row) =>
          row.table_name === table &&
          row.valid &&
          JSON.stringify(row.columns) === JSON.stringify(required),
      )
    )
      add("schema_unique_key_missing", `${table}(${required.join(",")})`);
  const triggers = await q(
    "SELECT /* import_preflight_triggers */ t.tgname AS trigger_name,(t.tgenabled IN('O','A')) AS enabled FROM pg_trigger t WHERE t.tgrelid=to_regclass('properties') AND NOT t.tgisinternal",
  );
  for (const name of REQUIRED_IMPORT_TRIGGERS)
    if (!triggers.some((row) => row.trigger_name === name && row.enabled))
      add("schema_trigger_missing", name);
  const schemaReady = !missingItems.length;
  if (!schemaReady)
    return {
      ready: false,
      missingItems,
      estateMappings,
      ownerTargets,
      fullDryRun: false,
      readOnly: true,
    };
  const policies = await q(
    "SELECT * FROM mls_ingestion_policies WHERE source=$1 AND scope_id=$2 AND policy_version=$3",
    ["28hse_agent_540", "agent:540", POLICY_VERSION],
  );
  const policy = policies.length === 1 ? policies[0] : null;
  if (!policy) add("ingestion_policy_missing", "28hse_agent_540 / agent:540 / no-hermes-v2");
  else {
    if (policy.owner !== POLICY_VERSION) add("ingestion_owner_unapproved", "expected no-hermes-v2");
    if (policy.publish_enabled !== true)
      add("ingestion_publication_disabled", "publish_enabled must be owner-approved");
    if (!policy.bootstrap_approved_at || !policy.bootstrap_approved_by)
      add("ingestion_bootstrap_unapproved", "bootstrap owner approval required");
    if (policy.parser_version !== SAVED_IMPORT_PARSER_VERSION)
      add("saved_import_parser_not_approved", SAVED_IMPORT_PARSER_VERSION);
  }
  const identity = policy?.config?.company_number_identity;
  if (
    identity?.version !== "company-number-v1" ||
    identity.approved !== true ||
    typeof identity.approved_by !== "string" ||
    !identity.approved_by.trim()
  )
    add(
      "company_identity_policy_unapproved",
      "config.company_number_identity requires company-number-v1, approved=true and an approver",
    );
  const labels = [...new Set(plan.rows.map((row) => row.record.estate).filter(Boolean))].sort();
  const ids = labels
    .map((label) => policy?.config?.estate_mappings?.[label]?.estate_id)
    .filter((id) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id ?? ""));
  const estates = ids.length
    ? await q(
        "SELECT /* import_preflight_estates */ id,slug,name_zh,district_slug FROM estates WHERE id=ANY($1::uuid[])",
        [ids],
      )
    : [];
  for (const label of labels) {
    const mapping = policy?.config?.estate_mappings?.[label];
    const found =
      mapping &&
      estates.find((estate) => estate.id.toLowerCase() === String(mapping.estate_id).toLowerCase());
    const valid = Boolean(found && mapping.district_slug === found.district_slug);
    estateMappings.push({
      label,
      estateId: found?.id ?? null,
      slug: found?.slug ?? null,
      districtSlug: found?.district_slug ?? null,
      valid,
    });
    if (!valid) add("estate_mapping_missing_or_invalid", label);
  }
  const expectedOwners = Object.entries(OWNER_REPLACEMENTS).map(([sourceId, ref]) => ({
    sourceId,
    ref,
    fingerprint: plan.rows.find((row) => row.id === sourceId)?.fingerprint ?? null,
  }));
  const owners = await q(
    `SELECT /* import_preflight_owner_targets */ p.id,p.status,p.canonical_property_no,m.public_listing_no,g.review_required,
 EXISTS(SELECT 1 FROM admin_property_overrides a WHERE a.property_no=m.public_listing_no) OR EXISTS(SELECT 1 FROM property_sync_fields f JOIN property_public_members fm ON fm.property_id=f.property_id WHERE fm.public_listing_no=m.public_listing_no AND (f.active_override OR f.selection_reason='manual_override')) AS overrides,
 EXISTS(SELECT 1 FROM mls_ingestion_conflicts c JOIN property_public_members cm ON cm.property_id=c.property_id WHERE cm.public_listing_no=m.public_listing_no AND c.review_status='unreviewed') AS conflicts,
 EXISTS(SELECT 1 FROM mls_ingestion_reviews r WHERE r.status='open' AND (EXISTS(SELECT 1 FROM mls_source_state s JOIN property_public_members sm ON sm.property_id=s.property_id WHERE sm.public_listing_no=m.public_listing_no AND s.source=r.source AND s.external_listing_id=r.external_listing_id AND s.deal_type=r.deal_type) OR (r.source='28hse_agent_540' AND EXISTS(SELECT 1 FROM jsonb_to_recordset($2::jsonb) x("sourceId" text,ref text) WHERE x.ref=m.public_listing_no AND x."sourceId"=r.external_listing_id)))) AS open_reviews,
 (p.status='draft' AND EXISTS(SELECT 1 FROM mls_source_state s JOIN listing_source_observations o ON o.id=s.observation_id CROSS JOIN jsonb_to_recordset($2::jsonb) x("sourceId" text,ref text,fingerprint text) WHERE s.property_id=p.id AND s.source='28hse_agent_540' AND s.external_listing_id=x."sourceId" AND x.ref=m.public_listing_no AND o.payload#>>'{raw,saved_import_hash}'=x.fingerprint)) AS known_import_draft
 FROM property_public_members m JOIN properties p ON p.id=m.property_id JOIN property_public_groups g ON g.public_listing_no=m.public_listing_no WHERE m.public_listing_no=ANY($1::text[])`,
    [Object.values(OWNER_REPLACEMENTS), JSON.stringify(expectedOwners)],
  );
  for (const ref of Object.values(OWNER_REPLACEMENTS)) {
    const group = owners.filter((row) => row.public_listing_no === ref);
    const targets = group.filter((row) => !row.known_import_draft);
    const reasons = [];
    if (targets.length !== 1) reasons.push("missing_or_ambiguous");
    else {
      if (targets[0].canonical_property_no !== ref) reasons.push("company_reference_mismatch");
      if (!["active", "draft"].includes(targets[0].status)) reasons.push("inactive_target");
    }
    for (const field of ["review_required", "overrides", "conflicts", "open_reviews"])
      if (group.some((row) => row[field])) reasons.push(field);
    ownerTargets.push({
      ref,
      propertyId: targets.length === 1 ? targets[0].id : null,
      valid: !reasons.length,
      reasons,
    });
    if (reasons.length) add("owner_target_not_ready", `${ref}: ${reasons.join(", ")}`);
  }
  if (fullDryRun && policy) {
    const inspected = await inspectSavedImport({ query: qProxy(q) }, plan);
    for (const issue of inspected.issues) add("full_dry_run_policy", issue);
    for (const row of plan.rows.filter((row) => row.action !== "skip"))
      for (const failure of row.failures) add("full_dry_run_row", `${row.id}: ${failure}`);
  }
  return {
    ready: !missingItems.length,
    missingItems,
    estateMappings,
    ownerTargets,
    fullDryRun,
    readOnly: true,
  };
}
const qProxy = (q) => async (sql, params) => ({ rows: await q(sql, params) });

export async function inspectImportReadOnly(client, plan, { fullDryRun = false } = {}) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const mode = (await client.query("SHOW transaction_read_only")).rows[0]?.transaction_read_only;
    if (mode !== "on") throw Error("IMPORT_PREFLIGHT_NOT_READ_ONLY");
    return await inspectReadOnlyBody(client, plan, { fullDryRun });
  } finally {
    await client.query("ROLLBACK");
  }
}
