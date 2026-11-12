/** Types for `importer.mjs`, which is plain JS shared with the CLI migration
 * scripts. Without these the TanStack route importing it fell back to `any`,
 * so the cron handler had no checking on the sync payload at all. */

export declare const DEFAULT_SEED_URLS: string[];
export declare const DEFAULT_OLD_SITE_SEED_URLS: Array<{
  url: string;
  dealType: "sale" | "rent";
}>;

/** Legacy-site origin; overridable with the `OLD_SITE_ORIGIN` env var. */
export declare const OLD_SITE_ORIGIN: string;
/** `properties.source_site` value for the legacy inventory. */
export declare const SOURCE_SITE: string;
/** Maximum detail fetch/parse error share before an apply run refuses to write. */
export declare const MAX_DETAIL_ERROR_RATE: number;
/** Minimum discovered listing ids before a deactivation sweep is allowed. */
export declare const MIN_DISCOVERED_FOR_SWEEP: number;
export declare const DEFAULT_USER_AGENT: string;
export declare const DEFAULT_TIMEOUT_MS: number;
export declare const DEFAULT_MAX_BYTES: number;

export declare function defaultSleep(ms: number): Promise<void>;

export type EstateRow = {
  id: string;
  slug: string;
  name_zh: string | null;
  name_en: string | null;
  aliases: string[] | null;
  district_slug: string | null;
};

export declare function discoverOldSitePages(input: {
  fetchText: (url: string) => Promise<string>;
  seedUrls?: Array<string | { url: string; dealType: "sale" | "rent" }>;
  maxPages?: number;
}): Promise<string[]>;

export type MlsListingRow = Record<string, unknown>;

export type MlsDealType = "sale" | "rent";

export type MlsSyncSummary = {
  discovered: number;
  selected: number;
  parsed: number;
  /** Detail URLs whose HTTP fetch succeeded (parsed or validation-failed). */
  fetched: number;
  /** Parse/fetch/validation errors divided by the selected detail count. */
  errorRate: number;
  /** True when `errorRate` exceeds `MAX_DETAIL_ERROR_RATE`. */
  errorBudgetExceeded: boolean;
  /** Every legacy detail id discovered, including ones not fetched this run. */
  discoveredLegacyIds: string[];
  /** Whether this run is trusted to deactivate listings it did not see. */
  canDeactivate: boolean;
  /** Rows whose legacy property number is missing (`OLD-<id>` fallback). */
  canonicalMissing: number;
  estateResolved: number;
  estateUnresolved: number;
  /** Discovered ids left protected from the sweep (not upserted this run). */
  protectedLegacyIds: string[];
  /** `[legacy_detail_id, deal_type]` pairs that produced upsertable rows. */
  pairsSeen: Array<[string, MlsDealType]>;
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
  /**
   * True when an explicit operator override let the sweep run below the 70%
   * coverage guard (initial reconciliation only). Always false on a healthy run.
   */
  coverageOverride: boolean;
  /**
   * Rows skipped because their unique `listing_no` is owned by another source
   * feed (Property.hk serves the same listing). Reported, never overwritten.
   */
  skippedConflicts: number;
  conflicts: Array<{
    listing_no: string;
    canonical_property_no: string | null;
    deal_type: MlsDealType;
    existing_source_site: string | null;
    existing_legacy_detail_id: string | null;
    existing_deal_type: string | null;
    existing_ingestion_owner: string | null;
  }>;
  errors: Array<{ url?: string; message: string }>;
  dryRunRows: MlsListingRow[];
};

export type MlsDb = {
  listEstateIdsBySlug?(): Promise<Map<string, string>>;
  /** Optional: when present, sync resolves estate/location ids through it. */
  listEstates?(): Promise<EstateRow[]>;
  upsertProperties(rows: MlsListingRow[]): Promise<{
    count: number;
    conflicts?: Array<{
      listing_no: string;
      canonical_property_no: string | null;
      deal_type: MlsDealType;
      existing_source_site: string | null;
      existing_legacy_detail_id: string | null;
      existing_deal_type: string | null;
      existing_ingestion_owner: string | null;
    }>;
  }>;
  deactivateMissing(input: {
    sourceSite: string;
    seenLegacyIds: string[];
    /** Present for pair-aware sweeps; mocks that ignore it keep working. */
    seenPairs?: Array<[string, MlsDealType]>;
    /** Discovered ids that were not upserted this run and must not be swept. */
    protectedLegacyIds?: string[];
    /**
     * Explicit operator opt-in to sweep below the coverage guard. Only the
     * one-off initial reconciliation CLI flag ever sets this.
     */
    allowLowCoverage?: boolean;
    nowIso: string;
  }): Promise<{
    count: number;
    skipped?: string;
    coverage?: number;
    coverageOverride?: boolean;
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
    /** Opt-in override of the 70% coverage guard (initial reconciliation). */
    allowLowCoverage?: boolean;
  }): Promise<MlsSyncSummary>;
};

export declare function createMlsImporter(input: {
  fetchText: (url: string) => Promise<string>;
  db: MlsDb;
  now?: () => Date;
}): MlsImporter;

export declare function createHardenedFetchText(options?: {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<unknown>;
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  retries?: number;
}): (url: string) => Promise<string>;

export declare function defaultFetchText(url: string): Promise<string>;
