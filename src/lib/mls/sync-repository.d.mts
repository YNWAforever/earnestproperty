import type { DealType, MlsSource, SourceObservation } from "./source-contract.mjs";

export interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
  command?: string;
  fields?: unknown[];
  oid?: number | null;
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

export declare class PublicationError extends Error {
  readonly code:
    | "MLS_PUBLICATION_FAILED"
    | "MLS_PUBLICATION_GATE"
    | "MLS_PUBLICATION_CONFLICT"
    | "MLS_PUBLICATION_OUTCOME_UNKNOWN";
  readonly cleanupErrors: readonly unknown[];
  constructor(
    message: string,
    options?: { cause?: unknown; code?: string; cleanupErrors?: readonly unknown[] },
  );
}

export declare class PublicationGateError extends PublicationError {
  readonly code: "MLS_PUBLICATION_GATE";
}

export declare class PublicationConflictError extends PublicationError {
  readonly code: "MLS_PUBLICATION_CONFLICT";
  readonly propertyId: string | null;
  constructor(
    message: string,
    options?: { propertyId?: string | null; cause?: unknown; cleanupErrors?: readonly unknown[] },
  );
}

export declare class PublicationOutcomeUnknownError extends PublicationError {
  readonly code: "MLS_PUBLICATION_OUTCOME_UNKNOWN";
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

export interface CanonicalPropertyWrite {
  listing_no: string;
  canonical_property_no: string;
  title_zh: string;
  title_en: string | null;
  deal_type: DealType;
  estate_id: string | null;
  district_slug: string;
  address: string | null;
  price: number | null;
  rent: number | null;
  saleable_area: number | null;
  gross_area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: string | null;
  orientation: string | null;
  features: string[] | null;
  description: string | null;
  images: string[];
  status: "draft" | "active" | "sold" | "rented" | "offline" | "inactive";
}

export interface NewCanonicalPropertyWrite extends CanonicalPropertyWrite {
  featured: false;
  management_fee: null;
  video_url: null;
  floorplan_url: null;
  source_site: "dual-source-mls";
  legacy_detail_id?: string;
  legacy_property_no?: string;
  legacy_url?: string;
}

export interface SourceLinkWrite {
  source: MlsSource;
  externalId: string;
  dealType: DealType;
  matchKey: string;
  observedAt: string;
}

export interface ReconciledFieldWrite {
  fieldName:
    | "title_zh"
    | "title_en"
    | "estate_id"
    | "district_slug"
    | "address"
    | "price"
    | "rent"
    | "saleable_area"
    | "gross_area"
    | "bedrooms"
    | "bathrooms"
    | "floor"
    | "orientation"
    | "features"
    | "description"
    | "images"
    | "status";
  lastPublishedValue: unknown;
  overrideValue: unknown;
  activeOverride: boolean;
  winningObservationId: string | null;
}

export interface PropertySyncStateWrite {
  consecutiveAbsentHealthyRuns: number;
  inactiveReason: string | null;
  /** Fixed six-digit UTC PostgreSQL timestamp token when inactive. */
  inactiveAt: string | null;
}

export interface ListingChangeEventWrite {
  changeType: "new" | "changed" | "inactive" | "reactivated" | "link_change";
  fieldName: string | null;
  oldValue: unknown;
  newValue: unknown;
  winningObservationId: string | null;
  reason: string;
}

export interface PublicationProposalBase {
  links: SourceLinkWrite[];
  fields: ReconciledFieldWrite[];
  lifecycle: PropertySyncStateWrite;
  events: ListingChangeEventWrite[];
}

export interface NewPublicationProposal extends PublicationProposalBase {
  kind: "new";
  propertyId?: never;
  expectedUpdatedAt?: never;
  canonical: NewCanonicalPropertyWrite;
}

export interface UpdatePublicationProposal extends PublicationProposalBase {
  kind: "update";
  propertyId: string;
  /** Fixed six-digit UTC PostgreSQL updated_at token for updates. */
  expectedUpdatedAt: string;
  canonical: CanonicalPropertyWrite;
}

export type PublicationProposal = NewPublicationProposal | UpdatePublicationProposal;

export interface PublicationBatchInput {
  runId: string;
  mode: "shadow" | "publish";
  publishEnabled: boolean;
  proposals: PublicationProposal[];
  signal?: AbortSignal;
}

export interface PublicationBatchResult {
  inserted: number;
  updated: number;
  events: number;
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
  assertLockSession(operation?: RepositoryOperation): Promise<void>;
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
  publishBatch(input: PublicationBatchInput): Promise<PublicationBatchResult>;
  getLatestRun(): Promise<ListingSyncRun | null>;
}

export declare function createSyncRepository(options: {
  client: DedicatedQueryClient;
}): SyncRepository;
