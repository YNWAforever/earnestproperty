import "@tanstack/react-start/server-only";

import {
  YOUTUBE_CHANNEL_ID,
  type YouTubeSyncMode,
  type YouTubeSyncSummary,
  type YouTubeSyncTrigger,
} from "./youtube-sync.types";
import type { YouTubeSyncStatus } from "./youtube-status.types";

type Row = Record<string, unknown>;
type QueryRows = (sql: string, params?: unknown[]) => Promise<Row[]>;
type Run = {
  runId: string;
  channelId: string;
  startedAt: Date;
  mode: YouTubeSyncMode;
  trigger: YouTubeSyncTrigger;
};
type Result = Run & {
  finishedAt: Date;
  status: "completed" | "failed" | "partial";
  summary: YouTubeSyncSummary | null;
  code: string | null;
};

export type YouTubeHistoryPort = {
  started(run: Run): Promise<void>;
  finished(run: Result): Promise<void>;
};

async function defaultQueryRows(sql: string, params: unknown[] = []) {
  return (await import("../neon/db.server")).queryRows(sql, params);
}

export function createYouTubeSyncHistory(queryRows: QueryRows = defaultQueryRows) {
  async function append(run: Run, action: string, outcome: string, metadata: Row) {
    // Machine runs have no staff identity. Only fixed aggregate fields reach the audit log.
    await queryRows(
      `INSERT INTO ops_audit_logs
         (actor_staff_id, permission, action, resource_type, resource_id, outcome, request_id, metadata)
       VALUES (NULL, 'cms.publish', $1, 'youtube_channel', $2, $3, $4::uuid, $5::jsonb)`,
      [action, run.channelId, outcome, run.runId, JSON.stringify(metadata)],
    );
  }

  async function started(run: Run) {
    await append(run, "youtube.sync.started", "success", {
      mode: run.mode,
      trigger: run.trigger,
      startedAt: run.startedAt.toISOString(),
      status: "running",
    });
  }

  async function finished(run: Result) {
    await append(run, "youtube.sync.result", run.status === "completed" ? "success" : "failure", {
      mode: run.mode,
      trigger: run.trigger,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt.toISOString(),
      status: run.status,
      code: run.code,
      inserted: run.summary?.inserted ?? null,
      adopted: run.summary?.adopted ?? null,
      updated: run.summary?.updated ?? null,
      restored: run.summary?.restored ?? null,
      fetched: run.summary?.fetched ?? null,
      pages: run.summary?.pages ?? null,
      // Provider reads and the set-based mutation are all-or-nothing. A failed
      // read cannot establish a number of failed videos.
      failed: run.status === "completed" ? 0 : null,
    });
  }

  async function readStatus(): Promise<YouTubeSyncStatus> {
    const rows = await queryRows(
      `WITH attempt AS (
         SELECT request_id, metadata FROM ops_audit_logs
         WHERE resource_type = 'youtube_channel' AND resource_id = $1
           AND action = 'youtube.sync.started'
         ORDER BY created_at DESC, id DESC LIMIT 1
       ), result AS (
         SELECT metadata FROM ops_audit_logs
         WHERE resource_type = 'youtube_channel' AND resource_id = $1
           AND action = 'youtube.sync.result'
           AND request_id = (SELECT request_id FROM attempt)
         ORDER BY created_at DESC, id DESC LIMIT 1
       ), success AS (
         SELECT metadata->>'finishedAt' AS at FROM ops_audit_logs
         WHERE resource_type = 'youtube_channel' AND resource_id = $1
           AND action = 'youtube.sync.result' AND outcome = 'success'
           AND metadata->>'status' = 'completed'
         ORDER BY created_at DESC, id DESC LIMIT 1
       )
       SELECT
         (SELECT metadata FROM attempt) AS attempt,
         (SELECT metadata FROM result) AS result,
         (SELECT at FROM success) AS last_success,
         EXISTS (SELECT 1 FROM youtube_sync_state
           WHERE channel_id = $1 AND lease_expires_at > now()
             AND lease_owner = (SELECT request_id FROM attempt)) AS running`,
      [YOUTUBE_CHANNEL_ID],
    );
    const row = rows[0] ?? {};
    const attempt = row.attempt as Row | null;
    const result = row.result as Row | null;
    return {
      lastAttempt: typeof attempt?.startedAt === "string" ? attempt.startedAt : null,
      lastSuccess: typeof row.last_success === "string" ? row.last_success : null,
      status: !attempt
        ? "never"
        : result?.status === "completed"
          ? "completed"
          : result?.status === "partial"
            ? "partial"
            : result
              ? "failed"
              : row.running
                ? "running"
                : "interrupted",
      inserted: typeof result?.inserted === "number" ? result.inserted : null,
      adopted: typeof result?.adopted === "number" ? result.adopted : null,
      updated: typeof result?.updated === "number" ? result.updated : null,
      failed: typeof result?.failed === "number" ? result.failed : null,
      code: typeof result?.code === "string" ? result.code : null,
    };
  }

  return { started, finished, readStatus };
}
