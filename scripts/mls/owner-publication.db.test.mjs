import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import sharp from "sharp";
import { applyIngestion } from "../../src/lib/mls/ingestion-repository.mjs";
import { batch as dailyBatch } from "../../src/lib/mls/ingestion-test-fixtures.mjs";
import { withOwnedPostgres } from "../acceptance/owned-postgres-test.mjs";
import {
  buildSavedImportPlan,
  assertImportTarget,
} from "../../src/lib/mls/saved-capture-import.mjs";
import {
  inspectOwnerPublication,
  applyOwnerPublication,
} from "../../src/lib/mls/owner-publication.mjs";
import {
  readOwnerReviewQueue,
  inspectOwnerReviewResolution,
  applyOwnerReviewResolution,
  isOwnerKeptField,
} from "../../src/lib/mls/owner-review-resolution.mjs";
async function local(run) {
  if (!process.env.IMPORT_TEST_DATABASE_URL)
    return withOwnedPostgres(async ({ pool }) => {
      const client = await pool.connect();
      try {
        return await run(client);
      } finally {
        client.release();
      }
    });
  assertImportTarget({
    IMPORT_TARGET_ENV: "development",
    IMPORT_DATABASE_URL: process.env.IMPORT_TEST_DATABASE_URL,
  });
  const client = new pg.Client({ connectionString: process.env.IMPORT_TEST_DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}
const keyHash = (key) => createHash("sha256").update(key).digest("hex");
const inputSha256 = "c".repeat(64);
const host = "local-test.public.blob.vercel-storage.com";
test("owner capture: 22 drafts + 8 inactive in place,23 creates,2 choices,sold/stale untouched,atomic owned media and audited queue", async () =>
  local(async (client) => {
    const schema = "owner_" + randomUUID().replaceAll("-", ""),
      root = await mkdtemp(join(tmpdir(), "owner-capture-"));
    const q = async (sql, p = []) => (await client.query(sql, p)).rows;
    try {
      await q(`CREATE SCHEMA ${schema}`);
      await q(`SET search_path TO ${schema},public`);
      for (const file of [
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
      ])
        await q(await readFile(new URL("../../neon/migrations/" + file, import.meta.url), "utf8"));
      await q("SELECT set_config('app.mls_writer_policy','no-hermes-v2',false)");
      await q(
        "INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,bootstrap_approved_at,bootstrap_approved_by) VALUES('28hse_agent_540','agent:540','no-hermes-v2','python-v2.2','no-hermes-v2',true,now(),'synthetic-owner')",
      );
      const entries = Array.from({ length: 53 }, (_, i) => ({
        source: "28hse",
        source_id: String(5000000 + i),
        agent_listing_ref: `A${String(100000 + i)}`,
        deal_type: i % 3 === 0 ? "rent" : "sale",
      }));
      // Two missing offerings share one agency public group, as the real capture does.
      entries[52].agent_listing_ref = entries[51].agent_listing_ref;
      entries[52].deal_type = entries[51].deal_type === "sale" ? "rent" : "sale";
      entries.push(
        { source: "28hse", source_id: "4065990", agent_listing_ref: "B047469", deal_type: "sale" },
        { source: "28hse", source_id: "4040895", agent_listing_ref: "A074799", deal_type: "sale" },
        {
          source: "28hse",
          source_id: "4028435",
          agent_listing_ref: "R067756",
          deal_type: "sale",
          sold_label: true,
        },
      );
      entries[30].source_id = "4044249";
      entries[31].source_id = "4062592";
      const images = [];
      for (let i = 0; i < 7; i++)
        images.push(
          await sharp({
            create: {
              width: 400,
              height: 300,
              channels: 3,
              background: { r: 20 + i * 25, g: 60, b: 160 },
            },
          })
            .png()
            .toBuffer(),
        );
      for (const row of entries) {
        const dir = join(root, "photos", row.source_id);
        await mkdir(dir, { recursive: true });
        row.photos = [];
        for (let i = 0; i < 7; i++) {
          const path = join(dir, `${i}.png`);
          await writeFile(path, images[i]);
          row.photos.push({
            local_path: path,
            original_url: `https://i1.28hse.com/${row.source_id}-${i}.png`,
            is_main: i === 0,
          });
        }
        Object.assign(row, {
          title: "Owner latest",
          description: "Latest captured details",
          district: ["4044249", "4062592"].includes(row.source_id) ? "outside" : "深井",
          estate: "not matched",
          price_hkd: row.deal_type === "sale" ? 4680000 : null,
          rent_hkd: row.deal_type === "rent" ? 18000 : null,
          saleable_area_sqft: 500,
          bedrooms: "2",
          bathrooms: "1",
          updated_date: "2026-10-25",
          source_url: `https://www.28hse.com/${row.deal_type === "sale" ? "buy" : "rent"}/apartment/property-${row.source_id}`,
        });
      }
      const seed = async (row, status, extra = "") => {
        const id = randomUUID(),
          no = extra || `${row.agent_listing_ref}-${id.slice(0, 8)}`;
        await q(
          "INSERT INTO properties(id,listing_no,canonical_property_no,title_zh,deal_type,district_slug,status,price,rent,description,images,source_site) VALUES($1,$2,$3,'Before',$4,'sham-tseng',$5::property_status,4000000,15000,CASE WHEN $5::text='draft' THEN NULL ELSE 'Before' END,CASE WHEN $5::text='draft' THEN ARRAY[]::text[] ELSE array_fill('https://imgs.property.hk/hotlink.jpg'::text,ARRAY[10]) END,'earnestproperty-old-site')",
          [id, no, row.agent_listing_ref, row.deal_type, status],
        );
        await q(
          "UPDATE properties SET ingestion_owner='no-hermes-v2',ingestion_identity_policy='no-hermes-v2' WHERE id=$1",
          [id],
        );
        return id;
      };
      const ids = new Map();
      for (let i = 0; i < 30; i++)
        ids.set(
          entries[i].source_id,
          await seed(
            entries[i],
            i < 22 ? "draft" : "inactive",
            i < 22 ? "SYNC-" + randomUUID() : "",
          ),
        );
      const choices = {};
      for (const row of entries.slice(53, 55)) {
        choices[row.agent_listing_ref] = await seed(row, "inactive");
        await seed(row, "inactive");
      }
      const soldId = await seed(entries[55], "draft");
      const runId = (
        await q(
          "INSERT INTO listing_sync_runs(scheduled_for,mode,status,parser_version) VALUES(current_date,'publish','healthy','python-v2.2') RETURNING id",
        )
      )[0].id;
      const receiptId = (
        await q(
          "INSERT INTO mls_ingestion_receipts(source,scope_id,policy_version,parser_version,scraped_at,payload_hash,run_id,response,full_snapshot) VALUES('28hse_agent_540','agent:540','no-hermes-v2','python-v2.2',now()-interval '14 days',repeat('a',64),$1,'{}',false) RETURNING id",
          [runId],
        )
      )[0].id;
      const observation = async (id, ref, deal) =>
        (
          await q(
            "INSERT INTO listing_source_observations(run_id,source,external_listing_id,deal_type,source_url,property_no_normalized,payload,content_hash,validation_state,discovered_at,fetched_at) VALUES($1,'28hse_agent_540',$2,$3,'https://www.28hse.com/local',CASE WHEN $2 LIKE 'own-%' OR $2='5777777' THEN NULL ELSE $4 END,jsonb_build_object('raw',jsonb_build_object('agency_property_no',$4)),repeat('b',64),'valid',now(),now()) RETURNING id",
            [runId, id, deal, ref],
          )
        )[0].id;
      const review = async (key, external, deal, obs, reason, evidence = {}) =>
        q(
          "INSERT INTO mls_ingestion_reviews(review_key,source,external_listing_id,deal_type,reason,evidence,observation_id,first_run_id,last_run_id) VALUES($1,'28hse_agent_540',$2,$3,$4,$5,$6,$7,$7)",
          [keyHash(key), external, deal, reason, JSON.stringify(evidence), obs, runId],
        );
      const staleIds = [];
      for (let i = 0; i < 8; i++) {
        const row = entries[[0, 1, 30, 31, 32, 33, 34, 35][i]],
          ref = `Z${900000 + i}`,
          id = await seed({ ...row, agent_listing_ref: ref }, "active");
        staleIds.push(id);
        const obs = await observation(row.source_id, row.agent_listing_ref, row.deal_type);
        await q(
          "INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,match_key,link_reason,status,first_seen_at,last_seen_at,last_seen_run_id) VALUES($1,'28hse_agent_540',$2,$3,$4,'source_id_v2','active',now(),now(),$5)",
          [id, row.source_id, row.deal_type, `${row.deal_type}:${ref}`, runId],
        );
        await q(
          "INSERT INTO mls_source_state(source,external_listing_id,deal_type,scope_id,policy_version,observation_id,last_receipt_id,property_id,source_status,first_seen_at,last_accepted_at,raw_identity) VALUES('28hse_agent_540',$1,$2,'agent:540','no-hermes-v2',$3,$4,$5,'active',now(),now(),$6)",
          [
            row.source_id,
            row.deal_type,
            obs,
            receiptId,
            id,
            JSON.stringify({ agency_property_no: ref }),
          ],
        );
        await review(`stale-${i}`, row.source_id, row.deal_type, obs, "company_number_changed");
      }
      for (let i = 8; i < 11; i++) {
        const row = entries[i],
          external = `own-${i}`,
          obs = await observation(external, row.agent_listing_ref, row.deal_type);
        await q(
          "INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,match_key,link_reason,status,first_seen_at,last_seen_at,last_seen_run_id) VALUES($1,'28hse_agent_540',$2,$3,$4,'source_id_v2','active',now(),now(),$5)",
          [
            ids.get(row.source_id),
            external,
            row.deal_type,
            `${row.deal_type}:${row.agent_listing_ref}`,
            runId,
          ],
        );
        await review(`own-${i}`, external, row.deal_type, obs, "ambiguous_sources");
      }
      const staleBefore = await q(
        "SELECT to_jsonb(p) AS value FROM properties p WHERE id=ANY($1::uuid[]) ORDER BY id",
        [[...staleIds, soldId]],
      );
      const stateBefore = await q(
        "SELECT to_jsonb(s) AS value FROM mls_source_state s ORDER BY external_listing_id",
      );
      const linkBefore = await q(
        "SELECT to_jsonb(l) AS value FROM property_source_links l WHERE external_listing_id NOT LIKE 'owner-capture-%' ORDER BY external_listing_id",
      );
      const plan = await buildSavedImportPlan(entries, { captureRoot: root });
      for (const row of plan.rows) row.ownerSourceDate = "2026-10-25";
      const inspected = await inspectOwnerPublication(client, plan, { inputSha256 });
      assert.equal(inspected.filter((i) => i.action === "update").length, 30);
      assert.equal(inspected.filter((i) => i.action === "create").length, 23);
      assert.equal(inspected.filter((i) => i.action === "held").length, 2);
      let puts = 0;
      const store = {
        put: async ({ pathname, body, contentType }) => {
          puts++;
          return { url: `https://${host}/${pathname}`, pathname, contentType, size: body.length };
        },
      };
      const result = await applyOwnerPublication(client, inspected, {
        inputSha256,
        blobStore: store,
        expectedHost: host,
        onFailure: async (error) => {
          throw error;
        },
      });
      assert.equal(result.published.length, 53, JSON.stringify(result.held));
      assert.equal(result.held.length, 2);
      for (const item of result.published) {
        const p = (await q("SELECT * FROM properties WHERE id=$1", [item.propertyId]))[0];
        assert.equal(p.status, "active");
        assert.equal(p.images.length, 7);
        assert.ok(p.images.every((url) => url.startsWith(`https://${host}/mls/`)));
        if (ids.has(item.id)) assert.equal(p.id, ids.get(item.id));
        if (["4044249", "4062592"].includes(item.id)) assert.equal(p.district_slug, "");
        assert.equal(p.estate_id, null);
      }
      assert.deepEqual(
        await q(
          "SELECT to_jsonb(p) AS value FROM properties p WHERE id=ANY($1::uuid[]) ORDER BY id",
          [[...staleIds, soldId]],
        ),
        staleBefore,
      );
      assert.deepEqual(
        await q("SELECT to_jsonb(s) AS value FROM mls_source_state s ORDER BY external_listing_id"),
        stateBefore,
      );
      assert.deepEqual(
        await q(
          "SELECT to_jsonb(l) AS value FROM property_source_links l WHERE external_listing_id NOT LIKE 'owner-capture-%' ORDER BY external_listing_id",
        ),
        linkBefore,
      );
      assert.equal(
        (
          await q(
            "SELECT count(*)::int AS n FROM mls_ingestion_reviews WHERE review_key=ANY($1::text[]) AND status='open'",
            [Array.from({ length: 8 }, (_, i) => keyHash(`stale-${i}`))],
          )
        )[0].n,
        8,
      );
      assert.equal(
        (
          await q(
            "SELECT count(*)::int AS n FROM mls_ingestion_reviews WHERE review_key=ANY($1::text[]) AND status='resolved'",
            [[8, 9, 10].map((i) => keyHash(`own-${i}`))],
          )
        )[0].n,
        3,
      );
      assert.equal((await q("SELECT count(*)::int AS n FROM admin_property_overrides"))[0].n, 0);
      const uploads = puts,
        audits = (await q("SELECT count(*)::int AS n FROM audit_logs"))[0].n;
      const again = await applyOwnerPublication(
        client,
        await inspectOwnerPublication(client, plan, { inputSha256 }),
        { inputSha256, blobStore: store, expectedHost: host },
      );
      assert.equal(again.alreadyPublished.length, 53);
      assert.equal(puts, uploads);
      assert.equal((await q("SELECT count(*)::int AS n FROM audit_logs"))[0].n, audits);
      const chosen = await applyOwnerPublication(
        client,
        await inspectOwnerPublication(client, plan, { inputSha256, choices }),
        { choices, inputSha256, blobStore: store, expectedHost: host },
      );
      assert.equal(chosen.published.length, 2, JSON.stringify(chosen.held));
      assert.ok(chosen.published.every((item) => item.propertyId === choices[item.ref]));
      // A fresh missing listing changes after upload: re-lock must hold and leave no partial canonical or audit.
      const raceEntry = {
        ...entries[32],
        source_id: "5999999",
        agent_listing_ref: "X999999",
        photos: entries[32].photos.map((photo) => ({ ...photo, local_path: photo.local_path })),
      };
      const racePlan = {
        ...plan,
        rows: [
          {
            ...plan.rows[32],
            id: raceEntry.source_id,
            record: { ...plan.rows[32].record, agency_property_no: raceEntry.agent_listing_ref },
            fingerprint: "d".repeat(64),
          },
        ],
      };
      const raceItems = await inspectOwnerPublication(client, racePlan, { inputSha256 });
      const raceStore = { put: store.put };
      // Force a fresh image hash to invoke the hook even though the main test's assets are cached.
      const originalRead = client.query.bind(client);
      let raceTriggered = false;
      const wrapped = {
        query: async (sql, params) => {
          if (
            typeof sql === "string" &&
            sql.startsWith("BEGIN") &&
            !sql.includes("READ ONLY") &&
            !raceTriggered
          ) {
            raceTriggered = true;
            await seed(raceEntry, "inactive");
          }
          return originalRead(sql, params);
        },
      };
      const raced = await applyOwnerPublication(wrapped, raceItems, {
        inputSha256,
        blobStore: raceStore,
        expectedHost: host,
      });
      assert.equal(raced.published.length, 0);
      assert.equal(raced.held[0].reason, "OWNER_TARGET_CHANGED_AFTER_UPLOAD");
      assert.equal(
        (
          await q(
            "SELECT count(*)::int AS n FROM audit_logs WHERE metadata->>'capture_source_id'='5999999'",
          )
        )[0].n,
        0,
      );
      // An error after canonical/media/review writes must roll the entire listing back.
      const failEntry = { ...entries[33], agent_listing_ref: "Q999999" };
      const failId = await seed(failEntry, "inactive");
      const failBefore = (
        await q("SELECT to_jsonb(p) AS value FROM properties p WHERE id=$1", [failId])
      )[0].value;
      const failPlan = {
        ...plan,
        rows: [
          {
            ...plan.rows[33],
            id: "5999998",
            record: { ...plan.rows[33].record, agency_property_no: "Q999999" },
            fingerprint: "e".repeat(64),
          },
        ],
      };
      const failItems = await inspectOwnerPublication(client, failPlan, { inputSha256 });
      const failingClient = {
        query: async (sql, params) => {
          if (typeof sql === "string" && sql.startsWith("INSERT INTO audit_logs"))
            throw Error("SYNTHETIC_AUDIT_FAILURE");
          return originalRead(sql, params);
        },
      };
      const failed = await applyOwnerPublication(failingClient, failItems, {
        inputSha256,
        blobStore: store,
        expectedHost: host,
      });
      assert.equal(failed.published.length, 0);
      assert.equal(failed.held[0].reason, "SYNTHETIC_AUDIT_FAILURE");
      assert.deepEqual(
        (await q("SELECT to_jsonb(p) AS value FROM properties p WHERE id=$1", [failId]))[0].value,
        failBefore,
      );
      assert.equal(
        (
          await q("SELECT count(*)::int AS n FROM listing_media_records WHERE property_id=$1", [
            failId,
          ])
        )[0].n,
        0,
      );
      assert.equal(
        (
          await q(
            "SELECT count(*)::int AS n FROM listing_source_observations WHERE external_listing_id='owner-capture-Q999999-sale' OR external_listing_id='owner-capture-Q999999-rent'",
          )
        )[0].n,
        0,
      );
      // Separate bulk-resolution preparation is exercised only on synthetic local reviews.
      const keepRef = { agent_listing_ref: "K999999", deal_type: "sale" },
        keepId = await seed(keepRef, "active");
      const keepObs = await observation("5777777", "K999999", "sale");
      await q("UPDATE properties SET bedrooms=2 WHERE id=$1", [keepId]);
      await q(
        "INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,match_key,link_reason,status,first_seen_at,last_seen_at,last_seen_run_id) VALUES($1,'28hse_agent_540','5777777','sale','sale:K999999','source_id_v2','active',now(),now(),$2)",
        [keepId, runId],
      );
      await review("keep-review", "5777777", "sale", keepObs, "unknown_field_ownership", {
        field: "bedrooms",
        current: 2,
      });
      await review("dup-one", "5777777", "sale", keepObs, "company_group_ambiguous", {
        identity: { agency_property_no: "K999999" },
      });
      await review("dup-two", "5777777", "sale", keepObs, "company_group_ambiguous", {
        identity: { agency_property_no: "K999999" },
      });
      const queue = await readOwnerReviewQueue(client),
        approval = { approval_ref: "synthetic-owner", reviews: queue.reviews };
      const dry = await inspectOwnerReviewResolution(client, approval);
      assert.equal(dry.actions.length, 2);
      await applyOwnerReviewResolution(client, approval, {
        inputSha256,
        captureInputSha256: inputSha256,
      });
      const owned = (
        await q(
          "SELECT * FROM property_sync_fields WHERE property_id=$1 AND field_name='bedrooms'",
          [keepId],
        )
      )[0];
      assert.equal(isOwnerKeptField(owned, 2), true);
      assert.equal(isOwnerKeptField(owned, 3), false);
      assert.equal(
        (
          await q(
            "SELECT count(*)::int AS n FROM mls_ingestion_reviews WHERE review_key=ANY($1::text[]) AND status='open'",
            [Array.from({ length: 8 }, (_, i) => keyHash(`stale-${i}`))],
          )
        )[0].n,
        8,
      );
      assert.equal(
        (
          await q(
            "SELECT count(*)::int AS n FROM mls_ingestion_reviews WHERE review_key=ANY($1::text[]) AND status='open'",
            [[keyHash("dup-one"), keyHash("dup-two")]],
          )
        )[0].n,
        1,
      );
      assert.equal((await inspectOwnerReviewResolution(client, approval)).actions.length, 0);
      // Real ingestion must preserve the reviewed value without recreating a manual/unknown review.
      await q(
        "INSERT INTO mls_source_state(source,external_listing_id,deal_type,scope_id,policy_version,observation_id,last_receipt_id,property_id,source_status,first_seen_at,last_accepted_at,raw_identity) VALUES('28hse_agent_540','5777777','sale','agent:540','no-hermes-v2',$1,$2,$3,'active',now(),now(),'{}')",
        [keepObs, receiptId, keepId],
      );
      const daily = dailyBatch(
        [
          {
            property_id: "5777777",
            agency_property_no: "K999999",
            source_url: "https://www.28hse.com/buy/apartment/property-5777777",
            title: "Keep owner rooms",
            estate: "not matched",
            district: "深井",
            deal_type: "sale",
            price: 4680000,
            bedrooms: 3,
          },
        ],
        new Date(Date.now() + 60000).toISOString(),
      );
      daily.meta.parser_version = "python-v2.2";
      await applyIngestion(client, daily);
      assert.equal(
        (await q("SELECT bedrooms FROM properties WHERE id=$1", [keepId]))[0].bedrooms,
        2,
      );
      assert.equal(
        (
          await q(
            "SELECT count(*)::int AS n FROM mls_ingestion_reviews WHERE external_listing_id='5777777' AND reason IN('manual_override','unknown_field_ownership') AND evidence->>'field'='bedrooms' AND status='open'",
          )
        )[0].n,
        0,
      );
    } finally {
      await q("ROLLBACK").catch(() => {});
      await q("SET search_path TO public");
      await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await rm(root, { recursive: true, force: true });
    }
  }));
