import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withOwnedPostgres } from "./acceptance/owned-postgres-test.mjs";
import { isolatedDatabase, applyMigrations } from "./acceptance/migrated-schema.mjs";
import { MIGRATION_VERSIONS } from "../src/lib/control-plane/migration-versions.js";

const version = "20261105120000_blog_presentation_contracts.sql";
async function run() {
  // No URL mode: even an explicit external test URL is refused before creating a target.
  for (const name of [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "TEST_DATABASE_URL",
    "CMS_TEST_DATABASE_URL",
    "ASTRA_TEST_DATABASE_URL",
  ])
    assert.ok(!process.env[name], "Blog schema suite refuses URL environment: " + name);
  await withOwnedPostgres(async (owned) => {
    const { sql, end } = await isolatedDatabase({ ...owned, owned: true });
    const schema = "blog_test_" + randomUUID().replaceAll("-", "");
    const query = async (statement, params = []) => {
      const results = await sql.transaction([
        sql.query("SELECT set_config('search_path',$1,true)", [schema + ",public"]),
        sql.query(statement, params),
      ]);
      return results[1];
    };
    try {
      await sql.query("CREATE SCHEMA " + schema);
      await applyMigrations(
        sql,
        schema,
        MIGRATION_VERSIONS.filter((v) => v < version),
      );
      const id = randomUUID();
      await query(
        "INSERT INTO articles(id,slug,title,content,category,published) VALUES($1,'existing-url','原有文章','原文','成交分析',false)",
        [id],
      );
      const before = (await query("SELECT to_jsonb(a) AS row FROM articles a WHERE id=$1", [id]))[0]
        .row;
      await applyMigrations(sql, schema, [version]);
      const after = (await query("SELECT to_jsonb(a) AS row FROM articles a WHERE id=$1", [id]))[0]
        .row;
      for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key]);
      assert.equal(after.slug_locked, true);
      const category = (await query("SELECT * FROM blog_categories WHERE key='成交分析'"))[0];
      assert.equal(after.category_id, category.id);
      await assert.rejects(
        query("INSERT INTO blog_categories(key,name) VALUES('成交分析','重複')"),
        /unique/i,
      );
      await assert.rejects(
        query("UPDATE articles SET slug='changed' WHERE id=$1", [id]),
        /BLOG_SLUG_LOCKED/,
      );
      await assert.rejects(
        query("UPDATE articles SET category_id=$1 WHERE id=$2", [randomUUID(), id]),
        /foreign key/i,
      );
      await assert.rejects(query("UPDATE articles SET version=0 WHERE id=$1", [id]), /check/i);
      const main = (await query("SELECT id FROM blog_settings WHERE scope_kind='main'"))[0].id;
      await query(
        "INSERT INTO blog_featured_articles(scope_id,article_id,position) VALUES($1,$2,0)",
        [main, id],
      );
      await assert.rejects(
        query("INSERT INTO blog_featured_articles(scope_id,article_id,position) VALUES($1,$2,1)", [
          main,
          id,
        ]),
        /unique/i,
      );
      await assert.rejects(
        query("INSERT INTO blog_featured_articles(scope_id,article_id,position) VALUES($1,$2,2)", [
          main,
          randomUUID(),
        ]),
        /foreign key/i,
      );
      const other = randomUUID();
      await query(
        "INSERT INTO articles(id,slug,title,published) VALUES($1,'draft-url','新稿',false)",
        [other],
      );
      await assert.rejects(
        query("INSERT INTO blog_featured_articles(scope_id,article_id,position) VALUES($1,$2,0)", [
          main,
          other,
        ]),
        /unique/i,
      );
      await query("UPDATE articles SET slug='editable-draft' WHERE id=$1", [other]);
      await query("UPDATE articles SET published=true WHERE id=$1", [other]);
      await assert.rejects(
        query("UPDATE articles SET slug='changed-again',slug_locked=false WHERE id=$1", [other]),
        /BLOG_SLUG_LOCKED/,
      );
      const admin = randomUUID(),
        agent = randomUUID(),
        resource = randomUUID();
      for (const [actor, role] of [
        [admin, "admin"],
        [agent, "agent"],
      ]) {
        await query("INSERT INTO staff_users(id,active) VALUES($1,true)", [actor]);
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [actor, role]);
      }
      const payload = {
        slug: "revision-owned",
        title: "新文章",
        content: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "正文與引號「測試」" }] }],
        }),
        category: "成交分析",
        category_id: category.id,
        content_format: "editor-json-v1",
        cover_alt: "封面",
        supplemental_links: [],
      };
      const draft = (
        await query("SELECT cms_mutate('save','article',$1,$2,$3::jsonb) AS r", [
          resource,
          agent,
          JSON.stringify(payload),
        ])
      )[0].r;
      await assert.rejects(
        query("SELECT cms_mutate('publish','article',$1,$2,NULL,NULL,1,$3)", [
          resource,
          agent,
          draft.id,
        ]),
        /FORBIDDEN/,
      );
      await query("SELECT cms_mutate('publish','article',$1,$2,NULL,NULL,1,$3)", [
        resource,
        admin,
        draft.id,
      ]);
      const live = (await query("SELECT * FROM articles WHERE id=$1", [resource]))[0];
      assert.equal(live.version, draft.version_number);
      assert.equal(live.content_format, "editor-json-v1");
      assert.deepEqual(JSON.parse(live.content), JSON.parse(payload.content));
      assert.equal(live.content, payload.content);
      assert.equal(live.cover_alt, "封面");
      assert.equal(live.slug_locked, true);
      assert.equal(live.category_id, category.id);
      // A new category has no legacy inventory entry; explicit identity must still win.
      const freshCategory = (
        await query("INSERT INTO blog_categories(key,name) VALUES('新分類','新分類') RETURNING id")
      )[0].id;
      const nextPayload = { ...payload, category_id: freshCategory };
      const next = (
        await query("SELECT cms_mutate('save','article',$1,$2,$3::jsonb,1) AS r", [
          resource,
          admin,
          JSON.stringify(nextPayload),
        ])
      )[0].r;
      await query("SELECT cms_mutate('publish','article',$1,$2,NULL,1,1,$3)", [
        resource,
        admin,
        next.id,
      ]);
      const moved = (await query("SELECT * FROM articles WHERE id=$1", [resource]))[0];
      assert.equal(moved.category_id, freshCategory);
      assert.equal(moved.category, "新分類");
      assert.equal(moved.version, next.version_number);
      const categoryScope = (
        await query(
          "INSERT INTO blog_settings(scope_kind,category_id,heading) VALUES('category',$1,'新分類') RETURNING id",
          [freshCategory],
        )
      )[0].id;
      await query(
        "INSERT INTO blog_featured_articles(scope_id,article_id,position) VALUES($1,$2,0)",
        [categoryScope, id],
      );
      await assert.rejects(
        query("INSERT INTO blog_settings(scope_kind,heading) VALUES('main','重複')"),
        /unique/i,
      );
      await assert.rejects(
        query(
          "INSERT INTO blog_settings(scope_kind,category_id,heading) VALUES('category',$1,'重複')",
          [freshCategory],
        ),
        /unique/i,
      );
      await assert.rejects(
        query(
          "INSERT INTO blog_settings(scope_kind,category_id,heading) VALUES('category',$1,'不存在')",
          [randomUUID()],
        ),
        /foreign key/i,
      );
      await assert.rejects(
        query("UPDATE blog_categories SET version=0 WHERE id=$1", [freshCategory]),
        /check/i,
      );
      await assert.rejects(
        query("UPDATE blog_settings SET version=0 WHERE id=$1", [main]),
        /check/i,
      );
      await assert.rejects(query("DELETE FROM articles WHERE id=$1", [id]), /foreign key/i);
      // Locked-slug publish rolls back both the revision transition and the existing live row.
      const bad = (
        await query("SELECT cms_mutate('save','article',$1,$2,$3::jsonb,$4) AS r", [
          resource,
          admin,
          JSON.stringify({ ...nextPayload, slug: "renamed" }),
          next.version_number,
        ])
      )[0].r;
      await assert.rejects(
        query("SELECT cms_mutate('publish','article',$1,$2,NULL,$3,1,$4)", [
          resource,
          admin,
          next.version_number,
          bad.id,
        ]),
        /BLOG_SLUG_LOCKED/,
      );
      assert.equal(
        (await query("SELECT state FROM cms_content_revisions WHERE id=$1", [next.id]))[0].state,
        "published",
      );
      assert.equal(
        (await query("SELECT slug FROM articles WHERE id=$1", [resource]))[0].slug,
        "revision-owned",
      );
      // Historical revision has no discriminator or supplemental links.
      const historicalResource = randomUUID();
      const historicalPayload = {
        slug: "historical-body",
        title: "歷史文章",
        content: "原有純文字\n<p>不是編輯器文件</p>",
      };
      const save = async (body, base = null) =>
        (
          await query("SELECT cms_mutate('save','article',$1,$2,$3::jsonb,$4) AS r", [
            historicalResource,
            admin,
            JSON.stringify(body),
            base,
          ])
        )[0].r;
      const publish = async (revision) =>
        query("SELECT cms_mutate('publish','article',$1,$2,NULL,$3,$4,$5)", [
          historicalResource,
          admin,
          revision.base_published_version,
          revision.draft_edit_version,
          revision.id,
        ]);
      const historical = await save(historicalPayload);
      await publish(historical);
      const links = [{ label: "延伸閱讀", url: "https://example.com/reference" }];
      const rich = await save(
        {
          ...historicalPayload,
          content: payload.content,
          content_format: "editor-json-v1",
          supplemental_links: links,
        },
        historical.version_number,
      );
      await publish(rich);
      const richLive = (
        await query("SELECT content,content_format FROM articles WHERE id=$1", [historicalResource])
      )[0];
      assert.equal(richLive.content_format, "editor-json-v1");
      assert.deepEqual(JSON.parse(richLive.content), JSON.parse(payload.content));
      const restored = (
        await query("SELECT cms_mutate('restore','article',$1,$2,NULL,NULL,NULL,$3) AS r", [
          historicalResource,
          admin,
          historical.id,
        ])
      )[0].r;
      await publish(restored);
      const restoredLive = (
        await query("SELECT * FROM articles WHERE id=$1", [historicalResource])
      )[0];
      assert.equal(restoredLive.content, historicalPayload.content);
      assert.equal(restoredLive.content_format, "legacy-text");
      assert.deepEqual(restoredLive.supplemental_links, links);
      console.log(
        "PASS rich document round-trip and historical restore pairs legacy content/format while preserving omitted links",
      );

      const duplicateCopyColumns = await query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='blog_categories' AND column_name IN ('heading','introduction','seo_title','seo_description')",
        [schema],
      );
      assert.deepEqual(duplicateCopyColumns, []);
      const categoryDto = async () =>
        (
          await query(
            'SELECT c.id,c.key,c.name,c.navigation_order AS "navigationOrder",c.hidden,c.version,s.heading,s.introduction,s.seo_title AS "seoTitle",s.seo_description AS "seoDescription",s.version AS "settingsVersion" FROM blog_categories c JOIN blog_settings s ON s.category_id=c.id AND s.scope_kind=\'category\' WHERE c.id=$1',
            [category.id],
          )
        )[0];
      const initialDto = await categoryDto();
      assert.equal(initialDto.heading, "成交分析");
      await query(
        "UPDATE blog_settings SET heading='更新標題',introduction='更新簡介',seo_title='搜尋標題',seo_description='搜尋簡介',version=version+1 WHERE category_id=$1",
        [category.id],
      );
      const updatedDto = await categoryDto();
      assert.equal(updatedDto.heading, "更新標題");
      assert.equal(updatedDto.introduction, "更新簡介");
      assert.equal(updatedDto.seoTitle, "搜尋標題");
      assert.equal(updatedDto.seoDescription, "搜尋簡介");
      assert.equal(updatedDto.version, initialDto.version);
      assert.equal(updatedDto.settingsVersion, initialDto.settingsVersion + 1);
      console.log(
        "PASS category DTO derives PageCopy only from settings with separate metadata/settings versions",
      );
      console.log(
        "PASS blog schema: preservation, integrity, independent scopes, slug locks, CMS projection/authority/rollback",
      );
    } finally {
      await end();
    }
  });
}
await run();
