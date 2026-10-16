import type { YouTubeSyncStatus } from "../../src/lib/youtube-sync/youtube-status.types";

// Synthetic CMS evidence only: no server function, auth, DB or provider imports.
export async function fetchYouTubeSyncStatus(): Promise<YouTubeSyncStatus> {
  return {
    lastAttempt: null,
    lastSuccess: null,
    status: "never",
    inserted: null,
    adopted: null,
    updated: null,
    failed: null,
    code: null,
  };
}
