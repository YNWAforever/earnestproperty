import { Client } from "@neondatabase/serverless";
import { decodeSnapshot, SnapshotError } from "./ingestion-contract.mjs";
import { evaluateSnapshotGate } from "./source-snapshot-gates.mjs";
import { withMlsAdvisoryLock } from "./neon-lock.mjs";
import { applyIngestion } from "./ingestion-repository.mjs";
export function snapshotResponse(batch, gate, receiptId = null) {
  return {
    success: true,
    status: receiptId ? (gate.full ? "success" : "partial_success") : "dry_run",
    full_snapshot: gate.full,
    receipt_id: receiptId,
    summary: {
      advertisement_count: batch.advertisementCount,
      offer_count: batch.offerCount,
      rejected_count: batch.rejects.length,
      duplicate_count: batch.duplicates,
    },
    rejects: batch.rejects,
  };
}
export async function ingestSnapshot(payload, options = {}) {
  // The initial pass validates the envelope, never establishes Property.hk matching authority.
  const batch = decodeSnapshot(payload, {
    idScope: options.apply !== true && payload?.id_scope === "branch" ? "branch" : "global",
  });
  if (options.expectedSource && batch.source !== options.expectedSource)
    throw new SnapshotError("source_mismatch");
  if (options.apply !== true) {
    const gate = evaluateSnapshotGate(batch, null);
    if (!gate.allowed)
      throw new SnapshotError("incomplete_snapshot", 422, { reasons: gate.reasons });
    return snapshotResponse(batch, gate);
  }
  if (!options.connectionString) throw new SnapshotError("database_unavailable", 503);
  // Completed receipts remain replayable while another batch holds the writer lock.
  const reader = (options.createClient ?? ((config) => new Client(config)))({
    connectionString: options.connectionString,
    connectionTimeoutMillis: 15000,
    query_timeout: 30000,
  });
  reader.neonConfig.webSocketConstructor = options.WebSocketImpl ?? globalThis.WebSocket;
  try {
    await reader.connect();
    const previous = (
      await reader.query(
        "SELECT payload_hash,response FROM mls_ingestion_receipts WHERE source=$1 AND scope_id=$2 AND scraped_at=$3::timestamptz",
        [batch.source, batch.scopeId, batch.scrapedAt],
      )
    ).rows[0];
    if (previous) {
      if (previous.payload_hash !== batch.hash) throw new SnapshotError("receipt_conflict", 409);
      return previous.response;
    }
  } finally {
    await reader.end();
  }
  const result = await withMlsAdvisoryLock({
    connectionString: options.connectionString,
    createClient: options.createClient,
    WebSocketImpl: options.WebSocketImpl,
    work: (client) => applyIngestion(client, payload, options),
  });
  if (result?.kind === "lock_unavailable")
    throw new SnapshotError("ingestion_busy", 503, { retryAfter: 5 });
  return result;
}
