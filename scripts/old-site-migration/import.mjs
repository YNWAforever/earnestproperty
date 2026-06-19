import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

import { normalizeListing } from "./normalize.mjs";

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
const rows = parsed.map(normalizeListing);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { error } = await supabase
  .from("properties")
  .upsert(rows, { onConflict: "legacy_detail_id" });

if (error) {
  console.error(error);
  process.exit(1);
}

console.log(JSON.stringify({ imported: rows.length, runDir }, null, 2));
