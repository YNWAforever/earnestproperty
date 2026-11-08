import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import {
  collectLiveInventory,
  buildLiveInventoryBatch,
  liveInventoryCatalogQuery,
  createNeonInventoryAdapter,
} from "./live-inventory";
import type { InventoryCatalogColumn } from "./live-inventory";
import type { Pool } from "@neondatabase/serverless";
import { fingerprint } from "../../src/lib/blog/reconcile";

const target = {
  verified: true as const,
  identity: "neon:fixture-project:fixture-branch:postgres",
  projectId: "fixture-project",
  branchId: "fixture-branch",
  endpointId: "ep-fixture",
  database: "postgres",
  role: "postgres",
  sourceRevision: "a".repeat(40),
  bindingReceiptSha256: "b".repeat(64),
  bindingVerification: "USER_CONFIRMED" as const,
  verifiedAtUtc: "2026-11-05T00:00:00.000Z",
  readOnlySessionAuthorized: true as const,
};

// Entirely in-memory, synthetic legacy schema. No URL, env, disk database or network.
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE articles (
      id text PRIMARY KEY, slug text, title text, excerpt text, content text,
      cover_image text, category text, reading_minutes integer, published boolean,
      published_at timestamptz, created_at timestamptz, updated_at timestamptz,
      author_id text, seo_title text, seo_description text
    );
    CREATE TABLE cms_content_revisions (
      id text PRIMARY KEY, resource_type text, resource_id text, version_number integer,
      state text, payload jsonb, validation_summary jsonb, base_published_version integer,
      created_by text, restored_from_revision_id text, created_at timestamptz,
      published_at timestamptz, draft_edit_version integer, draft_retired_at timestamptz,
      browse_created_at timestamptz
    );
    CREATE TABLE app_migrations (version text PRIMARY KEY, applied_at timestamptz);
    CREATE TABLE staff_users (id text, email text);
    INSERT INTO articles(id,slug,title,content,published,published_at,author_id) VALUES
      ('c','future','Future','private-future-body',true,'2099-01-01','author-c'),
      ('a','null-date','Null date','private-null-body',true,NULL,'author-a'),
      ('b','unpublished','Draft','private-draft-body',false,NULL,'author-b');
    INSERT INTO cms_content_revisions(id,resource_type,resource_id,version_number,state,payload,created_by,draft_retired_at) VALUES
      ('r1','article','a',1,'published','{"content":"published-history"}','author-a',NULL),
      ('r2','article','draft-only',1,'draft','{"content":"private-author-one"}','author-a',NULL),
      ('r3','article','draft-only',2,'draft','{"content":"private-author-two"}','author-b',NULL),
      ('r4','article','orphan',1,'archived','{"content":"private-orphan"}',NULL,NULL),
      ('r5','article','a',2,'superseded','{"content":"old-history"}','author-a',NULL),
      ('r6','article','retired',1,'draft','{"content":"retired-draft"}','author-c','2026-01-01'),
      ('r7','estate','unrelated',1,'draft','{"email":"unrelated-private-email"}','other',NULL);
    INSERT INTO app_migrations VALUES ('legacy.sql','2026-01-01');
    INSERT INTO staff_users VALUES ('author-a','unrelated-private-email');
  `);
  const statements: { sql: string; params: unknown[] }[] = [];
  let transactions = 0;
  let intercept:
    | ((
        sql: string,
        params: unknown[],
        rows: Record<string, unknown>[],
      ) => Record<string, unknown>[] | void)
    | undefined;
  const adapter = {
    async transaction<T>(
      options: unknown,
      run: (query: {
        query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
      }) => Promise<T>,
    ) {
      transactions++;
      expect(options).toEqual({ isolationLevel: "RepeatableRead", readOnly: true });
      await db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try {
        const result = await run({
          query: async (sql, params = []) => {
            statements.push({ sql, params });
            const result = await db.query<Record<string, unknown>>(sql, params);
            return { rows: intercept?.(sql, params, result.rows) ?? result.rows };
          },
        });
        await db.exec("COMMIT");
        return result;
      } catch (error) {
        await db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return {
    db,
    adapter,
    statements,
    transactions: () => transactions,
    intercept: (fn: NonNullable<typeof intercept>) => {
      intercept = fn;
    },
  };
}

test("legacy capture retains every author/state/date and marks missing schema without fabricating rows", async () => {
  const f = await fixture();
  try {
    const result = await collectLiveInventory(target, f.adapter, { pageSize: 2 });
    expect(result.raw.schemaVersion).toBe(1);
    expect(result.raw.coverage).toBe("schema-limited");
    expect(result.raw.tables.articles.rows!.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(result.raw.tables.articles.count).toBe(3);
    expect(result.raw.tables.articles.rows![0].published_at).toBeNull();
    expect(result.raw.tables.articles.rows![1].published).toBe(false);
    expect(result.raw.tables.articles.rows![2].published_at).toContain("2099-01-01");
    expect(result.raw.tables.cms_content_revisions.count).toBe(6);
    expect(result.raw.tables.cms_content_revisions.rows!.map((r) => r.id)).toEqual([
      "r1",
      "r2",
      "r3",
      "r4",
      "r5",
      "r6",
    ]);
    expect(result.raw.tables.cms_content_revisions.rows![2].created_by).toBe("author-b");
    expect(result.raw.tables.blog_categories).toMatchObject({
      status: "absent",
      count: null,
      rows: null,
    });
    expect(result.readiness.gaps).toContain("missing-table:blog_categories");
    expect(result.readiness.gaps).toContain("missing-column:articles.content_format");
    expect(result.normalization.databaseSnapshot).toBeNull();
    expect(result.normalization.sourceBundle).toBeNull();
    expect(result.receipt.counts.blog_categories).toBeNull();
    expect(result.receipt.counts.articles).toBe(3);
    expect(result.receipt.rawSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.receipt)).not.toMatch(/private-|author-a|unrelated-private/);
    expect(JSON.stringify(result.raw)).not.toContain("unrelated-private-email");
    expect(f.transactions()).toBe(1);
    for (const { sql } of f.statements) {
      expect(sql.trim()).toMatch(/^SELECT\b/i);
      expect(sql).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COPY|GRANT|REVOKE|MERGE)\b/i,
      );
      expect(sql).not.toContain("staff_users");
    }
    expect(
      f.statements.filter(
        ({ sql }) => sql.includes('FROM "public"."articles"') && !sql.includes("count(*)"),
      ).length,
    ).toBeGreaterThan(1);
  } finally {
    await f.db.close();
  }
}, 20000);

test("all columns survive legacy capture, including unreviewed fields; timeouts are local", async () => {
  const f = await fixture();
  try {
    await f.db.exec(`ALTER TABLE articles ADD COLUMN legacy_extra jsonb;
      UPDATE articles SET legacy_extra='{"retain":"exact-value"}' WHERE id='a'`);
    const result = await collectLiveInventory(target, f.adapter, { statementTimeoutMs: 1234 });
    expect(result.raw.tables.articles.rows![0].legacy_extra).toEqual({ retain: "exact-value" });
    expect(result.readiness.gaps).toContain("unreviewed-columns:articles");
    expect(result.raw.capabilities.articles.extraColumns).toEqual(["legacy_extra"]);
    expect(f.statements[0].sql).toContain("'1234ms',true");
    expect((await f.db.query("SHOW statement_timeout")).rows).toEqual([{ statement_timeout: "0" }]);
    expect(result.receipt.rawSha256).toBe(fingerprint(result.raw));
  } finally {
    await f.db.close();
  }
});

test.each([
  ["failed second page", "LIVE_INVENTORY_READ_FAILED"],
  ["short page", "LIVE_INVENTORY_PAGE_INCOMPLETE"],
  ["extra terminal page", "LIVE_INVENTORY_PAGE_INCOMPLETE"],
  ["count mismatch", "LIVE_INVENTORY_COUNT_MISMATCH"],
  ["duplicate identity", "LIVE_INVENTORY_DUPLICATE_IDENTITY"],
  ["reversed rows", "LIVE_INVENTORY_ROW_ORDER"],
  ["omitted column", "LIVE_INVENTORY_ROW_COLUMNS"],
  ["wrong resource", "LIVE_INVENTORY_RESOURCE_SCOPE"],
  ["schema drift", "LIVE_INVENTORY_SCHEMA_DRIFT"],
  ["snapshot drift", "LIVE_INVENTORY_SNAPSHOT_CHANGED"],
  ["catalog read failure", "LIVE_INVENTORY_READ_FAILED"],
] as const)(
  "rejects %s without returning or exposing partial/private data",
  async (scenario, code) => {
    const f = await fixture();
    let counts = 0,
      schemas = 0,
      sessions = 0;
    try {
      f.intercept((sql, params, rows) => {
        const articlePage = sql.includes('FROM "public"."articles"') && sql.includes("LIMIT");
        if (scenario === "failed second page" && articlePage && params[1] === 2)
          throw new Error("postgres://secret-password/private-draft-body");
        if (scenario === "short page" && articlePage && params[1] === 2) return [];
        if (scenario === "extra terminal page" && articlePage && params[1] === 3)
          return [{ raw: '{"id":"unexpected"}' }];
        if (
          scenario === "count mismatch" &&
          sql.includes('FROM "public"."articles"') &&
          sql.includes("count(*)") &&
          ++counts === 2
        )
          return [{ count: "4" }];
        if (scenario === "duplicate identity" && articlePage && params[1] === 2)
          return [{ raw: JSON.stringify({ ...JSON.parse(rows[0].raw as string), id: "a" }) }];
        if (scenario === "reversed rows" && articlePage && params[1] === 0)
          return rows.toReversed();
        if (scenario === "omitted column" && articlePage && params[1] === 0) {
          const row = JSON.parse(rows[0].raw as string);
          delete row.content;
          rows[0].raw = JSON.stringify(row);
          return rows;
        }
        if (
          scenario === "wrong resource" &&
          sql.includes('FROM "public"."cms_content_revisions"') &&
          sql.includes("LIMIT") &&
          params[1] === 0
        ) {
          const row = JSON.parse(rows[0].raw as string);
          row.resource_type = "estate";
          rows[0].raw = JSON.stringify(row);
          return rows;
        }
        if (sql === liveInventoryCatalogQuery) {
          if (scenario === "catalog read failure") throw new Error("secret catalog failure");
          if (scenario === "schema drift" && ++schemas === 2) return rows.slice(1);
        }
        if (
          scenario === "snapshot drift" &&
          sql.includes("pg_current_snapshot") &&
          ++sessions === 2
        )
          return [{ ...rows[0], snapshot: "999:999:" }];
      });
      let failure: unknown;
      try {
        await collectLiveInventory(target, f.adapter, { pageSize: 2 });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(code);
      expect(JSON.stringify(failure)).not.toMatch(/secret|private-draft-body|postgres:\/\//);
      expect((failure as Error).cause).toBeUndefined();
      expect((await f.db.query("SHOW transaction_read_only")).rows).toEqual([
        { transaction_read_only: "off" },
      ]);
    } finally {
      await f.db.close();
    }
  },
);

test("absence is unknown, existing empty tables are zero, and unsafe revision scope is not read", async () => {
  const f = await fixture();
  try {
    await f.db.exec(
      "DELETE FROM articles; DROP TABLE app_migrations; ALTER TABLE cms_content_revisions DROP COLUMN resource_type",
    );
    const result = await collectLiveInventory(target, f.adapter);
    expect(result.raw.tables.articles).toMatchObject({
      status: "captured",
      count: 0,
      rows: [],
      rawRows: [],
      numericPrecision: "exact",
    });
    expect(result.raw.tables.app_migrations).toMatchObject({
      status: "absent",
      count: null,
      rows: null,
      rawRows: null,
    });
    expect(result.raw.tables.cms_content_revisions).toMatchObject({
      status: "unsupported",
      count: null,
      rows: null,
      rawRows: null,
    });
    expect(result.readiness.gaps).toContain("missing-column:cms_content_revisions.resource_type");
    expect(f.statements.some((s) => s.sql.includes('FROM "public"."cms_content_revisions"'))).toBe(
      false,
    );
    expect(result.normalization.databaseSnapshot).toBeNull();
  } finally {
    await f.db.close();
  }
});

test("cancellation, unsafe session, wrong target and limits fail closed", async () => {
  const f = await fixture();
  try {
    const abort = new AbortController();
    f.intercept((sql) => {
      if (sql.includes('FROM "public"."articles"')) abort.abort("secret abort reason");
    });
    await expect(collectLiveInventory(target, f.adapter, { signal: abort.signal })).rejects.toThrow(
      "LIVE_INVENTORY_INTERRUPTED",
    );
    f.intercept((sql, _params, rows) =>
      sql.includes("pg_current_snapshot") ? [{ ...rows[0], read_only: "off" }] : rows,
    );
    await expect(collectLiveInventory(target, f.adapter)).rejects.toThrow(
      "LIVE_INVENTORY_SESSION_UNSAFE",
    );
    f.intercept((_sql, _params, rows) => rows);
    await expect(
      collectLiveInventory({ ...target, database: "wrong-db" }, f.adapter),
    ).rejects.toThrow("LIVE_INVENTORY_TARGET_MISMATCH");
    const before = f.transactions();
    await expect(
      collectLiveInventory({ ...target, verified: false } as unknown as typeof target, f.adapter),
    ).rejects.toThrow("LIVE_INVENTORY_TARGET_UNVERIFIED");
    await expect(
      collectLiveInventory({ ...target, identity: "postgres://secret" }, f.adapter),
    ).rejects.toThrow("LIVE_INVENTORY_TARGET_INVALID");
    await expect(
      collectLiveInventory(target, f.adapter, { statementTimeoutMs: 0 }),
    ).rejects.toThrow("LIVE_INVENTORY_INVALID_LIMIT");
    await expect(collectLiveInventory(target, f.adapter, { pageSize: 1.5 })).rejects.toThrow(
      "LIVE_INVENTORY_INVALID_LIMIT",
    );
    expect(f.transactions()).toBe(before);
    await expect(collectLiveInventory(target, f.adapter, { maxRowsPerTable: 2 })).rejects.toThrow(
      "LIVE_INVENTORY_ROW_LIMIT",
    );
  } finally {
    await f.db.close();
  }
});

test("batch executes as one owner read-only snapshot; truncated results and stale capabilities are refused", async () => {
  const f = await fixture();
  try {
    const columns = (await f.db.query<InventoryCatalogColumn>(liveInventoryCatalogQuery)).rows;
    const batch = buildLiveInventoryBatch(target, columns);
    expect(batch.readOnly).toBe(true);
    expect(batch.isolationLevel).toBe("RepeatableRead");
    const results = await f.adapter.transaction(
      { isolationLevel: batch.isolationLevel, readOnly: batch.readOnly },
      async (tx) => {
        const results = [];
        for (const sql of batch.queries) results.push(await tx.query(sql));
        return results;
      },
    );
    const capture = batch.validate(results);
    expect(capture.receipt.counts.articles).toBe(3);
    expect(capture.receipt.counts.cms_content_revisions).toBe(6);
    expect(capture.raw.tables.articles.rows![2].content).toBe("private-future-body");
    expect(() => batch.validate(results.slice(0, -1))).toThrow("LIVE_INVENTORY_BATCH_INCOMPLETE");
    const truncated = structuredClone(results);
    const pageIndex = batch.queries.findIndex(
      (sql) => sql.startsWith("SELECT to_jsonb(t)") && sql.includes('"articles"'),
    );
    truncated[pageIndex].rows.pop();
    expect(() => batch.validate(truncated)).toThrow("LIVE_INVENTORY_COUNT_MISMATCH");
    const drifted = structuredClone(results);
    drifted[2].rows.pop();
    expect(() => batch.validate(drifted)).toThrow("LIVE_INVENTORY_SCHEMA_DRIFT");
    const decodedOnly = structuredClone(results);
    decodedOnly[pageIndex].rows[0] = {
      row: JSON.parse(decodedOnly[pageIndex].rows[0].raw as string),
    };
    expect(() => batch.validate(decodedOnly)).toThrow("LIVE_INVENTORY_ROW_TEXT_REQUIRED");
    const malformed = structuredClone(results);
    malformed[pageIndex].rows[0] = { raw: '{"private-truncated":' };
    expect(() => batch.validate(malformed)).toThrow("LIVE_INVENTORY_ROW_TEXT_INVALID");
    for (const sql of batch.queries) {
      expect(sql).toMatch(/^SELECT\b/);
      expect(sql).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COPY|GRANT|REVOKE|MERGE)\b/i,
      );
    }
    const tinyBatch = buildLiveInventoryBatch(target, columns, { maxRowsPerTable: 2 });
    expect(() => tinyBatch.validate(results)).toThrow("LIVE_INVENTORY_ROW_LIMIT");
  } finally {
    await f.db.close();
  }
});

test("captures import and mutation receipts across blog scopes, retaining confirmed binding provenance", async () => {
  const f = await fixture();
  try {
    await f.db.exec(`
      CREATE TABLE blog_import_receipts (fingerprint text PRIMARY KEY, target_identity text, receipt jsonb, created_at timestamptz);
      CREATE TABLE blog_mutation_requests (request_id text PRIMARY KEY, actor_id text, operation text, fingerprint text, command jsonb, result jsonb, created_at timestamptz);
      INSERT INTO blog_import_receipts VALUES ('hash','fixture','{"private":"import"}',NULL);
      INSERT INTO blog_mutation_requests VALUES
        ('req-a','actor-a','archive','hash-a','{"resourceId":"article-a"}','{"private":"archive"}',NULL),
        ('req-b','actor-b','settings','hash-b','{"scope":"main"}','{"private":"settings"}',NULL),
        ('req-c','actor-c','category','hash-c','{"category":"成交分析"}','{"private":"category"}',NULL);
    `);
    const result = await collectLiveInventory(target, f.adapter, { pageSize: 2 });
    expect(result.raw.tables.blog_import_receipts.count).toBe(1);
    expect(result.raw.tables.blog_mutation_requests.count).toBe(3);
    expect(result.raw.tables.blog_mutation_requests.rows[1].command).toEqual({
      scope: "main",
    });
    expect(result.receipt.target.endpointId).toBe("ep-fixture");
    expect(result.receipt.target.bindingVerification).toBe("USER_CONFIRMED");
    expect(JSON.stringify(result.receipt)).not.toMatch(/actor-a|article-a|成交分析|"private"/);
  } finally {
    await f.db.close();
  }
});

test("Neon pool adapter rolls back and discards on failed reads or lost commit, with no leaked driver errors", async () => {
  for (const failOn of [null, "SELECT body", "COMMIT"] as const) {
    const sqls: string[] = [];
    let discarded: unknown;
    const pool = {
      async connect() {
        return {
          query: async (sql: string) => {
            sqls.push(sql);
            if (sql === failOn) throw new Error("postgres://secret@host/private-body");
            return { rows: [] };
          },
          release: (discard: unknown) => {
            discarded = discard;
          },
        };
      },
    };
    const adapter = createNeonInventoryAdapter(pool as unknown as Pick<Pool, "connect">);
    const action = adapter.transaction(
      { isolationLevel: "RepeatableRead", readOnly: true },
      async (tx) => {
        await tx.query("SELECT body");
        return "complete";
      },
    );
    if (failOn) {
      await expect(action).rejects.toThrow("LIVE_INVENTORY_READ_FAILED");
      expect(sqls.at(-1)).toBe("ROLLBACK");
      expect(discarded).toBe(true);
    } else {
      expect(await action).toBe("complete");
      expect(sqls.at(-1)).toBe("COMMIT");
      expect(discarded).toBe(false);
    }
    expect(sqls[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(sqls).not.toContain("BEGIN");
  }
});

async function supportedFixture() {
  const f = await fixture();
  await f.db.exec(`
      ALTER TABLE articles ADD COLUMN category_id text, ADD COLUMN content_format text,
        ADD COLUMN cover_alt text, ADD COLUMN supplemental_links jsonb, ADD COLUMN slug_locked boolean,
        ADD COLUMN version integer, ADD COLUMN editorial_metadata jsonb;
      CREATE TABLE blog_categories (id text PRIMARY KEY, key text, name text, navigation_order integer, hidden boolean, version integer);
      CREATE TABLE blog_settings (id text PRIMARY KEY, scope_kind text, category_id text, heading text, introduction text, seo_title text, seo_description text, version integer);
      CREATE TABLE blog_featured_articles (scope_id text, article_id text, position integer, PRIMARY KEY(scope_id,article_id));
      CREATE TABLE blog_legacy_category_map (legacy_key text PRIMARY KEY, category_id text);
      CREATE TABLE blog_import_receipts (fingerprint text PRIMARY KEY, target_identity text, receipt jsonb, created_at timestamptz);
      CREATE TABLE blog_mutation_requests (request_id text PRIMARY KEY, actor_id text, operation text, fingerprint text, command jsonb, result jsonb, created_at timestamptz);
      INSERT INTO blog_categories VALUES ('cat','成交分析','Exact category',2,false,7);
      INSERT INTO blog_settings VALUES ('main','main',NULL,'Main copy','Main intro',NULL,NULL,5), ('category','category','cat','Category copy','Category intro',NULL,NULL,4);
      INSERT INTO blog_featured_articles VALUES ('main','a',10), ('main','c',2), ('category','a',0);
      INSERT INTO blog_legacy_category_map VALUES ('成交分析','cat');
      INSERT INTO app_migrations VALUES
        ('20261105120000_blog_presentation_contracts.sql',NULL),
        ('20261105140000_blog_repository_mutations.sql',NULL),
        ('20261105160000_blog_import_receipts.sql',NULL);
    `);
  return f;
}

test("supported schema preserves scope ordering and normalizes only the seven existing snapshot tables", async () => {
  const f = await supportedFixture();
  try {
    await f.db.query(`UPDATE cms_content_revisions SET payload=$1::jsonb WHERE id='r2'`, [
      '{"decimal":1.2300,"exponent":1e20,"text":"9007199254740993","escaped":"quote\\"0.123456789012345678901"}',
    ]);
    const result = await collectLiveInventory(
      { ...target, systemIdentifier: "123456789" },
      f.adapter,
      { pageSize: 2 },
    );
    expect(result.raw.coverage).toBe("complete");
    expect(result.raw.tables.blog_featured_articles.rows).toEqual([
      { scope_id: "category", article_id: "a", position: 0 },
      { scope_id: "main", article_id: "c", position: 2 },
      { scope_id: "main", article_id: "a", position: 10 },
    ]);
    expect(result.raw.tables.blog_legacy_category_map.rows).toEqual([
      { legacy_key: "成交分析", category_id: "cat" },
    ]);
    expect(result.raw.tables.blog_settings.rows!.map((r) => r.version)).toEqual([4, 5]);
    const normalized = result.normalization.databaseSnapshot!;
    expect(normalized).not.toBeNull();
    expect(result.raw.tables.cms_content_revisions.numericPrecision).toBe("exact");
    expect(normalized.tables.cms_content_revisions[1].payload).toEqual({
      decimal: 1.23,
      exponent: 1e20,
      text: "9007199254740993",
      escaped: 'quote"0.123456789012345678901',
    });
    expect(Object.keys(normalized.tables).sort()).toEqual([
      "app_migrations",
      "articles",
      "blog_categories",
      "blog_featured_articles",
      "blog_legacy_category_map",
      "blog_settings",
      "cms_content_revisions",
    ]);
    // Structural projection retains even null/unsupported content for explicit
    // offline review; it never fills a format/version/date or fabricates bodies.
    expect(normalized.tables.articles[0].content_format).toBeNull();
    expect(normalized.tables.articles[0].version).toBeNull();
    expect(normalized.tables.articles).toEqual(result.raw.tables.articles.rows!);
    const { fingerprint: hash, ...data } = normalized;
    expect(hash).toBe(fingerprint(data));
    expect(result.normalization.contentReviewRequired).toBe(true);
    expect(result.normalization.sourceBundle).toBeNull();
    expect(result.readiness.activationAuthorized).toBe(false);
    expect(result.receipt.recoverableBackup).toBe(false);
  } finally {
    await f.db.close();
  }
});

test("empty legacy category key is retained exactly; empty article identity still fails", async () => {
  const f = await supportedFixture();
  try {
    await f.db.exec(`INSERT INTO blog_categories VALUES ('empty','','Empty legacy key',3,false,1);
      INSERT INTO blog_legacy_category_map VALUES ('','empty');
      UPDATE articles SET category='' WHERE id='a'`);
    const result = await collectLiveInventory(
      { ...target, systemIdentifier: "123456789" },
      f.adapter,
    );
    expect(result.raw.tables.blog_legacy_category_map.rows![0]).toEqual({
      legacy_key: "",
      category_id: "empty",
    });
    expect(result.normalization.databaseSnapshot).not.toBeNull();
    expect(result.normalization.databaseSnapshot!.tables.articles[0].category).toBe("");
    await f.db.exec(`UPDATE articles SET id='' WHERE id='a'`);
    await expect(collectLiveInventory(target, f.adapter)).rejects.toThrow(
      "LIVE_INVENTORY_ROW_IDENTITY",
    );
  } finally {
    await f.db.close();
  }
});

test.each(["9007199254740993", "0.12345678901234567890123456789", "1e400"])(
  "preserves authoritative PostgreSQL JSON text and blocks lossy normalization for %s",
  async (numberText) => {
    const f = await supportedFixture();
    try {
      await f.db.query(`UPDATE cms_content_revisions SET payload=$1::jsonb WHERE id='r2'`, [
        '{"exact":' + numberText + "}",
      ]);
      const expected = (
        await f.db.query<{ raw: string }>(
          `SELECT to_jsonb(t)::text AS raw FROM cms_content_revisions t WHERE id='r2'`,
        )
      ).rows[0].raw;
      const result = await collectLiveInventory(
        { ...target, systemIdentifier: "123456789" },
        f.adapter,
      );
      const capture = result.raw.tables.cms_content_revisions;
      expect(capture.rawRows![1]).toBe(expected);
      expect(capture.count).toBe(6);
      expect(capture.status).toBe("captured");
      expect(capture.numericPrecision).toBe("unrepresentable");
      // Withhold the parsed table view rather than offering silently rounded data.
      expect(capture.rows).toBeNull();
      expect(result.normalization.databaseSnapshot).toBeNull();
      expect(result.normalization.gaps).toContain(
        "unrepresentable-json-numeric:cms_content_revisions",
      );
      expect(result.receipt.tableSha256.cms_content_revisions).toBe(fingerprint(capture.rawRows));
      expect(result.receipt.rawSha256).toBe(fingerprint(result.raw));
    } finally {
      await f.db.close();
    }
  },
);
