/** Internal migration/import/receipt sequence on an already pinned transaction. */
import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";
import { buildImportPlan, canonical, fingerprint } from "../blog/reconcile";
import type { DatabaseSnapshot } from "../blog/reconcile";
import { inventoryFromSnapshots } from "../blog/import-snapshots";
import {
  assertPlan,
  blogSnapshotTables,
  captureBlogSnapshot,
  mutateBlogImport,
  storeBlogReceipt,
} from "./blog-import-transaction";
import type { BlogSnapshotIdentity, BlogSqlSession } from "./blog-import-transaction";
import { releaseMigrations } from "./blog-release-packet";
import type { ReleaseInputs } from "./blog-release-packet";

const baselineTables = Object.freeze({
  articles: "id",
  cms_content_revisions: "id",
  app_migrations: "version",
});
const migratedTables = Object.freeze({
  ...blogSnapshotTables,
  blog_mutation_requests: "request_id",
});
const newTables = Object.freeze([
  "blog_categories",
  "blog_settings",
  "blog_featured_articles",
  "blog_legacy_category_map",
  "blog_mutation_requests",
  "blog_import_receipts",
]);
const schemaTables = [
  ...Object.keys(baselineTables),
  ...newTables,
  "staff_users",
  "staff_roles",
  "audit_logs",
];
const baselineVersions = MIGRATION_VERSIONS.filter(
  (version) => !releaseMigrations.some((name) => name === version),
);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

// Fingerprint definitions and security attributes, with stable names rather than cluster OIDs.
// Relations are scoped to the release. Opaque function bodies may call helpers
// across schemas, so their fallback deliberately seals more routine definitions.
async function releaseSchema(client: BlogSqlSession) {
  const rows = (
    await client.query(
      `WITH RECURSIVE relations AS (
        SELECT c.* FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY($1::text[])
      ), routine_roots AS (
        SELECT t.tgfoid AS oid FROM pg_trigger t JOIN relations c ON c.oid=t.tgrelid
        UNION
        SELECT d.refobjid FROM pg_depend d WHERE d.refclassid='pg_proc'::regclass AND (
          (d.classid='pg_attrdef'::regclass AND d.objid IN (
            SELECT a.oid FROM pg_attrdef a JOIN relations c ON c.oid=a.adrelid))
          OR (d.classid='pg_constraint'::regclass AND d.objid IN (
            SELECT x.oid FROM pg_constraint x JOIN relations c ON c.oid=x.conrelid))
          OR (d.classid='pg_class'::regclass AND d.objid IN (
            SELECT i.indexrelid FROM pg_index i JOIN relations c ON c.oid=i.indrelid))
          OR (d.classid='pg_policy'::regclass AND d.objid IN (
            SELECT p.oid FROM pg_policy p JOIN relations c ON c.oid=p.polrelid))
        )
      ), routine_dependencies(oid) AS (
        SELECT oid FROM routine_roots
        UNION
        SELECT d.refobjid FROM routine_dependencies r JOIN pg_depend d ON d.objid=r.oid
        WHERE d.classid='pg_proc'::regclass AND d.refclassid='pg_proc'::regclass
      ), routine_scope AS (
        SELECT oid FROM routine_dependencies
        UNION
        -- PostgreSQL does not record function calls in PL/pgSQL or string SQL
        -- bodies. Such a body can also use dynamic SQL or change search_path.
        -- Seal every non-bootstrap routine (FirstNormalObjectId = 16384) for
        -- that opaque case; a name parser would miss valid runtime dispatch.
        SELECT p.oid FROM pg_proc p WHERE p.oid>=16384 AND EXISTS (
          SELECT 1 FROM routine_dependencies d JOIN pg_proc r ON r.oid=d.oid
          WHERE r.oid>=16384 AND r.prosqlbody IS NULL
        )
      )
      SELECT jsonb_build_object(
        'name', c.relname, 'kind', c.relkind, 'owner', pg_get_userbyid(c.relowner),
        'persistence', c.relpersistence, 'options', c.reloptions, 'acl', c.relacl,
        'row_security', c.relrowsecurity, 'force_row_security', c.relforcerowsecurity,
        'columns', (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),
          a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),a.attacl,
          CASE WHEN coll.oid IS NULL THEN NULL ELSE nc.nspname||'.'||coll.collname END) ORDER BY a.attnum)
          FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
          LEFT JOIN pg_collation coll ON coll.oid=a.attcollation LEFT JOIN pg_namespace nc ON nc.oid=coll.collnamespace
          WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
        'constraints', (SELECT jsonb_agg(jsonb_build_array(x.conname,pg_get_constraintdef(x.oid),x.convalidated) ORDER BY x.conname)
          FROM pg_constraint x WHERE x.conrelid=c.oid),
        'indexes', (SELECT jsonb_agg(jsonb_build_array(pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) ORDER BY ci.relname)
          FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid WHERE i.indrelid=c.oid),
        'triggers', (SELECT jsonb_agg(jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled,pg_get_functiondef(t.tgfoid)) ORDER BY t.tgname)
          FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
        'policies', (SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,
          ARRAY(SELECT CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r)::text END FROM unnest(p.polroles) r ORDER BY 1),
          pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname)
          FROM pg_policy p WHERE p.polrelid=c.oid)
      ) AS definition, c.relname AS name
      FROM relations c
      UNION ALL
      SELECT jsonb_build_object('schema',n.nspname,'routine',p.proname,'kind',p.prokind,
        'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'language',l.lanname,
        'definition',CASE WHEN p.prokind<>'a' THEN pg_get_functiondef(p.oid)
          ELSE jsonb_build_array(a.aggtransfn::regprocedure::text,a.aggfinalfn::regprocedure::text,
            a.aggcombinefn::regprocedure::text,a.aggserialfn::regprocedure::text,
            a.aggdeserialfn::regprocedure::text,a.aggmtransfn::regprocedure::text,
            a.aggminvtransfn::regprocedure::text,a.aggmfinalfn::regprocedure::text,
            a.agginitval,a.aggminitval)::text END),
        'routine:'||format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
      FROM routine_scope r JOIN pg_proc p ON p.oid=r.oid
      JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
      LEFT JOIN pg_aggregate a ON a.aggfnoid=p.oid
      WHERE p.oid>=16384
      ORDER BY name`,
      [schemaTables],
    )
  ).rows;
  return { schemaSha256: fingerprint(rows), relations: new Set(rows.map(({ name }) => name)) };
}

export async function captureBlogRelease(
  client: BlogSqlSession,
  target: BlogSnapshotIdentity,
  phase: "baseline" | "migrated",
) {
  const { schemaSha256 } = await releaseSchema(client);
  const snapshot = await captureBlogSnapshot(
    client,
    target,
    100,
    phase === "baseline" ? baselineTables : migratedTables,
  );
  return { schemaSha256, snapshot };
}

function assertLedger(snapshot: DatabaseSnapshot, versions: readonly string[]) {
  if (
    canonical(snapshot.tables.app_migrations.map((row) => row.version)) !==
    canonical([...versions].sort())
  )
    throw new Error("RELEASE_LEDGER");
}

type Tables = DatabaseSnapshot["tables"];
const categorySymbol = (key: unknown) => "category:" + String(key);
const settingSymbol = (category: unknown) =>
  category === null ? "main" : "setting:" + String(category);
const sorted = (rows: Tables[string], fields: string[]) =>
  [...rows].sort((a, b) => {
    const x = canonical(fields.map((field) => a[field]));
    const y = canonical(fields.map((field) => b[field]));
    return x < y ? -1 : x > y ? 1 : 0;
  });

function expectedMigration(before: DatabaseSnapshot, migrationTime: unknown): Tables {
  const { articles, cms_content_revisions, app_migrations } = before.tables;
  const keys = [...new Set(articles.map((row) => row.category).filter((key) => key !== null))];
  const categories = keys.map((key) => ({
    id: categorySymbol(key),
    key,
    name: key,
    navigation_order: 0,
    hidden: false,
    version: 1,
  }));
  return {
    articles: articles.map((row) => {
      const versions = cms_content_revisions
        .filter(
          (r) => r.resource_id === row.id && (r.state === "published" || r.state === "archived"),
        )
        .map((r) => Number(r.version_number));
      return {
        ...row,
        slug_locked: true,
        category_id: row.category === null ? null : categorySymbol(row.category),
        content_format: "legacy-text",
        cover_alt: null,
        supplemental_links: [],
        version: versions.length ? Math.max(...versions) : 1,
        editorial_metadata: {
          author: null,
          reviewer: null,
          sourcesNote: null,
          answerSummary: null,
          compareEstateSlugs: [],
        },
      };
    }),
    cms_content_revisions,
    app_migrations: sorted(
      [
        ...app_migrations,
        ...releaseMigrations.map((version) => ({ version, applied_at: migrationTime })),
      ],
      ["version"],
    ),
    blog_categories: sorted(categories, ["id"]),
    blog_legacy_category_map: sorted(
      categories.map((c) => ({ legacy_key: c.key, category_id: c.id })),
      ["legacy_key"],
    ),
    blog_settings: sorted(
      [null, ...categories].map((c) => ({
        id: settingSymbol(c?.id ?? null),
        scope_kind: c ? "category" : "main",
        category_id: c?.id ?? null,
        heading: c ? c.key : "樓市資訊",
        introduction: "",
        seo_title: null,
        seo_description: null,
        version: 1,
      })),
      ["id"],
    ),
    blog_featured_articles: [],
    blog_mutation_requests: [],
  };
}

function normalizeMigration(after: DatabaseSnapshot): Tables {
  const t = after.tables;
  const ids = new Map(t.blog_categories.map((row) => [row.id, categorySymbol(row.key)]));
  const category = (id: unknown) => {
    if (id === null) return null;
    if (typeof id !== "string" || !uuid.test(id) || !ids.has(id))
      throw new Error("RELEASE_MIGRATION_DATA");
    return ids.get(id);
  };
  return {
    ...t,
    articles: t.articles.map((row) => ({ ...row, category_id: category(row.category_id) })),
    blog_categories: sorted(
      t.blog_categories.map((row) => ({ ...row, id: category(row.id) })),
      ["id"],
    ),
    blog_legacy_category_map: sorted(
      t.blog_legacy_category_map.map((row) => ({
        ...row,
        category_id: category(row.category_id),
      })),
      ["legacy_key"],
    ),
    blog_settings: sorted(
      t.blog_settings.map((row) => {
        if (typeof row.id !== "string" || !uuid.test(row.id))
          throw new Error("RELEASE_MIGRATION_DATA");
        const categoryId = category(row.category_id);
        return { ...row, category_id: categoryId, id: settingSymbol(categoryId) };
      }),
      ["id"],
    ),
  };
}

type ReleaseReceipt = Awaited<ReturnType<typeof mutateBlogImport>> & {
  format: "earnest-blog-release-receipt-v1";
  packetSha256: string;
  targetIdentity: string;
  systemIdentifier: string;
  planFingerprint: string;
  migrationFingerprint: string;
  migrations: readonly string[];
  afterFingerprint: string;
  afterSchemaSha256: string;
  writes: number;
  verification: "unchanged" | "changed";
};

export async function runBlogRelease(
  client: BlogSqlSession,
  target: BlogSnapshotIdentity,
  inputs: ReleaseInputs,
): Promise<ReleaseReceipt> {
  const { packet, packetSha256, bundle, files } = inputs;
  // Same lock key as blog_lock(), which is absent at 95. Legacy cms_mutate writes
  // revisions before articles. Lock revisions first and avoid an articles DDL lock upgrade.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('blog:mutation',0))");
  await client.query(
    "LOCK TABLE cms_content_revisions, app_migrations IN SHARE ROW EXCLUSIVE MODE",
  );
  await client.query("LOCK TABLE articles IN ACCESS EXCLUSIVE MODE");
  await client.query("LOCK TABLE staff_users, staff_roles, audit_logs IN ACCESS SHARE MODE");
  const beforeSchema = await releaseSchema(client);
  const present = newTables.filter((table) => beforeSchema.relations.has(table));
  if (present.length) {
    await client.query("LOCK TABLE " + present.join(", ") + " IN SHARE ROW EXCLUSIVE MODE");
    if (present.includes("blog_import_receipts")) {
      const { rows } = await client.query(
        "SELECT target_identity,receipt FROM blog_import_receipts WHERE fingerprint=$1",
        [packetSha256],
      );
      if (rows.length) {
        const prior = rows[0].receipt as ReleaseReceipt;
        if (
          rows[0].target_identity !== target.identity ||
          prior.format !== "earnest-blog-release-receipt-v1" ||
          prior.packetSha256 !== packetSha256 ||
          prior.targetIdentity !== target.identity ||
          prior.systemIdentifier !== target.systemIdentifier ||
          prior.afterSchemaSha256 !== packet.migratedSchemaSha256 ||
          canonical(prior.migrations) !== canonical(releaseMigrations)
        )
          throw new Error("RELEASE_RECEIPT");
        const schema = await releaseSchema(client);
        const unchanged =
          schema.schemaSha256 === prior.afterSchemaSha256 &&
          (await captureBlogSnapshot(client, target, 100, migratedTables)).fingerprint ===
            prior.afterFingerprint;
        return { ...prior, writes: 0, verification: unchanged ? "unchanged" : "changed" };
      }
    }
    throw new Error("RELEASE_NO_MATCHING_RECEIPT");
  }

  if (beforeSchema.schemaSha256 !== packet.baselineSchemaSha256) throw new Error("RELEASE_SCHEMA");
  const before = await captureBlogSnapshot(client, target, 100, baselineTables);
  assertLedger(before, baselineVersions);
  if (baselineVersions.length !== 95 || before.fingerprint !== packet.baselineSha256)
    throw new Error("RELEASE_STALE");

  const migrationTime = (await client.query("SELECT to_jsonb(transaction_timestamp()) AS ts"))
    .rows[0].ts;
  for (const file of files) {
    await client.query(file.sql);
    await client.query(
      "INSERT INTO app_migrations(version,applied_at) VALUES($1,transaction_timestamp())",
      [file.name],
    );
  }
  await client.query("LOCK TABLE " + newTables.join(", ") + " IN SHARE ROW EXCLUSIVE MODE");
  const migrated = await captureBlogRelease(client, target, "migrated");
  if (migrated.schemaSha256 !== packet.migratedSchemaSha256)
    throw new Error("RELEASE_MIGRATED_SCHEMA");
  assertLedger(migrated.snapshot, [...baselineVersions, ...releaseMigrations]);
  const normalized = normalizeMigration(migrated.snapshot);
  if (canonical(normalized) !== canonical(expectedMigration(before, migrationTime)))
    throw new Error("RELEASE_MIGRATION_DATA");

  if (bundle.registry.length !== 112) throw new Error("RELEASE_SOURCE_COUNT");
  const plan = buildImportPlan(inventoryFromSnapshots(bundle, target.identity, migrated.snapshot));
  assertPlan(plan, target);
  if (plan.conflicts.length || plan.unresolved.length) throw new Error("IMPORT_BLOCKED");
  const result = await mutateBlogImport(client, plan, migrated.snapshot);
  const after = await captureBlogSnapshot(client, target, 100, migratedTables);
  const receipt: ReleaseReceipt = {
    ...result,
    format: "earnest-blog-release-receipt-v1",
    packetSha256,
    targetIdentity: target.identity,
    systemIdentifier: target.systemIdentifier,
    planFingerprint: plan.fingerprint,
    migrationFingerprint: migrated.snapshot.fingerprint,
    migrations: releaseMigrations,
    afterFingerprint: after.fingerprint,
    afterSchemaSha256: migrated.schemaSha256,
    writes: result.counts.articles,
    verification: "unchanged",
  };
  await storeBlogReceipt(client, packetSha256, target.identity, receipt);
  return receipt;
}
