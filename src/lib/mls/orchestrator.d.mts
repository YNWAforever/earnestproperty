import type { SourceRunResult } from "./source-contract.mjs";
import type { PublicationProposal, SyncRepository } from "./sync-repository.mjs";

export interface BlobStore {
  put(input: {
    pathname: string;
    body: Blob | ArrayBuffer | ArrayBufferView;
    contentType: string;
    signal?: AbortSignal;
  }): Promise<{
    url: string;
    downloadUrl: string;
    pathname: string;
    contentType: string;
    size: number;
  }>;
}

export interface PreparedListingMedia {
  observationId: string;
  propertyId: string | null;
  source: string;
  externalId: string;
  dealType: string;
  matchKey: string;
  images: readonly string[];
}

export interface MediaPreparationResult {
  publishable: boolean;
  reasons: readonly string[];
  images: readonly string[];
  uploadCount: number;
  wouldUploadCount: number;
  candidateResults: readonly Record<string, unknown>[];
  preparedMedia: PreparedListingMedia | null;
  /** Compatibility with pre-Task-10 preparers. */
  results?: readonly Record<string, unknown>[];
  prepared?: PreparedListingMedia | null;
}

export interface MediaPreparer {
  prepareListingMedia(input: {
    mode: "validate" | "upload";
    observation: import("./source-contract.mjs").SourceObservation;
    observationId: string;
    propertyId: string | null;
    currentImages: readonly string[];
    allowedMediaHosts?: readonly string[] | string;
    blobStore?: BlobStore;
    isNew: boolean;
    rightsConfirmed: boolean;
    repository: SyncRepository;
    signal?: AbortSignal;
  }): Promise<MediaPreparationResult>;
}
export interface SyncRunResult {
  runId: string;
  status: "shadow_healthy" | "healthy" | "degraded" | "blocked" | "failed";
  evaluation: Record<string, unknown>;
  gate?: Record<string, unknown>;
  counts: Record<string, number>;
  proposals?: PublicationProposal[];
  quarantines?: unknown[];
  failureCode?: string;
  failureSummary?: string;
}

export interface RunReporter {
  writeRunArtifacts(result: SyncRunResult): Promise<void>;
}

export declare function runDualSourceSync(input: {
  scheduledFor: string;
  mode: "shadow" | "publish";
  publishEnabled: boolean;
  mediaRightsConfirmed: boolean;
  parserVersion: string;
  mediaAllowedHosts?: readonly string[] | string;
  blobStore?: BlobStore;
  adapters: {
    oldSite: { collect(): Promise<SourceRunResult> };
    hse28: { collect(): Promise<SourceRunResult> };
  };
  repository: SyncRepository;
  media: MediaPreparer;
  reporter: RunReporter;
  signal: AbortSignal;
  now: () => Date;
}): Promise<SyncRunResult>;
