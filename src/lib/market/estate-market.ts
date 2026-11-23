import { createServerFn } from "@tanstack/react-start";

import type {
  MarketChartMonth,
  MarketEstateTransactions,
  MarketTransactionFilters,
} from "@/content/market-transactions";

export type EstateMarketBlock = {
  market: MarketEstateTransactions | null;
  chart: MarketChartRow[];
};

type MarketChartRow = MarketChartMonth;

/**
 * Server boundary for 市場註冊成交 (market registered transactions).
 *
 * The snapshot behind `/estate/{slug}` is ~5.7 MB of source rows. Reading it
 * through a server function (the same two-file boundary every DB-backed reader
 * in this repo uses) keeps it off the public client bundle: the browser only
 * receives the current page of rows. Importing the module directly from a route
 * loader instead put a 5.6 MB chunk in `.output/public`, which is why this file
 * exists and why `market-transactions-snapshot.ts` is marked server-only.
 *
 * Deliberately outside `src/lib/neon` and with no agency queries: these rows are
 * market registrations, never 本行成交, and the two sources keep separate
 * counts. `src/routes/estate.market-transactions.contract.test.mjs` pins that.
 */
export const fetchEstateMarketBlock = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string } & MarketTransactionFilters) => data)
  .handler(async ({ data }): Promise<EstateMarketBlock> => {
    // Imported inside the handler so Vite strips it from the client graph; the
    // snapshot module itself also declares `server-only`, so a future direct
    // import from a client component fails the build instead of shipping 5 MB.
    const { getEstateChartTranscription, getEstateMarketTransactions } =
      await import("@/content/market-transactions-snapshot");
    return {
      market: getEstateMarketTransactions(data.slug, {
        year: data.year ?? null,
        nature: data.nature ?? null,
        phase: data.phase ?? null,
        page: data.page ?? 1,
      }),
      chart: getEstateChartTranscription(data.slug),
    };
  });
