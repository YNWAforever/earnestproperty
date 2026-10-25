import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import pg from "pg";
import sharp from "sharp";
import { withOwnedPostgres } from "../acceptance/owned-postgres-test.mjs";
import {
  buildSavedImportPlan,
  applySavedImport,
  assertImportTarget,
  OWNER_REPLACEMENTS,
} from "../../src/lib/mls/saved-capture-import.mjs";
import { inspectImportReadOnly } from "../../src/lib/mls/saved-capture-preflight.mjs";
import { applyIngestion } from "../../src/lib/mls/ingestion-repository.mjs";
import { batch as dailyBatch } from "../../src/lib/mls/ingestion-test-fixtures.mjs";
import { buildOwnedMediaPathname, sha256 } from "../../src/lib/mls/media.mjs";

async function withLocalClient(run) {
  if (process.env.IMPORT_TEST_DATABASE_URL) {
    assertImportTarget({
      IMPORT_DATABASE_URL: process.env.IMPORT_TEST_DATABASE_URL,
      IMPORT_TARGET_ENV: "development",
    });
    const client = new pg.Client({ connectionString: process.env.IMPORT_TEST_DATABASE_URL });
    await client.connect();
    try {
      return await run(client);
    } finally {
      await client.end();
    }
  }
  return withOwnedPostgres(async ({ pool }) => {
    const client = await pool.connect();
    try {
      return await run(client);
    } finally {
      client.release();
    }
  });
}

const sqlFile = async (name) =>
  readFile(new URL(`../../neon/migrations/${name}`, import.meta.url), "utf8");

test("local PostgreSQL: 52 creates + 3 in-place updates, sold skipped, owned photos, same-ID retry and source-truth safeguards", async () =>
  withLocalClient(async (client) => {
    const schema = "saved_import_" + randomUUID().replaceAll("-", "");
    const root = await mkdtemp(join(tmpdir(), "earnest-import-db-"));
    const q = async (sql, params = []) => (await client.query(sql, params)).rows;
    try {
      await q(`CREATE SCHEMA ${schema}`);
      await q(`SET search_path TO ${schema},public`);
      for (const migration of [
        "20260622060000_public_content.sql",
        "20260623090000_neon_admin_crm_whatsapp.sql",
        "20260709090000_cms_videos.sql",
        "20260711090000_cms_content_revisions.sql",
        "20260817120000_dual_source_listing_sync.sql",
        "20260830130000_estate_expansion.sql",
        "20260906040000_property_public_identity.sql",
        "20260906090000_canonical_property_identity.sql",
        "20260906120000_admin_property_management.sql",
        "20260907120000_propertyhk_ingestion_v2.sql",
        "20260909120000_source_promotion_tiers.sql",
      ]) {
        await q("BEGIN");
        try {
          await q(await sqlFile(migration));
          await q("COMMIT");
        } catch (error) {
          await q("ROLLBACK");
          throw new Error(`Migration ${migration}: ${error.message}`, { cause: error });
        }
      }
      // Exercise only the review-only schema guard in an isolated schema, not the owner policy seed.
      const preparedSql = await readFile(
        new URL("./sql/prepare-28hse-saved-import-policy.sql", import.meta.url),
        "utf8",
      );
      const guardDdl = preparedSql
        .split("-- BEGIN PARSER GUARD DDL (also exercised only in disposable-schema tests)\n")[1]
        .split("-- END PARSER GUARD DDL")[0];
      await q(guardDdl);
      const estate = (
        await q(
          "INSERT INTO estates(slug,name_zh,district_slug) VALUES('saved-test-estate','測試屋苑','test-district') RETURNING id",
        )
      )[0];
      await q("INSERT INTO districts(slug,name_zh) VALUES('test-district','測試區')");
      const config = {
        saved_capture_import: {
          parser_version: "saved-capture-import-v1",
          approved: true,
          approved_by: "synthetic-owner",
        },
        absence_enabled: false,
        estate_mappings: {},
        district_slugs: { 測試區: "test-district" },
        company_number_identity: {
          approved: true,
          version: "company-number-v1",
          approved_by: "synthetic-owner",
        },
      };
      await q(
        "INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,bootstrap_approved_at,bootstrap_approved_by,config) VALUES('28hse_agent_540','agent:540','no-hermes-v2','python-v2.2','no-hermes-v2',true,now(),'synthetic-owner',$1)",
        [config],
      );
      const entries = Array.from({ length: 52 }, (_, i) => ({
        source_id: String(9000001 + i),
        agent_listing_ref: `A${String(100000 + i)}`,
        deal_type: i < 34 ? "sale" : "rent",
      }));
      for (const [source_id, agent_listing_ref] of Object.entries(OWNER_REPLACEMENTS))
        entries.push({
          source_id,
          agent_listing_ref,
          deal_type: source_id === "4015403" ? "sale" : "rent",
        });
      entries.push({
        source_id: "4028435",
        agent_listing_ref: "R067756",
        deal_type: "sale",
        sold_label: true,
      });
      const legacyRun = (
        await q(
          "INSERT INTO listing_sync_runs(scheduled_for,mode,status,parser_version,finished_at) VALUES(current_date,'publish','healthy','synthetic-legacy',now()) RETURNING id",
        )
      )[0].id;
      const existingIds = new Map();
      for (const row of entries.filter((row) => OWNER_REPLACEMENTS[row.source_id])) {
        const existing = (
          await q(
            "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,estate_id,status,price,rent,description,images) VALUES($1,$1,'Old listing',$2,'test-district',$3,'active',5000000,20000,'Old details',ARRAY['https://old.invalid/old.jpg']) RETURNING id",
            [row.agent_listing_ref, row.deal_type === "sale" ? "rent" : "sale", estate.id],
          )
        )[0];
        existingIds.set(row.source_id, existing.id);
        await q(
          "INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,match_key,link_reason,status,first_seen_at,last_seen_at,last_seen_run_id) VALUES($1,'old_site',$2,$3,$4,'exact_property_no_and_deal_type','active',now(),now(),$5)",
          [
            existing.id,
            `old-${row.source_id}`,
            row.deal_type === "sale" ? "rent" : "sale",
            `legacy:${row.agent_listing_ref}`,
            legacyRun,
          ],
        );
      }
      const untouched = (
        await q(
          "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,status) VALUES('UNTOUCHED','A000001','Unrelated stock','sale','test-district','active') RETURNING id",
        )
      )[0].id;
      const beforeUnrelated = (
        await q("SELECT to_jsonb(p) AS row FROM properties p WHERE id=$1", [untouched])
      )[0].row;
      const mainBytes = await sharp({
        create: { width: 420, height: 320, channels: 3, background: "#12aabb" },
      })
        .png()
        .toBuffer();
      const otherBytes = await sharp({
        create: { width: 420, height: 320, channels: 3, background: "#bb7700" },
      })
        .png()
        .toBuffer();
      for (const row of entries) {
        const dir = join(root, "photos", row.source_id);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "main.png"), mainBytes);
        await writeFile(join(dir, "other.png"), otherBytes);
        Object.assign(row, {
          source: "28hse",
          source_url: `https://www.28hse.com/${row.deal_type === "sale" ? "buy" : "rent"}/apartment/property-${row.source_id}`,
          title: "本地測試樓盤",
          estate: "測試屋苑",
          district: "測試區",
          description: "匯入後的完整單位詳情。",
          price_hkd: row.deal_type === "sale" ? 4680000 : null,
          rent_hkd: row.deal_type === "rent" ? 16000 : null,
          saleable_area_sqft: 500,
          bedrooms: "2",
          bathrooms: "1",
          floor_level: "中層",
          photos: [
            {
              seq: 2,
              is_main: false,
              watermark: "28Hse.com (owner approved)",
              local_path: join(dir, "other.png"),
              original_url: `https://i1.28hse.com/${row.source_id}-other.png`,
            },
            {
              seq: 1,
              is_main: true,
              watermark: "28Hse.com (owner approved)",
              local_path: join(dir, "main.png"),
              original_url: `https://i1.28hse.com/${row.source_id}-main.png`,
            },
          ],
        });
      }
      entries[0].merged_repost_ids = ["8800000"];
      entries[1].estate = "沒有此屋苑"; // valid district, no estate: normal active listing
      const plan = await buildSavedImportPlan(entries, { captureRoot: root });
      assert.deepEqual(
        plan.rows.flatMap((row) => row.failures),
        [],
      );
      const originalFull = (
        await q(
          "INSERT INTO mls_ingestion_receipts(source,scope_id,policy_version,parser_version,scraped_at,payload_hash,run_id,response,full_snapshot) VALUES('28hse_agent_540','agent:540','no-hermes-v2','python-v2.2',now()-interval '2 days',repeat('a',64),$1,jsonb_build_object('summary',jsonb_build_object('advertisement_count',55)),true) RETURNING id",
          [legacyRun],
        )
      )[0].id;
      await q(
        "INSERT INTO mls_ingestion_scopes(source,scope_id,policy_version,last_accepted_at,full_receipt_id,full_count) VALUES('28hse_agent_540','agent:540','no-hermes-v2',now()-interval '2 days',$1,55)",
        [originalFull],
      );
      await q("UPDATE mls_ingestion_receipts SET accepted_at=now()-interval '2 days' WHERE id=$1", [
        originalFull,
      ]);
      const readonlyBefore = await inspectImportReadOnly(client, plan, { fullDryRun: true });
      assert.equal(readonlyBefore.ready, true, JSON.stringify(readonlyBefore.missingItems));
      const observedColumns = (
        await q(
          "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='listing_source_observations'",
          [schema],
        )
      ).map((row) => row.column_name);
      assert.ok(!observedColumns.includes("source_updated_at"));
      let puts = 0;
      const store = {
        put: async ({ pathname, body, contentType }) => {
          puts++;
          return {
            url: `https://development-blob.invalid/${pathname}`,
            pathname,
            contentType,
            size: body.byteLength,
          };
        },
      };
      const result = await applySavedImport(client, plan, { blobStore: store });
      assert.equal(
        (
          await q(
            "SELECT p.estate_id,p.status FROM properties p JOIN property_source_links l ON l.property_id=p.id WHERE l.source='28hse_agent_540' AND l.external_listing_id=$1",
            [entries[1].source_id],
          )
        )[0].estate_id,
        null,
      );
      assert.equal(result.created.length, 52);
      assert.equal(result.updated.length, 3);
      assert.deepEqual(result.held, []);
      assert.equal((await q("SELECT count(*)::int AS n FROM properties"))[0].n, 56); // 55 selected + untouched
      assert.equal(
        (await q("SELECT count(*)::int AS n FROM properties WHERE status='draft'"))[0].n,
        0,
      );
      assert.equal(
        (
          await q(
            "SELECT count(*)::int AS n FROM mls_source_state WHERE external_listing_id='4028435'",
          )
        )[0].n,
        0,
      );
      const mainUrl = `https://development-blob.invalid/${buildOwnedMediaPathname(sha256(mainBytes), "image/png")}`;
      for (const row of entries.filter((row) => !row.sold_label)) {
        const listing = (
          await q(
            "SELECT p.*,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id JOIN mls_source_state s ON s.property_id=p.id WHERE s.source='28hse_agent_540' AND s.external_listing_id=$1 AND s.deal_type=$2",
            [row.source_id, row.deal_type],
          )
        )[0];
        assert.equal(listing.public_listing_no, row.agent_listing_ref);
        assert.equal(listing.status, "active");
        assert.equal(listing.deal_type, row.deal_type);
        assert.equal(listing.description, row.description);
        assert.equal(listing.images[0], mainUrl);
        assert.equal(listing.images.length, 2);
        assert.equal(listing.source_site, "28hse");
        assert.equal(
          Number(listing[row.deal_type === "sale" ? "price" : "rent"]),
          row.deal_type === "sale" ? 4680000 : 16000,
        );
        assert.equal(listing[row.deal_type === "sale" ? "rent" : "price"], null);
        if (existingIds.has(row.source_id))
          assert.equal(listing.id, existingIds.get(row.source_id));
      }
      assert.deepEqual(
        (await q("SELECT to_jsonb(p) AS row FROM properties p WHERE id=$1", [untouched]))[0].row,
        beforeUnrelated,
      );
      assert.equal(
        (
          await q(
            "SELECT bool_or(full_snapshot) AS any_full FROM mls_ingestion_receipts WHERE parser_version='saved-capture-import-v1'",
          )
        )[0].any_full,
        false,
      );
      assert.equal(
        (
          await q("SELECT full_receipt_id FROM mls_ingestion_scopes WHERE source='28hse_agent_540'")
        )[0].full_receipt_id,
        originalFull,
      );
      assert.equal(
        (
          await q(
            "SELECT count(*)::int AS n FROM property_source_links WHERE external_listing_id='8800000' AND status='active'",
          )
        )[0].n,
        1,
      );
      const uploads = puts;
      const retry = await applySavedImport(
        client,
        await buildSavedImportPlan(entries, { captureRoot: root }),
        { blobStore: store },
      );
      assert.equal(retry.created.length, 0);
      assert.equal(retry.updated.length, 0);
      assert.equal(retry.alreadyPresent.length, 55);
      assert.equal(puts, uploads);
      assert.equal((await q("SELECT count(*)::int AS n FROM properties"))[0].n, 56);
      const changed = structuredClone(entries);
      changed[0].price_hkd = 9990000;
      const changedPlan = await buildSavedImportPlan(changed, { captureRoot: root });
      await assert.rejects(
        () => applySavedImport(client, changedPlan, { blobStore: store }),
        /IMPORT_TARGET_PREFLIGHT_FAILED/,
      );
      assert.equal(puts, uploads);
      const pairedEntries = [];
      for (const [id, deal] of [
        ["9200001", "sale"],
        ["9200002", "rent"],
      ]) {
        const pairedDir = join(root, "photos", id);
        await mkdir(pairedDir, { recursive: true });
        const pairedPath = join(pairedDir, "main.png");
        await writeFile(pairedPath, mainBytes);
        pairedEntries.push({
          ...entries[0],
          source_id: id,
          source_url: `https://www.28hse.com/${deal === "sale" ? "buy" : "rent"}/apartment/property-${id}`,
          deal_type: deal,
          agent_listing_ref: "A900008",
          price_hkd: deal === "sale" ? 4680000 : null,
          rent_hkd: deal === "rent" ? 16000 : null,
          merged_repost_ids: [],
          photos: [
            {
              seq: 1,
              is_main: true,
              local_path: pairedPath,
              original_url: `https://i1.28hse.com/${id}.png`,
            },
          ],
        });
      }
      const paired = await applySavedImport(
        client,
        await buildSavedImportPlan(pairedEntries, { captureRoot: root }),
        { blobStore: store },
      );
      assert.equal(paired.created.length, 2);
      assert.ok(paired.created.every((row) => row.listingNo === "A900008"));
      assert.equal(
        (
          await q(
            "SELECT count(*)::int AS n FROM property_public_members WHERE public_listing_no='A900008'",
          )
        )[0].n,
        2,
      );
      const pairedRetry = await applySavedImport(
        client,
        await buildSavedImportPlan(pairedEntries, { captureRoot: root }),
        { blobStore: store },
      );
      assert.equal(pairedRetry.created.length, 0);
      assert.equal(pairedRetry.alreadyPresent.length, 2);
      const raceId = "9100000";
      const raceDir = join(root, "photos", raceId);
      await mkdir(raceDir, { recursive: true });
      const racePath = join(raceDir, "main.png");
      const raceBytes = await sharp({
        create: { width: 420, height: 320, channels: 3, background: "#7744ee" },
      })
        .png()
        .toBuffer();
      await writeFile(racePath, raceBytes);
      const raceEntry = {
        ...entries[0],
        source_id: raceId,
        source_url: `https://www.28hse.com/buy/apartment/property-${raceId}`,
        agent_listing_ref: "A900009",
        merged_repost_ids: [],
        photos: [
          {
            seq: 1,
            is_main: true,
            local_path: racePath,
            original_url: `https://i1.28hse.com/${raceId}.png`,
          },
        ],
      };
      const racePlan = await buildSavedImportPlan([raceEntry], { captureRoot: root });
      let beforeJournalRace;
      const racingStore = {
        put: async (input) => {
          beforeJournalRace = (
            await q(
              "SELECT to_jsonb(p) AS row FROM properties p JOIN mls_source_state s ON s.property_id=p.id WHERE s.source='28hse_agent_540' AND s.external_listing_id=$1",
              [raceId],
            )
          )[0].row;
          await q(
            "UPDATE mls_source_state SET source_status='delisted' WHERE source='28hse_agent_540' AND external_listing_id=$1",
            [raceId],
          );
          return store.put(input);
        },
      };
      await assert.rejects(
        () => applySavedImport(client, racePlan, { blobStore: racingStore }),
        /IMPORT_SOURCE_JOURNAL_CHANGED/,
      );
      const afterJournalRace = (
        await q(
          "SELECT to_jsonb(p) AS row FROM properties p JOIN mls_source_state s ON s.property_id=p.id WHERE s.source='28hse_agent_540' AND s.external_listing_id=$1",
          [raceId],
        )
      )[0].row;
      assert.deepEqual(afterJournalRace, beforeJournalRace);
      assert.equal(afterJournalRace.status, "draft");
      assert.equal(
        (
          await q(
            "SELECT parser_version FROM mls_ingestion_policies WHERE source='28hse_agent_540'",
          )
        )[0].parser_version,
        "python-v2.2",
      );
      assert.equal(
        (
          await q("SELECT full_receipt_id FROM mls_ingestion_scopes WHERE source='28hse_agent_540'")
        )[0].full_receipt_id,
        originalFull,
      );
      // The normal daily parser still accepts a full snapshot against its original baseline.
      const daily = dailyBatch(
        plan.rows.filter((row) => row.action !== "skip").map((row) => row.record),
        new Date(Date.now() + 60000).toISOString(),
      );
      daily.meta.parser_version = "python-v2.2";
      await applyIngestion(client, daily);
      const fullReceipt = (
        await q(
          "SELECT r.parser_version,r.full_snapshot FROM mls_ingestion_scopes s JOIN mls_ingestion_receipts r ON r.id=s.full_receipt_id WHERE s.source='28hse_agent_540'",
        )
      )[0];
      assert.equal(fullReceipt.parser_version, "python-v2.2");
      assert.equal(fullReceipt.full_snapshot, true);
      // The DB exception itself requires operator context and can NEVER authorize a full capture.
      for (const full of [false, true]) {
        await q("BEGIN");
        try {
          if (full)
            await q("SELECT set_config('app.saved_capture_import','saved-capture-import-v1',true)");
          await q(
            "INSERT INTO mls_ingestion_receipts(source,scope_id,policy_version,parser_version,scraped_at,payload_hash,run_id,response,full_snapshot) SELECT source,scope_id,policy_version,'saved-capture-import-v1',now()+interval '5 minutes',payload_hash,run_id,'{}',$2 FROM mls_ingestion_receipts WHERE id=$1",
            [originalFull, full],
          );
          await assert.rejects(() => q("COMMIT"), /MLS_RECEIPT_PARSER_NOT_APPROVED/);
        } finally {
          await q("ROLLBACK");
        }
      }
      await assert.rejects(
        () =>
          q(
            "UPDATE mls_ingestion_policies SET parser_version='other' WHERE source='28hse_agent_540'",
          ),
        /MLS_PRIMARY_PARSER_HAS_RECEIPTS/,
      );
    } finally {
      await q("ROLLBACK");
      await q("SET search_path TO public");
      await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await rm(root, { recursive: true, force: true });
    }
  }));
