import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { discoverAllSources, INDEX_SOURCES } from "./discover.mjs";
import { parseLegacyDetail } from "./parse.mjs";

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "EarnestPropertyMigrationBot/1.0" },
  });

  if (!response.ok) throw new Error(`Fetch failed ${response.status} ${url}`);
  return response.text();
}

function summarize(records, failures) {
  return {
    indexSources: INDEX_SOURCES.length,
    uniqueDetailUrls: records.length + failures.length,
    parsedListings: records.length,
    failedParses: failures.length,
    missingOptionalFields: {
      saleableArea: records.filter((record) => !record.saleableArea).length,
      grossArea: records.filter((record) => !record.grossArea).length,
      images: records.filter((record) => !record.images?.length).length,
      whatsappPhone: records.filter((record) => !record.whatsappPhone).length,
    },
  };
}

const runId = process.env.MIGRATION_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = join("artifacts", "old-site-migration", runId);
const maxPages = Number(process.env.MIGRATION_MAX_PAGES ?? 200);
const delayMs = Number(process.env.MIGRATION_DELAY_MS ?? 250);

await mkdir(outputDir, { recursive: true });

const discovered = await discoverAllSources({ maxPages, delayMs });
const parsed = [];
const failures = [];

for (const record of discovered) {
  try {
    const html = await fetchText(record.detailUrl);
    const listing = parseLegacyDetail(html, record.detailUrl);
    parsed.push({ ...listing, legacySourceIndexes: record.sourceIndexes });
    await writeFile(join(outputDir, `${listing.legacyDetailId}.html`), html);
  } catch (error) {
    failures.push({ detailUrl: record.detailUrl, message: error.message });
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

await writeFile(
  join(outputDir, "discovered-detail-urls.json"),
  JSON.stringify(discovered, null, 2),
);
await writeFile(join(outputDir, "parsed-listings.json"), JSON.stringify(parsed, null, 2));
await writeFile(join(outputDir, "failed-parses.json"), JSON.stringify(failures, null, 2));
await writeFile(
  join(outputDir, "summary.json"),
  JSON.stringify(summarize(parsed, failures), null, 2),
);

console.log(JSON.stringify({ runId, outputDir, ...summarize(parsed, failures) }, null, 2));
