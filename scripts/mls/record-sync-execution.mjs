import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { hashPayload } from "../../src/lib/mls/ingestion-contract.mjs";
import { recordSyncRun } from "../../src/lib/mls/sync-run-repository.mjs";
import { validateRunSummary } from "../../src/lib/mls/sync-run-contract.mjs";
import { verifyDailyTarget } from "./verify-daily-target.mjs";
const read = (path) => {
  if (!path) return null;
  const bytes = readFileSync(path);
  if (bytes.length > 5 * 1024 * 1024) throw Error("REPORT_TOO_LARGE");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
};
export function executionSummary({
  needs,
  payload,
  publication,
  workflowRunId,
  workflowAttempt = 1,
  gitSha,
  requestAsset,
  mode,
  receipt,
  manifest,
}) {
  if (!/^[0-9]{1,30}$/.test(workflowRunId ?? "") || !/^[a-f0-9]{40}$/.test(gitSha ?? ""))
    throw Error("INVALID_EXECUTION_ID");
  const stages = {};
  const clocks = (job) => {
    const outputs = needs[job]?.outputs ?? {};
    const startedAt = outputs.started_at || undefined;
    const finishedAt = outputs.finished_at || undefined;
    try {
      if (finishedAt && !startedAt) throw Error("invalid_execution_timing");
      validateRunSummary({ startedAt, finishedAt });
    } catch {
      throw Error("INVALID_EXECUTION_TIMING");
    }
    return {
      ...(startedAt ? { startedAt: new Date(startedAt).toISOString() } : {}),
      ...(finishedAt ? { finishedAt: new Date(finishedAt).toISOString() } : {}),
    };
  };
  const measuredClocks = Object.fromEntries(
    ["preflight", "collect", "ingest", "publish", "verify"].map((job) => [
      job,
      needs[job]?.result === "skipped" ? {} : clocks(job),
    ]),
  );
  const mapping = {
    collect: "collection",
    ingest: "ingestion",
    publish: "publication",
    verify: "verification",
  };
  for (const [job, stage] of Object.entries(mapping)) {
    const result = needs[job]?.result;
    const status =
      { success: "succeeded", failure: "failed", cancelled: "cancelled", skipped: "pending" }[
        result
      ] ?? "unknown";
    stages[stage] = {
      status,
      ...(["failed", "cancelled", "unknown"].includes(status)
        ? { errorCode: "WORKFLOW_" + status.toUpperCase() }
        : {}),
      ...(result === "skipped" ? {} : measuredClocks[job]),
    };
  }
  if (payload) {
    stages.collection.pagesRead =
      payload.meta?.pages?.filter((p) => p.status !== "failed").length ?? 0;
    stages.collection.pagesFailed = payload.meta?.pages_failed ?? 0;
  }
  if (needs.preflight?.result === "failure")
    stages.collection = { status: "blocked", errorCode: "PREFLIGHT_FAILED" };
  if (receipt) {
    stages.ingestion = {
      status: "succeeded",
      receiptId: receipt.id,
      reconciled: true,
      ...measuredClocks.ingest,
    };
  } else if (stages.ingestion.status === "succeeded")
    stages.ingestion = {
      status: ["shadow", "replay-shadow"].includes(mode) ? "blocked" : "unknown",
      errorCode: ["shadow", "replay-shadow"].includes(mode)
        ? "DRY_RUN_NO_WRITES"
        : "RECEIPT_RECONCILIATION_REQUIRED",
    };
  if (publication?.unknown?.length)
    stages.publication = { status: "unknown", errorCode: "PUBLICATION_RECONCILIATION_REQUIRED" };
  else if (stages.publication.status === "succeeded" && !publication)
    stages.publication = { status: "unknown", errorCode: "PUBLICATION_REPORT_REQUIRED" };
  if (stages.verification.status === "succeeded") {
    if (stages.publication.status !== "succeeded") {
      // The always-run summary job also succeeds when no public check ran.
      // Leave this stage unstarted rather than hiding a failed publication.
      stages.verification = { status: "pending", errorCode: "PUBLIC_VERIFICATION_NOT_RUN" };
    } else if (needs.verify?.outputs?.public_verified !== "true") {
      stages.verification = {
        status: "unknown",
        errorCode: "PUBLIC_VERIFICATION_PROOF_REQUIRED",
      };
    }
  }
  const s = receipt?.response?.summary;
  const counts = {};
  if (s) {
    counts.advertisementsObserved = s.advertisement_count;
    counts.canonicalCreated = s.properties_created;
    counts.canonicalUpdated = s.properties_changed;
  }
  if (publication) {
    counts.published = publication.published?.length ?? 0;
    counts.held = publication.held?.length ?? 0;
  }
  return {
    source: "28hse_agent_540",
    scopeId: "agent:540",
    workflowRunId,
    workflowAttempt,
    gitSha,
    branches: manifest?.branchSummaries ?? {},
    requestHash: payload ? hashPayload(payload) : undefined,
    privateEvidenceRef: requestAsset ? { requestAsset } : undefined,
    stages,
    counts,
    startedAt: Object.values(measuredClocks)
      .filter((clock) => clock.startedAt)
      .map((clock) => clock.startedAt)
      .sort()[0],
    finishedAt: new Date().toISOString(),
  };
}
if (process.argv[1]?.endsWith("record-sync-execution.mjs")) {
  let client;
  try {
    verifyDailyTarget(
      process.env.DATABASE_URL_UNPOOLED,
      process.env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST,
    );
    if (
      process.env.GITHUB_REF !== "refs/heads/main" ||
      process.env.PROPERTY_SYNC_EXPECTED_BRANCH !== "main"
    )
      throw Error("UNAPPROVED_EXECUTION_REF");
    const manifest = read(process.env.RECORD_MANIFEST),
      payload = read(process.env.RECORD_PAYLOAD),
      publication = read(process.env.RECORD_PUBLICATION),
      needs = JSON.parse(process.env.RECORD_NEEDS ?? "{}");
    const workflowRunId = process.env.GITHUB_RUN_ID,
      gitSha = process.env.GITHUB_SHA;
    client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
    await client.connect();
    let receipt = null;
    if (payload) {
      const r = await client.query(
        `SELECT id,accepted_at,response FROM mls_ingestion_receipts WHERE source='28hse_agent_540' AND scope_id='agent:540' AND payload_hash=$1 AND scraped_at=$2 AND full_snapshot AND response->>'success'='true'`,
        [hashPayload(payload), payload.scraped_at],
      );
      receipt = r.rows[0] ?? null;
    }
    let runId = process.env.GITHUB_RUN_ATTEMPT === "1" ? process.env.RECORD_OPERATION_ID : null;
    if (!runId) {
      const h = createHash("sha256")
        .update("property-sync:" + workflowRunId + ":" + process.env.GITHUB_RUN_ATTEMPT)
        .digest("hex")
        .slice(0, 32);
      runId = [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join(
        "-",
      );
    }
    const summary = executionSummary({
      needs,
      payload,
      publication,
      workflowRunId,
      workflowAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      gitSha,
      manifest,
      requestAsset: process.env.RECORD_REQUEST_ASSET,
      mode: process.env.MODE,
      receipt,
    });
    if (!summary.startedAt) throw Error("MISSING_EXECUTION_TIMING");
    await recordSyncRun({ client, runId, summary });
    console.log(JSON.stringify({ metadataRecorded: true, workflowRunId }));
  } catch {
    console.error("SYNC_EXECUTION_RECORD_FAILED_RECONCILE_RECEIPTS");
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => {});
  }
}
