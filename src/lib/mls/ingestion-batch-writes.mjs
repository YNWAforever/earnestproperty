// All batches execute on the caller's existing locked transaction.
export async function writeSyncFields(q, rows, adoption = false) {
  if (!rows.length) return;
  const conflict = adoption
    ? "DO NOTHING"
    : "DO UPDATE SET last_published_value=EXCLUDED.last_published_value,winning_observation_id=EXCLUDED.winning_observation_id,selection_reason=EXCLUDED.selection_reason,policy_version=EXCLUDED.policy_version,updated_at=now()";
  await q(
    `INSERT INTO property_sync_fields(property_id,field_name,last_published_value,winning_observation_id,selection_reason,policy_version) SELECT (value->>'property_id')::uuid,value->>'field_name',value->'last_published_value',(value->>'winning_observation_id')::uuid,value->>'selection_reason',value->>'policy_version' FROM jsonb_array_elements($1::jsonb) AS rows(value) ON CONFLICT(property_id,field_name) ${conflict}`,
    [JSON.stringify(rows)],
  );
}
export async function writeReviewRows(q, rows) {
  const unique = [...new Map(rows.map((row) => [row.review_key, row])).values()];
  for (let offset = 0; offset < unique.length; offset += 250) {
    await q(
      "INSERT INTO mls_ingestion_reviews(review_key,source,external_listing_id,deal_type,reason,evidence,observation_id,first_run_id,last_run_id) SELECT review_key,source,external_listing_id,deal_type,reason,evidence,observation_id,first_run_id,last_run_id FROM jsonb_populate_recordset(NULL::mls_ingestion_reviews,$1::jsonb) ON CONFLICT(review_key) DO UPDATE SET last_run_id=EXCLUDED.last_run_id,observation_id=EXCLUDED.observation_id,last_seen_at=now()",
      [JSON.stringify(unique.slice(offset, offset + 250))],
    );
  }
}
