import { canonicalJson, hashPayload, SnapshotError } from "./ingestion-contract.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const key = (row) => JSON.stringify([row.external_id, row.deal_type]);
const sorted = (rows) => rows.map(canonicalJson).sort();
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);

export function validAtomicGuards(meta) {
  const guard = meta.atomic_guards;
  if (
    !object(guard) ||
    guard.version !== "before-images-v1" ||
    !Array.isArray(guard.sources) ||
    !Array.isArray(guard.canonicals)
  )
    return false;
  const expected = meta.expectations;
  if (guard.sources.some((s) => !object(s))) return false;
  if (
    !Array.isArray(expected) ||
    guard.sources.length !== expected.length ||
    !equal(guard.sources.map(key).sort(), expected.map(key).sort())
  )
    return false;
  if (new Set(guard.sources.map(key)).size !== guard.sources.length) return false;
  if (
    guard.sources.some(
      (s) =>
        !["contact", "promotion"].every(
          (field) => Object.hasOwn(s, field) && (s[field] === null || object(s[field])),
        ),
    )
  )
    return false;
  const ids = [...new Set(expected.map((e) => e.property_id).filter((id) => id !== null))].sort();
  if (!equal(guard.canonicals.map((c) => c?.property_id).sort(), ids)) return false;
  return guard.canonicals.every(
    (c) =>
      object(c) &&
      /^[a-f0-9]{32}$/.test(c.row_hash ?? "") &&
      ["sync_fields", "groups", "members", "overrides"].every(
        (field) => Array.isArray(c[field]) && c[field].every(object),
      ),
  );
}

// Row locks cannot protect an absent contact/tier or a newly inserted review.
// Controlled patches take bounded table locks, in properties-first admin order;
// ordinary ingestion is unchanged. No external work or automatic retry belongs here.
export async function configurePatchTransaction(q) {
  // A pooled client's default isolation must not pin a snapshot before locks.
  await q("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
  await q("SET LOCAL lock_timeout = '3s'");
  await q("SET LOCAL statement_timeout = '15s'");
  await q("SET LOCAL idle_in_transaction_session_timeout = '15s'");
}

export async function lockPatchPreconditions(q) {
  for (const table of [
    "admin_property_overrides",
    "listing_source_observations",
    "mls_ingestion_conflicts",
    "mls_ingestion_reviews",
    "mls_source_contacts",
    "mls_source_promotion_tiers",
    "mls_source_state",
    "property_public_groups",
    "property_public_members",
    "property_source_links",
    "property_sync_fields",
  ])
    await q(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
}

export async function readProtectedPatchFields(q, ids) {
  return q(
    `/* controlled_patch_protected */
    SELECT p.id AS property_id,
      md5(jsonb_build_object('status',p.status,'description',p.description,
        'images',p.images,'agent_id',p.agent_id)::text) AS protected_hash,
      coalesce((SELECT jsonb_agg(to_jsonb(f) || jsonb_build_object(
        'canonical_value_hash',md5(coalesce((to_jsonb(p)->f.field_name)::text,''))) ORDER BY f.field_name) FROM property_sync_fields f
        WHERE f.property_id=p.id AND (f.active_override OR f.selection_reason='manual_override'
          OR f.winning_observation_id IS NULL)),
        '[]'::jsonb) AS manual_fields
    FROM properties p WHERE p.id=ANY($1::uuid[]) ORDER BY p.id`,
    [ids],
  );
}

// Also used to freeze synthetic DB-test inputs; callers must not treat an unlocked
// read as permission to apply. The writer always re-reads after acquiring locks.
export async function readPatchBeforeImages(q, source, expected) {
  const sources = await q(
    `/* controlled_patch_sources */
    SELECT i.external_id,i.deal_type,
      (SELECT to_jsonb(c) FROM mls_source_contacts c WHERE c.source=$1
        AND c.external_listing_id=i.external_id AND c.deal_type::text=i.deal_type) AS contact,
      (SELECT to_jsonb(t) FROM mls_source_promotion_tiers t WHERE t.source=$1
        AND t.external_listing_id=i.external_id AND t.deal_type::text=i.deal_type) AS promotion
    FROM unnest($2::text[],$3::text[]) AS i(external_id,deal_type)`,
    [source, expected.map((s) => s.external_id), expected.map((s) => s.deal_type)],
  );
  const ids = [...new Set(expected.map((e) => e.property_id).filter((id) => id !== null))];
  const canonicals = await q(
    `/* controlled_patch_canonicals */
    SELECT p.id AS property_id,md5(to_jsonb(p)::text) AS row_hash,
      coalesce((SELECT jsonb_agg((to_jsonb(f)-'last_published_value') || jsonb_build_object(
        'last_published_value',CASE WHEN f.field_name IN('description','images') THEN NULL ELSE f.last_published_value END,
        'last_published_hash',md5(coalesce(f.last_published_value::text,''))) ORDER BY f.field_name)
        FROM property_sync_fields f WHERE f.property_id=p.id),'[]'::jsonb) AS sync_fields,
      coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.public_listing_no) FROM property_public_groups g
        WHERE g.public_listing_no IN(SELECT m.public_listing_no FROM property_public_members m WHERE m.property_id=p.id)),
        '[]'::jsonb) AS groups,
      coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.property_id) FROM property_public_members m
        WHERE m.public_listing_no IN(SELECT own.public_listing_no FROM property_public_members own WHERE own.property_id=p.id)),
        '[]'::jsonb) AS members,
      coalesce((SELECT jsonb_agg(jsonb_build_object('property_no',a.property_no,'row_hash',md5(to_jsonb(a)::text)) ORDER BY a.property_no)
        FROM admin_property_overrides a WHERE a.property_no IN(
          SELECT m.public_listing_no FROM property_public_members m WHERE m.property_id=p.id)),
        '[]'::jsonb) AS overrides
    FROM properties p WHERE p.id=ANY($1::uuid[])`,
    [ids],
  );
  return {
    version: "before-images-v1",
    sources,
    canonicals: canonicals.map((row) => ({
      ...row,
      sync_fields: redactPatchOwnershipFields(row.sync_fields),
    })),
  };
}

export function redactPatchOwnershipFields(fields) {
  return fields.map((field) => {
    if (!["description", "images"].includes(field.field_name)) return field;
    const { override_value, ...rest } = field;
    return { ...rest, override_value_hash: hashPayload(override_value ?? null) };
  });
}

export async function assertAtomicPatchPreconditions(q, batch) {
  const meta = batch.meta.controlled_patch;
  if (!validAtomicGuards(meta)) throw new SnapshotError("invalid_patch_atomic_guards");
  const guards = meta.atomic_guards;
  const actual = await readPatchBeforeImages(q, batch.source, meta.expectations);
  const normalize = (rows) =>
    sorted(
      rows.map((row) => ({
        ...row,
        ...Object.fromEntries(
          ["sync_fields", "groups", "members", "overrides"].map((f) => [f, sorted(row[f])]),
        ),
      })),
    );
  if (
    !equal(sorted(actual.sources), sorted(guards.sources)) ||
    !equal(normalize(actual.canonicals), normalize(guards.canonicals))
  )
    throw new SnapshotError("patch_atomic_precondition_changed", 409);
  for (const before of actual.sources) {
    const incoming = batch.records.find(
      (r) => r.externalId === before.external_id && r.dealType === before.deal_type,
    );
    if (
      ["name", "phone", "licence"].some(
        (field) =>
          before.contact?.contact?.[field] != null &&
          String(before.contact.contact[field]).trim() &&
          !incoming.contact[field],
      )
    )
      throw new SnapshotError("patch_contact_clear_requires_review", 409);
  }
  return readProtectedPatchFields(
    q,
    guards.canonicals.map((c) => c.property_id),
  );
}

export async function assertProtectedPatchFields(q, before) {
  const after = await readProtectedPatchFields(
    q,
    before.map((row) => row.property_id),
  );
  if (!equal(sorted(after), sorted(before)))
    throw new SnapshotError("patch_protected_fields_changed", 409);
}
