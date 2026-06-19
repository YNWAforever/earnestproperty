import { mkdir, readFile, writeFile } from "node:fs/promises";

import { buildMigrationDataset } from "./normalize.mjs";

const runDir = process.argv[2];
const allowParsedPreview = process.argv.includes("--from-parsed");

if (!runDir) {
  console.error("Usage: npm run migration:redirects -- artifacts/old-site-migration/RUN_ID");
  process.exit(1);
}

async function readAliases() {
  try {
    return JSON.parse(await readFile(`${runDir}/redirect-aliases.json`, "utf8"));
  } catch (error) {
    if (!allowParsedPreview || error.code !== "ENOENT") throw error;

    const parsed = JSON.parse(await readFile(`${runDir}/parsed-listings.json`, "utf8"));
    return buildMigrationDataset(parsed).aliases;
  }
}

const aliases = await readAliases();
const redirects = aliases
  .filter((alias) => alias.legacyDetailId && alias.listingNo)
  .map((alias) => {
    const destination = `/property/${encodeURIComponent(alias.listingNo)}`;

    return {
      source: `/property-detail/${alias.legacyDetailId}.html`,
      destination,
      permanent: true,
    };
  });

if (redirects.length > 2048) {
  console.error(`Generated ${redirects.length} redirects, exceeding Vercel's 2048 redirect limit.`);
  process.exit(1);
}

await mkdir("src/generated", { recursive: true });
await writeFile("src/generated/old-site-redirects.json", `${JSON.stringify(redirects, null, 2)}\n`);

console.log(
  JSON.stringify(
    { redirects: redirects.length, source: allowParsedPreview ? "parsed" : "imported" },
    null,
    2,
  ),
);
