import type { Client } from "@neondatabase/serverless";
import type { IngestionOptions, IngestionResponse } from "./ingestion-service.mjs";
/** Dedicated client only. Opens and owns one transaction and defensive global transaction lock. */
export function applyIngestion(
  client: Client,
  payload: unknown,
  options?: IngestionOptions,
): Promise<IngestionResponse>;

/** Normal ingestion draft constructor; caller owns the transaction/group assignment. */
export function createImportedDraft(
  query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>,
  input: {
    id?: string;
    record: { fields: { title: string | null }; dealType: "sale" | "rent" };
    districtSlug: string;
    estateId?: string | null;
    companyNumber?: string | null;
  },
): Promise<Record<string, unknown>>;
