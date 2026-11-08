import assert from "node:assert/strict";
import test from "node:test";
import "../acceptance/owned-postgres-test.mjs";

const { mutateBlogImport } = await import("../../src/lib/neon/blog-import-transaction.ts");

const category = {
  id: "category-1",
  key: "市場",
  name: "市場",
  navigationOrder: 1,
  hidden: false,
  version: 1,
  settingsVersion: 1,
};

function snapshot(edit = {}) {
  return {
    targetIdentity: "owned:fixture:postgres",
    systemIdentifier: "1",
    fingerprint: "snapshot",
    tables: {
      blog_categories: [
        {
          id: category.id,
          key: category.key,
          name: category.name,
          navigation_order: 0,
          hidden: false,
          version: 1,
        },
      ],
      blog_settings: [
        {
          id: "setting-1",
          scope_kind: "category",
          category_id: category.id,
          heading: category.key,
          introduction: "",
          seo_title: null,
          seo_description: null,
          version: 1,
        },
      ],
      blog_featured_articles: [],
      articles: [],
      ...edit,
    },
  };
}

function plan(edit = {}) {
  return {
    fingerprint: "plan",
    inventory: {
      articles: [],
      completeSources: [],
      unresolvedSources: [],
      settings: [],
      categories: [category],
      sourceRevision: "fixture",
      targetIdentity: "owned:fixture:postgres",
      ...edit,
    },
    insert: [],
    conflicts: [],
    unresolved: [],
  };
}

function client(rowCount) {
  const sql = [];
  return {
    sql,
    async query(statement) {
      sql.push(statement);
      return { rows: [], rowCount };
    },
  };
}

test("category CAS mismatch fails closed before a later write", async () => {
  const db = client(0);
  await assert.rejects(mutateBlogImport(db, plan(), snapshot()), /IMPORT_CAS_MISMATCH/);
  assert.deepEqual(db.sql, [
    "UPDATE blog_categories SET navigation_order=$1,version=version+1 WHERE id=$2 AND version=$3",
  ]);
});

test("category CAS affecting two rows fails closed", async () => {
  const db = client(2);
  await assert.rejects(mutateBlogImport(db, plan(), snapshot()), /IMPORT_CAS_MISMATCH/);
});

test("category CAS updates exactly one row", async () => {
  const db = client(1);
  const result = await mutateBlogImport(db, plan(), snapshot());
  assert.equal(result.counts.categories, 1);
  assert.deepEqual(result.inserted, []);
  assert.equal(db.sql.length, 1);
});

test("article reference CAS mismatch fails closed", async () => {
  const db = client(0);
  const before = snapshot({
    blog_categories: [
      {
        id: category.id,
        key: category.key,
        name: category.name,
        navigation_order: 1,
        hidden: false,
        version: 1,
      },
    ],
    articles: [{ id: "article-1", category_id: null, category: category.key, version: 4 }],
  });
  await assert.rejects(mutateBlogImport(db, plan(), before), /IMPORT_CAS_MISMATCH/);
  assert.match(db.sql.at(-1), /UPDATE articles SET category_id=\$1 WHERE id=\$2 AND version=\$3/);
});

test("article and settings CAS updates succeed when exactly one row matches", async () => {
  const articleDb = client(1);
  const articleBefore = snapshot({
    blog_categories: [
      {
        id: category.id,
        key: category.key,
        name: category.name,
        navigation_order: 1,
        hidden: false,
        version: 1,
      },
    ],
    articles: [{ id: "article-1", category_id: null, category: category.key, version: 4 }],
  });
  const articles = await mutateBlogImport(articleDb, plan(), articleBefore);
  assert.equal(articles.counts.normalized, 1);
  const settingsDb = client(1);
  const settingsBefore = snapshot({
    blog_categories: [
      {
        id: category.id,
        key: category.key,
        name: category.name,
        navigation_order: 1,
        hidden: false,
        version: 1,
      },
    ],
  });
  const settings = await mutateBlogImport(
    settingsDb,
    plan({
      settings: [
        {
          scope: { kind: "category", categoryId: category.id },
          heading: "新標題",
          introduction: "",
          seoTitle: null,
          seoDescription: null,
          featuredIds: [],
          version: 1,
        },
      ],
    }),
    settingsBefore,
  );
  assert.equal(settings.counts.settings, 1);
  assert.match(settingsDb.sql[0], /UPDATE blog_settings SET heading=\$1/);
});

test("settings CAS mismatch fails closed before feature inserts", async () => {
  const db = client(0);
  const before = snapshot({
    blog_categories: [
      {
        id: category.id,
        key: category.key,
        name: category.name,
        navigation_order: 1,
        hidden: false,
        version: 1,
      },
    ],
  });
  const next = plan({
    settings: [
      {
        scope: { kind: "category", categoryId: category.id },
        heading: "新標題",
        introduction: "",
        seoTitle: null,
        seoDescription: null,
        featuredIds: [],
        version: 1,
      },
    ],
  });
  await assert.rejects(mutateBlogImport(db, next, before), /IMPORT_CAS_MISMATCH/);
  assert.match(db.sql.at(-1), /UPDATE blog_settings SET heading=\$1/);
  assert.equal(
    db.sql.some((statement) => statement.startsWith("INSERT")),
    false,
  );
});
