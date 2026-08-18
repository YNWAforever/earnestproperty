/** Types for `neon-db.mjs`, the Neon-backed MlsDb implementation shared between
 * the cron route and the CLI migration scripts. */

import type { MlsDb } from "./importer.d.mts";

export interface LatestSyncRun {
  id: string;
  scheduledFor: string;
  startedAt: string;
  finishedAt: string | null;
  mode: "shadow" | "publish";
  status: string;
  sourceStatus: unknown;
  counts: unknown;
  failureCode: string | null;
  failureSummary: string | null;
}

type NeonSql = {
  query: (statement: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

export declare function createNeonSqlFromEnv(): NeonSql;

export type NeonMlsDb = MlsDb & {
  getLatestSyncRun(): Promise<LatestSyncRun | null>;
};

export declare function createNeonMlsDb(sql: NeonSql): NeonMlsDb;
