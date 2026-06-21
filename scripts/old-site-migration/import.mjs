import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

import {
  createMlsImporter,
  createSupabaseMlsDb,
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

function createSupabaseClientFromEnv() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function importLegacyRunDir(runDir) {
  const parsed = JSON.parse(await readFile(`${runDir}/parsed-listings.json`, "utf8"));
  const dataset = buildMigrationDataset(parsed);

  await writeFile(`${runDir}/migration-dataset.json`, `${JSON.stringify(dataset, null, 2)}\n`);

  const supabase = createSupabaseClientFromEnv();
  const { error } = await supabase
    .from("properties")
    .upsert(dataset.rows, { onConflict: "listing_no" });

  if (error) throw error;

  await writeFile(
    `${runDir}/redirect-aliases.json`,
    `${JSON.stringify(dataset.aliases, null, 2)}\n`,
  );
  await writeFile(`${runDir}/import-summary.json`, `${JSON.stringify(dataset.summary, null, 2)}\n`);

  return { imported: dataset.rows.length, runDir, ...dataset.summary };
}

function dryRunDb() {
  return {
    listEstateIdsBySlug: async () => new Map(),
    upsertProperties: async (rows) => ({ count: rows.length }),
    deactivateMissing: async () => ({ count: 0 }),
  };
}

async function liveSync() {
  const hasSupabaseEnv = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasNeonEnv = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  const target = process.env.MLS_DB ?? (hasNeonEnv ? "neon" : "supabase");
  const db =
    target === "neon" && hasNeonEnv
      ? createNeonMlsDb(createNeonSqlFromEnv())
      : hasSupabaseEnv
        ? createSupabaseMlsDb(createSupabaseClientFromEnv())
        : dryRunDb();

  if (target === "neon" && !hasNeonEnv && !dryRun) {
    throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for Neon MLS sync.");
  }

  if (target !== "neon" && !hasSupabaseEnv && !dryRun) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for non-dry-run sync.",
    );
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
