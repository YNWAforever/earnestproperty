import { createHash } from "node:crypto";
import { fetchWoztellHistoryPage, chatNodeToEvent } from "./woztell-history.server.ts";
export async function startHistoryImport(staffId: string, mode: "forward" | "backward") {
  const channel = process.env.WOZTELL_CHANNEL_ID;
  if (!channel || !process.env.WOZTELL_OPEN_API_TOKEN)
    throw new Error("WOZTELL_HISTORY_CONFIGURATION_REQUIRED");
  const id = createHash("sha256")
    .update(JSON.stringify([channel, mode]))
    .digest("hex");
  const { queryRows } = await import("../neon/db.server.ts");
  const rows = await queryRows<{ id: string; completed: boolean }>(
    `WITH run AS (
 INSERT INTO woztell_history_imports(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id RETURNING *
 ), job AS (
 INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key,actor_staff_id)
 SELECT 'woztell.history.import',1,jsonb_build_object('importId',id,'cursor',cursor,'mode',$2::text,'channelId',$4::text),'queued',5,now(),
 'woztell.history:'||id||':'||md5(COALESCE(cursor,'')),$3::uuid FROM run WHERE NOT completed
 ON CONFLICT(idempotency_key) DO UPDATE SET status=CASE WHEN ops_jobs.status='failed' THEN 'queued' ELSE ops_jobs.status END,
 attempt_count=CASE WHEN ops_jobs.status='failed' THEN 0 ELSE ops_jobs.attempt_count END RETURNING id
 ) SELECT id,completed FROM run`,
    [id, mode, staffId, channel],
  );
  return rows[0];
}
export type HistoryJobPayload = {
  importId: string;
  cursor: string | null;
  mode: "forward" | "backward";
  channelId: string;
};
type HistoryPage = Awaited<ReturnType<typeof fetchWoztellHistoryPage>>;
export type HistoryImportPorts = {
  load: (id: string) => Promise<{ cursor: string | null; completed: boolean } | null>;
  fetchPage: (payload: HistoryJobPayload) => Promise<HistoryPage>;
  ingest: (event: ReturnType<typeof chatNodeToEvent>) => Promise<unknown>;
  advance: (payload: HistoryJobPayload, page: HistoryPage) => Promise<void>;
};
export async function runHistoryImportPage(
  payload: HistoryJobPayload,
  checkpoint: () => Promise<void>,
  injected?: HistoryImportPorts,
) {
  const ports = injected ?? {
    async load(id: string) {
      const { queryRows } = await import("../neon/db.server.ts");
      return (
        (
          await queryRows<{ cursor: string | null; completed: boolean }>(
            "SELECT cursor,completed FROM woztell_history_imports WHERE id=$1",
            [id],
          )
        )[0] ?? null
      );
    },
    async fetchPage(p: HistoryJobPayload) {
      const token = process.env.WOZTELL_OPEN_API_TOKEN;
      if (!token || p.channelId !== process.env.WOZTELL_CHANNEL_ID)
        throw new Error("WOZTELL_HISTORY_CONFIGURATION_REQUIRED");
      return fetchWoztellHistoryPage({
        token,
        channelId: p.channelId,
        mode: p.mode,
        cursor: p.cursor,
      });
    },
    async ingest(event: ReturnType<typeof chatNodeToEvent>) {
      return (await import("./woztell-ingest.server.ts")).ingestWoztellEvent(event);
    },
    advance: advanceHistoryImport,
  };
  const stored = await ports.load(payload.importId);
  if (!stored || stored.completed || stored.cursor !== payload.cursor) return { rows: 0 };
  await checkpoint();
  let page = await ports.fetchPage(payload);
  // Preserve the existing empty-forward fallback, within the same checkpoint.
  if (
    payload.mode === "forward" &&
    payload.cursor === null &&
    page.nodes.length === 0 &&
    !page.hasMore
  ) {
    payload = { ...payload, mode: "backward" };
    page = await ports.fetchPage(payload);
  }
  if (page.hasMore && (!page.cursor || page.cursor === payload.cursor))
    throw new Error("WOZTELL_HISTORY_CURSOR_STALLED");
  for (const node of page.nodes) {
    await checkpoint();
    await ports.ingest(chatNodeToEvent(node));
  }
  await checkpoint();
  await ports.advance(payload, page);
  return { rows: page.nodes.length };
}
async function advanceHistoryImport(payload: HistoryJobPayload, page: HistoryPage) {
  // Replay after a crash re-ingests a page harmlessly; cursor and next durable job commit together.
  const { transactionRows } = await import("../neon/db.server.ts");
  await transactionRows([
    {
      statement: "SELECT id FROM woztell_history_imports WHERE id=$1 FOR UPDATE",
      params: [payload.importId],
    },
    {
      statement: `WITH advanced AS (
 UPDATE woztell_history_imports SET cursor=$3,completed=$4,updated_at=now()
 WHERE id=$1 AND cursor IS NOT DISTINCT FROM $2::text AND NOT completed RETURNING *
 ) INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key)
 SELECT 'woztell.history.import',1,jsonb_build_object('importId',id,'cursor',cursor,'mode',$5::text,'channelId',$6::text),
 'queued',5,now()+interval '2 seconds','woztell.history:'||id||':'||md5(COALESCE(cursor,'')) FROM advanced WHERE NOT completed
 ON CONFLICT(idempotency_key) DO NOTHING`,
      params: [
        payload.importId,
        payload.cursor,
        page.cursor,
        !page.hasMore,
        payload.mode,
        payload.channelId,
      ],
    },
  ]);
}
