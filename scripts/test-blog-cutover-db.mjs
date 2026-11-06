// Read-only freshness adapter against a newly owned DB, including actual CLI exit codes.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { withOwnedPostgres } from "./acceptance/owned-postgres-test.mjs";
const { refuseExternalTargets } = await import("./blog-cms/acceptance-scenario.mjs");
const { verifyImportTarget, snapshotDatabase } = await import("../src/lib/neon/blog-import.ts");
const { inventoryFromSnapshots } = await import("../src/lib/blog/import-snapshots.ts");
const { buildImportPlan } = await import("../src/lib/blog/reconcile.ts");
const { blogArticles } = await import("../src/content/blog-articles.ts");
refuseExternalTargets();
await withOwnedPostgres(async ({ containerId, query }) => {
  const targetIdentity = "owned:" + containerId + ":postgres";
  const reader = await verifyImportTarget({ containerId, targetIdentity });
  const dir = ".private-sync-evidence/blog-import/task9-verifier-" + containerId;
  mkdirSync(dir, { recursive: true });
  const write = (name, value) => {
    const path = dir + "/" + name + ".json";
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
    return path;
  };
  try {
    const base = "docs/superpowers/evidence/blog-cms/";
    const bundle = {
      sourceRevision: "owned-task9-source-v1",
      registry: blogArticles,
      sitemap: JSON.parse(readFileSync(base + "public-sitemap-snapshot.json", "utf8")),
      presentation: JSON.parse(
        readFileSync(base + "public-blog-presentation-snapshot.json", "utf8"),
      ),
    };
    const sourcePath = write("sources", bundle);
    const before = await snapshotDatabase(reader);
    const plan = buildImportPlan(inventoryFromSnapshots(bundle, targetIdentity, before));
    assert.deepEqual(plan.unresolved, []);
    assert.deepEqual(plan.conflicts, []);
    const manifestPath = write("manifest", plan);
    const run = (extra = {}) => {
      const options = {
        "--manifest": manifestPath,
        "--sources": sourcePath,
        "--container": containerId,
        "--target": targetIdentity,
        "--revision": bundle.sourceRevision,
        "--fingerprint": plan.fingerprint,
        ...extra,
      };
      return spawnSync(
        "bun",
        [
          "run",
          "--no-env-file",
          "scripts/blog-cms/verify-manifest.ts",
          ...Object.entries(options).flat(),
        ],
        { encoding: "utf8", timeout: 60000, windowsHide: true },
      );
    };
    const good = run();
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).verified, true);
    assert.equal(JSON.parse(good.stdout).activationAuthorized, false);
    assert.equal(good.stderr.trim(), "");
    assert.deepEqual(await snapshotDatabase(reader), before);
    for (const [name, extra] of [
      ["target", { "--target": "wrong" }],
      ["revision", { "--revision": "wrong" }],
      ["approval", { "--fingerprint": "wrong" }],
      [
        "publicURLs",
        {
          "--sources": write("added-url", {
            ...bundle,
            sitemap: {
              ...bundle.sitemap,
              urls: [...bundle.sitemap.urls, "https://www.earnestproperty.com/blog/added"],
            },
          }),
        },
      ],
      ["missingSources", { "--sources": write("missing-source", { ...bundle, registry: [] }) }],
    ]) {
      const r = run(extra);
      assert.equal(r.status, 1, name + ": " + r.stderr);
      assert.match(r.stderr, /MANIFEST_(TARGET|REVISION|APPROVAL|SOURCE_CHANGED)/);
      assert.equal(r.stdout.trim(), "");
      console.log("PASS actual verify-manifest CLI rejection " + name + ": exit 1");
    }
    assert.deepEqual(await snapshotDatabase(reader), before);
    await query("UPDATE blog_settings SET version=version+1");
    const changed = await snapshotDatabase(reader);
    const stale = run();
    assert.equal(stale.status, 1, stale.stderr);
    assert.match(stale.stderr, /MANIFEST_STALE/);
    assert.deepEqual(await snapshotDatabase(reader), changed, "changed DB rejection is read-only");
    assert.equal((await query("SELECT count(*)::int n FROM blog_import_receipts"))[0].n, 0);
    console.log(
      "PASS actual verify-manifest changed database version rejection: exit 1; no imports/writes",
    );
    console.log(
      "VERIFIER_RECEIPT " +
        JSON.stringify({
          ...JSON.parse(good.stdout),
          sourceRecords: 112,
          publicUrls: 113,
          ownedReadOnly: true,
          snapshotsRetained: dir,
        }),
    );
  } finally {
    await reader.close();
  }
});
