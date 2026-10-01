import { orderPublicationQueue, publicationBacklog } from "./publication-queue.mjs";
import { publicationMediaObservation } from "./publication-media-retry.mjs";
import { decodeSnapshot, normalizeDecimal } from "./ingestion-contract.mjs";
import { prepareListingMedia } from "./media.mjs";
import { createObservation } from "./source-contract.mjs";
import { createSyncRepository } from "./sync-repository.mjs";
const POLICY = "daily-reviewed-publication-v1";
const HOSTS = ["i1.28hse.com", "i2.28hse.com", "i3.28hse.com"];
const equal = (a, b) => normalizeDecimal(a) === normalizeDecimal(b);
export function publicationDecision(raw, p) {
  if (!p || p.status !== "draft" || p.ingestion_owner !== "no-hermes-v2")
    return "not_imported_draft";
  if (p.blocked || Number(p.source_count) !== 1) return "staff_or_source_review";
  if (
    !/^[A-Z][0-9]{6}$/.test(raw.agency_property_no ?? "") ||
    raw.agency_property_no !== p.canonical_property_no ||
    raw.deal_type !== p.deal_type ||
    raw.property_id !== p.external_listing_id
  )
    return "identity_changed";
  if (raw.source_status !== "active" || p.source_status !== "active") return "source_inactive";
  if (!p.estate_id || !(Number(p.saleable_area) > 0) || !equal(p.saleable_area, raw.saleable_area))
    return "area_or_estate_missing";
  const amount = raw.deal_type === "rent" ? "rent" : "price";
  if (!(Number(raw[amount]) > 0) || !equal(raw[amount], p[amount])) return "amount_changed";
  if (p.images?.length || p.description || p.source_url) return "existing_content_requires_review";
  const content = raw.publication;
  if (
    !content ||
    typeof content.description !== "string" ||
    !content.description.trim() ||
    content.description.length > 2000 ||
    !Array.isArray(content.images) ||
    !content.images.length ||
    content.images.length > 6
  )
    return "content_missing";
  try {
    const source = new URL(raw.source_url);
    if (
      source.origin !== "https://www.28hse.com" ||
      source.pathname !==
        `/${raw.deal_type === "rent" ? "rent" : "buy"}/apartment/property-${raw.property_id}` ||
      source.search ||
      source.hash
    )
      return "source_url_invalid";
    for (const image of content.images) {
      const u = new URL(image);
      if (
        u.protocol !== "https:" ||
        !HOSTS.includes(u.hostname) ||
        u.port ||
        u.username ||
        u.password
      )
        return "media_host_invalid";
    }
  } catch {
    return "source_url_invalid";
  }
  return null;
}
const targetSql = `SELECT p.*,
 (SELECT max(mr.created_at) FROM listing_media_records mr WHERE mr.property_id=p.id) AS last_media_attempt_at,
 s.observation_id,s.external_listing_id,s.source_status,o.run_id,m.public_listing_no,
 (SELECT count(*) FROM mls_source_state x WHERE x.property_id=p.id AND x.source_status='active') AS source_count,
 (coalesce(o.payload->>'holdProjection','false')='true'
 OR EXISTS(SELECT 1 FROM properties other WHERE other.id<>p.id AND other.canonical_property_no=p.canonical_property_no AND other.deal_type=p.deal_type)
 OR EXISTS(SELECT 1 FROM admin_property_overrides a WHERE a.property_no=m.public_listing_no AND (a.shared<>'{}'::jsonb OR CASE p.deal_type::text WHEN 'sale' THEN a.sale ELSE a.rent END<>'{}'::jsonb))
 OR EXISTS(SELECT 1 FROM property_sync_fields f WHERE f.property_id=p.id AND (f.active_override OR f.selection_reason='manual_override'))
 OR EXISTS(SELECT 1 FROM mls_ingestion_conflicts c WHERE c.property_id=p.id AND c.review_status='unreviewed')
 OR EXISTS(SELECT 1 FROM mls_ingestion_reviews r WHERE r.source=s.source AND r.external_listing_id=s.external_listing_id AND r.deal_type=s.deal_type AND r.status='open')) AS blocked
 FROM mls_source_state s JOIN properties p ON p.id=s.property_id JOIN property_public_members m ON m.property_id=p.id
 JOIN listing_source_observations o ON o.id=s.observation_id
 WHERE s.source='28hse_agent_540' AND s.scope_id='agent:540' AND s.external_listing_id=$1 AND s.deal_type=$2`;
export async function publishDaily({
  payload,
  client,
  blobStore,
  apply = false,
  prepare = prepareListingMedia,
  now = Date.now,
  onReport = async () => {},
}) {
  const batch = decodeSnapshot(payload);
  if (
    batch.source !== "28hse_agent_540" ||
    batch.scopeId !== "agent:540" ||
    batch.rejects.length ||
    batch.duplicates
  )
    throw Error("INVALID_PUBLICATION_BATCH");
  if (
    !Number.isFinite(Date.parse(batch.scrapedAt)) ||
    now() - Date.parse(batch.scrapedAt) > 36 * 3600000 ||
    Date.parse(batch.scrapedAt) > now() + 60000
  )
    throw Error("STALE_PUBLICATION_BATCH");
  const q = async (text, params = []) => (await client.query(text, params)).rows;
  const accepted = async () => {
    const r = await q(
      `SELECT r.id FROM mls_ingestion_receipts r JOIN mls_ingestion_scopes s ON s.full_receipt_id=r.id
      WHERE r.source=$1 AND r.scope_id=$2 AND r.payload_hash=$3 AND r.full_snapshot
      AND r.response->>'success'='true' AND s.last_accepted_at=r.scraped_at`,
      [batch.source, batch.scopeId, batch.hash],
    );
    if (r.length !== 1) throw Error("ACCEPTED_CURRENT_FULL_RECEIPT_REQUIRED");
    return r[0].id;
  };
  const receiptId = await accepted();
  const report = {
    receiptId,
    published: [],
    ready: [],
    held: [],
    unknown: [],
    alreadyPublic: 0,
    attempted: 0,
    eligibleBacklog: 0,
    oldestWaitingAt: null,
  };
  const candidates = [];
  const repository = createSyncRepository({ client });
  let attempted = 0;
  try {
    for (const record of batch.records) {
      const raw = record.raw;
      const targets = await q(targetSql, [record.externalId, record.dealType]);
      if (targets.length === 1 && targets[0].status === "active") {
        report.alreadyPublic++;
        continue;
      }
      const p = targets.length === 1 ? targets[0] : null;
      const reason = publicationDecision(raw, p);
      const item = {
        propertyNo: raw.agency_property_no,
        sourceId: record.externalId,
        dealType: record.dealType,
        ...(p?.public_listing_no ? { publicListingNo: p.public_listing_no } : {}),
      };
      if (reason) {
        report.held.push({ ...item, reason });
        continue;
      }
      candidates.push({ record, property: p, item });
    }
    for (const { record, property: p, item } of orderPublicationQueue(candidates)) {
      const raw = record.raw;
      if (!apply) {
        report.ready.push(item);
        continue;
      }
      if (attempted >= 20) {
        report.held.push({ ...item, reason: "daily_publication_limit" });
        continue;
      }
      attempted++;
      report.attempted = attempted;
      const mediaObservationId = await publicationMediaObservation(q, p);
      const reusable = await q(
        `SELECT mr.source_url FROM listing_media_records mr JOIN media_assets a ON a.id=mr.owned_media_asset_id WHERE mr.property_id=$1 AND mr.observation_id=$2 AND mr.eligibility='eligible' AND mr.content_hash=a.content_hash AND mr.detected_mime=a.content_type AND mr.size_bytes=a.size_bytes`,
        [p.id, mediaObservationId],
      );
      const missing = raw.publication.images.filter(
        (url) => !reusable.some((asset) => asset.source_url === url),
      );

      const observation = createObservation({
        source: batch.source,
        externalId: record.externalId,
        dealType: record.dealType,
        sourceUrl: raw.source_url,
        propertyNoRaw: raw.agency_property_no,
        fields: record.fields,
        fetchedAt: batch.scrapedAt,
        mediaCandidates: missing.map((url) => ({
          url,
          category: "listing_photo",
          isPrimary: url === raw.publication.images[0],
        })),
      });
      const media = missing.length
        ? await prepare({
            rightsConfirmed: true,
            observation,
            observationId: mediaObservationId,
            propertyId: p.id,
            isNew: false,
            currentImages: [],
            mode: "upload",
            allowedMediaHosts: HOSTS,
            repository,
            blobStore,
          })
        : { publishable: true };
      if (!media.publishable) {
        report.held.push({ ...item, reason: "media_review_required" });
        continue;
      }
      await q("BEGIN");
      let commitSent = false;
      try {
        await q("SET LOCAL lock_timeout='20s'");
        await q("SELECT pg_advisory_xact_lock(hashtext('earnestproperty:mls-sync'))");
        await q("LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE");
        await accepted();
        const current = await q(targetSql, [record.externalId, record.dealType]);
        if (
          current.length !== 1 ||
          current[0].id !== p.id ||
          current[0].observation_id !== p.observation_id ||
          publicationDecision(raw, current[0])
        )
          throw Error("PUBLICATION_TARGET_CHANGED");
        const assets = await q(
          `SELECT mr.source_url,a.url FROM listing_media_records mr JOIN media_assets a ON a.id=mr.owned_media_asset_id
        WHERE mr.property_id=$1 AND mr.observation_id=$2 AND mr.source_url=ANY($3::text[]) AND mr.eligibility='eligible'
        AND mr.content_hash=a.content_hash AND mr.detected_mime=a.content_type AND mr.size_bytes=a.size_bytes`,
          [p.id, mediaObservationId, raw.publication.images],
        );
        const images = raw.publication.images.map(
          (url) => assets.find((a) => a.source_url === url)?.url,
        );
        if (images.some((x) => !x)) throw Error("OWNED_MEDIA_INCOMPLETE");
        const before = (
          await q("SELECT to_jsonb(p) AS value FROM properties p WHERE id=$1", [p.id])
        )[0].value;
        await q(
          "INSERT INTO admin_property_source_snapshots(property_no,property_id,operation,payload) VALUES($1,$2,'ADMIN_BEFORE',$3)",
          [p.public_listing_no, p.id, JSON.stringify(before)],
        );
        await q("SELECT set_config('app.admin_property_write','on',true)");
        await q(
          "UPDATE properties SET status='active',description=$2,images=$3,source_url=$4,updated_at=clock_timestamp() WHERE id=$1",
          [p.id, raw.publication.description, images, raw.source_url],
        );
        await q("SELECT set_config('app.admin_property_write','',true)");
        for (const [field, value] of Object.entries({
          status: "active",
          description: raw.publication.description,
          images,
          source_url: raw.source_url,
        })) {
          await q(
            `INSERT INTO property_sync_fields(property_id,field_name,last_published_value,winning_observation_id,selection_reason,policy_version)
          VALUES($1,$2,$3,$4,'operator_publication',$5) ON CONFLICT(property_id,field_name) DO UPDATE SET last_published_value=EXCLUDED.last_published_value,winning_observation_id=EXCLUDED.winning_observation_id,selection_reason=EXCLUDED.selection_reason,policy_version=EXCLUDED.policy_version,updated_at=now()`,
            [p.id, field, JSON.stringify(value), p.observation_id, POLICY],
          );
          await q(
            `INSERT INTO listing_change_events(property_id,run_id,change_type,field_name,old_value,new_value,winning_observation_id,reason) VALUES($1,$2,'changed',$3,$4,$5,$6,$7)`,
            [
              p.id,
              p.run_id,
              field,
              JSON.stringify(before[field] ?? null),
              JSON.stringify(value),
              p.observation_id,
              POLICY,
            ],
          );
        }
        await q(
          `INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) SELECT NULL,$2,'property',id,jsonb_build_object('receiptId',$3::text,'payloadHash',$4::text,'before',$5::jsonb,'after',to_jsonb(p)) FROM properties p WHERE id=$1`,
          [p.id, POLICY, receiptId, batch.hash, JSON.stringify(before)],
        );
        commitSent = true;
        await q("COMMIT");
        report.published.push(item);
      } catch (error) {
        if (commitSent) report.unknown.push({ ...item, reason: "commit_outcome_unknown" });
        await q("ROLLBACK").catch(() => {});
        throw error;
      }
    }
    return report;
  } finally {
    Object.assign(report, publicationBacklog(candidates, report.published));
    await onReport(report);
  }
}
