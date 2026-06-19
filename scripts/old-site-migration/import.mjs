import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

import { buildMigrationDataset } from "./normalize.mjs";

const runDir = process.argv[2];

if (!runDir) {
  console.error("Usage: npm run migration:import -- artifacts/old-site-migration/RUN_ID");
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const parsed = JSON.parse(await readFile(`${runDir}/parsed-listings.json`, "utf8"));
const dataset = buildMigrationDataset(parsed);

await writeFile(`${runDir}/migration-dataset.json`, `${JSON.stringify(dataset, null, 2)}\n`);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { error } = await supabase
  .from("properties")
  .upsert(dataset.rows, { onConflict: "listing_no" });

if (error) {
  console.error(error);
  process.exit(1);
}

await writeFile(`${runDir}/redirect-aliases.json`, `${JSON.stringify(dataset.aliases, null, 2)}\n`);
await writeFile(`${runDir}/import-summary.json`, `${JSON.stringify(dataset.summary, null, 2)}\n`);

console.log(JSON.stringify({ imported: dataset.rows.length, runDir, ...dataset.summary }, null, 2));
