export type YouTubeSyncStatus = {
  lastAttempt: string | null;
  lastSuccess: string | null;
  status: "never" | "running" | "completed" | "failed" | "partial" | "interrupted";
  inserted: number | null;
  adopted: number | null;
  updated: number | null;
  failed: number | null;
  code: string | null;
};
