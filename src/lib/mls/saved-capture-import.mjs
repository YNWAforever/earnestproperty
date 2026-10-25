import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getYouTubeVideoId } from "../youtube-video-url.js";
import {
  decodeSnapshot,
  hashPayload,
  normalizeDecimal,
  POLICY_VERSION,
} from "./ingestion-contract.mjs";
import { evaluateSnapshotGate } from "./source-snapshot-gates.mjs";
import { writeSyncFields } from "./ingestion-batch-writes.mjs";
import { applyIngestion } from "./ingestion-repository.mjs";
import { readPatchBeforeImages } from "./controlled-patch-preconditions.mjs";
import { exactUnitIdentity } from "./unit-identity.mjs";
import { createObservation, SOURCE_28HSE } from "./source-contract.mjs";
import { createSyncRepository } from "./sync-repository.mjs";
import {
  prepareListingMedia,
  detectImageMime,
  sha256,
  buildOwnedMediaPathname,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
} from "./media.mjs";

export const SAVED_IMPORT_PARSER_VERSION = "saved-capture-import-v1";

export const OWNER_REPLACEMENTS = Object.freeze({
  4029337: "B059801",
  4034694: "R068782",
  4015403: "B048068",
});

const PROJECTION = [
  "title_zh",
  "district_slug",
  "floor",
  "price",
  "rent",
  "gross_area",
  "saleable_area",
  "bedrooms",
  "bathrooms",
  "orientation",
];
const MEDIA_HOSTS = ["i1.28hse.com", "i2.28hse.com", "i3.28hse.com"];
const branded = (value) => /28hse|28house|香港屋網/i.test(String(value ?? ""));
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const decimal = (value) =>
  value == null || value === ""
    ? null
    : typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
const room = (value) =>
  value === "開放式" ? 0 : /^\d+$/.test(String(value ?? "")) ? Number(value) : null;

export function assertImportTarget(env) {
  if (!env.IMPORT_DATABASE_URL) throw Error("IMPORT_DATABASE_URL_REQUIRED");
  if (env.IMPORT_TARGET_ENV !== "development" || env.VERCEL_ENV === "production")
    throw Error("development_target_required");
  const url = new URL(env.IMPORT_DATABASE_URL);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw Error("local_loopback_database_required");
  if ([...url.searchParams.keys()].some((key) => !["sslmode", "application_name"].includes(key)))
    throw Error("database_target_parameters_rejected");
  if (
    [env.DATABASE_URL, env.DATABASE_URL_UNPOOLED]
      .filter(Boolean)
      .some((value) => value === env.IMPORT_DATABASE_URL)
  )
    throw Error("production_fallback_credentials_rejected");
  return url;
}

export async function buildSavedImportPlan(
  entries,
  { captureRoot = "/workspace/28hse_capture", capturedAt = new Date().toISOString() } = {},
) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 10000)
    throw Error("IMPORT_ARRAY_REQUIRED");
  const seen = new Set();
  const rows = [];
  for (const raw of entries) {
    const failures = [],
      warnings = [];
    const id = String(raw.source_id ?? raw["28hse編號 hse_id"] ?? "");
    const deal = raw.deal_type ?? raw["買/租 deal"];
    const identity = `${id}:${deal}`;
    if (raw.source !== "28hse" || !/^\d+$/.test(id) || !["sale", "rent"].includes(deal))
      failures.push("invalid_source_identity");
    if (seen.has(identity)) failures.push("duplicate_source_identity");
    seen.add(identity);
    const action =
      id === "4028435" ? "skip" : Object.hasOwn(OWNER_REPLACEMENTS, id) ? "update" : "create";
    const sourceUrl = raw.source_url ?? raw["28hse連結 source_url"];
    if (
      sourceUrl !==
      `https://www.28hse.com/${deal === "rent" ? "rent" : "buy"}/apartment/property-${id}`
    )
      failures.push("source_url_mismatch");
    if (
      (raw.status && raw.status !== "NEW") ||
      (raw["類別 status"] && raw["類別 status"] !== "NEW") ||
      raw.sold_label === true
    )
      failures.push("not_active_new_listing");
    const detailLabels = {
      block_unit: "座數及單位",
      kitchen_type: "廚房類型",
      kitchen_cooking_mode: "廚房煮食模式",
      rent_includes: "租金包括",
      management_fee: "管理費",
      primary_school_net: "小學校網",
      secondary_school_net: "中學校網",
      developer: "發展商",
      management_company: "管理公司",
      building_age: "樓齡",
      occupation_date: "入伙日期",
      estate_intro: "屋苑介紹",
      estate_units: "屋苑單位數目",
      estate_blocks: "屋苑座數",
      estate_parking: "屋苑車位",
    };
    const description = [
      text(raw.description),
      ...Object.entries(detailLabels).flatMap(([field, label]) =>
        text(raw[field]) ? [`${label}：${text(raw[field])}`] : [],
      ),
    ]
      .filter(Boolean)
      .join("\n");
    const record = {
      property_id: id,
      deal_type: deal,
      source_url: sourceUrl,
      agency_property_no: text(raw.agent_listing_ref),
      source_status: "active",
      captured_at: capturedAt,
      title: text(raw.title ?? raw["標題 title"]),
      estate: text(raw.estate ?? raw["屋苑 estate"]),
      district: text(raw.district ?? raw["地區 district"]),
      description: text(description),
      price: decimal(raw.price_hkd ?? raw["售價 price"]),
      rent: decimal(raw.rent_hkd ?? raw["月租 rent"]),
      saleable_area: decimal(raw.saleable_area_sqft ?? raw["實用面積 saleable_sqft"]),
      gross_area: decimal(raw.gross_area_sqft),
      bedrooms: room(raw.bedrooms),
      bathrooms: room(raw.bathrooms),
      floor: text(raw.floor_level),
      orientation: text(raw.facing),
      // A broad floor band is not an exact floor/unit: never invent unit keys.
      block: text(raw.block),
      phase: text(raw.phase),
      unit: text(raw.unit),
    };
    if (!/^[A-Z]\d{6}$/.test(record.agency_property_no ?? ""))
      failures.push("agency_reference_missing_or_invalid");
    for (const field of ["title", "estate", "district", "description"])
      if (!record[field]) failures.push(`${field}_missing`);
    if (!(record[deal === "sale" ? "price" : "rent"] > 0)) failures.push("offer_amount_missing");
    if ([record.title, record.description, ...(raw.feature_tags ?? [])].some(branded))
      failures.push("source_branded_public_text");
    if (raw.bedrooms != null && record.bedrooms === null)
      warnings.push("bedroom_count_not_exact_kept_null");
    const photos = [],
      byUrl = new Map();
    const candidates = Array.isArray(raw.photos)
      ? [...raw.photos].sort(
          (a, b) =>
            Number(b.is_main === true) - Number(a.is_main === true) || (a.seq ?? 0) - (b.seq ?? 0),
        )
      : [];
    if (!candidates.length) failures.push("photos_missing");
    for (const photo of candidates) {
      if (branded(photo.watermark)) warnings.push("owner_approved_source_watermark");
      try {
        if (!/^\d+$/.test(id)) throw Error("invalid_source_identity");
        const listingRoot = await realpath(resolve(captureRoot, "photos", id));
        const path = await realpath(photo.local_path);
        const allowedRoot = await realpath(resolve(captureRoot, "photos"));
        if (
          listingRoot !== resolve(allowedRoot, id) ||
          !listingRoot.startsWith(allowedRoot + sep) ||
          !path.startsWith(listingRoot + sep)
        )
          throw Error("photo_outside_listing_directory");
        const details = await stat(path);
        if (!details.isFile() || details.size < 1 || details.size > MAX_IMAGE_BYTES)
          throw Error("photo_size_invalid");
        const url = new URL(photo.original_url);
        if (
          url.protocol !== "https:" ||
          !MEDIA_HOSTS.includes(url.hostname) ||
          url.username ||
          url.password ||
          url.port ||
          url.hash
        )
          throw Error("photo_source_url_invalid");
        const bytes = await readFile(path);
        const mime = detectImageMime(bytes);
        if (!mime) throw Error("photo_type_invalid");
        const metadata = await sharp(bytes, {
          failOn: "error",
          limitInputPixels: MAX_IMAGE_PIXELS,
        }).metadata();
        if (
          !metadata.width ||
          !metadata.height ||
          metadata.width > MAX_IMAGE_DIMENSION ||
          metadata.height > MAX_IMAGE_DIMENSION ||
          metadata.width * metadata.height > MAX_IMAGE_PIXELS
        )
          throw Error("photo_dimensions_invalid");
        await sharp(bytes, { failOn: "error", limitInputPixels: MAX_IMAGE_PIXELS }).stats();
        const hash = sha256(bytes);
        if (byUrl.has(url.href)) {
          if (byUrl.get(url.href) !== hash) throw Error("duplicate_photo_url_conflict");
          warnings.push("duplicate_photo_url_merged");
          continue;
        }
        byUrl.set(url.href, hash);
        photos.push({
          path,
          url: url.href,
          hash,
          mime,
          size: bytes.length,
          width: metadata.width,
          height: metadata.height,
          pathname: buildOwnedMediaPathname(hash, mime),
        });
      } catch (error) {
        failures.push(
          [
            "photo_outside_listing_directory",
            "photo_size_invalid",
            "photo_source_url_invalid",
            "photo_type_invalid",
            "photo_dimensions_invalid",
            "duplicate_photo_url_conflict",
          ].includes(error.message)
            ? error.message
            : "photo_file_missing_or_invalid",
        );
      }
    }
    if (action === "update" && record.agency_property_no !== OWNER_REPLACEMENTS[id])
      failures.push("owner_update_reference_mismatch");
    const videoId = (raw.video_links ?? [])
      .map((url) => (typeof url === "string" ? getYouTubeVideoId(url) : null))
      .find(Boolean);
    const extras = {
      address: text(raw.full_address ?? raw.address),
      features: Array.isArray(raw.feature_tags)
        ? raw.feature_tags.filter((v) => typeof v === "string")
        : [],
      video_url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
      source_updated_at: /^\d{4}-\d{2}-\d{2}$/.test(raw.updated_date ?? "")
        ? raw.updated_date
        : null,
    };
    const aliases = (raw.merged_repost_ids ?? []).map(String);
    if (aliases.some((alias) => !/^\d+$/.test(alias) || alias === id))
      failures.push("invalid_repost_id");
    const fingerprint = hashPayload({
      record: { ...record, captured_at: undefined },
      extras,
      photos: photos.map(({ url, hash }) => ({ url, hash })),
      aliases,
    });
    record.saved_import_hash = fingerprint;
    rows.push({
      id,
      deal,
      action,
      record,
      extras,
      photos,
      aliases,
      fingerprint,
      unitIdentity: exactUnitIdentity(record),
      failures: action === "skip" ? [] : [...new Set(failures)],
      warnings: [...new Set(warnings)],
      inputPhotoCount: candidates.length,
      existingSiteReference: raw.existing_site_listing_same_ref ?? null,
    });
  }
  const identities = new Set(rows.map((row) => `${row.id}:${row.deal}`));
  for (const row of rows)
    if (row.aliases.some((id) => identities.has(`${id}:${row.deal}`)))
      row.failures.push("repost_is_another_canonical_record");
  return {
    mode: "dry-run",
    rows,
    capturedAt,
    totalPhotoReferences: rows.reduce((n, row) => n + row.inputPhotoCount, 0),
    uniqueListingPhotos: rows.reduce((n, row) => n + row.photos.length, 0),
  };
}

export function buildSavedPayload(
  rows,
  { parserVersion, stamp = new Date().toISOString(), expectations, atomicGuards } = {},
) {
  rows = rows.filter((row) => row.action !== "skip");
  const expected =
    expectations ??
    rows.map((row) => ({
      external_id: row.id,
      deal_type: row.deal,
      property_id: null,
      observation_id: null,
      fields: {},
    }));
  return {
    source: "28hse",
    scraped_at: stamp,
    listings: rows.map((row) => row.record),
    meta: {
      schema_version: "2.0",
      policy_version: POLICY_VERSION,
      scope_id: "agent:540",
      parser_version: parserVersion,
      run_id: `saved-import-${randomUUID()}`,
      crawl_complete: true,
      pages_failed: 0,
      worker_rejected_count: 0,
      rejected_records: [],
      eligible_for_absence: false,
      pages: ["sale", "rent"].flatMap((scope) => {
        const ids = rows.filter((row) => row.deal === scope).map((row) => row.id);
        return [
          ...(ids.length
            ? [{ scope, page: 1, status: "listings", ids, details_complete: true }]
            : []),
          { scope, page: ids.length ? 2 : 1, status: "terminal", ids: [], details_complete: true },
        ];
      }),
      controlled_patch: {
        mode: "controlled",
        evidence_mode: "saved-capture-v1",
        record_count: rows.length,
        absence_allowed: false,
        projection_fields: PROJECTION,
        expectations: expected,
        atomic_guards: atomicGuards ?? {
          version: "before-images-v1",
          sources: expected.map(({ external_id, deal_type }) => ({
            external_id,
            deal_type,
            contact: null,
            promotion: null,
          })),
          canonicals: [],
        },
      },
    },
  };
}

export async function cachedMediaInput(row) {
  const files = new Map();
  for (const photo of row.photos) {
    const bytes = await readFile(photo.path);
    if (sha256(bytes) !== photo.hash) throw Error("IMPORT_PHOTO_CHANGED_AFTER_REVIEW");
    files.set(photo.url, bytes);
  }
  return {
    // This closed transport serves only frozen, validated local bytes. It never
    // opens a socket; the resolver seam only satisfies the shared media preflight.
    resolveHost: async () => ["93.184.216.34"],
    transport: async (url) => {
      if (!files.has(url)) throw Error("IMPORT_UNCACHED_PHOTO_REJECTED");
      return new Response(files.get(url), { status: 200 });
    },
    observation: createObservation({
      source: SOURCE_28HSE,
      externalId: row.id,
      dealType: row.deal,
      sourceUrl: row.record.source_url,
      propertyNoRaw: row.record.agency_property_no,
      fields: { title_zh: row.record.title, price: row.record.price, rent: row.record.rent },
      fetchedAt: row.record.captured_at,
      mediaCandidates: row.photos.map((photo, i) => ({
        url: photo.url,
        category: "listing_photo",
        isPrimary: i === 0,
      })),
    }),
  };
}

export async function inspectSavedImport(client, plan) {
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  const policy = (
    await q(
      "SELECT * FROM mls_ingestion_policies WHERE source=$1 AND scope_id='agent:540' AND policy_version=$2",
      [SOURCE_28HSE, POLICY_VERSION],
    )
  )[0];
  const issues = [];
  if (
    !policy ||
    policy.owner !== POLICY_VERSION ||
    !policy.publish_enabled ||
    !policy.bootstrap_approved_at
  )
    issues.push("ingestion_policy_or_bootstrap_not_approved");
  if (policy && policy.parser_version !== SAVED_IMPORT_PARSER_VERSION)
    issues.push("saved_import_parser_not_approved");
  for (const row of plan.rows) {
    const links = await q(
      "SELECT l.property_id,l.external_listing_id,p.status,m.public_listing_no,o.payload#>>'{raw,saved_import_hash}' AS import_hash,s.observation_id FROM property_source_links l JOIN properties p ON p.id=l.property_id LEFT JOIN property_public_members m ON m.property_id=p.id LEFT JOIN mls_source_state s ON s.source=l.source AND s.external_listing_id=l.external_listing_id AND s.deal_type=l.deal_type LEFT JOIN listing_source_observations o ON o.id=s.observation_id WHERE l.source=$1 AND l.external_listing_id=ANY($2::text[]) AND l.deal_type=$3 AND l.status='active'",
      [SOURCE_28HSE, [row.id, ...row.aliases], row.deal],
    );
    const ids = new Set(links.map((link) => link.property_id));
    row.existing = links.find((link) => link.external_listing_id === row.id) ?? links[0] ?? null;
    if (ids.size > 1) row.failures.push("multiple_existing_source_targets");
    if (row.existing && row.existing.import_hash !== row.fingerprint)
      row.failures.push("existing_source_requires_review");
    if (row.action === "skip") continue;
    if (row.action === "update" && (!row.existing || row.existing.status === "draft")) {
      const targets = await q(
        "SELECT p.*,m.public_listing_no,md5(to_jsonb(p)::text) AS row_hash FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE m.public_listing_no=$1 AND ($2::uuid IS NULL OR p.id<>$2)",
        [OWNER_REPLACEMENTS[row.id], row.existing?.property_id ?? null],
      );
      if (
        targets.length !== 1 ||
        targets[0].canonical_property_no !== OWNER_REPLACEMENTS[row.id] ||
        !["active", "draft"].includes(targets[0].status)
      )
        row.failures.push("owner_update_target_missing_or_ambiguous");
      else row.updateTarget = targets[0];
    }
    const mapping = policy?.config?.estate_mappings?.[row.record.estate];
    if (!mapping?.estate_id || !mapping?.district_slug)
      row.failures.push("estate_mapping_unverified");
    else {
      const estate = (
        await q("SELECT id,district_slug FROM estates WHERE id=$1", [mapping.estate_id])
      )[0];
      if (!estate || estate.district_slug !== mapping.district_slug)
        row.failures.push("estate_mapping_mismatch");
    }
    const company = policy?.config?.company_number_identity;
    if (company?.approved !== true || company.version !== "company-number-v1")
      row.failures.push("company_identity_policy_not_approved");
  }
  return { policy, issues };
}

export async function applySavedImport(
  client,
  plan,
  { blobStore, onProgress = async () => {} } = {},
) {
  plan = { ...plan, rows: plan.rows.filter((row) => row.action !== "skip") };
  if (plan.rows.some((row) => row.failures.length)) throw Error("IMPORT_VALIDATION_FAILED");
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  const acquired = (
    await q("SELECT pg_try_advisory_lock(hashtext('earnestproperty:saved-import')) AS acquired")
  )[0]?.acquired;
  if (!acquired) throw Error("IMPORT_BUSY");
  const result = { created: [], updated: [], resumed: [], alreadyPresent: [], held: [] };
  try {
    const { policy, issues } = await inspectSavedImport(client, plan);
    if (issues.length || plan.rows.some((row) => row.failures.length))
      throw Error("IMPORT_TARGET_PREFLIGHT_FAILED");
    const pending = plan.rows.filter((row) => !row.existing);
    if (pending.length) {
      const stamp = new Date().toISOString();
      const expected = pending.map((row) => ({
        external_id: row.id,
        deal_type: row.deal,
        property_id: null,
        observation_id: null,
        fields: {},
      }));
      const guards = await readPatchBeforeImages(q, SOURCE_28HSE, expected);
      const payload = buildSavedPayload(pending, {
        parserVersion: SAVED_IMPORT_PARSER_VERSION,
        stamp,
        expectations: expected,
        atomicGuards: guards,
      });
      const batch = decodeSnapshot(payload, { controlledPatch: true });
      const gate = evaluateSnapshotGate(batch, null, {}, { controlledPatch: true });
      if (!gate.allowed || gate.full || gate.inferAbsence)
        throw Error("IMPORT_PARTIAL_SNAPSHOT_REQUIRED");
      await applyIngestion(client, payload, {
        controlledPatch: true,
        expectedSource: SOURCE_28HSE,
      });
    }
    const repository = createSyncRepository({ client });
    for (const row of plan.rows) {
      let source = (
        await q(
          "SELECT p.*,md5(to_jsonb(p)::text) AS row_hash,s.observation_id,md5(to_jsonb(s)::text) AS source_state_hash,md5(to_jsonb(l)::text) AS source_link_hash,md5(to_jsonb(o)::text) AS observation_hash,m.public_listing_no,o.payload#>>'{raw,saved_import_hash}' AS import_hash FROM mls_source_state s JOIN properties p ON p.id=s.property_id JOIN listing_source_observations o ON o.id=s.observation_id JOIN property_public_members m ON m.property_id=p.id JOIN property_source_links l ON l.source=s.source AND l.external_listing_id=s.external_listing_id AND l.deal_type=s.deal_type WHERE s.source=$1 AND s.external_listing_id=$2 AND s.deal_type=$3",
          [SOURCE_28HSE, row.id, row.deal],
        )
      )[0];
      if (!source || source.import_hash !== row.fingerprint)
        throw Error("IMPORT_SOURCE_BINDING_CHANGED");
      const completed =
        (
          await q(
            "SELECT 1 FROM property_sync_fields WHERE property_id=$1 AND field_name='images' AND winning_observation_id=$2 AND selection_reason='operator_saved_capture_import'",
            [source.id, source.observation_id],
          )
        ).length > 0;
      if (source.status === "active" && completed) {
        result.alreadyPresent.push({ id: row.id, listingNo: source.public_listing_no });
        continue;
      }
      if (
        !["draft", "active"].includes(source.status) ||
        (row.action !== "update" && source.ingestion_owner !== POLICY_VERSION)
      )
        throw Error("IMPORT_DRAFT_REVIEW_REQUIRED");
      const cached = await cachedMediaInput(row);
      const media = await prepareListingMedia({
        ...cached,
        rightsConfirmed: true,
        observationId: source.observation_id,
        propertyId: source.id,
        isNew: false,
        currentImages: [],
        mode: "upload",
        allowedMediaHosts: MEDIA_HOSTS,
        repository,
        blobStore,
      });
      if (!media.publishable || !media.images.length) {
        result.held.push({ id: row.id, reason: "owned_media_validation_failed" });
        await onProgress(result);
        continue;
      }
      await q("BEGIN");
      try {
        await q("SELECT pg_advisory_xact_lock(hashtext('earnestproperty:mls-sync'))");
        await q("LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE");
        await q("SELECT set_config('app.mls_writer_policy',$1,true)", [POLICY_VERSION]);
        const journals = await q(
          "SELECT s.property_id,s.observation_id,s.source_status,l.property_id AS linked_property_id,l.status AS link_status,md5(to_jsonb(s)::text) AS source_state_hash,md5(to_jsonb(l)::text) AS source_link_hash,md5(to_jsonb(o)::text) AS observation_hash,o.payload#>>'{raw,saved_import_hash}' AS import_hash,m.public_listing_no FROM mls_source_state s JOIN property_source_links l ON l.source=s.source AND l.external_listing_id=s.external_listing_id AND l.deal_type=s.deal_type JOIN listing_source_observations o ON o.id=s.observation_id JOIN property_public_members m ON m.property_id=s.property_id WHERE s.source=$1 AND s.external_listing_id=$2 AND s.deal_type=$3 FOR UPDATE OF s,l,o,m",
          [SOURCE_28HSE, row.id, row.deal],
        );
        const journal = journals[0];
        if (
          journals.length !== 1 ||
          journal.property_id !== source.id ||
          journal.linked_property_id !== source.id ||
          journal.observation_id !== source.observation_id ||
          journal.source_status !== "active" ||
          journal.link_status !== "active" ||
          journal.import_hash !== row.fingerprint ||
          journal.public_listing_no !== source.public_listing_no ||
          ["source_state_hash", "source_link_hash", "observation_hash"].some(
            (field) => journal[field] !== source[field],
          )
        )
          throw Error("IMPORT_SOURCE_JOURNAL_CHANGED");
        const current = (
          await q(
            "SELECT md5(to_jsonb(p)::text) AS row_hash FROM properties p WHERE id=$1 FOR UPDATE",
            [source.id],
          )
        )[0];
        if (current?.row_hash !== source.row_hash)
          throw Error("IMPORT_PROPERTY_CHANGED_DURING_MEDIA_UPLOAD");
        if (row.action === "update" && row.updateTarget && source.id !== row.updateTarget.id) {
          const target = row.updateTarget;
          const original = (
            await q(
              "SELECT md5(to_jsonb(p)::text) AS row_hash FROM properties p WHERE id=$1 FOR UPDATE",
              [target.id],
            )
          )[0];
          if (
            original?.row_hash !== target.row_hash ||
            source.public_listing_no !== target.public_listing_no
          )
            throw Error("IMPORT_OWNER_TARGET_CHANGED");
          // Standard ingestion staged an unpublished offer. Fold it into the
          // explicitly owner-selected existing row only after media is owned.
          // Source rebinding, draft removal and field replacement commit together.
          const reboundState = await q(
            "UPDATE mls_source_state SET property_id=$2 WHERE property_id=$1 AND source=$3 AND external_listing_id=$4 AND deal_type=$5 AND observation_id=$6 RETURNING property_id",
            [source.id, target.id, SOURCE_28HSE, row.id, row.deal, source.observation_id],
          );
          const reboundLinks = await q(
            "UPDATE property_source_links SET property_id=$2 WHERE property_id=$1 AND source=$3 AND external_listing_id=$4 AND deal_type=$5 AND status='active' RETURNING property_id",
            [source.id, target.id, SOURCE_28HSE, row.id, row.deal],
          );
          if (reboundState.length !== 1 || reboundLinks.length !== 1)
            throw Error("IMPORT_SOURCE_JOURNAL_CHANGED");
          await q(
            "UPDATE listing_media_records SET property_id=$2 WHERE property_id=$1 AND observation_id=$3",
            [source.id, target.id, source.observation_id],
          );
          await q("DELETE FROM properties WHERE id=$1 AND status='draft' AND ingestion_owner=$2", [
            source.id,
            POLICY_VERSION,
          ]);
          source = { ...source, ...target, observation_id: source.observation_id };
        }
        const reviews = await q(
          "SELECT 1 FROM mls_ingestion_reviews WHERE source=$1 AND external_listing_id=$2 AND deal_type=$3 AND status='open' UNION ALL SELECT 1 FROM property_public_groups WHERE public_listing_no=$4 AND review_required UNION ALL SELECT 1 FROM admin_property_overrides WHERE property_no=$4",
          [SOURCE_28HSE, row.id, row.deal, source.public_listing_no],
        );
        if (reviews.length) throw Error("IMPORT_STAFF_REVIEW_REQUIRED");
        for (const alias of row.aliases) {
          const existing = await q(
            "SELECT property_id FROM property_source_links WHERE source=$1 AND external_listing_id=$2 AND deal_type=$3 FOR UPDATE",
            [SOURCE_28HSE, alias, row.deal],
          );
          if (existing.some((link) => link.property_id !== source.id))
            throw Error("IMPORT_REPOST_TARGET_CONFLICT");
          await q(
            "INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,match_key,link_reason,status,first_seen_at,last_seen_at,last_seen_run_id) SELECT $1,$2,$3,$4,NULL,'source_id_v2','active',fetched_at,fetched_at,run_id FROM listing_source_observations WHERE id=$5 ON CONFLICT(source,external_listing_id,deal_type) DO NOTHING",
            [source.id, SOURCE_28HSE, alias, row.deal, source.observation_id],
          );
        }
        if (row.action === "update") {
          // Retain historical evidence, but prevent the superseded deal's link
          // from silently reattaching that old offering on a later source run.
          await q(
            "UPDATE property_source_links SET status='rejected',updated_at=now() WHERE property_id=$1 AND deal_type<>$2 AND status='active'",
            [source.id, row.deal],
          );
        }
        const mapping = policy.config.estate_mappings[row.record.estate];
        const values = {
          title_zh: row.record.title,
          deal_type: row.deal,
          price: row.record.price,
          rent: row.record.rent,
          saleable_area: row.record.saleable_area,
          gross_area: row.record.gross_area,
          bedrooms: row.record.bedrooms,
          bathrooms: row.record.bathrooms,
          floor: row.record.floor,
          orientation: row.record.orientation,
          estate_id: mapping.estate_id,
          district_slug: mapping.district_slug,
          description: row.record.description,
          images: media.images,
          address: row.extras.address,
          features: row.extras.features,
          source_updated_at: row.extras.source_updated_at,
          video_url: row.extras.video_url,
          floorplan_url: null,
          status: "active",
        };
        const effectiveRows = await q(
          `UPDATE properties SET ${Object.keys(values)
            .map((key, i) => `${key}=$${i + 2}`)
            .join(
              ",",
            )},source_site='28hse',source_url=$${Object.keys(values).length + 2},last_seen_at=now(),last_scraped_at=now(),ingestion_owner='no-hermes-v2',ingestion_identity_policy='no-hermes-v2',updated_at=now() WHERE id=$1 RETURNING *`,
          [source.id, ...Object.values(values), row.record.source_url],
        );
        const effective = effectiveRows[0];
        const numeric = new Set([
          "price",
          "rent",
          "saleable_area",
          "gross_area",
          "bedrooms",
          "bathrooms",
        ]);
        if (
          effectiveRows.length !== 1 ||
          Object.entries(values).some(([field, value]) => {
            const actual = effective?.[field] ?? null;
            if (numeric.has(field)) return normalizeDecimal(actual) !== normalizeDecimal(value);
            if (field === "source_updated_at" && actual instanceof Date)
              return actual.toISOString().slice(0, 10) !== value;
            return hashPayload(actual) !== hashPayload(value ?? null);
          })
        )
          throw Error("IMPORT_EFFECTIVE_FIELDS_CHANGED");
        await writeSyncFields(
          q,
          Object.entries(values)
            .filter(([field]) => field !== "deal_type")
            .map(([field, value]) => ({
              property_id: source.id,
              field_name: field,
              last_published_value: value,
              winning_observation_id: source.observation_id,
              selection_reason: "operator_saved_capture_import",
              policy_version: POLICY_VERSION,
            })),
        );
        await q(
          "INSERT INTO listing_change_events(property_id,run_id,change_type,field_name,old_value,new_value,winning_observation_id,reason) SELECT $1,run_id,'changed','saved_import',$3::jsonb,$4::jsonb,id,'operator_saved_capture_import' FROM listing_source_observations WHERE id=$2",
          [
            source.id,
            source.observation_id,
            JSON.stringify({
              status: source.status,
              deal_type: source.deal_type,
              price: source.price,
              rent: source.rent,
            }),
            JSON.stringify({
              status: "active",
              deal_type: row.deal,
              price: row.record.price,
              rent: row.record.rent,
            }),
          ],
        );
        await q("COMMIT");
      } catch (error) {
        await q("ROLLBACK");
        throw error;
      }
      result[row.action === "update" ? "updated" : row.existing ? "resumed" : "created"].push({
        id: row.id,
        listingNo: source.public_listing_no,
        propertyId: source.id,
        photos: media.images.length,
        url: `/property/${encodeURIComponent(source.public_listing_no)}`,
      });
      await onProgress(result);
    }
    return result;
  } finally {
    await q("SELECT pg_advisory_unlock(hashtext('earnestproperty:saved-import'))");
  }
}
