export type MlsSource = "old_site" | "28hse_agent_540";
export type DealType = "sale" | "rent";

export interface ListingFields {
  title_zh?: string | null;
  title_en?: string | null;
  estate_slug?: string | null;
  district_slug?: string | null;
  address?: string | null;
  price?: number | null;
  rent?: number | null;
  saleable_area?: number | null;
  gross_area?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  floor?: string | null;
  orientation?: string | null;
  features?: string[] | null;
  description?: string | null;
  status?: "draft" | "active" | "sold" | "rented" | "offline" | "inactive" | null;
}

export interface MediaCandidate {
  url: string;
  category: "listing_photo" | "map" | "floorplan" | "qr" | "vr" | "branded" | "unknown";
  isPrimary: boolean;
  rejected?: boolean;
  eligible?: boolean;
  contextRejected?: boolean;
  rejectionReason?: string;
  rejectionReasons?: readonly string[];
  contextRejectionMarkers?: readonly string[];
}

export interface SourceObservation {
  schemaVersion: 1;
  source: MlsSource;
  externalId: string;
  dealType: DealType;
  sourceUrl: string;
  propertyNoRaw: string | null;
  propertyNoNormalized: string | null;
  matchKey: string | null;
  fields: ListingFields;
  rawFields: Record<string, unknown>;
  mediaCandidates: MediaCandidate[];
  sourceUpdatedAt: string | null;
  discoveredAt: string;
  fetchedAt: string;
  contentHash: string;
  validationState: "valid" | "quarantined";
  quarantineReasons: string[];
  parseWarnings: string[];
}

export interface SourceRunResult {
  source: MlsSource;
  identityValid: boolean;
  robotsAllowed: boolean;
  paginationComplete: boolean;
  challengeDetected: boolean;
  advertisedCounts: Record<DealType, number>;
  pageCounts: Record<DealType, number>;
  discovered: number;
  observations: SourceObservation[];
  failures: Array<{ externalId?: string; code: string; detail: string }>;
  diagnostics: Array<{
    sourceUrl: string;
    responseStatus: number | null;
    attempts: number;
    templateFingerprint: string | null;
    selectorCounts: Record<string, number>;
    failureCode: string | null;
  }>;
  conflictingDuplicateIds: string[];
}

export interface ObservationInput {
  source: MlsSource;
  externalId: string;
  dealType: DealType;
  sourceUrl: string;
  propertyNoRaw?: string | null;
  fields?: ListingFields;
  rawFields?: Record<string, unknown>;
  mediaCandidates?: MediaCandidate[];
  sourceUpdatedAt?: string | null;
  discoveredAt?: string;
  fetchedAt: string;
  quarantineReasons?: string[];
  parseWarnings?: string[];
}

export declare const SOURCE_OLD_SITE: "old_site";
export declare const SOURCE_28HSE: "28hse_agent_540";
export declare const DEAL_TYPES: readonly DealType[];
export declare const MLS_PARSER_VERSION: "dual-source-v1";
export declare const OBSERVATION_SCHEMA_VERSION: 1;
export declare function normalizePropertyNo(value: unknown): string | null;
export declare function buildMatchKey(propertyNo: unknown, dealType: unknown): string | null;
export declare function stableObservationHash(value: unknown): string;
export declare function createObservation(input: ObservationInput): SourceObservation;
