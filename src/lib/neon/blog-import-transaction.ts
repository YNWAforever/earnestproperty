/** Internal blog transaction operations. The caller owns identity, locking and COMMIT. */
import { randomUUID } from "node:crypto";
import { articleInput, buildImportPlan, fingerprint, canonical } from "../blog/reconcile";
import type { DatabaseSnapshot, ImportPlan } from "../blog/reconcile";
import { encodeArticle } from "../blog/article-codec";

export type BlogSnapshotIdentity = Readonly<{ identity: string; systemIdentifier: string }>;
export type BlogSqlSession = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};
type Row = Record<string, unknown>;
export const blogSnapshotTables: Record<string, string> = {
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
export async function captureBlogSnapshot(
  client: BlogSqlSession,
  target: BlogSnapshotIdentity,
  pageSize = 100,
  selection: Readonly<Record<string, string>> = blogSnapshotTables,
): Promise<DatabaseSnapshot> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000)
    throw new Error("IMPORT_PAGE_SIZE");
  const data: DatabaseSnapshot["tables"] = {};
  for (const [table, order] of Object.entries(selection)) {
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
export function assertPlan(plan: ImportPlan, target: BlogSnapshotIdentity) {
  if (buildImportPlan(plan.inventory).fingerprint !== plan.fingerprint)
    throw new Error("IMPORT_MANIFEST");
  const rebuilt = buildImportPlan(plan.inventory);
  if (canonical(rebuilt) !== canonical(plan)) throw new Error("IMPORT_MANIFEST");
  if (plan.inventory.targetIdentity !== target.identity) throw new Error("IMPORT_TARGET");
}
export async function readReceipt(
  client: BlogSqlSession,
  plan: ImportPlan,
): Promise<ImportReceipt | null> {
  const rows = (
    await client.query("SELECT receipt FROM blog_import_receipts WHERE fingerprint=$1", [
      plan.fingerprint,
    ])
  ).rows;
  return rows.length ? (rows[0].receipt as ImportReceipt) : null;
}
export async function checkedReceipt(
  client: BlogSqlSession,
  target: BlogSnapshotIdentity,
  plan: ImportPlan,
  receipt: ImportReceipt,
): Promise<ImportReceipt> {
  if (receipt.targetIdentity !== target.identity || receipt.fingerprint !== plan.fingerprint)
    throw new Error("IMPORT_RECEIPT_TARGET");
  const now = await captureBlogSnapshot(client, target);
  // Report drift without any repair/write, including edits, deleted records and revised settings.
  return {
    ...receipt,
    writes: 0,
    verification: now.fingerprint === receipt.afterFingerprint ? "unchanged" : "changed",
  };
}

export async function mutateBlogImport(
  client: BlogSqlSession,
  plan: ImportPlan,
  before: DatabaseSnapshot,
) {
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
  return { inserted, counts };
}

export async function completeOwnedImport(
  client: BlogSqlSession,
  target: BlogSnapshotIdentity,
  plan: ImportPlan,
  backupSha256: string,
  { inserted, counts }: Awaited<ReturnType<typeof mutateBlogImport>>,
) {
  const after = await captureBlogSnapshot(client, target);
  const receipt: ImportReceipt = {
    fingerprint: plan.fingerprint,
    targetIdentity: target.identity,
    sourceRevision: plan.inventory.sourceRevision,
    sourceDigest: plan.inventory.sourceDigest ?? null,
    backupSha256: backupSha256,
    inserted,
    counts,
    afterFingerprint: after.fingerprint,
    writes: counts.articles,
    verification: "unchanged",
  };
  await storeBlogReceipt(client, plan.fingerprint, target.identity, receipt);
  return receipt;
}

export async function storeBlogReceipt(
  client: BlogSqlSession,
  fingerprint: string,
  targetIdentity: string,
  receipt: unknown,
) {
  await client.query(
    "INSERT INTO blog_import_receipts(fingerprint,target_identity,receipt) VALUES($1,$2,$3::jsonb)",
    [fingerprint, targetIdentity, JSON.stringify(receipt)],
  );
}
