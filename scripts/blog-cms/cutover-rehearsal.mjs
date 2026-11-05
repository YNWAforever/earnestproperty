// Isolated acceptance hooks only; never an operational hosted pause or recovery adapter.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { verifyManifest } from "./verify-manifest.ts";
import { verifyImport, snapshotDatabase } from "../../src/lib/neon/blog-import.ts";
import { encodeArticle } from "../../src/lib/blog/article-codec.ts";
import { articleInput } from "../../src/components/admin/blog/blog-editor-state.ts";

export function cutoverRehearsal({ owned, api, publicApi, document }) {
  const { query, containerId } = owned;
  const targetIdentity = "owned:" + containerId + ":postgres";
  let staff, initialState;
  const forbidden = (e) => e.status === 403;
  const command = (record, patch) => ({
    id: record.id,
    expectedVersion: record.version,
    editState: record.editState,
    input: { ...articleInput(record), ...patch },
    action: "save",
    requestId: randomUUID(),
  });
  return {
    async pause(context) {
      initialState = context.initialState;
      staff = await query("SELECT id,active FROM staff_users ORDER BY id");
      assert.equal(staff.length, 4, "Only the four owned generated users may be suspended");
      assert.ok(staff.every((s) => s.active));
      await query("UPDATE staff_users SET active=false WHERE id=ANY($1::uuid[])", [
        staff.map((s) => s.id),
      ]);
      // Drain cooperating mutations already holding the existing transaction lock.
      await query("SELECT blog_lock()");
      for (const role of ["admin", "manager", "agent", "viewer"]) {
        await assert.rejects(
          api.list({ search: "", state: "all", page: 1, pageSize: 100 }, role),
          forbidden,
        );
        await assert.rejects(
          api.save({ input: context.inputs[0], action: "save", requestId: randomUUID() }, role),
          forbidden,
        );
      }
      await assert.rejects(api.settings(initialState.settings[0]), forbidden);
      await assert.rejects(api.category(initialState.categories[0]), forbidden);
      for (const s of staff) {
        await assert.rejects(
          query("SELECT blog_require_actor($1::uuid,false)", [s.id]),
          /BLOG_FORBIDDEN/,
        );
        // Alternate legacy/copilot mutation funnel checks active staff in the DB too.
        for (const op of ["save", "publish", "archive", "restore"])
          await assert.rejects(
            query("SELECT cms_mutate($1,'article',$2::uuid,$3::uuid)", [op, randomUUID(), s.id]),
            /FORBIDDEN/,
          );
      }
      assert.equal((await query("SELECT count(*)::int n FROM staff_users WHERE active"))[0].n, 0);
      // Deliberately prove the limit: privileged direct SQL remains admitted (zero rows touched).
      await query("UPDATE articles SET title=title WHERE false");
      console.log(
        "CUTOVER_PAUSE " +
          JSON.stringify({
            targetIdentity,
            staffBlocked: 4,
            mechanism: "staff_users.active=false plus blog_lock drain",
            allWriterPause: false,
            hosted: "BLOCKED",
            directSqlBypass: "demonstrated; zero-row UPDATE accepted",
          }),
      );
    },
    async fresh({ plan, reader }) {
      const approved = {
        fingerprint: plan.fingerprint,
        targetIdentity,
        sourceRevision: plan.inventory.sourceRevision,
      };
      const fresh = { ...plan.inventory, database: await snapshotDatabase(reader, 7) };
      console.log("CUTOVER_FRESHNESS " + JSON.stringify(verifyManifest(plan, fresh, approved)));
    },
    async imported({ plan, reader, receipt, inputs, backupSha256 }) {
      const retained = ".private-sync-evidence/blog-import/task9-rehearsal-" + containerId;
      mkdirSync(retained, { recursive: true });
      for (const [name, value] of Object.entries({
        manifest: plan,
        backup: plan.inventory.database,
        receipt,
      }))
        writeFileSync(retained + "/" + name + ".json", JSON.stringify(value), {
          flag: "wx",
          mode: 0o600,
        });
      assert.equal((await verifyImport(plan, reader)).verification, "unchanged");
      const snapshot = await snapshotDatabase(reader, 7);
      assert.equal(snapshot.tables.articles.length, inputs.length);
      assert.equal(snapshot.tables.cms_content_revisions.length, inputs.length);
      for (const input of inputs) {
        const mapped = receipt.inserted.find((r) => r.slug === input.slug);
        const row = snapshot.tables.articles.find((r) => r.id === mapped.id);
        const revision = snapshot.tables.cms_content_revisions.find(
          (r) => r.id === mapped.revisionId,
        );
        for (const [key, value] of Object.entries(encodeArticle(input))) {
          const liveValue =
            key === "published_at" && row[key] ? new Date(row[key]).toISOString() : row[key];
          assert.deepEqual(liveValue, value, input.slug + " live " + key);
          assert.deepEqual(revision.payload[key], value, input.slug + " revision " + key);
        }
        assert.equal(row.published, input.published);
        assert.equal(revision.state, input.published ? "published" : "archived");
        const visible = input.published && !input.publishedAt;
        const live = await publicApi.article(input.slug);
        assert.equal(live?.slug ?? null, visible ? input.slug : null);
        await document(
          "/blog/" + input.slug,
          visible ? 200 : 404,
          visible ? input.title : "找不到文章或分類",
        );
      }
      assert.deepEqual(await snapshotDatabase(reader, 7), snapshot, "verification is read-only");
      console.log(
        "CUTOVER_IMPORT_RECEIPT " +
          JSON.stringify({
            targetIdentity,
            systemIdentifier: reader.systemIdentifier,
            fingerprint: plan.fingerprint,
            sourceDigest: plan.inventory.sourceDigest,
            backupSha256,
            afterFingerprint: receipt.afterFingerprint,
            counts: receipt.counts,
            urlsVerifiedBeforeReopen: inputs.length,
            recordsVerifiedBeforeReopen: inputs.length,
            retained,
            renderer: "already-running bound local artifact; no deployment switch",
            invalidation: "fresh no-store HTTP requests; hosted CDN purge NOT_RUN",
          }),
      );
      // Restore only the exact initial rows/states; never blanket-enable accounts.
      for (const s of staff)
        await query("UPDATE staff_users SET active=$2 WHERE id=$1", [s.id, s.active]);
      assert.deepEqual(await query("SELECT id,active FROM staff_users ORDER BY id"), staff);
      assert.equal(
        (await api.list({ search: "", state: "all", page: 1, pageSize: 100 })).total,
        inputs.length,
      );
      console.log(
        "PASS CUTOVER_REOPEN exact owned staff states restored; existing sessions regain CMS access",
      );
    },
    async recover({ reader, records }) {
      const original = await api.preview({ id: records[3].id });
      // A bounded defect on one field after all post-import editorial changes.
      const damaged = await api.save(command(original, { seoTitle: "需要修復的SEO" }));
      const staleRepair = command(damaged, { seoTitle: original.seoTitle });
      const newer = await api.save(command(damaged, { title: "修復前的較新編輯" }));
      const before = await snapshotDatabase(reader, 7);
      await assert.rejects(api.save(staleRepair), (e) => e.status === 409);
      assert.deepEqual(await snapshotDatabase(reader, 7), before, "stale recovery has no writes");
      const repaired = await api.save(
        command(await api.preview({ id: newer.id }), { seoTitle: original.seoTitle }),
      );
      assert.equal(repaired.title, newer.title);
      assert.deepEqual(repaired.body, newer.body);
      assert.equal(repaired.seoTitle, original.seoTitle);
      assert.equal(repaired.published, newer.published);
      const after = await snapshotDatabase(reader, 7);
      const retained = ".private-sync-evidence/blog-import/task9-rehearsal-" + containerId;
      writeFileSync(
        retained + "/recovery.json",
        JSON.stringify({
          before,
          after,
          staleStatus: 409,
          resourceId: newer.id,
          field: "seoTitle",
          preservedNewerVersion: newer.version,
        }),
        { flag: "wx", mode: 0o600 },
      );
      for (const table of Object.keys(before.tables)) {
        const unaffected = (rows) =>
          rows.filter((r) =>
            table === "articles"
              ? r.id !== newer.id
              : table === "cms_content_revisions"
                ? r.resource_id !== newer.id
                : true,
          );
        assert.deepEqual(unaffected(after.tables[table]), unaffected(before.tables[table]), table);
      }
      assert.equal(await publicApi.article(records[0].slug), null, "withdrawn remains withdrawn");
      assert.equal(await publicApi.article(records[99].slug), null, "unpublished stays private");
      assert.equal(await publicApi.article(records[100].slug), null, "future stays private");
      assert.equal((await api.preview({ id: records[1].id }, "agent")).title, "私人草稿不可外洩");
      await document("/blog/" + repaired.slug, 200, newer.title);
      console.log(
        "CUTOVER_RECOVERY " +
          JSON.stringify({
            targetIdentity,
            mode: "CAS forward repair of one SEO field",
            staleRepair: "409/no writes",
            newerTitleAndBody: "preserved",
            otherProtectedRows: "byte-equivalent JSON",
            withdrawnDraftFuture: "preserved",
            activePrivateDraft: "preserved",
            beforeFingerprint: before.fingerprint,
            afterFingerprint: after.fingerprint,
            bulkRestore: "NOT_RUN",
          }),
      );
    },
  };
}
