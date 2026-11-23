import "@tanstack/react-start/server-only";
import raw from "./fixtures/market-transactions-62-estates-20261123.json?raw";
import {
  buildMarketSnapshot,
  getEstateChartTranscription as readEstateChartTranscription,
  getEstateMarketTransactions as readEstateMarketTransactions,
  type MarketChartMonth,
  type MarketEstateTransactions,
  type MarketTransactionFilters,
} from "./market-transactions.ts";

// Vite bundles this versioned source file. No scrape or database write at runtime.
const snapshot = buildMarketSnapshot(JSON.parse(raw));

/** Latest registration date covered by the committed snapshot (2026-11-19). */
export const MARKET_SNAPSHOT_AS_OF = snapshot.registrationThrough;

export function getEstateMarketTransactions(
  slug: string,
  filters?: MarketTransactionFilters,
): MarketEstateTransactions | null {
  return readEstateMarketTransactions(snapshot, slug, filters);
}

export function getEstateChartTranscription(slug: string): MarketChartMonth[] {
  return readEstateChartTranscription(snapshot, slug);
}
