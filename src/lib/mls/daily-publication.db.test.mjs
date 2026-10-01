import { assertDisposableNeonTestTarget } from "../neon/disposable-test-target.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { publishDaily } from "./daily-publication.mjs";
import { hashPayload } from "./ingestion-contract.mjs";
test(
  "daily publication executes audited SQL atomically and replays without media writes",
  { skip: !process.env.ASTRA_TEST_DATABASE_URL },
  async () => {
    await assertDisposableNeonTestTarget(process.env.ASTRA_TEST_DATABASE_URL);
    const c = new Client({ connectionString: process.env.ASTRA_TEST_DATABASE_URL });
    await c.connect();
    const q = (s, p = []) => c.query(s, p);
    const schema = "publication_" + randomUUID().replaceAll("-", "");
    try {
      await q(`CREATE SCHEMA ${schema}`);
      await q(`SET search_path TO ${schema},public,pg_catalog`);
      await q(
        "CREATE TABLE properties(LIKE public.properties INCLUDING DEFAULTS INCLUDING CONSTRAINTS); ALTER TABLE properties ADD PRIMARY KEY(id); CREATE UNIQUE INDEX properties_listing_no_key ON properties(listing_no)",
      );
      for (const migration of [
        "20260817120000_dual_source_listing_sync.sql",
        "20260906040000_property_public_identity.sql",
        "20260906090000_canonical_property_identity.sql",
        "20260906120000_admin_property_management.sql",
        "20260907120000_propertyhk_ingestion_v2.sql",
      ])
        await q(readFileSync("neon/migrations/" + migration, "utf8"));
      for (const table of [
        "properties",
        "mls_source_state",
        "property_public_members",
        "listing_source_observations",
        "listing_sync_runs",
        "admin_property_overrides",
        "property_sync_fields",
        "mls_ingestion_conflicts",
        "mls_ingestion_reviews",
        "mls_ingestion_receipts",
        "mls_ingestion_scopes",
        "listing_media_records",
        "media_assets",
        "admin_property_source_snapshots",
        "listing_change_events",
        "audit_logs",
      ])
        await q(`CREATE TEMP TABLE ${table} AS SELECT * FROM ${table} WITH NO DATA`);
      await q("CREATE UNIQUE INDEX ON property_sync_fields(property_id,field_name)");
      const id = randomUUID(),
        obs = randomUUID(),
        receipt = randomUUID(),
        run = randomUUID(),
        asset = randomUUID();
      const raw = {
        property_id: "4000001",
        agency_property_no: "A123456",
        deal_type: "rent",
        source_status: "active",
        source_url: "https://www.28hse.com/rent/apartment/property-4000001",
        title: "Test",
        estate: "Test",
        district: "Test",
        rent: "18000",
        saleable_area: "500",
        publication: { description: "Test: 500 sq ft", images: ["https://i1.28hse.com/a.jpg"] },
      };
      const payload = {
        source: "28hse",
        branches: [],
        scraped_at: new Date().toISOString(),
        listings: [raw],
        meta: {
          schema_version: "2.0",
          run_id: run,
          scope_id: "agent:540",
          policy_version: "no-hermes-v2",
          parser_version: "fixture-v2",
          crawl_complete: true,
          pages_failed: 0,
          worker_rejected_count: 0,
          rejected_records: [],
          eligible_for_absence: true,
          completed_branches: [],
          pages: [],
        },
      };
      await q(
        "INSERT INTO properties(id,listing_no,canonical_property_no,title_zh,deal_type,status,ingestion_owner,rent,saleable_area,estate_id) VALUES($1,'SYNC-test','A123456','Test','rent','draft','no-hermes-v2',18000,500,$2)",
        [id, randomUUID()],
      );
      await q(
        "INSERT INTO property_public_members(property_id,public_listing_no) VALUES($1,'A123456')",
        [id],
      );
      await q("INSERT INTO listing_source_observations(id,run_id,payload) VALUES($1,$2,'{}')", [
        obs,
        run,
      ]);
      await q(
        "INSERT INTO mls_source_state(property_id,observation_id,source,scope_id,external_listing_id,deal_type,source_status) VALUES($1,$2,'28hse_agent_540','agent:540','4000001','rent','active')",
        [id, obs],
      );
      await q(
        "INSERT INTO mls_ingestion_receipts(id,source,scope_id,payload_hash,full_snapshot,response,scraped_at) VALUES($1,'28hse_agent_540','agent:540',$2,true,'{\"success\":true}',$3)",
        [receipt, hashPayload(payload), payload.scraped_at],
      );
      await q("INSERT INTO mls_ingestion_scopes(full_receipt_id,last_accepted_at) VALUES($1,$2)", [
        receipt,
        payload.scraped_at,
      ]);
      let preparations = 0;
      const prepare = async ({ observationId, observation }) => {
        assert.deepEqual(
          observation.mediaCandidates.map((x) => x.url),
          ["https://i1.28hse.com/a.jpg"],
        );
        preparations++;
        await q(
          "INSERT INTO media_assets(id,url,content_hash,content_type,size_bytes) VALUES($1,'https://owned.test/a.jpg','hash','image/jpeg',200)",
          [asset],
        );
        await q(
          "INSERT INTO listing_media_records(property_id,observation_id,source_url,owned_media_asset_id,content_hash,detected_mime,size_bytes,eligibility) VALUES($1,$2,'https://i1.28hse.com/a.jpg',$3,'hash','image/jpeg',200,'eligible')",
          [id, observationId, asset],
        );
        return { publishable: true };
      };
      const preview = await publishDaily({ payload, client: c });
      assert.equal(preview.ready.length, 1);
      assert.equal(preparations, 0);
      await q(
        "INSERT INTO listing_media_records(property_id,observation_id,source_url,eligibility,rejection_reason) VALUES($1,$2,'https://i1.28hse.com/a.jpg','rejected','download_failed')",
        [id, obs],
      );
      const priorAsset = randomUUID();
      await q(
        "INSERT INTO media_assets(id,url,content_hash,content_type,size_bytes) VALUES($1,'https://owned.test/previous.jpg','priorhash','image/jpeg',201)",
        [priorAsset],
      );
      await q(
        "INSERT INTO listing_media_records(property_id,observation_id,source_url,owned_media_asset_id,content_hash,detected_mime,size_bytes,eligibility) VALUES($1,$2,'https://i2.28hse.com/previous.jpg',$3,'priorhash','image/jpeg',201,'eligible')",
        [id, obs, priorAsset],
      );
      const result = await publishDaily({ payload, client: c, apply: true, prepare });
      assert.equal(
        (await q("SELECT count(*)::int n FROM listing_media_records WHERE eligibility='rejected'"))
          .rows[0].n,
        1,
      );
      assert.equal(
        (await q("SELECT observation_id FROM mls_source_state")).rows[0].observation_id,
        obs,
      );
      assert.notEqual(
        (
          await q(
            "SELECT observation_id FROM listing_media_records WHERE eligibility='eligible' AND source_url='https://i1.28hse.com/a.jpg'",
          )
        ).rows[0].observation_id,
        obs,
      );

      assert.equal(result.published.length, 1);
      assert.equal((await q("SELECT status FROM properties")).rows[0].status, "active");
      assert.equal((await q("SELECT count(*)::int n FROM listing_change_events")).rows[0].n, 4);
      assert.equal((await q("SELECT count(*)::int n FROM audit_logs")).rows[0].n, 1);
      const replay = await publishDaily({ payload, client: c, apply: true, prepare });
      assert.equal(replay.alreadyPublic, 1);
      assert.equal(preparations, 1);
      await q("UPDATE properties SET status='draft',description=NULL,images=NULL,source_url=NULL");
      const brokenClient = {
        query: async (text, params) => {
          if (text.includes("INSERT INTO audit_logs")) throw Error("TEST_AUDIT_FAILURE");
          return c.query(text, params);
        },
      };
      await assert.rejects(
        publishDaily({
          payload,
          client: brokenClient,
          apply: true,
          prepare: async () => ({ publishable: true }),
        }),
        /TEST_AUDIT_FAILURE/,
      );
      assert.equal((await q("SELECT status FROM properties")).rows[0].status, "draft");
      assert.equal((await q("SELECT count(*)::int n FROM listing_change_events")).rows[0].n, 4);
      let unknownReport;
      const lostAcknowledgement = {
        query: async (text, params) => {
          const result = await c.query(text, params);
          if (text === "COMMIT") throw Error("TEST_COMMIT_ACK_LOST");
          return result;
        },
      };
      await assert.rejects(
        publishDaily({
          payload,
          client: lostAcknowledgement,
          apply: true,
          prepare,
          onReport: async (r) => {
            unknownReport = r;
          },
        }),
        /TEST_COMMIT_ACK_LOST/,
      );
      assert.equal(unknownReport.unknown[0].reason, "commit_outcome_unknown");
      assert.equal((await q("SELECT status FROM properties")).rows[0].status, "active");
      const reconciled = await publishDaily({ payload, client: c, apply: true, prepare });
      assert.equal(reconciled.alreadyPublic, 1);
      assert.equal(
        preparations,
        1,
        "confirmed owned media is not uploaded after unknown acknowledgement",
      );
      await q("UPDATE properties SET status='draft',description=NULL,images=NULL,source_url=NULL");
      await q(
        "INSERT INTO admin_property_overrides(property_no,shared,rent,sale) VALUES('A123456','{\"title_zh\":\"Staff\"}','{}','{}')",
      );
      const held = await publishDaily({ payload, client: c, apply: true, prepare });
      assert.equal(held.held[0].reason, "staff_or_source_review");
      assert.equal(preparations, 1);

      await q(
        "UPDATE mls_ingestion_scopes SET last_accepted_at=last_accepted_at+interval '1 second'",
      );
      await assert.rejects(
        publishDaily({ payload, client: c, apply: true, prepare }),
        /ACCEPTED_CURRENT/,
      );
      assert.equal(preparations, 1);
      // Real PostgreSQL queue readback; media failure is synthetic, no Blob calls.
      const waiting = Array.from({ length: 21 }, (_, i) => ({
        ...raw,
        property_id: String(4100001 + i),
        agency_property_no: "B" + String(200001 + i),
        source_url: `https://www.28hse.com/rent/apartment/property-${4100001 + i}`,
        publication: { description: "Test queue", images: [`https://i1.28hse.com/queue-${i}.jpg`] },
      }));
      const waitingPayload = { ...payload, listings: waiting };
      await q(
        `INSERT INTO properties(id,listing_no,canonical_property_no,title_zh,deal_type,status,ingestion_owner,rent,saleable_area,estate_id,created_at)
        SELECT gen_random_uuid(),'QUEUE-'||x.property_id,x.agency_property_no,'Queue','rent','draft','no-hermes-v2',18000,500,$2,now()-interval '2 days'
        FROM jsonb_to_recordset($1::jsonb) x(property_id text,agency_property_no text)`,
        [JSON.stringify(waiting), randomUUID()],
      );
      await q(
        `INSERT INTO property_public_members(property_id,public_listing_no) SELECT id,canonical_property_no FROM properties WHERE listing_no LIKE 'QUEUE-%'`,
      );
      await q(
        `INSERT INTO listing_source_observations(id,run_id,payload) SELECT gen_random_uuid(),$1,'{}' FROM properties WHERE listing_no LIKE 'QUEUE-%'`,
        [run],
      );
      const observations = (
        await q(
          `SELECT id FROM listing_source_observations WHERE id<>$1 AND payload='{}' ORDER BY id`,
          [obs],
        )
      ).rows;
      const queueProps = (
        await q(
          `SELECT id,canonical_property_no FROM properties WHERE listing_no LIKE 'QUEUE-%' ORDER BY canonical_property_no`,
        )
      ).rows;
      await q(
        `INSERT INTO mls_source_state(property_id,observation_id,source,scope_id,external_listing_id,deal_type,source_status)
       SELECT x.id,x.obs,'28hse_agent_540','agent:540',x.external,'rent','active'
       FROM jsonb_to_recordset($1::jsonb) x(id uuid,obs uuid,external text)`,
        [
          JSON.stringify(
            queueProps.map((p, i) => ({
              id: p.id,
              obs: observations[i].id,
              external: waiting[i].property_id,
            })),
          ),
        ],
      );
      await q("UPDATE mls_ingestion_receipts SET payload_hash=$1", [hashPayload(waitingPayload)]);
      await q("UPDATE mls_ingestion_scopes SET last_accepted_at=$1", [payload.scraped_at]);
      const tried = [];
      const failMedia = async ({ propertyId, observationId, observation }) => {
        tried.push(propertyId);
        await q(
          `INSERT INTO listing_media_records(property_id,observation_id,source_url,eligibility,created_at) VALUES($1,$2,$3,'upload_failed',clock_timestamp())`,
          [propertyId, observationId, observation.mediaCandidates[0].url],
        );
        return { publishable: false };
      };
      const queueReport = await publishDaily({
        payload: waitingPayload,
        client: c,
        apply: true,
        prepare: failMedia,
      });
      assert.equal(queueReport.attempted, 20);
      assert.equal(queueReport.eligibleBacklog, 21);
      assert.equal(tried.length, 20);
      assert.equal(
        queueReport.held.filter((x) => x.reason === "daily_publication_limit").length,
        1,
      );
      const untouched = queueProps.find((x) => !tried.includes(x.id)).id;
      tried.length = 0;
      await publishDaily({ payload: waitingPayload, client: c, apply: true, prepare: failMedia });
      assert.equal(tried[0], untouched, "never attempted draft gets first slot on next run");
      assert.equal(tried.length, 20, "failures count as attempts on retry");
    } finally {
      await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await c.end();
    }
  },
);
