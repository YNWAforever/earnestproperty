/** Types for `neon-db.mjs`, the Neon-backed MlsDb implementation shared between
 * the cron route and the CLI migration scripts. */

import type { MlsDb } from "./importer.d.mts";

type NeonSql = {
  query: (statement: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

export declare function createNeonSqlFromEnv(): NeonSql;

export declare function createNeonMlsDb(sql: NeonSql): MlsDb;
