import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { withOwnedPostgres } from "../acceptance/owned-postgres-test.mjs";
import { PINNED_POSTGRES_18 } from "../../src/lib/neon/owned-postgres-images.ts";
import { MIGRATION_VERSIONS } from "../../src/lib/control-plane/migration-versions.js";
import { syntheticReleaseSource } from "./synthetic-release-source.mjs";

const { verifyImportTarget, applyOwnedBlogRelease, snapshotOwnedBlogRelease } =
  await import("../../src/lib/neon/blog-import.ts");
const { sha256 } = await import("./production-adapter.ts");
const { releaseArtifacts, releaseMigrations } =
  await import("../../src/lib/neon/blog-release-packet.ts");

// The release is a historical 95 -> 98 replay. Both owned instances must be built from
// the migrations that existed at release time, not from the live manifest: a migration
// added later (e.g. one replacing a guard function) would otherwise change the sealed
// schema of the "after" reference and make the replay fail for the wrong reason.
const releaseStart = MIGRATION_VERSIONS.indexOf(releaseMigrations[0]);
const baselineMigrationVersions = MIGRATION_VERSIONS.slice(0, releaseStart);

const urlKeys = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "TEST_DATABASE_URL",
  "CMS_TEST_DATABASE_URL",
  "ASTRA_TEST_DATABASE_URL",
];
for (const key of urlKeys) assert.ok(!process.env[key], "Refuses " + key);
assert.ok(
  process.argv.length === 2 ||
    (process.argv.length === 3 && process.argv[2] === "--captured-source"),
  "Unknown owned release option",
);
const capturedSource = process.argv[2] === "--captured-source";
const source = capturedSource
  ? readFileSync(
      new URL(
        "../../.private-sync-evidence/blog-import/public-source-2026-11-05T11-54-46-574Z/normalized-main-navigation/source-bundle.json",
        import.meta.url,
      ),
    )
  : syntheticReleaseSource();
if (capturedSource)
  assert.equal(sha256(source), "60f95f002b0b0f1da1ad4145b7a8d02f14ab19066e9bd3a18bd9b3563a71427e");
console.log(
  capturedSource
    ? "SOURCE captured private rehearsal"
    : "SOURCE synthetic CI fixture; not live content evidence",
);
const bundle = JSON.parse(source);

// Schema reviewed independently of the release executor on a separate owned instance.
let migratedSchema;
const ownedIds = [];
const writerRole = "release_fixture_writer";
async function seedWriter(query) {
  await query("CREATE ROLE release_fixture_writer NOLOGIN");
  await query("GRANT INSERT, UPDATE ON articles TO release_fixture_writer");
}
await withOwnedPostgres(
  async ({ containerId, query }) => {
    ownedIds.push(containerId);
    await seedWriter(query);
    const target = await verifyImportTarget({
      containerId,
      targetIdentity: `owned:${containerId}:postgres`,
    });
    try {
      const reference = await snapshotOwnedBlogRelease(target, "migrated");
      migratedSchema = reference.schemaSha256;
    } finally {
      await target.close();
    }
  },
  {
    image: PINNED_POSTGRES_18,
    migrationVersions: [...baselineMigrationVersions, ...releaseMigrations],
  },
);

await withOwnedPostgres(
  async ({ containerId, pool, query }) => {
    ownedIds.push(containerId);
    await seedWriter(query);
    const target = await verifyImportTarget({
      containerId,
      targetIdentity: `owned:${containerId}:postgres`,
    });
    try {
      const serverVersion = (await query("SHOW server_version"))[0].server_version;
      assert.match(serverVersion, /^18\.6(?:\s|$)/);
      const baseline = await snapshotOwnedBlogRelease(target, "baseline");
      const packet = {
        format: "earnest-blog-release-v1",
        targetIdentity: target.identity,
        systemIdentifier: target.systemIdentifier,
        baselineSha256: baseline.snapshot.fingerprint,
        baselineSchemaSha256: baseline.schemaSha256,
        migratedSchemaSha256: migratedSchema,
        sourceSha256: sha256(source),
        ...releaseArtifacts(),
      };
      const effects = () =>
        query(`SELECT
      (SELECT count(*)::int FROM ai_knowledge_repair_requests WHERE source_type='article') requests,
      (SELECT count(*)::int FROM ops_jobs WHERE job_type='ai.knowledge.repair') jobs`);
      const baselineEffects = await effects();
      function run(edit = {}, payload = source, digest) {
        const bytes = Buffer.from(JSON.stringify({ ...packet, ...edit }));
        return applyOwnedBlogRelease(target, bytes, digest ?? sha256(bytes), payload);
      }
      async function unchanged() {
        assert.deepEqual(await snapshotOwnedBlogRelease(target, "baseline"), baseline);
        assert.deepEqual(
          (await query("SELECT to_regclass('public.blog_import_receipts') receipt"))[0],
          { receipt: null },
        );
        assert.deepEqual(await effects(), baselineEffects);
      }
      await assert.rejects(run({}, source, "0".repeat(64)), /RELEASE_PACKET/);
      await assert.rejects(run({ targetIdentity: "production:forged" }), /RELEASE_TARGET/);
      await assert.rejects(run({}, Buffer.concat([source, Buffer.from(" ")])), /RELEASE_SOURCE/);
      await assert.rejects(
        run({ migrationSha256: releaseMigrations.map(() => "0".repeat(64)) }),
        /RELEASE_MIGRATIONS/,
      );
      await assert.rejects(run({ implementationSha256: "0".repeat(64) }), /RELEASE_IMPLEMENTATION/);
      await assert.rejects(run({ baselineSha256: "0".repeat(64) }), /RELEASE_STALE/);
      await assert.rejects(run({ baselineSchemaSha256: "0".repeat(64) }), /RELEASE_SCHEMA/);
      await unchanged();
      console.log("PASS packet, source, target, implementation, migration and baseline seals");

      // PL/pgSQL string bodies do not record this call in pg_depend. The
      // articles trigger and its immediate function stay byte-identical.
      const helper = (
        await query(
          "SELECT pg_get_functiondef('ep_queue_knowledge_repair(ai_knowledge_source_type,text)'::regprocedure) definition",
        )
      )[0].definition;
      await query(helper.replace("BEGIN", "BEGIN\n  NULL; -- fixture drift"));
      try {
        await assert.rejects(run(), /RELEASE_SCHEMA/);
        assert.equal(
          Number((await query("SELECT count(*) n FROM app_migrations"))[0].n),
          baselineMigrationVersions.length,
        );
        assert.deepEqual(await effects(), baselineEffects);
      } finally {
        await query(helper);
      }
      await unchanged();
      console.log("PASS changed transitive trigger helper rejected before mutation");

      const writer = await pool.connect();
      try {
        await writer.query("BEGIN");
        await writer.query("SET LOCAL ROLE " + writerRole);
        await writer.query("LOCK TABLE articles IN ROW EXCLUSIVE MODE");
        await assert.rejects(run(), { code: "55P03" });
      } finally {
        await writer.query("ROLLBACK");
        writer.release();
      }
      await unchanged();
      console.log("PASS concurrent writer timed out with no partial changes");

      await query("INSERT INTO app_migrations(version) VALUES('unreviewed.sql')");
      await assert.rejects(run(), /RELEASE_LEDGER/);
      await query("DELETE FROM app_migrations WHERE version='unreviewed.sql'");
      await unchanged();
      await assert.rejects(
        run({ migratedSchemaSha256: "0".repeat(64) }),
        /RELEASE_MIGRATED_SCHEMA/,
      );
      await unchanged();
      // A real post-DDL import failure, from internally valid but unsupported source.
      const truncated = Buffer.from(
        JSON.stringify({ ...bundle, registry: bundle.registry.slice(1) }),
      );
      const originalQuery = pg.Client.prototype.query;
      async function withTransportFault(fault, action) {
        pg.Client.prototype.query = function (sql, ...params) {
          return fault.call(this, originalQuery, sql, params);
        };
        try {
          return await action();
        } finally {
          pg.Client.prototype.query = originalQuery;
        }
      }
      await assert.rejects(
        run({ sourceSha256: sha256(truncated) }, truncated),
        /RELEASE_SOURCE_COUNT/,
      );
      await unchanged();
      await withTransportFault(
        function (original, sql, params) {
          if (typeof sql === "string" && sql.startsWith("INSERT INTO blog_import_receipts"))
            return original.call(this, "SELECT 1/0");
          return original.call(this, sql, ...params);
        },
        () => assert.rejects(run(), { code: "22012" }),
      );
      await unchanged();
      console.log("PASS post-DDL failure rolls back schema, ledger and content");

      // Driver test fault only: the real server commits, but the caller sees failure.
      await withTransportFault(
        async function (original, sql, params) {
          const result = await original.call(this, sql, ...params);
          if (sql === "COMMIT") throw new Error("fixture: commit response lost");
          return result;
        },
        () => assert.rejects(run(), /fixture: commit response lost/),
      );
      const retry = await run();
      assert.equal(retry.writes, 0);
      assert.equal(retry.verification, "unchanged");
      assert.equal(retry.inserted.length, 112);
      assert.deepEqual(retry.migrations, releaseMigrations);
      await assert.rejects(run({ baselineSha256: "1".repeat(64) }), /RELEASE_NO_MATCHING_RECEIPT/);
      const counts = (
        await query(`SELECT
      (SELECT count(*)::int FROM app_migrations) ledger,
      (SELECT count(*)::int FROM blog_categories) categories,
      (SELECT count(*)::int FROM blog_settings) scopes,
      (SELECT count(*)::int FROM blog_import_receipts) receipts,
      (SELECT count(*)::int FROM articles WHERE published_at IS NULL) undated`)
      )[0];
      assert.deepEqual(counts, { ledger: 98, categories: 7, scopes: 8, receipts: 1, undated: 2 });
      const slugs = await query(`SELECT a.slug FROM articles a JOIN cms_content_revisions r
      ON r.resource_id=a.id AND r.resource_type='article' AND r.state='published'
      AND r.version_number=1 AND r.payload->>'slug'=a.slug AND r.payload->>'content'=a.content
      WHERE a.slug_locked`);
      assert.deepEqual(
        slugs.map(({ slug }) => slug).sort(),
        bundle.registry.map(({ slug }) => slug).sort(),
      );
      assert.deepEqual(
        slugs.map(({ slug }) => `/blog/${slug}`).sort(),
        bundle.sitemap.urls
          .map((url) => new URL(url).pathname)
          .filter((url) => url !== "/blog/editorial-standards")
          .sort(),
      );
      console.log("PASS atomic 95->98 and 112 matching live/revision URLs, null dates and retry");

      const { id } = retry.inserted[0];
      const actor = randomUUID();
      await query("INSERT INTO staff_users(id,active) VALUES($1,true)", [actor]);
      await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'agent')", [actor]);
      await query(
        `INSERT INTO cms_content_revisions(resource_type,resource_id,version_number,state,payload,created_by,base_published_version)
      SELECT 'article',resource_id,2,'draft',payload || '{"title":"New private draft"}',$2,1
      FROM cms_content_revisions WHERE resource_type='article' AND resource_id=$1`,
        [id, actor],
      );
      await query("UPDATE articles SET title='New editorial title',published=false WHERE id=$1", [
        id,
      ]);
      const edited = await snapshotOwnedBlogRelease(target, "migrated");
      const drift = await run();
      assert.equal(drift.verification, "changed");
      assert.equal(drift.writes, 0);
      assert.deepEqual(await snapshotOwnedBlogRelease(target, "migrated"), edited);
      console.log("PASS matching retry preserves newer editorial work without writes");
      console.log(
        "REHEARSAL " +
          JSON.stringify({
            serverVersion,
            targetIdentity: target.identity,
            baselineSchemaSha256: baseline.schemaSha256,
            migratedSchemaSha256: migratedSchema,
            packetSha256: retry.packetSha256,
            migrationFingerprint: retry.migrationFingerprint,
            afterFingerprint: retry.afterFingerprint,
            ...releaseArtifacts(),
          }),
      );
    } finally {
      await target.close();
    }
  },
  { image: PINNED_POSTGRES_18, migrationVersions: baselineMigrationVersions },
);

for (const id of ownedIds) {
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal(
    execFileSync("docker", ["ps", "-a", "--filter", "id=" + id, "--format", "{{.ID}}"], {
      encoding: "utf8",
      timeout: 15000,
    }).trim(),
    "",
  );
}
console.log("PASS exact owned-container cleanup " + ownedIds.join(" "));
