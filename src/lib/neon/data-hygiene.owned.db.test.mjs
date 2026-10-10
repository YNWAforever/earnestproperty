import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

// FX-18a data hygiene. One owned container for the whole file; later tasks add
// subtests below. Synthetic data only. Nothing talks to WozTell, Neon
// production, YouTube or a model: fetch throws and the ops wake is disabled.

const id = (n) => `79180000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = id(1);
const MANAGER = id(2);
const AGENT = id(3);
const FAQ_SCOPE = "synthetic-fx18a";

const actor = (staffId, role) => ({
  staffId,
  authUserId: "synthetic-fx18a-" + staffId,
  roles: [role],
});
const admin = actor(ADMIN, "admin");
const manager = actor(MANAGER, "manager");
const agent = actor(AGENT, "agent");

async function rejectsWith(promise, status, body) {
  let error;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof Response, "expected a thrown Response, got " + String(error));
  assert.equal(error.status, status);
  if (body !== undefined) assert.equal(await error.text(), body);
}

function faqDraft(row, overrides = {}) {
  return {
    id: row.id,
    scope: row.scope,
    question: row.question,
    answer: row.answer,
    sort_order: row.sort_order,
    expected_version: row.version,
    ...overrides,
  };
}

function videoDraft(row, overrides = {}) {
  return {
    id: row.id,
    title: row.title,
    video_url: row.video_url,
    description: row.description,
    sort_order: row.sort_order,
    published: row.published,
    category: row.category,
    expected_version: row.version,
    ...overrides,
  };
}

test("FX-18a data hygiene on owned Postgres", { timeout: 300000 }, async (t) => {
  const previousWake = process.env.OPS_WAKE_URL;
  process.env.OPS_WAKE_URL = "";
  const network = mock.method(globalThis, "fetch", () => {
    throw new Error("FX-18a owned test: network is disabled");
  });
  try {
    await withOwnedPostgres(async ({ pool, query, transaction }) => {
      await mockOwnedServerDb(mock, query, transaction);
      const server = await import("./admin-data.server.ts");
      const { createYouTubeSyncRepository } =
        await import("../youtube-sync/youtube-repository.server.ts");
      const { fetchFaqs } = await import("./public-data.server.ts");
      const { buildLiveAgentReply } = await import("../ai/live-agent-reply.server.ts");
      const { publicKnowledgeCurrentSourcesCte } =
        await import("../ai/knowledge-freshness.server.ts");

      for (const [staffId, role] of [
        [ADMIN, "admin"],
        [MANAGER, "manager"],
        [AGENT, "agent"],
      ]) {
        await query(
          "INSERT INTO staff_users(id,auth_user_id,email,name_zh,active) VALUES($1,$2,$3,$4,true)",
          [
            staffId,
            "synthetic-fx18a-" + staffId,
            "fx18a-" + staffId.slice(-2) + "@example.invalid",
            "測試同事" + staffId.slice(-1),
          ],
        );
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [staffId, role]);
      }

      const insertFaq = async (n, question, answer, published = true) => {
        await query(
          "INSERT INTO faqs(id,scope,question,answer,sort_order,published) VALUES($1,$2,$3,$4,$5,$6)",
          [id(n), FAQ_SCOPE, question, answer, n, published],
        );
        return id(n);
      };
      const insertVideo = async (n, title) => {
        await query(
          `INSERT INTO cms_videos(id,title,video_url,description,sort_order,published,category)
           VALUES($1,$2,$3,'synthetic',$4,true,NULL)`,
          [id(n), title, "https://youtu.be/AAAAAAAAAA" + String.fromCharCode(64 + (n % 26)), n],
        );
        return id(n);
      };
      const faqRow = async (faqId) =>
        (await query("SELECT * FROM faqs WHERE id=$1", [faqId]))[0] ?? null;
      const videoRow = async (videoId) =>
        (await query("SELECT * FROM cms_videos WHERE id=$1", [videoId]))[0] ?? null;
      const audits = async (subjectId) =>
        query(
          "SELECT actor_id::text, action, metadata FROM audit_logs WHERE subject_id=$1 ORDER BY created_at, id",
          [subjectId],
        );
      const readFaq = async (faqId) => {
        const cms = await server.listAdminCms();
        const row = cms.faqs.find((faq) => faq.id === faqId);
        assert.ok(row, "FAQ must be listed");
        return row;
      };
      const readVideo = async (videoId) => {
        const row = (await server.fetchAdminCmsVideos()).find((video) => video.id === videoId);
        assert.ok(row, "video must be listed");
        return row;
      };

      await t.test(
        "own consecutive FAQ and video saves succeed; a second tab's stale save gets 409 and writes nothing",
        async () => {
          const faqId = await insertFaq(101, "停車位？", "有");
          const adminTab = await readFaq(faqId);
          const managerTab = await readFaq(faqId);
          assert.match(adminTab.version, /^[0-9a-f]{32}$/);
          assert.equal(adminTab.published, true);

          const first = await server.saveAdminFaq(
            faqDraft(adminTab, { answer: "有，月租" }),
            admin,
          );
          assert.equal(first.id, faqId);
          assert.notEqual(first.version, adminTab.version);
          // The same tab saves again from the version its last save returned.
          const second = await server.saveAdminFaq(
            faqDraft(adminTab, { answer: "有，月租及時租", expected_version: first.version }),
            admin,
          );
          assert.notEqual(second.version, first.version);
          // A double click: nothing changed, same version, no audit row, no 409.
          const before = (await audits(faqId)).length;
          const again = await server.saveAdminFaq(
            faqDraft(adminTab, { answer: "有，月租及時租", expected_version: second.version }),
            admin,
          );
          assert.equal(again.version, second.version);
          assert.equal((await audits(faqId)).length, before);
          assert.equal((await readFaq(faqId)).version, second.version);

          await rejectsWith(
            server.saveAdminFaq(faqDraft(managerTab, { answer: "沒有" }), manager),
            409,
            "CMS_ROW_CHANGED",
          );
          assert.equal((await faqRow(faqId)).answer, "有，月租及時租");
          assert.equal((await audits(faqId)).length, before);

          const videoId = await insertVideo(201, "屋苑導覽");
          const adminVideo = await readVideo(videoId);
          const managerVideo = await readVideo(videoId);
          assert.match(adminVideo.version, /^[0-9a-f]{32}$/);
          const v1 = await server.saveAdminCmsVideo(
            videoDraft(adminVideo, { title: "屋苑導覽 2026" }),
            admin,
          );
          assert.equal(v1.id, videoId);
          const v2 = await server.saveAdminCmsVideo(
            videoDraft(adminVideo, {
              title: "屋苑導覽 2026",
              sort_order: 7,
              expected_version: v1.version,
            }),
            admin,
          );
          assert.notEqual(v2.version, v1.version);
          const videoAudits = (await audits(videoId)).length;
          const v3 = await server.saveAdminCmsVideo(
            videoDraft(adminVideo, {
              title: "屋苑導覽 2026",
              sort_order: 7,
              expected_version: v2.version,
            }),
            admin,
          );
          assert.equal(v3.version, v2.version);
          assert.equal((await audits(videoId)).length, videoAudits);

          await rejectsWith(
            server.saveAdminCmsVideo(videoDraft(managerVideo, { title: "舊標題" }), manager),
            409,
            "CMS_ROW_CHANGED",
          );
          const video = await videoRow(videoId);
          assert.equal(video.title, "屋苑導覽 2026");
          assert.equal(video.sort_order, 7);
          assert.equal((await audits(videoId)).length, videoAudits);
        },
      );

      await t.test(
        "a FAQ save without a version is refused with 400 and writes nothing",
        async () => {
          const faqId = await insertFaq(102, "管理費？", "每月");
          const view = await readFaq(faqId);
          for (const expected_version of [
            undefined,
            "",
            "2026-10-06T03:04:05.123456Z",
            "X".repeat(32),
          ]) {
            await rejectsWith(
              server.saveAdminFaq(faqDraft(view, { answer: "改了", expected_version }), admin),
              400,
              "CMS_ROW_VERSION_REQUIRED",
            );
          }
          assert.equal((await faqRow(faqId)).answer, "每月");
          assert.equal((await audits(faqId)).length, 0);

          const videoId = await insertVideo(202, "會所");
          const video = await readVideo(videoId);
          await rejectsWith(
            server.saveAdminCmsVideo(
              videoDraft(video, { title: "改了", expected_version: undefined }),
              admin,
            ),
            400,
            "CMS_ROW_VERSION_REQUIRED",
          );
          assert.equal((await videoRow(videoId)).title, "會所");
          assert.equal((await audits(videoId)).length, 0);
        },
      );

      await t.test("the audit row has before and after of the changed fields only", async () => {
        const faqId = await insertFaq(103, "近港鐵？", "步行十分鐘");
        const view = await readFaq(faqId);
        const saved = await server.saveAdminFaq(faqDraft(view, { answer: "步行八分鐘" }), manager);
        const rows = await audits(faqId);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].action, "faq.update");
        assert.equal(rows[0].actor_id, MANAGER);
        assert.deepEqual(rows[0].metadata, {
          changed: ["answer"],
          before: { answer: "步行十分鐘" },
          after: { answer: "步行八分鐘" },
          expectedVersion: view.version,
          version: saved.version,
        });

        const videoId = await insertVideo(203, "泳池");
        const video = await readVideo(videoId);
        const savedVideo = await server.saveAdminCmsVideo(
          videoDraft(video, { category: "facilities", sort_order: 9 }),
          admin,
        );
        const videoAudits = await audits(videoId);
        assert.equal(videoAudits.length, 1);
        assert.equal(videoAudits[0].action, "cms_video.update");
        assert.equal(videoAudits[0].actor_id, ADMIN);
        assert.deepEqual(videoAudits[0].metadata, {
          changed: ["category", "sort_order"],
          before: { category: null, sort_order: 203 },
          after: { category: "facilities", sort_order: 9 },
          expectedVersion: video.version,
          version: savedVideo.version,
        });

        const created = await server.saveAdminFaq(
          { scope: FAQ_SCOPE, question: "可養寵物？", answer: "可以", sort_order: 4 },
          admin,
        );
        assert.match(created.id, /^[0-9a-f-]{36}$/);
        const createdAudit = await audits(created.id);
        assert.equal(createdAudit.length, 1);
        assert.equal(createdAudit[0].action, "faq.create");
        assert.deepEqual(createdAudit[0].metadata.after, {
          scope: FAQ_SCOPE,
          question: "可養寵物？",
          answer: "可以",
          sort_order: 4,
          published: true,
        });

        const createdVideo = await server.saveAdminCmsVideo(
          {
            title: "新片",
            video_url: "https://youtu.be/BBBBBBBBBBB",
            description: null,
            sort_order: 1,
            published: false,
            category: null,
          },
          admin,
        );
        const createdVideoAudit = await audits(createdVideo.id);
        assert.equal(createdVideoAudit.length, 1);
        assert.equal(createdVideoAudit[0].action, "cms_video.create");
        assert.equal(createdVideoAudit[0].metadata.after.title, "新片");
        assert.equal(createdVideoAudit[0].metadata.version, createdVideo.version);
      });

      await t.test(
        "a YouTube sync run that leaves staff fields unchanged does not change the video version",
        async () => {
          const repository = createYouTubeSyncRepository({ queryRows: query });
          const channelId = "UCsyntheticFX18a";
          const youtubeId = "FX18aVideo1";
          const run = async (owner, at) => {
            const now = new Date(at);
            const lease = await repository.acquireLease({ channelId, owner, now });
            assert.ok(lease, "lease must be acquired");
            const summary = await repository.applySnapshot({
              channelId,
              owner,
              mode: "incremental",
              videos: [
                {
                  videoId: youtubeId,
                  title: "YouTube 標題",
                  description: "YouTube description",
                  publishedAt: "2026-10-01T00:00:00.000Z",
                  canonicalUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
                  adoptionId: null,
                  expectedManualUrl: null,
                },
              ],
              newestVideoId: youtubeId,
              completedAt: new Date(now.getTime() + 1000),
              period: null,
            });
            await repository.releaseLease({
              channelId,
              owner,
              now: new Date(now.getTime() + 2000),
            });
            return summary;
          };

          // Assert on the rows, not the run summary: its inserted/updated split is
          // not what this test is about.
          await run(id(301), "2026-10-10T01:00:00.000Z");
          const [{ id: videoId }] = await query(
            "SELECT id::text FROM cms_videos WHERE youtube_video_id=$1",
            [youtubeId],
          );
          const staffView = await readVideo(videoId);
          const updatedBefore = (await videoRow(videoId)).updated_at.toISOString();

          await run(id(302), "2026-10-10T02:00:00.000Z");
          const synced = await query("SELECT id::text FROM cms_videos WHERE youtube_video_id=$1", [
            youtubeId,
          ]);
          assert.deepEqual(synced, [{ id: videoId }]);
          assert.notEqual((await videoRow(videoId)).updated_at.toISOString(), updatedBefore);
          assert.equal((await readVideo(videoId)).version, staffView.version);

          // The staff tab opened before the sync still saves.
          const saved = await server.saveAdminCmsVideo(
            videoDraft(staffView, { category: "estate-tour" }),
            admin,
          );
          assert.notEqual(saved.version, staffView.version);
          assert.equal((await videoRow(videoId)).category, "estate-tour");
        },
      );

      await t.test(
        "import of a question that is archived changes nothing and reports FAQ_ARCHIVED",
        async () => {
          const archivedId = await insertFaq(104, "可以租車位？", "可以", false);
          const result = await server.saveAdminFaq(
            {
              scope: FAQ_SCOPE,
              question: "可以租車位？",
              answer: "新答案",
              sort_order: 1,
              upsert: true,
            },
            admin,
          );
          assert.deepEqual(result, { id: "", error: "FAQ_ARCHIVED" });
          const row = await faqRow(archivedId);
          assert.equal(row.answer, "可以");
          assert.equal(row.published, false);
          assert.equal((await audits(archivedId)).length, 0);

          // The single form names the archived match instead of the live-match text.
          assert.deepEqual(
            await server.saveAdminFaq(
              { scope: FAQ_SCOPE, question: "可以租車位？", answer: "x", sort_order: 1 },
              admin,
            ),
            { id: "", error: "FAQ_ARCHIVED_DUPLICATE" },
          );
          const liveId = await insertFaq(105, "有會所？", "有");
          assert.deepEqual(
            await server.saveAdminFaq(
              { scope: FAQ_SCOPE, question: "有會所？", answer: "x", sort_order: 1 },
              admin,
            ),
            { id: "", error: "此範圍已有相同問題，請改用編輯。" },
          );

          // Editing an archived FAQ is refused even with its current version.
          const archivedView = await readFaq(archivedId);
          assert.equal(archivedView.published, false);
          await rejectsWith(
            server.saveAdminFaq(faqDraft(archivedView, { answer: "改了" }), admin),
            409,
            "FAQ_ARCHIVED",
          );
          assert.equal((await faqRow(archivedId)).answer, "可以");

          // A live match still updates in place, audited with before and after.
          const liveBefore = await readFaq(liveId);
          const upserted = await server.saveAdminFaq(
            {
              scope: FAQ_SCOPE,
              question: "有會所？",
              answer: "有，設泳池",
              sort_order: 2,
              upsert: true,
            },
            admin,
          );
          assert.equal(upserted.id, liveId);
          assert.equal(upserted.inserted, false);
          assert.equal(upserted.version, (await readFaq(liveId)).version);
          assert.notEqual(upserted.version, liveBefore.version);
          const liveAudits = await audits(liveId);
          assert.equal(liveAudits.length, 1);
          assert.equal(liveAudits[0].action, "faq.update");
          assert.deepEqual(liveAudits[0].metadata.before, { answer: "有" });
          assert.deepEqual(liveAudits[0].metadata.after, { answer: "有，設泳池" });
          // Re-importing the same answer writes no audit row.
          await server.saveAdminFaq(
            {
              scope: FAQ_SCOPE,
              question: "有會所？",
              answer: "有，設泳池",
              sort_order: 2,
              upsert: true,
            },
            admin,
          );
          assert.equal((await audits(liveId)).length, 1);

          const fresh = await server.saveAdminFaq(
            {
              scope: FAQ_SCOPE,
              question: "新問題？",
              answer: "新答案",
              sort_order: 3,
              upsert: true,
            },
            admin,
          );
          assert.equal(fresh.inserted, true);
          assert.equal((await audits(fresh.id))[0].action, "faq.create");

          const cms = await server.listAdminCms();
          const group = cms.faqGroups.find((g) => g.scope === FAQ_SCOPE);
          const scoped = cms.faqs.filter((faq) => faq.scope === FAQ_SCOPE);
          assert.equal(group.total, scoped.filter((faq) => faq.published).length);
          assert.equal(group.archived, scoped.filter((faq) => !faq.published).length);
          assert.ok(group.archived >= 1);
        },
      );

      // ---- Task 2 (C-12): FAQ delete archives with a fresh snapshot; managers restore it.
      const faqRevisions = async (faqId) =>
        query(
          `SELECT version_number, state, payload, created_by::text, restored_from_revision_id::text
           FROM cms_content_revisions WHERE resource_type='faq' AND resource_id=$1
           ORDER BY version_number`,
          [faqId],
        );
      // The July 2026 migration gave every FAQ a v1 published revision once.
      const seedJulyRevision = async (faqId) =>
        query(
          `INSERT INTO cms_content_revisions(resource_type,resource_id,version_number,state,payload,published_at)
           SELECT 'faq', f.id, 1, 'published', to_jsonb(f) - 'created_at' - 'updated_at', now()
           FROM faqs f WHERE f.id=$1`,
          [faqId],
        );
      const publicFaq = async (question) =>
        (await fetchFaqs({ scope: FAQ_SCOPE })).find((faq) => faq.question === question) ?? null;
      const chatbotFaqCard = async (question) => {
        const reply = await buildLiveAgentReply(question);
        return reply.cards.find((card) => card.type === "faq" && card.title === question) ?? null;
      };
      const inKnowledgeSources = async (faqId) =>
        (
          await query(
            `${publicKnowledgeCurrentSourcesCte()}
             SELECT source_id FROM current_public_sources
             WHERE source_type='faq' AND source_id=$1`,
            [faqId],
          )
        ).length === 1;

      await t.test(
        "an archived FAQ is hidden from fetchFaqs, the chatbot reader and the knowledge sources, and restore brings back the answer it had when archived",
        async () => {
          const question = "會所泳池幾點開放？";
          const faqId = await insertFaq(110, question, "早上七時開放");
          await seedJulyRevision(faqId);
          const edited = await server.saveAdminFaq(
            faqDraft(await readFaq(faqId), { answer: "早上六時半至晚上十時開放" }),
            manager,
          );
          assert.equal(edited.id, faqId);

          assert.equal((await publicFaq(question))?.answer, "早上六時半至晚上十時開放");
          assert.deepEqual((await chatbotFaqCard(question))?.lines, ["早上六時半至晚上十時開放"]);
          assert.equal(await inKnowledgeSources(faqId), true);

          assert.deepEqual(await server.deleteAdminFaq(faqId, manager), { ok: true });

          assert.equal(await publicFaq(question), null);
          assert.equal(await chatbotFaqCard(question), null);
          assert.equal(await inKnowledgeSources(faqId), false);
          const archivedRow = await faqRow(faqId);
          assert.equal(archivedRow.published, false);
          assert.equal(archivedRow.answer, "早上六時半至晚上十時開放");

          const restored = await server.restoreAdminFaq(faqId, manager);
          assert.equal(restored.ok, true);
          const view = await readFaq(faqId);
          assert.equal(restored.version, view.version);
          assert.equal(view.published, true);
          assert.equal(view.answer, "早上六時半至晚上十時開放");
          assert.equal(view.sort_order, 110);

          assert.equal((await publicFaq(question))?.answer, "早上六時半至晚上十時開放");
          assert.deepEqual((await chatbotFaqCard(question))?.lines, ["早上六時半至晚上十時開放"]);
          assert.equal(await inKnowledgeSources(faqId), true);

          // v1 July (superseded), v2 fresh snapshot (superseded), v3 archived,
          // v4 restored draft now published.
          const revisions = await faqRevisions(faqId);
          assert.deepEqual(
            revisions.map((r) => [r.version_number, r.state]),
            [
              [1, "superseded"],
              [2, "superseded"],
              [3, "archived"],
              [4, "published"],
            ],
          );
          assert.equal(revisions[2].payload.answer, "早上六時半至晚上十時開放");
          assert.equal(revisions[3].created_by, MANAGER);
          assert.ok(revisions[3].restored_from_revision_id);
          // One transaction's rows share created_at, so compare as a set.
          const actions = (await audits(faqId)).map((row) => row.action).sort();
          assert.deepEqual(actions, [
            "cms_archived",
            "cms_published",
            "cms_restored",
            "faq.update",
          ]);

          // The restored FAQ saves again with the version restore returned.
          const again = await server.saveAdminFaq(
            faqDraft(view, { answer: "早上六時開放" }),
            manager,
          );
          assert.equal(again.id, faqId);
        },
      );

      await t.test("archive of a FAQ that has no revision row works", async () => {
        const created = await server.saveAdminFaq(
          { scope: FAQ_SCOPE, question: "有洗衣房？", answer: "地庫有", sort_order: 111 },
          admin,
        );
        assert.equal(created.inserted, true);
        assert.equal((await faqRevisions(created.id)).length, 0);

        assert.deepEqual(await server.deleteAdminFaq(created.id, admin), { ok: true });
        const revisions = await faqRevisions(created.id);
        assert.deepEqual(
          revisions.map((r) => [r.version_number, r.state]),
          [
            [1, "superseded"],
            [2, "archived"],
          ],
        );
        assert.equal(revisions[1].payload.answer, "地庫有");
        assert.equal((await faqRow(created.id)).published, false);

        const restored = await server.restoreAdminFaq(created.id, admin);
        assert.equal(restored.ok, true);
        const row = await faqRow(created.id);
        assert.equal(row.published, true);
        assert.equal(row.answer, "地庫有");
        assert.equal(row.sort_order, 111);
      });

      await t.test(
        "delete writes one archived revision and one cms_archived audit row, and deletes no row",
        async () => {
          const faqId = await insertFaq(112, "有健身室？", "有");
          await seedJulyRevision(faqId);
          const result = await server.deleteAdminFaq(faqId, admin);
          assert.deepEqual(result, { ok: true });
          assert.ok(await faqRow(faqId), "the row is kept");
          const revisions = await faqRevisions(faqId);
          // The July revision already matches the live row, so no new snapshot.
          assert.deepEqual(
            revisions.map((r) => [r.version_number, r.state]),
            [
              [1, "superseded"],
              [2, "archived"],
            ],
          );
          const rows = await audits(faqId);
          assert.deepEqual(
            rows.map((row) => [row.actor_id, row.action]),
            [[ADMIN, "cms_archived"]],
          );
        },
      );

      await t.test(
        "restore by an agent is refused; by a manager it succeeds; a restore that collides with a live same question returns FAQ_RESTORE_CONFLICT and changes nothing",
        async () => {
          const faqId = await insertFaq(113, "有兒童遊樂場？", "有");
          await server.deleteAdminFaq(faqId, admin);
          const before = await faqRevisions(faqId);

          await rejectsWith(server.restoreAdminFaq(faqId, agent), 403);
          assert.equal((await faqRow(faqId)).published, false);
          assert.equal((await faqRevisions(faqId)).length, before.length);
          // An agent cannot archive either.
          const liveId = await insertFaq(114, "有網球場？", "有");
          await rejectsWith(server.deleteAdminFaq(liveId, agent), 403);
          assert.equal((await faqRow(liveId)).published, true);
          assert.equal((await faqRevisions(liveId)).length, 0);

          const restored = await server.restoreAdminFaq(faqId, manager);
          assert.equal(restored.ok, true);
          assert.equal((await faqRow(faqId)).published, true);
          // Restoring a live FAQ is Not found and writes nothing.
          const count = (await faqRevisions(faqId)).length;
          assert.deepEqual(await server.restoreAdminFaq(faqId, manager), {
            ok: false,
            error: "Not found",
          });
          assert.equal((await faqRevisions(faqId)).length, count);

          // A FAQ archived through the revision engine before this change keeps
          // the July question; a live FAQ has since taken that question.
          const legacyId = await insertFaq(115, "有保安？", "二十四小時");
          await seedJulyRevision(legacyId);
          await server.saveAdminFaq(
            faqDraft(await readFaq(legacyId), { question: "有保安員？" }),
            admin,
          );
          await query("SELECT cms_mutate('archive','faq',$1::uuid,$2::uuid)", [legacyId, ADMIN]);
          const takenId = await insertFaq(116, "有保安？", "有");
          const legacyRevisions = await faqRevisions(legacyId);
          const legacyAudits = await audits(legacyId);

          await rejectsWith(server.restoreAdminFaq(legacyId, manager), 409, "FAQ_RESTORE_CONFLICT");
          const legacy = await faqRow(legacyId);
          assert.equal(legacy.published, false);
          assert.equal(legacy.question, "有保安員？");
          assert.equal((await faqRow(takenId)).answer, "有");
          assert.deepEqual(await faqRevisions(legacyId), legacyRevisions);
          assert.deepEqual(await audits(legacyId), legacyAudits);
        },
      );

      await t.test(
        "deleting an already archived FAQ returns Not found and adds no revision",
        async () => {
          const faqId = await insertFaq(117, "有穿梭巴士？", "有");
          await server.deleteAdminFaq(faqId, admin);
          const revisions = await faqRevisions(faqId);
          const rows = await audits(faqId);
          assert.deepEqual(await server.deleteAdminFaq(faqId, admin), {
            ok: false,
            error: "Not found",
          });
          assert.deepEqual(await faqRevisions(faqId), revisions);
          assert.deepEqual(await audits(faqId), rows);
          assert.deepEqual(await server.deleteAdminFaq(id(999), admin), {
            ok: false,
            error: "Not found",
          });
        },
      );

      await t.test(
        "a save racing an archive waits for it and gets FAQ_ARCHIVED; the archived payload equals the row",
        async () => {
          const faqId = await insertFaq(120, "有升降機？", "有兩部");
          await seedJulyRevision(faqId);
          await server.saveAdminFaq(faqDraft(await readFaq(faqId), { answer: "有三部" }), admin);
          const tab = await readFaq(faqId);

          // Connection X holds the July revision, so the archive stops at its
          // supersede step, after everything it locked before that step.
          const holder = await pool.connect();
          let archive;
          let save;
          try {
            await holder.query("BEGIN");
            await holder.query(
              "SELECT id FROM cms_content_revisions WHERE resource_type='faq' AND resource_id=$1 AND state='published' FOR UPDATE",
              [faqId],
            );
            const waiting = async (pattern) => {
              for (let i = 0; i < 200; i++) {
                const rows = await query(
                  `SELECT 1 FROM pg_stat_activity
                   WHERE wait_event_type = 'Lock' AND query LIKE $1`,
                  [pattern],
                );
                if (rows.length) return true;
                await new Promise((resolve) => setTimeout(resolve, 25));
              }
              return false;
            };
            archive = server.deleteAdminFaq(faqId, admin).then(
              (value) => ({ value }),
              (error) => ({ error }),
            );
            assert.ok(await waiting("%UPDATE cms_content_revisions SET state = 'superseded'%"));

            let saveDone = false;
            save = server
              .saveAdminFaq(faqDraft(tab, { answer: "有四部" }), admin)
              .then(
                (value) => ({ value }),
                (error) => ({ error }),
              )
              .finally(() => {
                saveDone = true;
              });
            // The save must queue behind the archive's row lock, not slip in.
            for (let i = 0; i < 40 && !saveDone; i++) {
              const rows = await query(
                `SELECT 1 FROM pg_stat_activity
                 WHERE wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%' AND query LIKE '%FROM faqs f%'`,
              );
              if (rows.length) break;
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
            assert.equal(saveDone, false, "the save committed while the archive was in flight");
          } finally {
            await holder.query("COMMIT");
            holder.release();
          }

          assert.deepEqual((await archive).value, { ok: true });
          const saved = await save;
          assert.ok(saved.error instanceof Response, "the save must be refused");
          assert.equal(saved.error.status, 409);
          assert.equal(await saved.error.text(), "FAQ_ARCHIVED");

          const row = await faqRow(faqId);
          assert.equal(row.published, false);
          assert.equal(row.answer, "有三部");
          const archived = (await faqRevisions(faqId)).filter((r) => r.state === "archived");
          assert.equal(archived.length, 1);
          assert.equal(archived[0].payload.answer, row.answer);
        },
      );

      await t.test(
        "the import conflict check lists archived matches apart from live ones",
        async () => {
          await insertFaq(118, "有寵物公園？", "有");
          const archivedId = await insertFaq(119, "有燒烤場？", "有");
          await server.deleteAdminFaq(archivedId, admin);
          const result = await server.checkAdminFaqConflicts(
            [
              { scope: FAQ_SCOPE, question: "有寵物公園？" },
              { scope: FAQ_SCOPE, question: "有燒烤場？" },
              { scope: FAQ_SCOPE, question: "全新問題？" },
            ],
            admin,
          );
          assert.deepEqual(result, {
            existing: [{ scope: FAQ_SCOPE, question: "有寵物公園？" }],
            archived: [{ scope: FAQ_SCOPE, question: "有燒烤場？" }],
          });
          assert.deepEqual(await server.checkAdminFaqConflicts([], admin), {
            existing: [],
            archived: [],
          });
        },
      );

      await t.test("when the audit insert fails, the FAQ and video writes roll back", async () => {
        const faqId = await insertFaq(106, "樓齡？", "二十年");
        const videoId = await insertVideo(206, "大堂");
        const faq = await readFaq(faqId);
        const video = await readVideo(videoId);
        await query(`CREATE FUNCTION fx18a_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.action IN ('faq.update', 'cms_video.update', 'cms_archived') THEN
              RAISE EXCEPTION 'fx18a synthetic audit failure';
            END IF;
            RETURN NEW;
          END $$`);
        await query(
          "CREATE TRIGGER fx18a_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fx18a_fail_audit()",
        );
        try {
          await assert.rejects(
            server.saveAdminFaq(faqDraft(faq, { answer: "二十一年" }), admin),
            /fx18a synthetic audit failure/,
          );
          await assert.rejects(
            server.saveAdminCmsVideo(videoDraft(video, { title: "大堂 2026" }), admin),
            /fx18a synthetic audit failure/,
          );
          // FAQ archive: the snapshot, archived revision and published=false roll back too.
          await assert.rejects(
            server.deleteAdminFaq(faqId, admin),
            /fx18a synthetic audit failure/,
          );
        } finally {
          await query("DROP TRIGGER fx18a_fail_audit ON audit_logs");
          await query("DROP FUNCTION fx18a_fail_audit()");
        }
        assert.equal((await faqRow(faqId)).answer, "二十年");
        assert.equal((await faqRow(faqId)).published, true);
        assert.equal((await faqRevisions(faqId)).length, 0);
        assert.equal((await videoRow(videoId)).title, "大堂");
        assert.equal((await readFaq(faqId)).version, faq.version);
        assert.equal((await readVideo(videoId)).version, video.version);
        assert.equal((await audits(faqId)).length, 0);
        assert.equal((await audits(videoId)).length, 0);
      });

      await t.test(
        "agent cannot set verified or published, and cannot edit a verified or published transaction; manager and admin can",
        async () => {
          const estateId = id(901);
          await query(
            "INSERT INTO estates(id,slug,name_zh) VALUES($1,'synthetic-fx18a','測試屋苑')",
            [estateId],
          );
          const draft = (overrides = {}) => ({
            estate_id: estateId,
            deal_type: "sale",
            price: 8_000_000,
            saleable_area: 400,
            deal_date: "2026-08-01",
            unit: null,
            block: null,
            floor_band: null,
            source: "synthetic",
            source_url: null,
            verified: false,
            ...overrides,
          });
          const txRow = async (txId) =>
            (await query("SELECT * FROM transactions WHERE id=$1", [txId]))[0];
          const FORBIDDEN = "TRANSACTION_VERIFY_FORBIDDEN";

          // An agent creates an unverified deal, and may keep editing it.
          const { id: ownId } = await server.saveAdminTransaction(draft(), agent);
          assert.equal((await txRow(ownId)).verification_state, "unverified");
          await server.saveAdminTransaction(draft({ id: ownId, price: 8_100_000 }), agent);
          assert.equal(Number((await txRow(ownId)).price), 8_100_000);

          // The agent cannot verify or publish it, create one verified, or publish alone.
          const countBefore = (await query("SELECT count(*)::int AS n FROM transactions"))[0].n;
          for (const change of [{ verified: true }, { verified: true, published: true }]) {
            await rejectsWith(
              server.saveAdminTransaction(draft({ id: ownId, ...change }), agent),
              403,
              FORBIDDEN,
            );
            await rejectsWith(server.saveAdminTransaction(draft(change), agent), 403, FORBIDDEN);
          }
          const afterRefusals = await txRow(ownId);
          assert.equal(afterRefusals.verification_state, "unverified");
          assert.equal(afterRefusals.published, false);
          assert.equal(Number(afterRefusals.price), 8_100_000);
          assert.equal(
            (await query("SELECT count(*)::int AS n FROM transactions"))[0].n,
            countBefore,
          );

          // A manager verifies and publishes it; a manager's other edits still work.
          await server.saveAdminTransaction(
            draft({ id: ownId, verified: true, published: true }),
            manager,
          );
          const verified = await txRow(ownId);
          assert.equal(verified.verification_state, "verified");
          assert.equal(verified.published, true);

          // The agent now cannot edit it, even with the verified flags left off or on.
          for (const change of [
            { price: 1 },
            { price: 9_000_000, verified: false },
            { price: 9_000_000, verified: true, published: true },
          ]) {
            await assert.rejects(
              server.saveAdminTransaction(draft({ id: ownId, ...change }), agent),
              (error) => error instanceof Response && error.status === 403,
            );
          }
          const untouched = await txRow(ownId);
          assert.equal(Number(untouched.price), 8_000_000);
          assert.equal(untouched.verification_state, "verified");
          assert.equal(untouched.published, true);

          // A verified-but-unpublished row (set by an admin) is also closed to the agent.
          const { id: heldId } = await server.saveAdminTransaction(
            draft({ verified: true, published: false }),
            admin,
          );
          assert.equal((await txRow(heldId)).verification_state, "verified");
          assert.equal((await txRow(heldId)).published, false);
          await assert.rejects(
            server.saveAdminTransaction(draft({ id: heldId, price: 2 }), {
              ...agent,
              staffId: AGENT,
            }),
            (error) => error instanceof Response && error.status === 403,
          );
          assert.equal(Number((await txRow(heldId)).price), 8_000_000);

          // Manager and admin may still edit and un-verify a verified deal.
          await server.saveAdminTransaction(
            draft({ id: ownId, price: 8_200_000, verified: true }),
            admin,
          );
          assert.equal(Number((await txRow(ownId)).price), 8_200_000);
          await server.saveAdminTransaction(draft({ id: ownId, verified: false }), manager);
          assert.equal((await txRow(ownId)).verification_state, "unverified");
        },
      );
    });
  } finally {
    network.mock.restore();
    if (previousWake === undefined) delete process.env.OPS_WAKE_URL;
    else process.env.OPS_WAKE_URL = previousWake;
  }
});
