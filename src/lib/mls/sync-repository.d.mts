import type { DealType, MlsSource, SourceObservation } from "./source-contract.mjs";

export interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

export interface DedicatedQueryClient {
  query<Row = Record<string, unknown>>(
    statement: string,
    params?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface RepositoryOperation {
  signal?: AbortSignal;
}

export interface PersistedObservationRef {
  id: string;
  source: MlsSource;
  externalId: string;
  dealType: DealType;
  propertyNoNormalized: string | null;
  matchKey: string | null;
  contentHash: string;
}

export interface CountSnapshot {
  sale: number;
  rent: number;
}

export interface SourceHealthStatus {
  source: MlsSource;
  healthy: boolean;
  reasons: string[];
  [key: string]: unknown;
}

export interface RunEvaluation {
  sourceStatus: Partial<Record<MlsSource, SourceHealthStatus>>;
  counts: Record<string, unknown>;
  baselines: Record<string, unknown>;
}

export interface RunCompletion extends RunEvaluation {
  status: "shadow_healthy" | "healthy" | "degraded" | "blocked" | "failed" | "lock_skipped";
  failureCode?: string | null;
  failureSummary?: string | null;
}

export interface CanonicalProperty {
  id: string;
  listing_no: string;
  canonical_property_no: string;
  legacy_property_no: string | null;
  deal_type: DealType;
  updated_at: string;
}

export interface ExternalIdentity {
  source: MlsSource;
  externalId: string;
  dealType?: DealType;
}

export interface SourceLink {
  property_id: string;
  source: MlsSource;
  external_listing_id: string;
  deal_type: DealType;
  match_key: string;
  link_reason: "exact_property_no_and_deal_type";
  status: "proposed" | "active" | "rejected";
}

export interface ProposedSourceLink {
  propertyId: string;
  source: MlsSource;
  externalId: string;
  dealType: DealType;
  matchKey: string;
  observedAt: string;
}

export interface PropertySyncField {
  property_id: string;
  field_name: string;
  last_published_value: unknown;
  override_value: unknown;
  active_override: boolean;
  winning_observation_id: string | null;
  updated_at: string;
}

export interface PropertySyncState {
  property_id: string;
  consecutive_absent_healthy_runs: number;
  last_evaluated_run_id: string | null;
  inactive_reason: string | null;
  inactive_at: string | null;
  updated_at: string;
}

export interface MediaAsset {
  id: string;
  url: string;
  pathname: string;
  contentType: string | null;
  sizeBytes: number | null;
  contentHash: string | null;
  ownerType: string;
  ownerId: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface OwnedMediaInput {
  url: string;
  pathname: string;
  contentType: string | null;
  sizeBytes: number | null;
  contentHash: string;
  ownerType: string;
  ownerId: string | null;
  createdBy: string | null;
}

export interface OwnedMediaRegistration {
  outcome: "inserted" | "existing";
  asset: MediaAsset;
}

export interface ListingMediaRecordInput {
  observationId: string;
  propertyId: string | null;
  sourceUrl: string;
  contentHash: string | null;
  ownedMediaAssetId: string | null;
  detectedMime: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  eligibility: "eligible" | "rejected" | "upload_failed";
  rejectionReason: string | null;
}

export interface ListingSyncRun {
  id: string;
  scheduled_for: string;
  started_at: string;
  finished_at: string | null;
  mode: "shadow" | "publish";
  status:
    | "running"
    | "shadow_healthy"
    | "healthy"
    | "degraded"
    | "blocked"
    | "failed"
    | "lock_skipped";
  parser_version: string;
  source_status: Record<string, unknown>;
  counts: Record<string, unknown>;
  baselines: Record<string, unknown>;
  failure_code: string | null;
  failure_summary: string | null;
  baseline_approved_at: string | null;
  baseline_approved_by: string | null;
  baseline_approval_note: string | null;
  created_at: string;
}

export interface SyncRepository {
  beginRun(input: {
    scheduledFor: string;
    mode: "shadow" | "publish";
    parserVersion: string;
  }): Promise<{ runId: string }>;
  saveObservations(
    runId: string,
    observations: SourceObservation[],
  ): Promise<PersistedObservationRef[]>;
  getHealthyCountHistory(source: MlsSource, limit?: number): Promise<CountSnapshot[]>;
  recordRunEvaluation(runId: string, evaluation: RunEvaluation): Promise<void>;
  assertLockSession(): Promise<void>;
  finishRun(runId: string, result: RunCompletion): Promise<void>;
  approveShadowRun(
    runId: string,
    approval: { reviewer: string; note?: string | null },
  ): Promise<void>;
  getApprovedHealthyShadowStreak(
    beforeDate: string,
  ): Promise<{ length: number; lastDate: string | null }>;
  findCanonicalCandidates(matchKeys: string[]): Promise<CanonicalProperty[]>;
  loadSourceLinks(externalIdentities: ExternalIdentity[]): Promise<SourceLink[]>;
  saveProposedLinks(runId: string, links: ProposedSourceLink[]): Promise<void>;
  loadEstateIdsBySlug(slugs: string[]): Promise<Map<string, string>>;
  loadFieldStates(propertyIds: string[]): Promise<PropertySyncField[]>;
  loadLifecycleStates(propertyIds: string[]): Promise<PropertySyncState[]>;
  findMediaByHash(hash: string, operation?: RepositoryOperation): Promise<MediaAsset | null>;
  findMediaByUrls(urls: string[], operation?: RepositoryOperation): Promise<MediaAsset[]>;
  registerOwnedMedia(
    input: OwnedMediaInput,
    operation?: RepositoryOperation,
  ): Promise<OwnedMediaRegistration>;
  saveMediaRecord(input: ListingMediaRecordInput, operation?: RepositoryOperation): Promise<void>;
  getLatestRun(): Promise<ListingSyncRun | null>;
}

export declare function createSyncRepository(options: {
  client: DedicatedQueryClient;
}): SyncRepository;
