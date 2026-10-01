import { randomUUID } from "node:crypto";
import { hashPayload } from "./ingestion-contract.mjs";
import { requireSyncRole } from "./sync-run-repository.mjs";
export const WITHDRAWAL_RULE_VERSION = "review-withdrawal-v1";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const scope = (source) =>
  source === "28hse_agent_540"
    ? "agent:540"
    : source === "propertyhk"
      ? "branches:EPW,EPS,EPT"
      : null;
const blocked = (reason) => ({
  allowed: false,
  approval: "NOT_APPROVED",
  reason,
  ruleVersion: WITHDRAWAL_RULE_VERSION,
});
export function evaluateWithdrawalEvidence(e, now = Date.now()) {
  if (e.status !== "active") return blocked("not_active");
  if (e.protected) return blocked("staff_or_review_protected");
  if (e.otherActiveSources?.length) return blocked("active_source_conflict");
  const latest = e.snapshots?.[0];
  if (
    !latest?.full ||
    !Number.isFinite(Date.parse(latest.collectedAt)) ||
    now - Date.parse(latest.collectedAt) > 36 * 3600000 ||
    Date.parse(latest.collectedAt) > now + 60000
  )
    return blocked("fresh_complete_evidence_required");
  if (e.kind === "explicit_terminal")
    return ["sold", "rented"].includes(e.terminalReason)
      ? {
          allowed: true,
          approval: "REVIEW_REQUIRED",
          reason: "explicit_terminal",
          ruleVersion: WITHDRAWAL_RULE_VERSION,
        }
      : blocked("terminal_evidence_required");
  if (e.source === "propertyhk") return blocked("propertyhk_absence_disabled");
  if (e.currentPresent) return blocked("source_present");
  if (e.failedBetween) return blocked("failed_or_unknown_interval");
  const prior = e.snapshots?.[1];
  if (
    !prior?.full ||
    !prior.missing ||
    !latest.missing ||
    !latest.covered ||
    !prior.covered ||
    Date.parse(latest.collectedAt) - Date.parse(prior.collectedAt) < 24 * 3600000
  )
    return blocked("two_full_observations_required");
  return {
    allowed: true,
    approval: "REVIEW_REQUIRED",
    reason: "confirmed_absence",
    ruleVersion: WITHDRAWAL_RULE_VERSION,
  };
}
const qFor =
  (client) =>
  async (s, p = []) =>
    (await client.query(s, p)).rows;
async function dbRole(q, actor) {
  requireSyncRole(actor);
  const roles = await q(
    `SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1 AND s.active AND r.role::text IN ('admin','manager') LIMIT 1`,
    [actor.staffId],
  );
  if (roles.length !== 1) throw Error("FORBIDDEN");
}
async function context(q, source) {
  const receipts = await q(
    `SELECT r.id,r.run_id,r.scraped_at,r.accepted_at,r.payload_hash,
 EXISTS(SELECT 1 FROM property_sync_runs m WHERE m.receipt_id=r.id AND m.stages->'collection'->>'status'='succeeded' AND m.stages->'ingestion'->>'status'='succeeded') AS covered
 FROM mls_ingestion_receipts r WHERE r.source=$1 AND r.scope_id=$2 AND r.full_snapshot AND r.response->>'success'='true' ORDER BY r.scraped_at DESC,r.id DESC LIMIT 2`,
    [source, scope(source)],
  );
  // Absence is measured between original observations, not later receipt acceptance.
  const since = receipts[1]?.scraped_at ?? receipts[0]?.scraped_at ?? new Date(0).toISOString();
  const failures = await q(
    `SELECT id,stages,dispatch_status,finished_at FROM property_sync_runs WHERE source=$1 AND (started_at>=$2 OR finished_at>=$2 OR finished_at IS NULL) AND (finished_at IS NULL OR dispatch_status IN ('failed','unknown') OR EXISTS(SELECT 1 FROM jsonb_each(stages) s WHERE s.value->>'status' IN ('failed','blocked','unknown','cancelled'))) ORDER BY started_at DESC,id DESC LIMIT 1`,
    [source, since],
  );
  const watermark = await q(
    "SELECT full_receipt_id,last_accepted_at FROM mls_ingestion_scopes WHERE source=$1 AND scope_id=$2",
    [source, scope(source)],
  );
  return {
    receipts,
    failedBetween: failures.length > 0,
    failure: failures[0] ?? null,
    watermark: watermark[0] ?? null,
  };
}
async function candidateRows(q, source, ctx, { ids = null, limit = 25, cursor = null } = {}) {
  return q(
    `SELECT p.id,p.title_zh,p.status::text,p.deal_type::text,m.public_listing_no AS property_no,admin_property_group_version(m.public_listing_no) AS version,
 (EXISTS(SELECT 1 FROM admin_property_overrides a WHERE a.property_no=m.public_listing_no AND (a.shared<>'{}'::jsonb OR CASE p.deal_type::text WHEN 'sale' THEN a.sale ELSE a.rent END<>'{}'::jsonb))
 OR EXISTS(SELECT 1 FROM property_sync_fields f WHERE f.property_id=p.id AND (f.active_override OR f.selection_reason='manual_override'))
 OR EXISTS(SELECT 1 FROM mls_ingestion_conflicts c WHERE c.property_id=p.id AND c.review_status='unreviewed')
 OR EXISTS(SELECT 1 FROM mls_ingestion_reviews r JOIN property_source_links l ON l.source=r.source AND l.external_listing_id=r.external_listing_id AND l.deal_type=r.deal_type WHERE l.property_id=p.id AND r.status='open')) AS protected,
 coalesce((SELECT jsonb_agg(jsonb_build_object('source',s.source,'externalId',s.external_listing_id,'dealType',s.deal_type,'status',s.source_status,'reason',o.payload->>'sourceStatusReason','observationId',s.observation_id,'receiptId',s.last_receipt_id,'acceptedAt',s.last_accepted_at,'current',s.last_receipt_id=sc.full_receipt_id AND fr.full_snapshot AND fr.scraped_at>now()-interval '36 hours') ORDER BY s.source,s.external_listing_id,s.deal_type) FROM mls_source_state s JOIN listing_source_observations o ON o.id=s.observation_id LEFT JOIN mls_ingestion_scopes sc ON sc.source=s.source AND sc.scope_id=s.scope_id LEFT JOIN mls_ingestion_receipts fr ON fr.id=sc.full_receipt_id WHERE s.property_id=p.id),'[]'::jsonb) AS states,
 EXISTS(SELECT 1 FROM listing_source_observations o JOIN property_source_links l ON l.source=o.source AND l.external_listing_id=o.external_listing_id AND l.deal_type=o.deal_type WHERE l.property_id=p.id AND l.status='active' AND o.run_id=$2::uuid AND o.source=$1) AS latest_present,
 EXISTS(SELECT 1 FROM listing_source_observations o JOIN property_source_links l ON l.source=o.source AND l.external_listing_id=o.external_listing_id AND l.deal_type=o.deal_type WHERE l.property_id=p.id AND l.status='active' AND o.run_id=$3::uuid AND o.source=$1) AS prior_present
 FROM properties p JOIN property_public_members m ON m.property_id=p.id
 WHERE EXISTS(SELECT 1 FROM property_source_links l WHERE l.property_id=p.id AND l.source=$1 AND l.status='active')
 AND ($4::uuid[] IS NULL OR p.id=ANY($4::uuid[])) AND ($5::uuid IS NULL OR p.id>$5::uuid)
 ORDER BY p.id LIMIT $6`,
    [source, ctx.receipts[0]?.run_id ?? null, ctx.receipts[1]?.run_id ?? null, ids, cursor, limit],
  );
}
function rowEvidence(row, source, ctx, now) {
  const terminal = row.states.find(
    (s) =>
      s.source === source &&
      s.current &&
      s.status === "delisted" &&
      ["sold", "rented"].includes(s.reason),
  );
  const evidence = {
    source,
    scopeId: scope(source),
    kind: terminal ? "explicit_terminal" : "historical_absence",
    terminalReason: terminal?.reason ?? null,
    status: row.status,
    protected: row.protected,
    otherActiveSources: row.states
      .filter((s) => s.status === "active" && (s.source !== source || s.current))
      .map((s) => s.source + ":" + s.externalId),
    currentPresent: row.latest_present,
    failedBetween: ctx.failedBetween,
    snapshots: ctx.receipts.map((r, i) => ({
      receiptId: r.id,
      payloadHash: r.payload_hash,
      full: true,
      covered: r.covered,
      collectedAt: new Date(r.scraped_at).toISOString(),
      acceptedAt: new Date(r.accepted_at).toISOString(),
      missing: !(i === 0 ? row.latest_present : row.prior_present),
    })),
    states: row.states,
    watermark: ctx.watermark,
    failure: ctx.failure,
  };
  const decision = evaluateWithdrawalEvidence(evidence, now);
  const evidenceHash = hashPayload({ version: row.version, evidence });
  return {
    candidateId: row.id,
    propertyNo: row.property_no,
    title: row.title_zh,
    dealType: row.deal_type,
    version: row.version,
    status: row.status,
    evidence,
    evidenceHash,
    decision,
  };
}
export async function listWithdrawalCandidates({
  client,
  actor,
  source,
  limit = 25,
  cursor = null,
  now = Date.now(),
}) {
  if (
    !scope(source) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (cursor && !uuid.test(cursor))
  )
    throw Error("INVALID_CANDIDATE_PAGE");
  const q = qFor(client);
  await dbRole(q, actor);
  const ctx = await context(q, source);
  const all = await candidateRows(q, source, ctx, { limit: limit + 1, cursor });
  const rows = all
    .slice(0, limit)
    .map((r) => rowEvidence(r, source, ctx, now))
    .filter((r) => r.evidence.kind === "explicit_terminal" || !r.evidence.currentPresent);
  return {
    rows: rows.slice(0, limit),
    nextCursor: all.length > limit ? all[limit - 1].id : null,
    ruleVersion: WITHDRAWAL_RULE_VERSION,
  };
}
export async function previewWithdrawals({
  client,
  actor,
  source,
  candidateIds,
  now = Date.now(),
}) {
  if (
    !scope(source) ||
    !Array.isArray(candidateIds) ||
    !candidateIds.length ||
    candidateIds.length > 100 ||
    candidateIds.some((x) => !uuid.test(x)) ||
    new Set(candidateIds).size !== candidateIds.length
  )
    throw Error("INVALID_CANDIDATE_SELECTION");
  const q = qFor(client);
  await dbRole(q, actor);
  await q("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try {
    const ctx = await context(q, source),
      records = await candidateRows(q, source, ctx, { ids: candidateIds, limit: 100 });
    if (records.length !== candidateIds.length) throw Error("CANDIDATE_NOT_FOUND");
    const rows = records.map((r) => rowEvidence(r, source, ctx, now)),
      previewId = randomUUID();
    const preview = (
      await q(
        "INSERT INTO property_withdrawal_previews(id,actor_id,source,scope_id) VALUES($1,$2,$3,$4) RETURNING expires_at",
        [previewId, actor.staffId, source, scope(source)],
      )
    )[0];
    for (const row of rows)
      await q(
        `INSERT INTO property_withdrawal_preview_rows(preview_id,property_id,property_no,deal_type,expected_version,evidence_hash,decision,evidence,before_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          previewId,
          row.candidateId,
          row.propertyNo,
          row.dealType,
          row.version,
          row.evidenceHash,
          JSON.stringify(row.decision),
          JSON.stringify(row.evidence),
          JSON.stringify({ status: row.status, version: row.version, title: row.title }),
        ],
      );
    await q(
      `INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) VALUES($1,'property.withdrawal.preview','withdrawal_preview',$2,$3)`,
      [
        actor.staffId,
        previewId,
        JSON.stringify({
          source,
          ruleVersion: WITHDRAWAL_RULE_VERSION,
          candidateIds,
          allowed: rows.filter((r) => r.decision.allowed).length,
        }),
      ],
    );
    await q("COMMIT");
    return { previewId, expiresAt: new Date(preview.expires_at).toISOString(), rows };
  } catch (e) {
    await q("ROLLBACK").catch(() => {});
    throw e;
  }
}
export async function applyWithdrawalPreview({
  client,
  actor,
  previewId,
  selectedIds,
  expectedVersions,
  idempotencyKey,
  reason,
  now = Date.now(),
}) {
  if (
    !uuid.test(previewId ?? "") ||
    !uuid.test(idempotencyKey ?? "") ||
    !Array.isArray(selectedIds) ||
    !selectedIds.length ||
    selectedIds.length > 100 ||
    selectedIds.some((x) => !uuid.test(x)) ||
    new Set(selectedIds).size !== selectedIds.length ||
    typeof reason !== "string" ||
    reason.trim().length < 5 ||
    reason.length > 1000 ||
    !expectedVersions ||
    typeof expectedVersions !== "object" ||
    Object.keys(expectedVersions).length !== selectedIds.length ||
    selectedIds.some((id) => typeof expectedVersions[id] !== "string")
  )
    throw Error("INVALID_WITHDRAWAL_APPLY");
  const q = qFor(client);
  await dbRole(q, actor);
  const requestHash = hashPayload({
    previewId,
    selectedIds: [...selectedIds].sort(),
    expectedVersions,
    reason: reason.trim(),
    actor: actor.staffId,
  });
  let commitSent = false;
  await q("BEGIN");
  try {
    // Same table writer gate/order as existing admin_property_manage; no lock inversion.
    await q("SET LOCAL lock_timeout='10s'");
    await q("LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE");
    const preview = (
      await q(
        "SELECT *,expires_at<=clock_timestamp() AS expired FROM property_withdrawal_previews WHERE id=$1 AND actor_id=$2 FOR UPDATE",
        [previewId, actor.staffId],
      )
    )[0];
    if (!preview) throw Error("PREVIEW_NOT_FOUND");
    const previous = (
      await q("SELECT * FROM property_withdrawal_batches WHERE idempotency_key=$1", [
        idempotencyKey,
      ])
    )[0];
    if (previous) {
      if (previous.request_hash !== requestHash || previous.actor_id !== actor.staffId)
        throw Error("IDEMPOTENCY_CONFLICT");
      await q("COMMIT");
      return { batchId: previous.id, results: previous.results, replayed: true };
    }
    if (preview.expired) throw Error("STALE_PREVIEW");
    const rows = await q(
      "SELECT * FROM property_withdrawal_preview_rows WHERE preview_id=$1 AND property_id=ANY($2::uuid[]) FOR UPDATE",
      [previewId, selectedIds],
    );
    if (rows.length !== selectedIds.length) throw Error("SELECTION_OUTSIDE_PREVIEW");
    const ctx = await context(q, preview.source),
      current = await candidateRows(q, preview.source, ctx, { ids: selectedIds, limit: 100 });
    const batchId = randomUUID(),
      results = [];
    for (const row of rows) {
      await q("SAVEPOINT withdrawal_item");
      try {
        if (row.apply_result) {
          results.push(row.apply_result);
          await q("RELEASE SAVEPOINT withdrawal_item");
          continue;
        }
        if (expectedVersions[row.property_id] !== row.expected_version)
          throw Error("EXPECTED_VERSION_MISMATCH");
        const raw = current.find((r) => r.id === row.property_id);
        if (!raw) throw Error("CANDIDATE_CHANGED");
        const actual = rowEvidence(raw, preview.source, ctx, now);
        if (actual.evidenceHash !== row.evidence_hash || actual.version !== row.expected_version)
          throw Error("STALE_SOURCE_OR_PROPERTY");
        if (!row.decision.allowed || !actual.decision.allowed)
          throw Error(actual.decision.reason ?? "NOT_APPROVED");
        await q("SELECT admin_property_manage($1,$2,$3,$4::jsonb,$5::uuid)", [
          row.property_no,
          row.expected_version,
          row.deal_type,
          JSON.stringify({ status: "inactive" }),
          actor.staffId,
        ]);
        const afterVersion = (
          await q("SELECT admin_property_group_version($1) AS version", [row.property_no])
        )[0].version;
        const result = {
          candidateId: row.property_id,
          propertyNo: row.property_no,
          status: "applied",
          beforeVersion: row.expected_version,
          afterVersion,
        };
        await q(
          `INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) VALUES($1,'property.withdrawal.apply','property',$2,$3)`,
          [
            actor.staffId,
            row.property_id,
            JSON.stringify({
              batchId,
              previewId,
              reason: reason.trim(),
              ruleVersion: WITHDRAWAL_RULE_VERSION,
              evidence: row.evidence,
              before: row.before_state,
              after: { status: "inactive", version: afterVersion },
            }),
          ],
        );
        await q(
          "UPDATE property_withdrawal_preview_rows SET apply_result=$3 WHERE preview_id=$1 AND property_id=$2",
          [previewId, row.property_id, JSON.stringify(result)],
        );
        results.push(result);
        await q("RELEASE SAVEPOINT withdrawal_item");
      } catch (e) {
        await q("ROLLBACK TO SAVEPOINT withdrawal_item");
        await q("RELEASE SAVEPOINT withdrawal_item");
        const code =
          typeof e.message === "string" && /^[A-Za-z0-9_]{1,100}$/.test(e.message)
            ? e.message
            : "WITHDRAWAL_ITEM_REJECTED";
        results.push({
          candidateId: row.property_id,
          propertyNo: row.property_no,
          status: "blocked",
          reason: code,
        });
      }
    }
    await q(
      "INSERT INTO property_withdrawal_batches(id,preview_id,idempotency_key,actor_id,reason,request_hash,results) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        batchId,
        previewId,
        idempotencyKey,
        actor.staffId,
        reason.trim(),
        requestHash,
        JSON.stringify(results),
      ],
    );
    commitSent = true;
    await q("COMMIT");
    return { batchId, results, replayed: false };
  } catch (e) {
    await q("ROLLBACK").catch(() => {});
    if (commitSent) throw Error("OUTCOME_UNKNOWN_RECONCILE_BATCH");
    throw e;
  }
}

export async function readWithdrawalResult({ client, actor, idempotencyKey }) {
  if (!uuid.test(idempotencyKey ?? "")) throw Error("INVALID_BATCH_KEY");
  const q = qFor(client);
  await dbRole(q, actor);
  const row = (
    await q(
      "SELECT id,results FROM property_withdrawal_batches WHERE idempotency_key=$1 AND actor_id=$2",
      [idempotencyKey, actor.staffId],
    )
  )[0];
  return row
    ? { status: "confirmed", batchId: row.id, results: row.results }
    : { status: "unknown", results: [] };
}
