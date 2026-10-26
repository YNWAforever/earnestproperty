import csv from "./fixtures/eprc-transactions-22-estates-20261027.csv?raw";
import { buildEprcSnapshot, getEprcEstateTransactions } from "./eprc-transactions";

// Vite bundles this versioned source. No network scrape or database writes at runtime.
const snapshot = buildEprcSnapshot(csv);

export function getEstateRegisteredTransactions(slug: string) {
  return getEprcEstateTransactions(snapshot, slug);
}
