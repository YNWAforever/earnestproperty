import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { buildImportPlan, sanitizedSummary, fingerprint } from "../../src/lib/blog/reconcile";
import type { Inventory, ImportPlan } from "../../src/lib/blog/reconcile";
import { inventoryFromSnapshots } from "../../src/lib/blog/import-snapshots";
import type { SourceBundle } from "../../src/lib/blog/import-snapshots";
import {
  verifyImportTarget,
  snapshotDatabase,
  applyImport,
  verifyImport,
} from "../../src/lib/neon/blog-import";

function args(values: string[], allowed: string[]) {
  const result = new Map<string, string>();
  for (let i = 0; i < values.length; i++) {
    const key = values[i];
    if (!allowed.includes(key) || result.has(key)) throw new Error("IMPORT_ARGUMENTS");
    if (["--apply", "--verify"].includes(key)) result.set(key, "true");
    else {
      const value = values[++i];
      if (!value || value.startsWith("--")) throw new Error("IMPORT_ARGUMENTS");
      result.set(key, value);
    }
  }
  return result;
}
const required = (a: Map<string, string>, key: string) => {
  const v = a.get(key);
  if (!v) throw new Error("IMPORT_REQUIRED_" + key.slice(2));
  return v;
};
function read<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
function privateWrite(path: string, value: unknown) {
  const root = resolve(".private-sync-evidence/blog-import"),
    file = resolve(path),
    rel = relative(root, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw new Error("IMPORT_PRIVATE_OUTPUT_PATH");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
export async function runCli(mode: "inventory" | "reconcile" | "import", values: string[]) {
  if (mode === "inventory") {
    const a = args(values, [
      "--sources",
      "--target",
      "--database",
      "--container",
      "--output",
      "--backup-output",
    ]);
    if (a.has("--database") && a.has("--container")) throw new Error("IMPORT_ARGUMENTS");
    const sources = read<SourceBundle>(required(a, "--sources")),
      identity = required(a, "--target");
    let database = a.has("--database")
      ? read<Inventory["database"]>(a.get("--database")!)
      : undefined;
    if (a.has("--container")) {
      const target = await verifyImportTarget({
        containerId: a.get("--container")!,
        targetIdentity: identity,
      });
      try {
        database = await snapshotDatabase(target);
        privateWrite(required(a, "--backup-output"), database);
      } finally {
        await target.close();
      }
    }
    const inventory = inventoryFromSnapshots(sources, identity, database);
    privateWrite(required(a, "--output"), inventory);
    return sanitizedSummary(buildImportPlan(inventory));
  }
  if (mode === "reconcile") {
    const a = args(values, ["--inventory", "--output"]);
    const plan = buildImportPlan(read<Inventory>(required(a, "--inventory")));
    if (a.has("--output")) privateWrite(a.get("--output")!, plan);
    return sanitizedSummary(plan);
  }
  const a = args(values, [
    "--manifest",
    "--apply",
    "--verify",
    "--container",
    "--target",
    "--fingerprint",
    "--backup",
    "--backup-sha256",
    "--sources",
  ]);
  const plan = read<ImportPlan>(required(a, "--manifest")),
    rebuilt = buildImportPlan(plan.inventory);
  if (fingerprint(rebuilt) !== fingerprint(plan)) throw new Error("IMPORT_MANIFEST");
  if (!a.has("--apply") && !a.has("--verify")) return sanitizedSummary(plan);
  if (a.has("--apply") && a.has("--verify")) throw new Error("IMPORT_ARGUMENTS");
  if (required(a, "--fingerprint") !== plan.fingerprint) throw new Error("IMPORT_APPROVAL");
  const bundle = read<SourceBundle>(required(a, "--sources"));
  if (
    fingerprint(bundle) !== plan.inventory.sourceDigest ||
    bundle.sourceRevision !== plan.inventory.sourceRevision
  )
    throw new Error("IMPORT_SOURCE_CHANGED");
  const target = await verifyImportTarget({
    containerId: required(a, "--container"),
    targetIdentity: required(a, "--target"),
    ...(a.has("--apply")
      ? {
          authorization: {
            planFingerprint: plan.fingerprint,
            backupPath: required(a, "--backup"),
            backupSha256: required(a, "--backup-sha256"),
          },
        }
      : {}),
  });
  try {
    return a.has("--apply") ? await applyImport(plan, target) : await verifyImport(plan, target);
  } finally {
    await target.close();
  }
}
export async function entry(mode: "inventory" | "reconcile" | "import") {
  try {
    const result = await runCli(mode, process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if ("verification" in result && result.verification === "changed") process.exitCode = 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error(/^IMPORT_[A-Z0-9_:-]+$/.test(message) ? message : "IMPORT_FAILED");
    process.exitCode = 1;
  }
}
