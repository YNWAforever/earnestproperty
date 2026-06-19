import { mkdir, readFile, writeFile } from "node:fs/promises";

const runDir = process.argv[2];

if (!runDir) {
  console.error("Usage: npm run migration:redirects -- artifacts/old-site-migration/RUN_ID");
  process.exit(1);
}

const parsed = JSON.parse(await readFile(`${runDir}/parsed-listings.json`, "utf8"));
const redirects = parsed
  .filter(
    (listing) => listing.legacyDetailId && (listing.legacyPropertyNo || listing.legacyDetailId),
  )
  .map((listing) => {
    const listingNo = listing.legacyPropertyNo || `OLD-${listing.legacyDetailId}`;
    const destination = `/property/${encodeURIComponent(listingNo)}`;

    return {
      source: `/property-detail/${listing.legacyDetailId}.html`,
      destination,
      permanent: true,
    };
  });

await mkdir("src/generated", { recursive: true });
await writeFile("src/generated/old-site-redirects.json", `${JSON.stringify(redirects, null, 2)}\n`);

console.log(JSON.stringify({ redirects: redirects.length }, null, 2));
