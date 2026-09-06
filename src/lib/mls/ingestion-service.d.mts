import type { Client } from "@neondatabase/serverless";
export interface IngestionOptions {
  connectionString?: string;
  apply?: boolean;
  expectedSource?: "28hse_agent_540" | "propertyhk";
  /** Server-only test dependency; never populated from request JSON. */
  createClient?: (config: {
    connectionString: string;
    connectionTimeoutMillis: number;
    query_timeout: number;
  }) => Client;
  WebSocketImpl?: typeof WebSocket;
  /** Server-only failure-injection hook, inside the transaction before COMMIT. */
  beforeCommit?: () => void | Promise<void>;
}
export interface IngestionResponse {
  success: true;
  status: "dry_run" | "success" | "partial_success";
  full_snapshot: boolean;
  receipt_id: string | null;
  summary: {
    advertisement_count: number;
    offer_count: number;
    rejected_count: number;
    duplicate_count: number;
  };
  rejects: Array<{ row_index: number; code: string }>;
}
export function ingestSnapshot(
  payload: unknown,
  options?: IngestionOptions,
): Promise<IngestionResponse>;
