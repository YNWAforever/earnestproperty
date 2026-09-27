import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { queryRows } from "./db.server.ts";
import type { StaffAccess } from "./auth.server.ts";
import { companyChannel } from "./whatsapp-enquiries.server.ts";
import { mintReference } from "../whatsapp-enquiries/links.ts";
import { batchPayloadHash, canonicalBatchRows } from "../whatsapp-enquiries/link-batch-policy.ts";
import type {
  BatchPreview,
  BatchRowPreview,
  BatchRowResult,
  CommitChunkResult,
} from "./whatsapp-link-batches.types.ts";

type Actor = Pick<StaffAccess, "staffId" | "roles">;
const uuid = z.string().uuid();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const reasonMessages: Record<string, string> = {
  PLACEMENT_UNVERIFIED: "投放位置尚未核實或未啟用",
  WA_LINK_PUBLIC_OFFER_UNAVAILABLE: "目前租售盤已下架或版本改變",
  WA_LINK_STAFF_NOT_READY: "指定同事缺少已核實 Inbox 映射",
  STAFF_REFERENCE_CONFLICT_OR_EXPIRED: "同事來源代碼已過期或衝突",
  PLACEMENT_CONFLICT: "此投放已有不同內容的連結，需人工編輯",
  LEGACY_PLACEMENT_AMBIGUOUS: "舊連結有多個候選，需人工選擇",
};
async function authorize(actor: Actor, query = queryRows) {
  if (!actor.roles.some((role) => role === "admin" || role === "manager"))
    throw new Response("Forbidden", { status: 403 });
  const [allowed] = await query(
    "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager') LIMIT 1",
    [actor.staffId],
  );
  if (!allowed) throw new Response("Forbidden", { status: 403 });
}

export async function previewWhatsappLinkBatch(
  value: { batchId: string; rows: unknown[] },
  actor: Actor,
  query = queryRows,
): Promise<BatchPreview> {
  const batchId = uuid.parse(value.batchId);
  await authorize(actor, query);
  const channel = companyChannel();
  const rows = canonicalBatchRows(value.rows, channel, 1000);
  const payloadHash = batchPayloadHash(rows);
  const evidence = await query(
    `WITH wanted AS (SELECT x AS row, x->>'rowKey' AS row_key, x->>'placementKey' AS placement_key,
       x->>'placementId' AS placement_id, x->'input' AS d FROM jsonb_array_elements($1::jsonb) x)
     SELECT w.row_key,w.placement_key,
       (w.d->>'propertyId' IS NULL OR (offer.id=(w.d->>'propertyId')::uuid AND offer.status::text='active')) AS offer_ok,
       ( (w.d->>'requestedStaffId' IS NULL AND w.d->>'referenceMappingId' IS NULL) OR EXISTS(
         SELECT 1 FROM staff_users s JOIN staff_roles sr ON sr.staff_user_id=s.id
           JOIN whatsapp_staff_channels m ON m.staff_id=s.id AND m.channel_id=$2
         WHERE s.id=COALESCE(NULLIF(w.d->>'requestedStaffId','')::uuid,
           (SELECT ref.staff_id FROM staff_external_references ref WHERE ref.id=NULLIF(w.d->>'referenceMappingId','')::uuid))
           AND s.active AND sr.role IN ('admin','manager','agent')
           AND m.eligible AND m.retired_at IS NULL AND m.verified_at IS NOT NULL AND m.verification_ref IS NOT NULL)) AS staff_ok,
       (w.d->>'referenceMappingId' IS NULL OR EXISTS(
         SELECT 1 FROM staff_external_references sr WHERE sr.id=(w.d->>'referenceMappingId')::uuid
           AND sr.namespace LIKE (w.d->>'placementSource')||'/%'
           AND sr.valid_from<=now() AND (sr.valid_until IS NULL OR sr.valid_until>now()) AND sr.verified_at<=now()
           AND (w.d->>'requestedStaffId' IS NULL OR sr.staff_id=(w.d->>'requestedStaffId')::uuid))) AS reference_ok,
       reserved.link_id AS reserved_id,candidates.n AS candidate_count,candidates.link_id AS candidate_id
     FROM wanted w
     LEFT JOIN LATERAL (SELECT p.id,p.status FROM property_public_members pm JOIN properties p ON p.id=pm.property_id
       WHERE pm.public_listing_no=w.d->>'publicListingNo' AND p.deal_type::text=w.d->>'dealType'
       ORDER BY p.source_updated_at DESC NULLS LAST,p.last_seen_at DESC NULLS LAST,
         p.updated_at DESC NULLS LAST,p.created_at DESC,p.id ASC LIMIT 1) offer ON true
     LEFT JOIN whatsapp_tracking_link_placements reserved ON reserved.placement_key=w.placement_key
     LEFT JOIN LATERAL (
       SELECT count(*)::int n,min(l.id::text)::uuid link_id FROM whatsapp_tracking_links l JOIN whatsapp_tracking_link_versions v
         ON v.link_id=l.id AND v.version=l.current_version
       WHERE v.enabled AND v.placement_verified_at IS NOT NULL AND v.channel_id=$2
         AND v.placement_source=w.d->>'placementSource' AND v.entry_point_type=w.d->>'entryPointType'
         AND v.public_listing_no IS NOT DISTINCT FROM w.d->>'publicListingNo'
         AND v.property_id IS NOT DISTINCT FROM NULLIF(w.d->>'propertyId','')::uuid
         AND v.deal_type IS NOT DISTINCT FROM w.d->>'dealType'
         AND v.requested_staff_id IS NOT DISTINCT FROM NULLIF(w.d->>'requestedStaffId','')::uuid
         AND v.reference_mapping_id IS NOT DISTINCT FROM NULLIF(w.d->>'referenceMappingId','')::uuid
         AND v.branch_id IS NOT DISTINCT FROM w.d->>'branchId'
         AND v.external_listing_id IS NOT DISTINCT FROM w.d->>'externalListingId'
         AND v.video_id IS NOT DISTINCT FROM w.d->>'videoId'
         AND (EXISTS(SELECT 1 FROM whatsapp_tracking_link_placements x WHERE x.link_id=l.id AND x.placement_key=w.placement_key)
           OR (NOT EXISTS(SELECT 1 FROM whatsapp_tracking_link_placements x WHERE x.link_id=l.id)
             AND ((w.d->>'placementSource'='website' AND w.placement_id='website:primary')
               OR w.d->>'placementSource' IN ('28hse','youtube'))))
     ) candidates ON true`,
    [JSON.stringify(rows), channel],
  );
  const byKey = new Map(evidence.map((r) => [String(r.row_key), r]));
  const decisions: BatchRowPreview[] = rows.map((row) => {
    const facts = byKey.get(row.rowKey);
    const codes: string[] = [];
    if (!row.input.enabled || !row.input.placementVerified) codes.push("PLACEMENT_UNVERIFIED");
    if (!facts || facts.offer_ok !== true) codes.push("WA_LINK_PUBLIC_OFFER_UNAVAILABLE");
    if (facts?.staff_ok !== true) codes.push("WA_LINK_STAFF_NOT_READY");
    if (facts?.reference_ok !== true) codes.push("STAFF_REFERENCE_CONFLICT_OR_EXPIRED");
    const candidate = facts?.candidate_id ? String(facts.candidate_id) : null;
    if (facts?.reserved_id && String(facts.reserved_id) !== candidate)
      codes.push("PLACEMENT_CONFLICT");
    if (Number(facts?.candidate_count ?? 0) > 1) codes.push("LEGACY_PLACEMENT_AMBIGUOUS");
    return {
      rowKey: row.rowKey,
      decision: codes.length ? "blocked" : candidate ? "reuse" : "create",
      existingLinkId: candidate,
      reasons: codes.map((code) => ({ code, message: reasonMessages[code] })),
    };
  });
  const previewToken = randomUUID();
  const [snapshot] = await query(
    `INSERT INTO whatsapp_link_batch_previews(batch_id,actor_staff_id,channel_id,token_hash,payload_hash,rows,expires_at)
     VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,now()+interval '10 minutes')
     ON CONFLICT(batch_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at
       WHERE whatsapp_link_batch_previews.actor_staff_id=EXCLUDED.actor_staff_id
         AND whatsapp_link_batch_previews.payload_hash=EXCLUDED.payload_hash
         AND whatsapp_link_batch_previews.channel_id=EXCLUDED.channel_id
     RETURNING expires_at`,
    [batchId, actor.staffId, channel, hash(previewToken), payloadHash, JSON.stringify(rows)],
  );
  if (!snapshot) throw new Response("BATCH_PAYLOAD_CONFLICT", { status: 409 });
  return {
    batchId,
    previewToken,
    expiresAt: new Date(String(snapshot.expires_at)).toISOString(),
    rows: decisions,
    counts: {
      create: decisions.filter((r) => r.decision === "create").length,
      reuse: decisions.filter((r) => r.decision === "reuse").length,
      blocked: decisions.filter((r) => r.decision === "blocked").length,
    },
  };
}

export async function commitWhatsappLinkChunk(
  value: { batchId: string; chunkId: string; previewToken: string; rows: unknown[] },
  actor: Actor,
  query = queryRows,
): Promise<CommitChunkResult> {
  const batchId = uuid.parse(value.batchId),
    chunkId = uuid.parse(value.chunkId),
    token = uuid.parse(value.previewToken);
  await authorize(actor, query);
  const channel = companyChannel();
  const rows = canonicalBatchRows(value.rows, channel, 50);
  const chunkHash = batchPayloadHash(rows);
  const codes = Object.fromEntries(rows.map((row) => [row.rowKey, mintReference()]));
  try {
    const [result] = await query(
      "SELECT wa_commit_link_batch_chunk($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb,$7,$8::jsonb) AS result",
      [
        actor.staffId,
        batchId,
        chunkId,
        hash(token),
        chunkHash,
        JSON.stringify(rows),
        channel,
        JSON.stringify(codes),
      ],
    );
    return result.result as CommitChunkResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/BATCH_PAYLOAD_CONFLICT/.test(message))
      throw new Response("BATCH_PAYLOAD_CONFLICT", { status: 409 });
    if (/BATCH_PREVIEW_EXPIRED_OR_UNAUTHORIZED/.test(message))
      throw new Response("BATCH_PREVIEW_EXPIRED", { status: 409 });
    if (/WA_LINK_DUPLICATE_ROW_KEY|WA_LINK_DUPLICATE_PLACEMENT/.test(message))
      throw new Response("BATCH_ROWS_INVALID", { status: 400 });
    throw error;
  }
}

export async function getWhatsappLinkBatchResult(
  batchIdValue: string,
  actor: Actor,
  query = queryRows,
) {
  const batchId = uuid.parse(batchIdValue);
  await authorize(actor, query);
  const [batch] = await query(
    "SELECT batch_id,payload_hash,expires_at FROM whatsapp_link_batch_previews WHERE batch_id=$1::uuid AND actor_staff_id=$2::uuid",
    [batchId, actor.staffId],
  );
  if (!batch) throw new Response("BATCH_NOT_FOUND", { status: 404 });
  const operations = await query(
    "SELECT chunk_id,state,result,created_at FROM whatsapp_link_batch_operations WHERE batch_id=$1::uuid AND actor_staff_id=$2::uuid ORDER BY created_at,chunk_id",
    [batchId, actor.staffId],
  );
  return {
    batchId,
    operations: operations.map((r) => ({
      batchId,
      chunkId: String(r.chunk_id),
      state: String(r.state) as "committed" | "rejected",
      rows: r.result as BatchRowResult[],
      createdAt: new Date(String(r.created_at)).toISOString(),
    })),
  };
}
