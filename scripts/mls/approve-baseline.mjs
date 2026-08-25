import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { logRunEvent } from "../../src/lib/mls/reporting.mjs";
import { withMlsAdvisoryLock } from "../../src/lib/mls/neon-lock.mjs";
import { createSyncRepository } from "../../src/lib/mls/sync-repository.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ApprovalInputError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function loadEnvironmentFiles(cwd = process.cwd()) {
  if (typeof process.loadEnvFile !== "function") return;
  for (const filename of [".env", ".env.local"]) {
    const file = path.join(cwd, filename);
    try {
      await access(file);
    } catch {
      continue;
    }
    process.loadEnvFile(file);
  }
}

function parseArguments(argv = []) {
  const values = {};
  for (const argument of argv) {
    const match = /^(--run|--reviewer|--note)=(.*)$/.exec(argument);
    if (!match || Object.hasOwn(values, match[1]))
      throw new ApprovalInputError("invalid_approval_arguments");
    values[match[1].slice(2)] = match[2];
  }
  if (!values.run || !UUID_PATTERN.test(values.run)) throw new ApprovalInputError("invalid_run_id");
  if (
    !values.reviewer ||
    values.reviewer.trim() !== values.reviewer ||
    values.reviewer.length > 200
  ) {
    throw new ApprovalInputError("invalid_reviewer");
  }
  if (values.note != null && (values.note.trim() !== values.note || values.note.length > 200)) {
    throw new ApprovalInputError("invalid_approval_note");
  }
  return Object.freeze({
    runId: values.run.toLowerCase(),
    reviewer: values.reviewer,
    note: values.note ?? null,
  });
}

function databaseUrl() {
  const value = String(process.env.DATABASE_URL_UNPOOLED ?? "").trim();
  if (!value) throw new ApprovalInputError("missing_database_url_unpooled");
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname)
      throw new Error("invalid");
  } catch {
    throw new ApprovalInputError("invalid_database_url");
  }
  return value;
}

function rowsFromResult(result) {
  if (!result || !Array.isArray(result.rows)) throw new Error("database result is invalid");
  return result.rows;
}

function isHealthyShadow(row) {
  const sourceStatus = row?.source_status;
  return (
    row?.mode === "shadow" &&
    row?.status === "shadow_healthy" &&
    row?.finished_at != null &&
    sourceStatus &&
    ["old_site", "28hse_agent_540"].every(
      (source) =>
        sourceStatus[source]?.healthy === true &&
        Array.isArray(sourceStatus[source]?.reasons) &&
        sourceStatus[source].reasons.length === 0,
    )
  );
}

function publicRunSummary(row, artifactRoot) {
  const sourceStatus = row.source_status ?? {};
  return {
    runId: row.id,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    sourceCounts: row.counts ?? {},
    healthReasons: Object.fromEntries(
      ["old_site", "28hse_agent_540"].map((source) => [
        source,
        sourceStatus[source]?.reasons ?? [],
      ]),
    ),
    artifactLocation: path.resolve(artifactRoot, String(row.scheduled_for), String(row.id)),
  };
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  let connectionString;
  try {
    await loadEnvironmentFiles();
    args = parseArguments(argv);
    connectionString = databaseUrl();
  } catch (error) {
    logRunEvent({
      level: "error",
      event: "mls_baseline_approval_rejected",
      code: error.code ?? "invalid_approval",
    });
    return 30;
  }
  try {
    const result = await withMlsAdvisoryLock({
      connectionString,
      work: async (client) => {
        const rows = rowsFromResult(
          await client.query(
            `SELECT id, scheduled_for::text AS scheduled_for, started_at, finished_at,
                    mode, status, source_status, counts
               FROM listing_sync_runs
              WHERE id = $1::uuid
              LIMIT 2`,
            [args.runId],
          ),
        );
        if (rows.length !== 1) throw new Error("shadow run was not found");
        const row = rows[0];
        if (!isHealthyShadow(row))
          throw new Error("only a completed healthy shadow run can be approved");
        const repository = createSyncRepository({ client });
        const summary = publicRunSummary(row, process.env.MLS_ARTIFACT_DIR ?? "artifacts/mls-sync");
        process.stdout.write(`${JSON.stringify(summary)}\n`);
        await repository.approveShadowRun(args.runId, { reviewer: args.reviewer, note: args.note });
        return { approved: true, runId: args.runId };
      },
    });
    if (result?.kind === "lock_unavailable") {
      logRunEvent({
        level: "warn",
        event: "mls_baseline_approval_lock_unavailable",
        code: "lock_unavailable",
      });
      return 75;
    }
    logRunEvent({ level: "info", event: "mls_baseline_approved", code: "shadow_approved" });
    return 0;
  } catch (error) {
    logRunEvent({
      level: "error",
      event: "mls_baseline_approval_failed",
      code: error?.code ?? "approval_failed",
    });
    return 40;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
