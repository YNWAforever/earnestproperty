import { randomUUID } from "node:crypto";
import { hashPayload } from "./ingestion-contract.mjs";
import { normalize28HsePromotionTier } from "./promotion-tier.mjs";
import { savePromotionTiers } from "./promotion-tier-repository.mjs";

export const HOMEPAGE_INVENTORY_PARSER = "owner-homepage-inventory-v1";
const SOURCE = "28hse_agent_540";
const SCOPE = "agent:540";
const UTC_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const stampOrder = (value) =>
  value.slice(0, 19) + "." + (value.match(/\.(\d+)Z$/)?.[1] ?? "").padEnd(6, "0");

/** Complete owner-approved index evidence; no dates or missing badges are inferred. */
export function normalizeHomepageInventory(input, { now = Date.now() } = {}) {
  if (
    !input ||
    input.schema_version !== 1 ||
    input.source !== SOURCE ||
    input.scope !== SCOPE ||
    input.deal_type !== "sale" ||
    input.complete !== true ||
    !Array.isArray(input.entries) ||
    !Number.isInteger(input.advertised_count) ||
    input.advertised_count < 0 ||
    input.entries.length > 10000 ||
    input.advertised_count !== input.entries.length
  )
    throw Error("HOMEPAGE_INVENTORY_INCOMPLETE");
  const capturedAt = input.captured_at;
  const capturedMs = typeof capturedAt === "string" ? Date.parse(capturedAt) : NaN;
  if (
    !UTC_STAMP.test(capturedAt ?? "") ||
    !Number.isFinite(capturedMs) ||
    new Date(capturedMs).toISOString().slice(0, 19) !== capturedAt.slice(0, 19) ||
    !Number.isFinite(Number(now)) ||
    capturedMs > Number(now) + 5 * 60 * 1000 ||
    capturedMs < Number(now) - 36 * 60 * 60 * 1000
  )
    throw Error("HOMEPAGE_INVENTORY_CAPTURE_TIME_INVALID");
  const seen = new Set();
  const entries = input.entries.map((entry, index) => {
    if (
      !entry ||
      typeof entry.source_id !== "string" ||
      !/^\d{1,160}$/.test(entry.source_id) ||
      typeof entry.agent_listing_ref !== "string" ||
      !/^[A-Z][0-9]{6}$/.test(entry.agent_listing_ref) ||
      !Object.hasOwn(entry, "promotion_tier_raw") ||
      (entry.promotion_tier_raw !== null && typeof entry.promotion_tier_raw !== "string") ||
      (entry.promotion_tier_raw?.length ?? 0) > 64 ||
      seen.has(entry.source_id)
    )
      throw Error("HOMEPAGE_INVENTORY_ENTRY_INVALID");
    seen.add(entry.source_id);
    const promotion = normalize28HsePromotionTier(entry.promotion_tier_raw, {
      badgeObserved: true,
    });
    if (promotion.tier === "unknown") throw Error("HOMEPAGE_INVENTORY_GRADE_UNKNOWN");
    return {
      sourceId: entry.source_id,
      ref: entry.agent_listing_ref,
      position: index + 1,
      promotionTier: promotion.tier,
      promotionTierRaw: promotion.raw,
    };
  });
  const normalized = { capturedAt, advertisedCount: input.advertised_count, entries };
  return { ...normalized, fingerprint: hashPayload(normalized) };
}

/**
 * Save only index evidence in existing journal tables. The reader uses the latest
 * healthy run as its membership boundary, including a verified empty snapshot.
 * No canonical row, source link, ingestion receipt or source state is changed.
 */
export async function saveHomepageInventory(client, inventory, { inputSha256 } = {}) {
  if (!/^[a-f0-9]{64}$/.test(inputSha256 ?? ""))
    throw Error("HOMEPAGE_INVENTORY_INPUT_HASH_REQUIRED");
  // Recheck the normalized boundary without pretending a replay was freshly captured.
  const normalized = normalizeHomepageInventory(
    {
      schema_version: 1,
      source: SOURCE,
      scope: SCOPE,
      deal_type: "sale",
      complete: true,
      advertised_count: inventory?.advertisedCount,
      captured_at: inventory?.capturedAt,
      entries: inventory?.entries?.map((entry) => ({
        source_id: entry.sourceId,
        agent_listing_ref: entry.ref,
        promotion_tier_raw: entry.promotionTierRaw,
      })),
    },
    { now: Date.parse(inventory?.capturedAt) },
  );
  if (
    normalized.fingerprint !== inventory.fingerprint ||
    hashPayload({
      capturedAt: inventory.capturedAt,
      advertisedCount: inventory.advertisedCount,
      entries: inventory.entries,
    }) !== inventory.fingerprint
  )
    throw Error("HOMEPAGE_INVENTORY_FINGERPRINT_MISMATCH");

  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  let transaction = false;
  let commitSent = false;
  try {
    await q("BEGIN");
    transaction = true;
    await q("SELECT pg_advisory_xact_lock(hashtext('earnestproperty:mls-sync'))");
    const [latest] = await q(
      `SELECT id, counts FROM listing_sync_runs
       WHERE parser_version=$1 AND mode='publish' AND status='healthy'
         AND counts->>'homepage_inventory'='true' AND counts->>'full_snapshot'='true'
         AND counts->>'source'=$2 AND counts->>'scope'=$3 AND counts->>'deal_type'='sale'
       ORDER BY (counts->>'captured_at')::timestamptz DESC, started_at DESC, id DESC LIMIT 1`,
      [HOMEPAGE_INVENTORY_PARSER, SOURCE, SCOPE],
    );
    if (latest?.counts.fingerprint === inventory.fingerprint) {
      commitSent = true;
      await q("COMMIT");
      return { runId: latest.id, replayed: true, count: inventory.advertisedCount };
    }
    if (latest && stampOrder(inventory.capturedAt) <= stampOrder(latest.counts.captured_at))
      throw Error("HOMEPAGE_INVENTORY_STALE");

    const runId = randomUUID();
    await q(
      `INSERT INTO listing_sync_runs(id,scheduled_for,mode,status,parser_version)
       VALUES($1,$2::date,'publish','running',$3)`,
      [runId, inventory.capturedAt.slice(0, 10), HOMEPAGE_INVENTORY_PARSER],
    );
    const observations = inventory.entries.map((entry) => ({
      ...entry,
      observationId: randomUUID(),
      source: SOURCE,
      externalId: `homepage-inventory-${entry.sourceId}`,
      dealType: "sale",
      fetchedAt: inventory.capturedAt,
      payload: {
        homepage_inventory: {
          position: entry.position,
          promotion_tier: entry.promotionTier,
          promotion_tier_raw: entry.promotionTierRaw,
          capture_source_id: entry.sourceId,
        },
      },
    }));
    for (let offset = 0; offset < observations.length; offset += 250) {
      const batch = observations.slice(offset, offset + 250);
      await q(
        `INSERT INTO listing_source_observations
           (id,run_id,source,external_listing_id,deal_type,source_url,property_no_raw,
            property_no_normalized,payload,content_hash,validation_state,discovered_at,fetched_at)
         SELECT k.id,$1::uuid,$2,k.external_id,'sale'::deal_type,k.source_url,k.ref,k.ref,
                k.payload,k.content_hash,'valid',$3::timestamptz,$3::timestamptz
         FROM unnest($4::uuid[],$5::text[],$6::text[],$7::text[],$8::jsonb[],$9::text[])
           AS k(id,external_id,source_url,ref,payload,content_hash)`,
        [
          runId,
          SOURCE,
          inventory.capturedAt,
          batch.map((o) => o.observationId),
          batch.map((o) => o.externalId),
          batch.map(() => "https://www.28hse.com/agent/540?buyRent=buy"),
          batch.map((o) => o.ref),
          batch.map((o) => JSON.stringify(o.payload)),
          batch.map((o) =>
            hashPayload({ entry: o.payload, ref: o.ref, capturedAt: inventory.capturedAt }),
          ),
        ],
      );
    }
    await savePromotionTiers(q, observations, { snapshotComplete: true });
    await q(
      "UPDATE listing_sync_runs SET status='healthy',finished_at=now(),counts=$2::jsonb WHERE id=$1",
      [
        runId,
        JSON.stringify({
          homepage_inventory: true,
          full_snapshot: true,
          source: SOURCE,
          scope: SCOPE,
          deal_type: "sale",
          captured_at: inventory.capturedAt,
          advertised_count: inventory.advertisedCount,
          fingerprint: inventory.fingerprint,
          input_sha256: inputSha256,
        }),
      ],
    );
    commitSent = true;
    await q("COMMIT");
    return { runId, replayed: false, count: inventory.advertisedCount };
  } catch (error) {
    if (commitSent) {
      const unknown = Error("HOMEPAGE_INVENTORY_COMMIT_UNKNOWN", { cause: error });
      unknown.code = "HOMEPAGE_INVENTORY_COMMIT_UNKNOWN";
      throw unknown;
    }
    if (transaction) await q("ROLLBACK");
    throw error;
  }
}
