import {
  deriveSyncHealth,
  validateRunSummary,
  transitionStage,
  SYNC_STAGES,
} from "./sync-run-contract.mjs";
const SOURCES = ["28hse_agent_540", "propertyhk"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireSyncRole(actor, allowed = ["admin", "manager"]) {
  if (!uuid.test(actor?.staffId ?? "") || !actor.roles?.some((r) => allowed.includes(r)))
    throw Error("FORBIDDEN");
}
export const SYNC_HEALTH_COPY = Object.freeze({
  never_synced: "從未成功同步",
  stale: "超過30小時未成功匯入",
  failed: "同步失敗，保留現有資料",
  blocked: "等待核實，暫不下架",
  unknown: "結果待核實，請勿重複提交",
  running: "同步處理中",
  healthy: "已完成匯入",
});
export async function readSyncWorkspace({
  query,
  actor,
  limit = 25,
  cursor = null,
  now = Date.now(),
  capabilities = {},
}) {
  requireSyncRole(actor);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (cursor && (!uuid.test(cursor.id ?? "") || !Number.isFinite(Date.parse(cursor.at))))
  )
    throw Error("INVALID_PAGE");
  const receipts = await query(
    `SELECT s.source,r.id AS receipt_id,r.scraped_at,r.accepted_at,r.response FROM mls_ingestion_scopes s JOIN mls_ingestion_receipts r ON r.id=s.full_receipt_id WHERE r.full_snapshot AND r.response->>'success'='true' ORDER BY s.source`,
  );
  const aggregates = await query(
    `SELECT s.source,count(DISTINCT s.external_listing_id)::int AS advertisements,count(DISTINCT p.id) FILTER(WHERE p.status='draft')::int AS backlog,count(DISTINCT p.id) FILTER(WHERE p.status='active')::int AS public_count FROM mls_source_state s LEFT JOIN properties p ON p.id=s.property_id WHERE s.source=ANY($1::text[]) GROUP BY s.source`,
    [SOURCES],
  );
  const latest = await query(
    `SELECT DISTINCT ON(source) id,source,stages,branches,counts,dispatch_status,error_code,finished_at FROM property_sync_runs ORDER BY source,started_at DESC,id DESC`,
  );
  const history = await query(
    `WITH recent AS (
 (SELECT id,source,scope_id,operation,workflow_run_id,git_sha,request_asset,request_hash,receipt_id,stages,branches,counts,dispatch_status,error_code,started_at,finished_at FROM property_sync_runs WHERE ($1::timestamptz IS NULL OR (started_at,id)<($1::timestamptz,$2::uuid)) ORDER BY started_at DESC,id DESC LIMIT $3)
 UNION ALL
 (SELECT r.id,r.source,r.scope_id,'ingestion',NULL,NULL,NULL,r.payload_hash,r.id,
 jsonb_build_object('collection',jsonb_build_object('status','succeeded','finishedAt',r.scraped_at),'ingestion',jsonb_build_object('status','succeeded','receiptId',r.id,'finishedAt',r.accepted_at)),
 '{}'::jsonb,jsonb_build_object('advertisementsObserved',r.response->'summary'->'advertisement_count','canonicalCreated',r.response->'summary'->'properties_created','canonicalUpdated',r.response->'summary'->'properties_changed'),'not_requested',NULL,r.accepted_at,r.accepted_at
 FROM mls_ingestion_receipts r WHERE r.full_snapshot AND r.response->>'success'='true' AND NOT EXISTS(SELECT 1 FROM property_sync_runs m WHERE m.receipt_id=r.id)
 AND ($1::timestamptz IS NULL OR (r.accepted_at,r.id)<($1::timestamptz,$2::uuid)) ORDER BY r.accepted_at DESC,r.id DESC LIMIT $3)
 ) SELECT * FROM recent ORDER BY started_at DESC,id DESC LIMIT $3`,
    [cursor?.at ?? null, cursor?.id ?? null, limit + 1],
  );
  const cards = [
    ["28Hse", "28hse_agent_540", null],
    ["EPS", "propertyhk", "EPS"],
    ["EPT", "propertyhk", "EPT"],
    ["EPW", "propertyhk", "EPW"],
  ].map(([label, source, branch]) => {
    const receipt = receipts.find((r) => r.source === source),
      run = latest.find((r) => r.source === source),
      agg = aggregates.find((r) => r.source === source);
    const stages =
      run?.stages ??
      (receipt
        ? {
            collection: {
              status: "succeeded",
              finishedAt: new Date(receipt.scraped_at).toISOString(),
            },
            ingestion: {
              status: "succeeded",
              receiptId: receipt.receipt_id,
              finishedAt: new Date(receipt.accepted_at).toISOString(),
            },
          }
        : {});
    const acceptedAt = receipt?.accepted_at ? new Date(receipt.accepted_at).toISOString() : null;
    let health = deriveSyncHealth({ lastAcceptedFullAt: acceptedAt, stages }, now);
    if (
      (run?.dispatch_status === "unknown" ||
        (["reserved", "accepted"].includes(run?.dispatch_status) &&
          !run.finished_at &&
          !Object.keys(stages).length)) &&
      health !== "stale"
    )
      health = "unknown";
    const branchEvidence = branch ? run?.branches?.[branch] : null;
    if (
      branch &&
      (!branchEvidence ||
        branchEvidence.terminalVerified !== true ||
        branchEvidence.failedCount > 0) &&
      health === "healthy"
    )
      health = "blocked";
    return {
      label,
      source,
      branch,
      health,
      message:
        health === "healthy" && Number(agg?.backlog) > 0
          ? "已匯入，部分樓盤待上架"
          : SYNC_HEALTH_COPY[health],
      connected: Boolean(receipt),
      lastCollectionAt: receipt?.scraped_at ? new Date(receipt.scraped_at).toISOString() : null,
      lastAcceptedFullAt: acceptedAt,
      lastPublishedAt:
        stages.publication?.status === "succeeded" ? (stages.publication.finishedAt ?? null) : null,
      advertisements: branch
        ? (branchEvidence?.observedCount ?? null)
        : (agg?.advertisements ?? null),
      backlog: agg?.backlog ?? null,
      publicCount: agg?.public_count ?? null,
      stages,
      branchEvidence,
      capability: capabilities[source] ?? { enabled: false, reason: "未配置受控工作流程接駁" },
    };
  });
  const page = history.slice(0, limit),
    last = page.at(-1);
  return {
    cards,
    history: page,
    nextCursor:
      history.length > limit && last
        ? { at: new Date(last.started_at).toISOString(), id: last.id }
        : null,
    asOf: new Date(now).toISOString(),
  };
}
export async function readSyncOperationResult({ query, actor, idempotencyKey }) {
  requireSyncRole(actor, ["admin"]);
  if (!uuid.test(idempotencyKey ?? "")) throw Error("INVALID_OPERATION");
  const [row] = await query(
    `WITH actor_access AS (
      SELECT EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id
        WHERE s.id=$2::uuid AND s.active AND r.role::text='admin') AS allowed
    ) SELECT a.allowed,r.id,r.dispatch_status,r.workflow_run_id,r.finished_at,r.stages,
      EXISTS(SELECT 1 FROM mls_ingestion_receipts i WHERE i.id=r.receipt_id
        AND i.source=r.source AND i.scope_id=r.scope_id AND i.payload_hash=r.request_hash
        AND i.full_snapshot AND i.response->>'success'='true') AS receipt_confirmed
      FROM actor_access a LEFT JOIN property_sync_runs r
        ON a.allowed AND r.idempotency_key=$1::uuid AND r.requested_by=$2::uuid`,
    [idempotencyKey, actor.staffId],
  );
  if (row?.allowed !== true) throw Error("FORBIDDEN");
  if (!row.id) return { runId: null, state: "unknown", reconciled: false };
  const finished = row.finished_at && Number.isFinite(new Date(row.finished_at).getTime());
  if (row.dispatch_status === "failed" && finished)
    return { runId: row.id, state: "failed", reconciled: true };
  const known =
    Object.keys(row.stages ?? {}).length === SYNC_STAGES.length &&
    SYNC_STAGES.every((stage) =>
      ["pending", "succeeded", "failed", "blocked", "cancelled"].includes(
        row.stages?.[stage]?.status,
      ),
    );
  const receiptConfirmed =
    row.stages?.ingestion?.status !== "succeeded" || row.receipt_confirmed === true;
  const completed =
    finished && /^[0-9]{1,30}$/.test(row.workflow_run_id ?? "") && known && receiptConfirmed;
  return {
    runId: row.id,
    state: completed
      ? "completed"
      : row.dispatch_status === "accepted" && !finished
        ? row.workflow_run_id
          ? "running"
          : "pending"
        : "unknown",
    reconciled: Boolean(completed),
  };
}
export async function requestSyncOperation({ query, actor, input, capability, dispatch }) {
  requireSyncRole(actor, ["admin"]);
  if (
    !SOURCES.includes(input?.source) ||
    !["collect", "ingestion", "publication"].includes(input.operation) ||
    !uuid.test(input.idempotencyKey ?? "") ||
    (input.operation !== "collect" && !uuid.test(input.runId ?? ""))
  )
    throw Error("INVALID_OPERATION");
  if (capability?.enabled !== true || typeof dispatch !== "function")
    throw Error("WORKFLOW_CAPABILITY_UNAVAILABLE");
  const rows = await query(
    "SELECT reserve_property_sync_operation($1,$2,$3::uuid,$4::uuid,$5::uuid) AS reservation",
    [input.source, input.operation, input.idempotencyKey, actor.staffId, input.runId ?? null],
  );
  const reservation = rows[0]?.reservation ?? rows[0];
  if (!reservation?.newly_reserved)
    return { runId: reservation?.id, status: reservation?.dispatch_status ?? "unknown" };
  let status = "unknown";
  try {
    const result = await dispatch({
      source: reservation.source,
      operation: reservation.operation,
      requestAsset: reservation.request_asset ?? null,
      operationId: reservation.id,
    });
    status =
      result?.accepted === true ? "accepted" : result?.rejected === true ? "failed" : "unknown";
  } catch {}
  try {
    await query(
      `UPDATE property_sync_runs SET dispatch_status=$2,finished_at=CASE WHEN $2='failed' THEN clock_timestamp() ELSE finished_at END,updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1 AND dispatch_status='reserved'`,
      [reservation.id, status],
    );
  } catch {
    status = "unknown";
  }
  return { runId: reservation.id, status };
}
export async function recordSyncRun({ client, runId, summary }) {
  if (!uuid.test(runId)) throw Error("INVALID_RUN");
  validateRunSummary(summary);
  if (
    !SOURCES.includes(summary.source) ||
    summary.scopeId !== (summary.source === "propertyhk" ? "branches:EPW,EPS,EPT" : "agent:540")
  )
    throw Error("INVALID_SOURCE_SCOPE");
  const q = async (s, p = []) => (await client.query(s, p)).rows;
  await q("BEGIN");
  try {
    await q("SELECT pg_advisory_xact_lock(hashtext($1))", ["sync-run:" + runId]);
    const previous = (
      await q("SELECT * FROM property_sync_runs WHERE id=$1 FOR UPDATE", [runId])
    )[0];
    const stages = { ...previous?.stages };
    for (const stage of SYNC_STAGES)
      if (summary.stages?.[stage]) {
        const event = { ...summary.stages[stage], stage },
          prior = stages[stage];
        if (prior && ["succeeded", "failed", "blocked", "cancelled"].includes(prior.status)) {
          for (const key of ["startedAt", "finishedAt"]) if (key in prior) event[key] = prior[key];
        }
        stages[stage] = transitionStage(prior ?? { status: "pending" }, event);
      }
    const receiptId = stages.ingestion?.receiptId ?? previous?.receipt_id ?? null;
    if (receiptId) {
      const receipts = await q(
        `SELECT id FROM mls_ingestion_receipts WHERE id=$1 AND source=$2 AND scope_id=$3 AND payload_hash=$4 AND full_snapshot AND response->>'success'='true'`,
        [receiptId, summary.source, summary.scopeId, summary.requestHash],
      );
      if (receipts.length !== 1) throw Error("RECEIPT_IDENTITY_REQUIRED");
    }
    if (
      previous &&
      (previous.source !== summary.source ||
        previous.scope_id !== summary.scopeId ||
        (previous.request_hash && previous.request_hash !== summary.requestHash))
    )
      throw Error("RUN_IDENTITY_CHANGED");
    await q(
      `INSERT INTO property_sync_runs(id,source,scope_id,workflow_run_id,git_sha,request_asset,request_hash,receipt_id,stages,branches,counts,finished_at,error_code,workflow_attempt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO UPDATE SET workflow_run_id=coalesce(EXCLUDED.workflow_run_id,property_sync_runs.workflow_run_id),git_sha=coalesce(EXCLUDED.git_sha,property_sync_runs.git_sha),request_asset=coalesce(EXCLUDED.request_asset,property_sync_runs.request_asset),request_hash=coalesce(EXCLUDED.request_hash,property_sync_runs.request_hash),dispatch_status=CASE WHEN EXCLUDED.workflow_run_id IS NOT NULL THEN 'accepted' ELSE property_sync_runs.dispatch_status END,stages=EXCLUDED.stages,branches=EXCLUDED.branches,counts=EXCLUDED.counts,receipt_id=EXCLUDED.receipt_id,finished_at=EXCLUDED.finished_at,error_code=EXCLUDED.error_code,revision=property_sync_runs.revision+1,updated_at=clock_timestamp()`,
      [
        runId,
        summary.source,
        summary.scopeId,
        summary.workflowRunId ?? null,
        summary.gitSha ?? null,
        summary.privateEvidenceRef?.requestAsset ?? null,
        summary.requestHash ?? null,
        receiptId,
        JSON.stringify(stages),
        JSON.stringify(summary.branches ?? previous?.branches ?? {}),
        JSON.stringify({ ...previous?.counts, ...summary.counts }),
        summary.finishedAt ?? previous?.finished_at ?? null,
        summary.errorCode ?? null,
        summary.workflowAttempt ?? 1,
      ],
    );
    await q("COMMIT");
  } catch (error) {
    await q("ROLLBACK").catch(() => {});
    throw error;
  }
}
