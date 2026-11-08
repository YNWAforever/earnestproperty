import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dbTargetOrOwned } from "./acceptance/owned-postgres-test.mjs";
import { MIGRATION_VERSIONS } from "../src/lib/control-plane/migration-versions.js";
import { applyMigrations, isolatedDatabase } from "./acceptance/migrated-schema.mjs";
// Owned Docker Postgres by default: a fresh database in a new loopback container, with every
// real migration applied to the random test schema. An explicit Neon run still needs
// CMS_TEST_DATABASE_URL plus CMS_TEST_DATABASE_APPROVED=disposable and passes the disposable
// guard. In CI a missing database fails (OWNED_DB_REQUIRED_NO_SKIPPED_PASS), never skips.
// No fallback to application credentials.
const url = process.env.CMS_TEST_DATABASE_URL;
if (url && process.env.CMS_TEST_DATABASE_APPROVED !== "disposable") {
  console.error(
    "CMS DB suite not run: CMS_TEST_DATABASE_URL also needs CMS_TEST_DATABASE_APPROVED=disposable for an explicitly approved disposable database.",
  );
  process.exit(2);
}
if (url && [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED].includes(url))
  throw Error("CMS DB suite refuses application database URL");
await dbTargetOrOwned(
  async (target) => {
    const { sql, end } = await isolatedDatabase(target);
    try {
      await runCmsSuite(sql, target.owned);
    } finally {
      await end();
    }
  },
  { urlVar: "CMS_TEST_DATABASE_URL" },
);

async function runCmsSuite(sql, owned) {
  const schema = "cms_test_" + randomUUID().replaceAll("-", "");
  // Each HTTP batch is a real transaction with a local search path; no interactive JS awaits.
  function splitStatements(text) {
    const parts = [];
    let start = 0;
    const tokens =
      /(--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|\$\$[\s\S]*?\$\$|;)/g;
    for (const match of text.matchAll(tokens))
      if (match[0] === ";") {
        const part = text.slice(start, match.index).trim();
        if (part) parts.push(part);
        start = match.index + 1;
      }
    const rest = text.slice(start).trim();
    if (rest) parts.push(rest);
    return parts;
  }
  const query = async (statement, params = []) => {
    const statements = params.length ? [statement] : splitStatements(statement);
    const results = await sql.transaction([
      sql.query(`SET LOCAL search_path TO ${schema}, public`),
      ...statements.map((s) => sql.query(s, params)),
    ]);
    return results.at(-1);
  };
  const admin = randomUUID(),
    manager = randomUUID(),
    agent = randomUUID(),
    viewer = randomUUID(),
    revoked = randomUUID();
  const roles = { admin, manager, agent, viewer, revoked };
  let passed = 0;
  const check = async (name, fn) => {
    await fn();
    console.log("PASS " + name);
    passed++;
  };
  const mutate = async (
    op,
    id,
    actor = admin,
    {
      payload = { slug: id, title: "Title", content: "Body" },
      base = null,
      edit = null,
      revision = null,
      type = "article",
    } = {},
  ) =>
    (
      await query(
        "SELECT cms_mutate($1,$2,$3::uuid,$4::uuid,$5::jsonb,$6::integer,$7::integer,$8::uuid) AS r",
        [op, type, id, actor, JSON.stringify(payload), base, edit, revision],
      )
    )[0].r;
  const publish = (d, actor = admin) =>
    mutate("publish", d.resource_id, actor, {
      base: d.base_published_version,
      edit: d.draft_edit_version,
      revision: d.id,
    });
  const snapshot = async (id) =>
    JSON.stringify(
      (
        await query(
          `SELECT jsonb_build_object('revisions',(SELECT jsonb_agg(r ORDER BY version_number) FROM cms_content_revisions r WHERE resource_id=$1),'live',(SELECT to_jsonb(a) FROM articles a WHERE id=$1),'audit',(SELECT jsonb_agg(l ORDER BY id) FROM audit_logs l WHERE subject_id=$1::uuid)) AS state`,
          [id],
        )
      )[0].state,
    );
  try {
    await sql.query(`CREATE SCHEMA ${schema}`);
    // Production's schema: every real migration, in order, in the random test schema.
    await applyMigrations(sql, schema, MIGRATION_VERSIONS);
    for (const [role, id] of Object.entries(roles)) {
      await query("INSERT INTO staff_users(id,active) VALUES($1,$2)", [id, role !== "revoked"]);
      await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [
        id,
        role === "revoked" ? "admin" : role,
      ]);
    }
    await check("actual active role matrix for every operation", async () => {
      for (const [role, actor] of [...Object.entries(roles), ["unauthenticated", null]]) {
        const id = randomUUID();
        const d = await mutate("save", id);
        await publish(d);
        const draft = await mutate("save", id, admin, { base: 1 });
        for (const op of ["save", "publish", "restore", "archive"]) {
          const allowed =
            ["admin", "manager"].includes(role) || (role === "agent" && op === "save");
          const call = () =>
            mutate(op, id, actor, {
              base: 1,
              edit: draft.draft_edit_version,
              revision: op === "restore" ? d.id : draft.id,
            });
          if (!allowed) await assert.rejects(call, /FORBIDDEN/);
          // Allowed operations use fresh independent resources to avoid cross-operation conflicts.
          else {
            const fresh = randomUUID();
            const a = await mutate("save", fresh, actor);
            if (op === "save") assert.equal(a.created_by, actor);
            else if (op === "publish") await publish(a, actor);
            else if (op === "restore") {
              await publish(a);
              await mutate("restore", fresh, actor, { revision: a.id });
            } else await mutate("archive", fresh, actor);
          }
        }
      }
    });
    await check("two new drafts allocate unique versions under same resource lock", async () => {
      const id = randomUUID();
      const drafts = await Promise.all([mutate("save", id, admin), mutate("save", id, manager)]);
      assert.deepEqual(drafts.map((d) => d.version_number).sort(), [1, 2]);
    });
    await check("first publication and two same-base publishers have one winner", async () => {
      const id = randomUUID();
      const drafts = await Promise.all([mutate("save", id, admin), mutate("save", id, manager)]);
      const results = await Promise.allSettled(drafts.map((d) => publish(d)));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        (
          await query(
            "SELECT count(*)::int AS n FROM cms_content_revisions WHERE resource_id=$1 AND state='published'",
            [id],
          )
        )[0].n,
        1,
      );
    });
    await check("stale same-draft saves reject one writer", async () => {
      const id = randomUUID();
      const d = await mutate("save", id);
      const results = await Promise.allSettled(
        [1, 2].map((n) =>
          mutate("save", id, admin, {
            revision: d.id,
            edit: 1,
            payload: { slug: id, title: "Title " + n },
          }),
        ),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        (await query("SELECT draft_edit_version FROM cms_content_revisions WHERE id=$1", [d.id]))[0]
          .draft_edit_version,
        2,
      );
    });
    await check("save versus publish cannot mutate the published snapshot", async () => {
      const id = randomUUID();
      const d = await mutate("save", id);
      const results = await Promise.allSettled([
        publish(d),
        mutate("save", id, admin, {
          revision: d.id,
          edit: 1,
          payload: { slug: id, title: "Changed" },
        }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const [r] = await query("SELECT * FROM cms_content_revisions WHERE id=$1", [d.id]);
      if (r.state === "published") assert.equal(r.payload.title, "Title");
    });
    await check(
      "restore v1 while v3 published creates fresh draft with current base and immutable history",
      async () => {
        const id = randomUUID();
        const a = await mutate("save", id);
        await publish(a);
        const b = await mutate("save", id, admin, { base: 1 });
        await publish(b);
        const c = await mutate("save", id, admin, { base: 2 });
        await publish(c);
        const restored = await mutate("restore", id, admin, { revision: a.id });
        assert.equal(restored.base_published_version, 3);
        assert.equal(restored.restored_from_revision_id, a.id);
        assert.equal(restored.version_number, 4);
        assert.deepEqual(restored.payload, a.payload);
        await assert.rejects(
          query("UPDATE cms_content_revisions SET payload='{}' WHERE id=$1", [a.id]),
          /CMS_IMMUTABLE_REVISION/,
        );
        await publish(restored);
      },
    );
    await check("restore identity rejects stale older draft with same edit token", async () => {
      const id = randomUUID();
      const a = await mutate("save", id);
      await publish(a);
      const old = await mutate("save", id, admin, { base: 1 });
      const restored = await mutate("restore", id, admin, { revision: a.id });
      assert.notEqual(old.id, restored.id);
      await assert.rejects(
        mutate("save", id, admin, { base: 1, revision: old.id, edit: 1 }),
        /CMS_REVISION_CONFLICT/,
      );
    });
    await check("restored publication has no retired actor draft fallback", async () => {
      const id = randomUUID();
      const a = await mutate("save", id);
      await publish(a);
      const older = await mutate("save", id, admin, { base: 1 });
      const restored = await mutate("restore", id, admin, { revision: a.id });
      await publish(restored);
      const active = await query(
        "SELECT * FROM cms_content_revisions WHERE resource_id=$1 AND state='draft' AND draft_retired_at IS NULL AND created_by=$2",
        [id, admin],
      );
      assert.equal(active.length, 0);
      const [historical] = await query("SELECT * FROM cms_content_revisions WHERE id=$1", [
        older.id,
      ]);
      assert.equal(historical.state, "draft");
      assert.ok(historical.draft_retired_at);
      assert.deepEqual(historical.payload, older.payload);
      await assert.rejects(
        query("UPDATE cms_content_revisions SET payload='{}' WHERE id=$1", [older.id]),
        /CMS_IMMUTABLE_REVISION/,
      );
      await assert.rejects(publish(older), /CMS_REVISION_CONFLICT/);
    });
    await check(
      "archive of draft-only resource invalidates every previously issued save and publish token",
      async () => {
        const id = randomUUID();
        const a = await mutate("save", id);
        const b = await mutate("save", id, manager);
        await mutate("archive", id);
        for (const d of [a, b]) {
          await assert.rejects(publish(d), /CMS_REVISION_CONFLICT/);
          await assert.rejects(
            mutate("save", id, d.created_by, { revision: d.id, edit: d.draft_edit_version }),
            /CMS_REVISION_CONFLICT/,
          );
        }
        assert.equal(
          (
            await query(
              "SELECT * FROM cms_content_revisions WHERE resource_id=$1 AND state='draft' AND draft_retired_at IS NULL",
              [id],
            )
          ).length,
          0,
        );
        assert.equal((await query("SELECT * FROM articles WHERE id=$1", [id])).length, 0);
      },
    );
    await check(
      "first publication versus archive never resurrects an archived draft token",
      async () => {
        const id = randomUUID();
        const a = await mutate("save", id);
        await Promise.allSettled([mutate("archive", id), publish(a)]);
        const rows = await query("SELECT published FROM articles WHERE id=$1", [id]);
        assert.ok(rows.length === 0 || rows[0].published === false);
        await assert.rejects(publish(a), /CMS_REVISION_CONFLICT/);
      },
    );
    await check("archive versus publish leaves matching visibility and publication", async () => {
      const id = randomUUID();
      const a = await mutate("save", id);
      await publish(a);
      const b = await mutate("save", id, admin, { base: 1 });
      await Promise.allSettled([mutate("archive", id), publish(b)]);
      const [r] = await query(
        "SELECT a.published, EXISTS(SELECT 1 FROM cms_content_revisions r WHERE r.resource_id=a.id AND state='published') AS revision_published FROM articles a WHERE id=$1",
        [id],
      );
      assert.equal(r.published, r.revision_published);
      assert.equal(r.published, false);
    });
    await check(
      "every archive/publish write failure rolls back revision, live projection and audit",
      async () => {
        await query(
          `CREATE FUNCTION cms_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_failure'; END $$;`,
        );
        for (const op of ["archive", "publish"])
          for (const [table, event, condition] of [
            ["cms_content_revisions", "INSERT", ""],
            ["cms_content_revisions", "UPDATE", "WHEN (OLD.state = 'published')"],
            ["cms_content_revisions", "UPDATE", "WHEN (OLD.state = 'draft')"],
            ["articles", "UPDATE", ""],
            ["audit_logs", "INSERT", ""],
          ]) {
            if (op === "publish" && event === "INSERT" && table === "cms_content_revisions")
              continue;
            const id = randomUUID();
            const a = await mutate("save", id);
            await publish(a);
            const d = await mutate("save", id, admin, { base: 1 });
            const before = await snapshot(id);
            await query(
              `CREATE TRIGGER fail_write BEFORE ${event} ON ${table} FOR EACH ROW ${condition} EXECUTE FUNCTION cms_test_fail()`,
            );
            try {
              await assert.rejects(
                op === "publish" ? publish(d) : mutate("archive", id),
                /injected_failure/,
              );
            } finally {
              await query(`DROP TRIGGER fail_write ON ${table}`);
            }
            assert.equal(await snapshot(id), before);
          }
      },
    );
    await check(
      "restore retirement and subsequent insert/audit failures roll back old complete state",
      async () => {
        for (const [table, event, condition] of [
          ["cms_content_revisions", "UPDATE", "WHEN (NEW.draft_retired_at IS NOT NULL)"],
          ["cms_content_revisions", "INSERT", ""],
          ["audit_logs", "INSERT", ""],
        ]) {
          const id = randomUUID();
          const a = await mutate("save", id);
          await publish(a);
          await mutate("save", id, admin, { base: 1 });
          const before = await snapshot(id);
          await query(
            `CREATE TRIGGER fail_write BEFORE ${event} ON ${table} FOR EACH ROW ${condition} EXECUTE FUNCTION cms_test_fail()`,
          );
          try {
            await assert.rejects(
              mutate("restore", id, admin, { revision: a.id }),
              /injected_failure/,
            );
          } finally {
            await query(`DROP TRIGGER fail_write ON ${table}`);
          }
          assert.equal(await snapshot(id), before);
        }
      },
    );
    await check(
      "publication retirement of legacy duplicate actor drafts rolls back with failed retirement write",
      async () => {
        const id = randomUUID();
        const a = await mutate("save", id);
        await publish(a);
        const d = await mutate("save", id, admin, { base: 1 });
        await query(
          "INSERT INTO cms_content_revisions(resource_type,resource_id,version_number,state,payload,base_published_version,created_by) VALUES('article',$1,3,'draft',$2::jsonb,1,$3)",
          [id, JSON.stringify(d.payload), admin],
        );
        const before = await snapshot(id);
        await query(
          "CREATE TRIGGER fail_write BEFORE UPDATE ON cms_content_revisions FOR EACH ROW WHEN (NEW.draft_retired_at IS NOT NULL) EXECUTE FUNCTION cms_test_fail()",
        );
        try {
          await assert.rejects(publish(d), /injected_failure/);
        } finally {
          await query("DROP TRIGGER fail_write ON cms_content_revisions");
        }
        assert.equal(await snapshot(id), before);
      },
    );
    await check(
      "title-only legacy estate publish preserves nullable arrays and all unedited fields",
      async () => {
        const id = randomUUID();
        await query(
          "INSERT INTO estates(id,slug,name_zh,district_slug,aliases,facilities,published,lat,description) VALUES($1::uuid,$1::text,'Before','district',NULL,NULL,true,22.4,' Body ')",
          [id],
        );
        const before = (
          await query(
            "SELECT to_jsonb(e)-'updated_at'-'name_zh' AS payload FROM estates e WHERE id=$1",
            [id],
          )
        )[0].payload;
        await query("SELECT * FROM cms_reconcile_legacy_estates($1,true)", [admin]);
        const payload = (
          await query("SELECT to_jsonb(e) AS payload FROM estates e WHERE id=$1", [id])
        )[0].payload;
        payload.name_zh = "After";
        const d = await mutate("save", id, admin, { type: "estate", payload, base: 1 });
        await mutate("publish", id, admin, {
          type: "estate",
          base: 1,
          edit: d.draft_edit_version,
          revision: d.id,
        });
        const after = (
          await query(
            "SELECT to_jsonb(e)-'updated_at'-'name_zh' AS payload FROM estates e WHERE id=$1",
            [id],
          )
        )[0].payload;
        assert.deepEqual(after, before);
        assert.equal(after.aliases, null);
        assert.equal(after.facilities, null);
      },
    );
    await check(
      "legacy estate dry-run and reconciliation are idempotent and preserve visibility",
      async () => {
        const visible = randomUUID(),
          hidden = randomUUID();
        await query(
          "INSERT INTO estates(id,slug,name_zh,published) VALUES($1::uuid,$1::text,'Legacy',true),($2::uuid,$2::text,'Legacy',false)",
          [visible, hidden],
        );
        const dry = await query("SELECT * FROM cms_reconcile_legacy_estates($1,false)", [admin]);
        assert.equal(dry.length, 2);
        assert.ok(dry.every((r) => !r.applied));
        assert.equal(
          (await query("SELECT * FROM cms_reconcile_legacy_estates($1,true)", [admin])).length,
          2,
        );
        assert.equal(
          (await query("SELECT * FROM cms_reconcile_legacy_estates($1,true)", [admin])).length,
          0,
        );
        assert.equal(
          (await query("SELECT published FROM estates WHERE id=$1", [hidden]))[0].published,
          false,
        );
      },
    );
    console.log(
      `CMS ${owned ? "owned Postgres" : "disposable"} database: ${passed} groups passed.`,
    );
  } finally {
    // Only the exact random test schema in the owned or explicitly approved disposable database.
    await sql.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
}
