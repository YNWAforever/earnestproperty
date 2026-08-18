import type { SourceRunResult } from "./source-contract.mjs";
import type { PublicationProposal, SyncRepository } from "./sync-repository.mjs";

export interface MediaPreparer {
  prepareListingMedia(input: Record<string, unknown>): Promise<{
    publishable: boolean;
    reasons: readonly string[];
    images: readonly string[];
    uploadCount: number;
    wouldUploadCount: number;
    results: readonly unknown[];
    prepared: unknown;
  }>;
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
