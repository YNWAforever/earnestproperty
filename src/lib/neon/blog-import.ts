/**
 * Offline operations module. No application connection loader or server-function export.
 * The only constructor opens an inspected, loopback-only owned Docker target.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { articleInput, buildImportPlan, fingerprint, canonical } from "../blog/reconcile";
import type { DatabaseSnapshot, ImportPlan } from "../blog/reconcile";
import { encodeArticle } from "../blog/article-codec";
import { isOwnedPostgresImage } from "./owned-postgres-images";

type Row = Record<string, unknown>;
type Client = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
  release: () => void;
};
type Pool = { connect: () => Promise<Client>; end: () => Promise<void> };
const tables: Record<string, string> = {
  articles: "id",
  cms_content_revisions: "id",
  blog_categories: "id",
  blog_settings: "id",
  blog_featured_articles: "scope_id,article_id",
  blog_legacy_category_map: "legacy_key",
  app_migrations: "version",
};
export type ImportReceipt = {
  fingerprint: string;
  targetIdentity: string;
  sourceRevision: string;
  sourceDigest: string | null;
  backupSha256: string;
  inserted: {
    temporaryId: string;
    id: string;
    slug: string;
    fingerprint: string;
    revisionId: string;
  }[];
  counts: { articles: number; categories: number; settings: number; normalized: number };
  afterFingerprint: string;
  writes: number;
  verification: "unchanged" | "changed";
};
export type VerifiedImportTarget = Readonly<{
  identity: string;
  systemIdentifier: string;
  close: () => Promise<void>;
}>;
type Authorization = { planFingerprint: string; backupPath: string; backupSha256: string };
type TargetConfig = { containerId: string; targetIdentity: string; authorization?: Authorization };
const verified = new WeakMap<
  VerifiedImportTarget,
  { pool: Pool; config: TargetConfig; backup?: DatabaseSnapshot }
>();
function inspect(config: TargetConfig) {
  if (
    !/^[a-f0-9]{64}$/.test(config.containerId) ||
    config.targetIdentity !== "owned:" + config.containerId + ":postgres"
  )
    throw new Error("IMPORT_TARGET");
  const meta = JSON.parse(
    execFileSync("docker", ["inspect", config.containerId], { encoding: "utf8", timeout: 15000 }),
  )[0];
  const ports = meta.NetworkSettings.Ports["5432/tcp"];
  if (
    meta.Id !== config.containerId ||
    !/^\/earnest-remediation-qa-[a-f0-9-]+$/.test(meta.Name) ||
    !isOwnedPostgresImage(meta.Config.Image) ||
    !meta.State.Running ||
    ports?.length !== 1 ||
    ports[0].HostIp !== "127.0.0.1"
  )
    throw new Error("IMPORT_TARGET");
  return Number(ports[0].HostPort);
}
async function dbIdentity(client: Client) {
  const { rows } = await client.query(
    "SELECT system_identifier::text system_id,current_database() db,current_user usr FROM pg_control_system()",
  );
  if (rows[0]?.db !== "postgres" || rows[0]?.usr !== "postgres")
    throw new Error("IMPORT_TARGET_DATABASE");
  return String(rows[0].system_id);
}
export async function verifyImportTarget(config: TargetConfig): Promise<VerifiedImportTarget> {
  // Refuse even accidental URL configuration. Never read dotenv or application secrets.
  for (const key of [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "TEST_DATABASE_URL",
    "CMS_TEST_DATABASE_URL",
    "ASTRA_TEST_DATABASE_URL",
  ])
    if (process.env[key]) throw new Error("IMPORT_REFUSES_URL_ENV");
  const port = inspect(config);
  const pg = createRequire(import.meta.url)("pg") as { Pool: new (config: object) => Pool };
  const pool = new pg.Pool({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
  try {
    const client = await pool.connect();
    let systemIdentifier: string;
    try {
      systemIdentifier = await dbIdentity(client);
    } finally {
      client.release();
    }
    let backup: DatabaseSnapshot | undefined;
    if (config.authorization) {
      const bytes = readFileSync(config.authorization.backupPath);
      if (createHash("sha256").update(bytes).digest("hex") !== config.authorization.backupSha256)
        throw new Error("IMPORT_BACKUP_DIGEST");
      backup = JSON.parse(bytes.toString("utf8")) as DatabaseSnapshot;
      if (
        backup.targetIdentity !== config.targetIdentity ||
        backup.systemIdentifier !== systemIdentifier ||
        fingerprint({
          targetIdentity: backup.targetIdentity,
          systemIdentifier: backup.systemIdentifier,
          tables: backup.tables,
        }) !== backup.fingerprint
      )
        throw new Error("IMPORT_BACKUP_TARGET");
    }
    const target = Object.freeze({
      identity: config.targetIdentity,
      systemIdentifier,
      close: async () => {
        verified.delete(target);
        await pool.end();
      },
    });
    verified.set(target, { pool, config: structuredClone(config), backup });
    return target;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
function state(target: VerifiedImportTarget) {
  const s = verified.get(target);
  if (!s) throw new Error("IMPORT_UNVERIFIED_TARGET");
  inspect(s.config);
  return s;
}
async function transaction<T>(
  target: VerifiedImportTarget,
  write: boolean,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const s = state(target),
    client = await s.pool.connect();
  try {
    await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if ((await dbIdentity(client)) !== target.systemIdentifier)
      throw new Error("IMPORT_TARGET_CHANGED");
    if (write) {
      await client.query("SELECT blog_lock()");
      // Protect against direct SQL writers as well as the cooperating CMS lock.
      await client.query(
        "LOCK TABLE articles,cms_content_revisions,blog_categories,blog_settings,blog_featured_articles,blog_legacy_category_map,blog_import_receipts IN SHARE ROW EXCLUSIVE MODE",
      );
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function capture(
  client: Client,
  target: VerifiedImportTarget,
  pageSize = 100,
): Promise<DatabaseSnapshot> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000)
    throw new Error("IMPORT_PAGE_SIZE");
  const data: DatabaseSnapshot["tables"] = {};
  for (const [table, order] of Object.entries(tables)) {
    const where = table === "cms_content_revisions" ? " WHERE resource_type='article'" : "";
    const count = Number((await client.query("SELECT count(*) n FROM " + table + where)).rows[0].n);
    const rows: Row[] = [];
    for (let offset = 0; offset < count; offset += pageSize) {
      const page = (
        await client.query(
          "SELECT to_jsonb(t) row FROM " +
            table +
            " t" +
            where +
            " ORDER BY " +
            order +
            " LIMIT $1 OFFSET $2",
          [pageSize, offset],
        )
      ).rows;
      if (!page.length) throw new Error("IMPORT_INCOMPLETE_PAGE:" + table);
      rows.push(...page.map((r) => r.row as Row));
    }
    if (
      rows.length !== count ||
      new Set(rows.map((r) => canonical(order.split(",").map((k) => r[k])))).size !== count
    )
      throw new Error("IMPORT_INCOMPLETE_COUNT:" + table);
    data[table] = rows;
  }
  const body = {
    targetIdentity: target.identity,
    systemIdentifier: target.systemIdentifier,
    tables: data,
  };
  return { ...body, fingerprint: fingerprint(body) };
}
export async function snapshotDatabase(
  target: VerifiedImportTarget,
  pageSize = 100,
): Promise<DatabaseSnapshot> {
  return transaction(target, false, (client) => capture(client, target, pageSize));
}
function assertPlan(plan: ImportPlan, target: VerifiedImportTarget) {
  if (buildImportPlan(plan.inventory).fingerprint !== plan.fingerprint)
    throw new Error("IMPORT_MANIFEST");
  const rebuilt = buildImportPlan(plan.inventory);
  if (canonical(rebuilt) !== canonical(plan)) throw new Error("IMPORT_MANIFEST");
  if (plan.inventory.targetIdentity !== target.identity) throw new Error("IMPORT_TARGET");
}
async function readReceipt(client: Client, plan: ImportPlan): Promise<ImportReceipt | null> {
  const rows = (
    await client.query("SELECT receipt FROM blog_import_receipts WHERE fingerprint=$1", [
      plan.fingerprint,
    ])
  ).rows;
  return rows.length ? (rows[0].receipt as ImportReceipt) : null;
}
async function checkedReceipt(
  client: Client,
  target: VerifiedImportTarget,
  plan: ImportPlan,
  receipt: ImportReceipt,
): Promise<ImportReceipt> {
  if (receipt.targetIdentity !== target.identity || receipt.fingerprint !== plan.fingerprint)
    throw new Error("IMPORT_RECEIPT_TARGET");
  const now = await capture(client, target);
  // Report drift without any repair/write, including edits, deleted records and revised settings.
  return {
    ...receipt,
    writes: 0,
    verification: now.fingerprint === receipt.afterFingerprint ? "unchanged" : "changed",
  };
}
export async function verifyImport(
  plan: ImportPlan,
  target: VerifiedImportTarget,
): Promise<ImportReceipt> {
  assertPlan(plan, target);
  return transaction(target, false, async (client) => {
    const receipt = await readReceipt(client, plan);
    if (!receipt) throw new Error("IMPORT_RECEIPT_MISSING");
    return checkedReceipt(client, target, plan, receipt);
  });
}
export async function applyImport(
  plan: ImportPlan,
  target: VerifiedImportTarget,
): Promise<ImportReceipt> {
  assertPlan(plan, target);
  const s = state(target),
    approval = s.config.authorization;
  if (!approval || approval.planFingerprint !== plan.fingerprint || !s.backup)
    throw new Error("IMPORT_APPROVAL");
  if (plan.conflicts.length || plan.unresolved.length) throw new Error("IMPORT_BLOCKED");
  if (!plan.inventory.database || plan.inventory.database.fingerprint !== s.backup.fingerprint)
    throw new Error("IMPORT_BACKUP_SNAPSHOT");
  return transaction(target, true, async (client) => {
    const prior = await readReceipt(client, plan);
    if (prior) return checkedReceipt(client, target, plan, prior);
    const before = await capture(client, target);
    if (before.fingerprint !== plan.inventory.database!.fingerprint)
      throw new Error("IMPORT_STALE");
    const categoryIds = new Map<string, string>(),
      articleIds = new Map<string, string>();
    const counts = { articles: 0, categories: 0, settings: 0, normalized: 0 };
    for (const c of plan.inventory.categories) {
      const old = before.tables.blog_categories.find((r) => r.key === c.key);
      if (old) {
        if (old.id !== c.id || Number(old.version) !== c.version)
          throw new Error("IMPORT_CATEGORY_VERSION");
        categoryIds.set(c.id, String(old.id));
        // Existing metadata is authoritative; only controller-approved placeholder ordering is initialized.
        if (old.name !== c.name || old.hidden !== c.hidden)
          throw new Error("IMPORT_CATEGORY_CONFLICT");
        if (old.navigation_order !== c.navigationOrder) {
          const row = before.tables.blog_settings.find((r) => r.category_id === old.id);
          if (
            old.version !== 1 ||
            row?.version !== 1 ||
            row.heading !== c.key ||
            row.introduction !== "" ||
            row.seo_title !== null ||
            row.seo_description !== null
          )
            throw new Error("IMPORT_CATEGORY_CONFLICT");
          await client.query(
            "UPDATE blog_categories SET navigation_order=$1,version=version+1 WHERE id=$2 AND version=$3",
            [c.navigationOrder, old.id, c.version],
          );
          counts.categories++;
        }
      } else {
        if (c.version !== 0 || c.settingsVersion !== 0) throw new Error("IMPORT_CATEGORY_VERSION");
        const id = randomUUID();
        categoryIds.set(c.id, id);
        await client.query(
          "INSERT INTO blog_categories(id,key,name,navigation_order,hidden) VALUES($1,$2,$3,$4,$5)",
          [id, c.key, c.name, c.navigationOrder, c.hidden],
        );
        counts.categories++;
        await client.query(
          "INSERT INTO blog_legacy_category_map(legacy_key,category_id) VALUES($1,$2)",
          [c.key, id],
        );
      }
    }
    // Normalize only missing references, with whole-snapshot freshness AND per-row version CAS.
    for (const row of before.tables.articles) {
      if (row.category_id != null || row.category == null) continue;
      const c = plan.inventory.categories.find((c) => c.key === row.category);
      if (!c) throw new Error("IMPORT_UNRESOLVED_CATEGORY");
      await client.query(
        "UPDATE articles SET category_id=$1 WHERE id=$2 AND version=$3 AND category_id IS NULL",
        [categoryIds.get(c.id), row.id, row.version],
      );
      counts.normalized++;
    }
    const inserted: ImportReceipt["inserted"] = [];
    for (const a of plan.insert) {
      const id = randomUUID(),
        revisionId = randomUUID();
      const input = {
        ...articleInput(a),
        categoryId: a.categoryId === null ? null : (categoryIds.get(a.categoryId) ?? a.categoryId),
      };
      const category =
        input.categoryId === null
          ? null
          : plan.inventory.categories.find((c) => categoryIds.get(c.id) === input.categoryId)?.key;
      if (input.categoryId !== null && !category) throw new Error("IMPORT_CATEGORY_UNRESOLVED");
      const collisions = (
        await client.query(
          "SELECT id FROM articles WHERE id=$1 OR slug=$2 UNION ALL SELECT resource_id FROM cms_content_revisions WHERE resource_type='article' AND (resource_id=$1 OR payload->>'slug'=$2)",
          [id, a.slug],
        )
      ).rows;
      if (collisions.length) throw new Error("IMPORT_EXISTING_HISTORY");
      const payload: Record<string, unknown> = {
        ...encodeArticle(input),
        category: category ?? null,
      };
      await client.query(
        `INSERT INTO articles(id,slug,title,excerpt,content,category,category_id,published,published_at,cover_image,cover_alt,content_format,supplemental_links,editorial_metadata,reading_minutes,seo_title,seo_description,slug_locked,version)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,true,1)`,
        [
          id,
          a.slug,
          a.title,
          a.excerpt,
          payload.content,
          category ?? null,
          input.categoryId,
          a.published,
          a.publishedAt,
          a.coverImage,
          a.coverAlt,
          a.body.format,
          JSON.stringify(a.links),
          JSON.stringify(a.editorial),
          a.readingMinutes,
          a.seoTitle,
          a.seoDescription,
        ],
      );
      await client.query(
        `INSERT INTO cms_content_revisions(id,resource_type,resource_id,version_number,state,payload,validation_summary,published_at)
    VALUES($1,'article',$2,1,$3,$4::jsonb,$5::jsonb,$6)`,
        [
          revisionId,
          id,
          a.published ? "published" : "archived",
          JSON.stringify(payload),
          JSON.stringify({
            import: {
              fingerprint: plan.fingerprint,
              sourceRevision: plan.inventory.sourceRevision,
              sourceFingerprint: fingerprint(a),
            },
          }),
          a.publishedAt,
        ],
      );
      articleIds.set(a.id, id);
      inserted.push({
        temporaryId: a.id,
        id,
        slug: a.slug,
        fingerprint: fingerprint(a),
        revisionId,
      });
      counts.articles++;
    }
    for (const setting of plan.inventory.settings) {
      const scopeId =
        setting.scope.kind === "main"
          ? null
          : (categoryIds.get(setting.scope.categoryId) ?? setting.scope.categoryId);
      const old = before.tables.blog_settings.find(
        (r) => r.scope_kind === setting.scope.kind && r.category_id === scopeId,
      );
      if ((old && Number(old.version) !== setting.version) || (!old && setting.version !== 0))
        throw new Error("IMPORT_SETTINGS_VERSION");
      const featureIds = setting.featuredIds.map((id) => articleIds.get(id) ?? id);
      const page = {
        heading: setting.heading,
        introduction: setting.introduction,
        seo_title: setting.seoTitle,
        seo_description: setting.seoDescription,
      };
      const oldFeatures = before.tables.blog_featured_articles
        .filter((r) => r.scope_id === old?.id)
        .sort((a, b) => Number(a.position) - Number(b.position))
        .map((r) => String(r.article_id));
      if (
        old &&
        Object.entries(page).every(([k, v]) => old[k] === v) &&
        canonical(oldFeatures) === canonical(featureIds)
      )
        continue;
      if (
        old &&
        (old.version !== 1 ||
          old.introduction !== "" ||
          old.seo_title !== null ||
          old.seo_description !== null ||
          oldFeatures.length ||
          old.heading !==
            (setting.scope.kind === "main"
              ? "樓市資訊"
              : plan.inventory.categories.find((c) => categoryIds.get(c.id) === scopeId)?.key))
      )
        throw new Error("IMPORT_SETTINGS_AUTHORITATIVE");
      const id = String(old?.id ?? randomUUID());
      if (old)
        await client.query(
          "UPDATE blog_settings SET heading=$1,introduction=$2,seo_title=$3,seo_description=$4,version=version+1 WHERE id=$5 AND version=$6",
          [...Object.values(page), id, setting.version],
        );
      else
        await client.query(
          "INSERT INTO blog_settings(id,scope_kind,category_id,heading,introduction,seo_title,seo_description) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [id, setting.scope.kind, scopeId, ...Object.values(page)],
        );
      for (const [position, articleId] of featureIds.entries()) {
        const eligible = (
          await client.query(
            "SELECT id FROM articles WHERE id=$1 AND published AND (published_at IS NULL OR published_at<=now()) AND ($2::uuid IS NULL OR category_id=$2)",
            [articleId, scopeId],
          )
        ).rows;
        if (!eligible.length) throw new Error("IMPORT_INELIGIBLE_FEATURE");
        await client.query(
          "INSERT INTO blog_featured_articles(scope_id,article_id,position) VALUES($1,$2,$3)",
          [id, articleId, position],
        );
      }
      counts.settings++;
    }
    const after = await capture(client, target);
    const receipt: ImportReceipt = {
      fingerprint: plan.fingerprint,
      targetIdentity: target.identity,
      sourceRevision: plan.inventory.sourceRevision,
      sourceDigest: plan.inventory.sourceDigest ?? null,
      backupSha256: approval.backupSha256,
      inserted,
      counts,
      afterFingerprint: after.fingerprint,
      writes: counts.articles,
      verification: "unchanged",
    };
    await client.query(
      "INSERT INTO blog_import_receipts(fingerprint,target_identity,receipt) VALUES($1,$2,$3::jsonb)",
      [plan.fingerprint, target.identity, JSON.stringify(receipt)],
    );
    return receipt;
  });
}
