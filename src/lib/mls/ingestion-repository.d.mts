import type { Client } from "@neondatabase/serverless";
import type { IngestionOptions, IngestionResponse } from "./ingestion-service.mjs";
/** Dedicated client only. Opens and owns one transaction and defensive global transaction lock. */
export function applyIngestion(
  client: Client,
  payload: unknown,
  options?: IngestionOptions,
): Promise<IngestionResponse>;
