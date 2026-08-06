/** Types for `importer.mjs`, which is plain JS shared with the CLI migration
 * scripts. Without these the TanStack route importing it fell back to `any`,
 * so the cron handler had no checking on the sync payload at all. */

export declare const DEFAULT_SEED_URLS: string[];

export type MlsListingRow = Record<string, unknown>;

export type MlsSyncSummary = {
  discovered: number;
  selected: number;
  parsed: number;
  upserted: number;
  deactivated: number;
  deactivationSkipped: boolean;
  errors: Array<{ url?: string; message: string }>;
  dryRunRows: MlsListingRow[];
};

export type MlsDb = {
  listEstateIdsBySlug(): Promise<Map<string, string>>;
  upsertProperties(rows: MlsListingRow[]): Promise<{ count: number }>;
  deactivateMissing(input: {
    sourceSite: string;
    seenLegacyIds: string[];
    nowIso: string;
  }): Promise<{ count: number }>;
};

export type MlsImporter = {
  discover(seedUrls?: string[], options?: { maxPages?: number }): Promise<string[]>;
  sync(options?: {
    seedUrls?: string[];
    maxDetails?: number;
    maxPages?: number;
    dryRun?: boolean;
    fullSync?: boolean;
  }): Promise<MlsSyncSummary>;
};

export declare function createMlsImporter(input: {
  fetchText: (url: string) => Promise<string>;
  db: MlsDb;
  now?: () => Date;
}): MlsImporter;

export declare function defaultFetchText(url: string): Promise<string>;
