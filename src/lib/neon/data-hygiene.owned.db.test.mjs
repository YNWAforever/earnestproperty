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
const FAQ_SCOPE = "synthetic-fx18a";

const actor = (staffId, role) => ({
  staffId,
  authUserId: "synthetic-fx18a-" + staffId,
  roles: [role],
});
const admin = actor(ADMIN, "admin");
const manager = actor(MANAGER, "manager");

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
    await withOwnedPostgres(async ({ query, transaction }) => {
      await mockOwnedServerDb(mock, query, transaction);
      const server = await import("./admin-data.server.ts");
      const { createYouTubeSyncRepository } =
        await import("../youtube-sync/youtube-repository.server.ts");

      for (const [staffId, role] of [
        [ADMIN, "admin"],
        [MANAGER, "manager"],
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

      await t.test("when the audit insert fails, the FAQ and video writes roll back", async () => {
        const faqId = await insertFaq(106, "樓齡？", "二十年");
        const videoId = await insertVideo(206, "大堂");
        const faq = await readFaq(faqId);
        const video = await readVideo(videoId);
        await query(`CREATE FUNCTION fx18a_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.action IN ('faq.update', 'cms_video.update') THEN
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
        } finally {
          await query("DROP TRIGGER fx18a_fail_audit ON audit_logs");
          await query("DROP FUNCTION fx18a_fail_audit()");
        }
        assert.equal((await faqRow(faqId)).answer, "二十年");
        assert.equal((await videoRow(videoId)).title, "大堂");
        assert.equal((await readFaq(faqId)).version, faq.version);
        assert.equal((await readVideo(videoId)).version, video.version);
        assert.equal((await audits(faqId)).length, 0);
        assert.equal((await audits(videoId)).length, 0);
      });
    });
  } finally {
    network.mock.restore();
    if (previousWake === undefined) delete process.env.OPS_WAKE_URL;
    else process.env.OPS_WAKE_URL = previousWake;
  }
});
