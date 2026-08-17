/** Types for `importer.mjs`, which is plain JS shared with the CLI migration
 * scripts. Without these the TanStack route importing it fell back to `any`,
 * so the cron handler had no checking on the sync payload at all. */

export declare const DEFAULT_SEED_URLS: string[];
export declare const DEFAULT_OLD_SITE_SEED_URLS: Array<{
  url: string;
  dealType: "sale" | "rent";
}>;

export declare function discoverOldSitePages(input: {
  fetchText: (url: string) => Promise<string>;
  seedUrls?: Array<string | { url: string; dealType: "sale" | "rent" }>;
  maxPages?: number;
}): Promise<string[]>;

export type MlsListingRow = Record<string, unknown>;

export type MlsSyncSummary = {
  discovered: number;
  selected: number;
  parsed: number;
  upserted: number;
  deactivated: number;
  deactivationSkipped: boolean;
  /**
   * Set when the DB layer REFUSED to deactivate because the discovery pass
   * covered too little of the live inventory to be trusted. Null on a healthy
   * run. Callers must not treat a blocked sweep as success.
   */
  deactivationBlocked: string | null;
  deactivationCoverage: number | null;
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
  }): Promise<{
    count: number;
    skipped?: string;
    coverage?: number;
    activeCount?: number;
    discovered?: number;
  }>;
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
