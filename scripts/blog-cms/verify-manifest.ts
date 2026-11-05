/** Read-only pre-import freshness gate. PASS is not deployment authorization. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildImportPlan, fingerprint } from "../../src/lib/blog/reconcile";
import type { Inventory, ImportPlan } from "../../src/lib/blog/reconcile";
import { inventoryFromSnapshots } from "../../src/lib/blog/import-snapshots";
import type { SourceBundle } from "../../src/lib/blog/import-snapshots";
import { snapshotDatabase, verifyImportTarget } from "../../src/lib/neon/blog-import";

type Binding = { fingerprint: string; targetIdentity: string; sourceRevision: string };
export function verifyManifest(plan: ImportPlan, fresh: Inventory, approved: Binding) {
  const reject = (reason: string): never => {
    throw new Error("MANIFEST_" + reason);
  };
  if (fingerprint(buildImportPlan(plan.inventory)) !== fingerprint(plan)) reject("TAMPERED");
  if (!approved.fingerprint || approved.fingerprint !== plan.fingerprint) reject("APPROVAL");
  for (const inv of [plan.inventory, fresh]) {
    if (
      !approved.targetIdentity ||
      inv.targetIdentity !== approved.targetIdentity ||
      inv.database?.targetIdentity !== approved.targetIdentity
    )
      reject("TARGET");
    if (!approved.sourceRevision || inv.sourceRevision !== approved.sourceRevision)
      reject("REVISION");
    if (!inv.sourceDigest || !inv.publicUrls || !inv.database) reject("MISSING_SOURCES");
    const { targetIdentity, systemIdentifier, tables } = inv.database;
    if (
      !systemIdentifier ||
      fingerprint({ targetIdentity, systemIdentifier, tables }) !== inv.database.fingerprint
    )
      reject("DATABASE_DIGEST");
    for (const table of [
      "articles",
      "cms_content_revisions",
      "blog_categories",
      "blog_settings",
      "blog_featured_articles",
      "blog_legacy_category_map",
      "app_migrations",
    ])
      if (!Array.isArray(tables[table])) reject("MISSING_SOURCES");
  }
  const observed = buildImportPlan(fresh);
  if (
    plan.conflicts.length ||
    plan.unresolved.length ||
    observed.conflicts.length ||
    observed.unresolved.length
  )
    reject("UNRESOLVED");
  // Never replace the approved fingerprint with the newly observed one.
  if (observed.fingerprint !== approved.fingerprint) reject("STALE");
  return {
    gate: "pre-import-freshness" as const,
    verified: true,
    activationAuthorized: false,
    fingerprint: approved.fingerprint,
    targetIdentity: approved.targetIdentity,
    sourceRevision: approved.sourceRevision,
    systemIdentifier: fresh.database!.systemIdentifier,
  };
}

export async function runVerifyManifest(values: string[]) {
  const options = new Map<string, string>();
  const allowed = [
    "--manifest",
    "--sources",
    "--container",
    "--target",
    "--revision",
    "--fingerprint",
  ];
  for (let i = 0; i < values.length; i += 2) {
    const [key, value] = values.slice(i, i + 2);
    if (!allowed.includes(key) || options.has(key) || !value || value.startsWith("--"))
      throw new Error("MANIFEST_ARGUMENTS");
    options.set(key, value);
  }
  const get = (key: string) => {
    const value = options.get(key);
    if (!value) throw new Error("MANIFEST_ARGUMENTS");
    return value;
  };
  const plan = JSON.parse(readFileSync(get("--manifest"), "utf8")) as ImportPlan;
  const bundle = JSON.parse(readFileSync(get("--sources"), "utf8")) as SourceBundle;
  const binding = {
    fingerprint: get("--fingerprint"),
    targetIdentity: get("--target"),
    sourceRevision: get("--revision"),
  };
  // Reject static drift before connecting. Only the owned-Docker adapter can be constructed.
  verifyManifest(plan, plan.inventory, binding);
  if (
    fingerprint(bundle) !== plan.inventory.sourceDigest ||
    bundle.sourceRevision !== binding.sourceRevision
  )
    throw new Error("MANIFEST_SOURCE_CHANGED");
  const target = await verifyImportTarget({
    containerId: get("--container"),
    targetIdentity: binding.targetIdentity,
  });
  try {
    const fresh = inventoryFromSnapshots(bundle, target.identity, await snapshotDatabase(target));
    return verifyManifest(plan, fresh, binding);
  } finally {
    await target.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await runVerifyManifest(process.argv.slice(2))));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error(/^(MANIFEST|IMPORT)_[A-Z0-9_:-]+$/.test(message) ? message : "MANIFEST_FAILED");
    process.exitCode = 1;
  }
}
