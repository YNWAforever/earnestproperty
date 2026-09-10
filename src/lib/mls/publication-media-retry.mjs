import { randomUUID } from "node:crypto";
// Media records are immutable. A failed attempt gets a child observation, never
// an overwrite of its rejection; accepted inventory observations stay unchanged.
export async function publicationMediaObservation(q, property) {
  const prior = await q(
    `SELECT id FROM listing_source_observations WHERE payload->>'publicationOriginalObservationId'=$1 ORDER BY fetched_at DESC,id DESC LIMIT 1`,
    [property.observation_id],
  );
  const current = prior[0]?.id ?? property.observation_id;
  const failed = await q(
    "SELECT 1 FROM listing_media_records WHERE observation_id=$1 AND eligibility<>'eligible' LIMIT 1",
    [current],
  );
  if (!failed.length) return current;
  const run = randomUUID(),
    id = randomUUID();
  await q("BEGIN");
  try {
    await q(
      `INSERT INTO listing_sync_runs(id,scheduled_for,mode,status,parser_version,finished_at,source_status,counts) VALUES($1,CURRENT_DATE,'shadow','degraded','daily-media-retry-v1',now(),'{"full_snapshot":false,"baseline_eligible":false}','{"canonical_writes":0}')`,
      [run],
    );
    await q(
      `INSERT INTO listing_source_observations(id,run_id,source,external_listing_id,deal_type,source_url,property_no_raw,property_no_normalized,payload,media_candidates,content_hash,validation_state,quarantine_reasons,parse_warnings,discovered_at,fetched_at)
   SELECT $2,$3,source,external_listing_id,deal_type,source_url,property_no_raw,property_no_normalized,payload||jsonb_build_object('publicationOriginalObservationId',$1::text),media_candidates,content_hash,'valid','{}','{}',discovered_at,clock_timestamp() FROM listing_source_observations WHERE id=$1::uuid`,
      [property.observation_id, id, run],
    );
    await q(
      `INSERT INTO listing_media_records(observation_id,property_id,source_url,content_hash,owned_media_asset_id,detected_mime,size_bytes,width,height,eligibility,rejection_reason)
   SELECT $2,property_id,source_url,content_hash,owned_media_asset_id,detected_mime,size_bytes,width,height,eligibility,rejection_reason FROM listing_media_records WHERE observation_id=$1 AND property_id=$3 AND eligibility='eligible'`,
      [current, id, property.id],
    );
    await q("COMMIT");
    return id;
  } catch (error) {
    await q("ROLLBACK");
    throw error;
  }
}
