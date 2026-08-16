import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

import {
  createMlsImporter,
  defaultFetchText,
  DEFAULT_SEED_URLS,
} from "../../src/lib/mls/importer.mjs";
import { createNeonMlsDb, createNeonSqlFromEnv } from "../../src/lib/mls/neon-db.mjs";
import { buildMigrationDataset } from "./normalize.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const maxArg = args.find((arg) => arg.startsWith("--max="));
const maxPagesArg = args.find((arg) => arg.startsWith("--max-pages="));
const maxDetails = maxArg ? Number(maxArg.slice("--max=".length)) : 200;
const maxPages = maxPagesArg ? Number(maxPagesArg.slice("--max-pages=".length)) : dryRun ? 2 : 50;
const legacyRunDir = args.find((arg) => !arg.startsWith("--"));

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

function dryRunDb() {
  return {
    listEstateIdsBySlug: async () => new Map(),
    upsertProperties: async (rows) => ({ count: rows.length }),
    deactivateMissing: async () => ({ count: 0 }),
  };
}

async function importLegacyRunDir(runDir) {
  const parsed = JSON.parse(await readFile(`${runDir}/parsed-listings.json`, "utf8"));
  const dataset = buildMigrationDataset(parsed);
  await writeFile(`${runDir}/migration-dataset.json`, `${JSON.stringify(dataset, null, 2)}\n`);

  const db = dryRun ? dryRunDb() : createNeonMlsDb(createNeonSqlFromEnv());
  const result = await db.upsertProperties(dataset.rows);

  await writeFile(
    `${runDir}/redirect-aliases.json`,
    `${JSON.stringify(dataset.aliases, null, 2)}\n`,
  );
  await writeFile(`${runDir}/import-summary.json`, `${JSON.stringify(dataset.summary, null, 2)}\n`);

  return { imported: result.count, runDir, ...dataset.summary };
}

async function liveSync() {
  const hasNeonEnv = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  const db = dryRun ? dryRunDb() : createNeonMlsDb(createNeonSqlFromEnv());

  if (!hasNeonEnv && !dryRun) {
    throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for Neon MLS sync.");
  }

  const importer = createMlsImporter({
    fetchText: defaultFetchText,
    db,
    now: () => new Date(),
  });

  return importer.sync({
    seedUrls: DEFAULT_SEED_URLS,
    maxDetails,
    maxPages,
    dryRun,
  });
}

const result = legacyRunDir ? await importLegacyRunDir(legacyRunDir) : await liveSync();
console.log(JSON.stringify(result, null, 2));
