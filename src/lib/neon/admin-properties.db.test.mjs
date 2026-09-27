import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { assertDisposableNeonTestTarget } from "./disposable-test-target.mjs";
import {
  buildAdminPropertyGroupsQuery,
  buildAdminManagedPropertyQuery,
  buildAdminSourceReviewQuery,
  mapAdminPropertyGroup,
} from "./admin-properties.server.ts";
const url = process.env.ASTRA_TEST_DATABASE_URL;
const admin = { staffId: "10000000-0000-0000-0000-000000000001", roles: ["admin"] };
const agent = { staffId: "10000000-0000-0000-0000-000000000001", roles: ["agent"] };
test(
  "grouped reads rank globally, page groups, retain history and deny sibling disclosure",
  { skip: !url },
  async () => {
    await assertDisposableNeonTestTarget(url);
    const db = neon(url),
      schema = `admin_groups_${randomUUID().replaceAll("-", "")}`;
    const run = async (statement, params = []) => {
      const results = await db.transaction((tx) => [
        tx.query("SELECT set_config('search_path',$1,true)", [`${schema},pg_catalog`]),
        tx.query(statement, params),
      ]);
      return results[1];
    };
    const query = async (filters, actor = admin) => {
      const q = buildAdminPropertyGroupsQuery(filters, actor);
      return (await run(q.statement, q.params))[0];
    };
    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      await run(
        `CREATE TABLE properties(id uuid PRIMARY KEY,listing_no text,deal_type text,status text,title_zh text,estate_id uuid,agent_id uuid,price numeric,rent numeric,saleable_area numeric,images text[],source_updated_at timestamptz,last_seen_at timestamptz,updated_at timestamptz,created_at timestamptz)`,
      );
      await run(
        `CREATE TABLE property_public_members(property_id uuid PRIMARY KEY,public_listing_no text)`,
      );
      await run(`CREATE TABLE estates(id uuid PRIMARY KEY,name_zh text)`);
      await run(`CREATE TABLE staff_users(id uuid PRIMARY KEY,name_zh text,name_en text)`);
      const a = agent.staffId,
        b = "10000000-0000-0000-0000-000000000002";
      // Old active sale owned by A is superseded by B's withdrawal. A must not see old sale.
      await run(
        `INSERT INTO properties(id,listing_no,deal_type,status,title_zh,agent_id,price,rent,saleable_area,images,source_updated_at,updated_at,created_at) VALUES
 ('00000000-0000-0000-0000-000000000001','R075733-old','sale','active','Private old',$1,6000000,NULL,500,ARRAY[]::text[],'2026-01-01','2026-01-01','2026-01-01'),
 ('00000000-0000-0000-0000-000000000002','R075733-sale','sale','offline','Private sale',$2,6700000,NULL,600,ARRAY[]::text[],'2026-02-01','2026-02-01','2026-02-01'),
 ('00000000-0000-0000-0000-000000000003','R075733-rent','rent','active','Visible rent',$1,NULL,18000,550,ARRAY[]::text[],'2026-02-01','2026-02-01','2026-02-01'),
 ('00000000-0000-0000-0000-000000000004','SECOND-sale','sale','active','Second',$1,2000000,NULL,400,ARRAY[]::text[],'2026-01-01','2026-01-01','2026-01-01'),
 ('00000000-0000-0000-0000-000000000005','MANUAL','rent','draft','Manual',$1,NULL,10000,400,ARRAY[]::text[],'2026-01-01','2026-01-01','2026-01-01')`,
        [a, b],
      );
      await run(
        `INSERT INTO property_public_members SELECT id,CASE WHEN listing_no LIKE 'R075733%' THEN 'R075733' ELSE 'SECOND' END FROM properties WHERE listing_no<>'MANUAL'`,
      );
      const all = await query({ status: "all", pageSize: 1 });
      assert.equal(all.total, 3);
      assert.equal(all.rows.length, 1);
      assert.equal((await query({ status: "active", deal: "sale" })).total, 1);
      const group = await query({ q: "R075733", status: "all" });
      assert.equal(group.total, 1);
      const mapped = mapAdminPropertyGroup(group.rows[0]);
      assert.equal(mapped.summary.offerings.sale.price, 6700000);
      assert.equal(mapped.summary.offerings.rent.rent, 18000);
      assert.equal(mapped.summary.reviewRequired, true);
      const saleAscending = await query({
        status: "all",
        sort: "salePrice",
        direction: "asc",
        pageSize: 1,
      });
      assert.equal(saleAscending.rows[0].group_no, "SECOND");
      const saleSecondPage = await query({
        status: "all",
        sort: "salePrice",
        direction: "asc",
        pageSize: 1,
        page: 2,
      });
      assert.equal(saleSecondPage.rows[0].group_no, "R075733");
      const saleNullLast = await query({
        status: "all",
        sort: "salePrice",
        direction: "desc",
        pageSize: 1,
        page: 3,
      });
      assert.ok(saleNullLast.rows[0].group_no.startsWith("unlinked:"));
      const rentalOrder = await query({ status: "all", sort: "rentPrice", direction: "asc" });
      assert.ok(rentalOrder.rows[0].group_no.startsWith("unlinked:"));
      assert.equal(rentalOrder.rows[1].group_no, "R075733");
      assert.equal(rentalOrder.rows[2].group_no, "SECOND");
      assert.deepEqual(
        (await query({ status: "all", sort: "estate", direction: "asc" })).rows.map(
          (r) => r.group_no,
        ),
        ["R075733", "SECOND", rentalOrder.rows[0].group_no],
      );
      const scoped = await query({ q: "R075733", status: "all" }, agent);
      const scopedMap = mapAdminPropertyGroup(scoped.rows[0]);
      assert.equal(scopedMap.summary.offerings.sale, null);
      assert.equal(scopedMap.summary.editableShared, false);
      assert.deepEqual(scopedMap.conflicts, []);
      assert.equal(JSON.stringify(scoped).includes("Private sale"), false);
      assert.equal((await query({ q: "Private sale", status: "all" }, agent)).total, 0);
      const detailQuery = buildAdminManagedPropertyQuery(
        "00000000-0000-0000-0000-000000000001",
        admin,
      );
      const [detail] = await run(detailQuery.statement, detailQuery.params);
      assert.equal(detail.history.length, 3);
      assert.equal(detail.history.filter((x) => x.current).length, 2);
      const manualQuery = buildAdminManagedPropertyQuery(
        "00000000-0000-0000-0000-000000000005",
        agent,
      );
      const [manual] = await run(manualQuery.statement, manualQuery.params);
      assert.equal(manual.unlinked, true);
      const beyond = await query({ status: "all", page: 100 });
      assert.equal(beyond.total, 3);
      assert.deepEqual(beyond.rows, []);
      const oldVersion = group.rows[0].version;
      await run(
        `UPDATE properties SET updated_at=updated_at+interval '1 second' WHERE listing_no='R075733-old'`,
      );
      assert.notEqual((await query({ q: "R075733", status: "all" })).rows[0].version, oldVersion);
      await run(
        `CREATE TABLE admin_property_overrides(property_no text PRIMARY KEY,shared jsonb,sale jsonb,rent jsonb)`,
      );
      await run(
        `CREATE TABLE admin_property_source_snapshots(id bigint,property_no text,property_id uuid,operation text,payload jsonb,captured_at timestamptz)`,
      );
      await run(
        `INSERT INTO admin_property_overrides VALUES('R075733','{"description":"Shared page copy"}','{"price":6700000}','{"rent":18000}')`,
      );
      await run(`INSERT INTO admin_property_source_snapshots VALUES
      (1,'R075733','00000000-0000-0000-0000-000000000002','UPDATE','{"price":9000000,"description":"Private"}',now()),
      (2,'R075733','00000000-0000-0000-0000-000000000003','UPDATE','{"rent":17000,"description":"Original"}',now())`);
      const reviewQuery = buildAdminSourceReviewQuery(
        ["00000000-0000-0000-0000-000000000002", "00000000-0000-0000-0000-000000000003"],
        agent,
      );
      const [review] = await run(reviewQuery.statement, reviewQuery.params);
      assert.equal(
        review.differences.some((diff) => diff.deal_type === "sale"),
        false,
      );
      assert.equal(review.differences.find((diff) => diff.field === "rent").source_value, 17000);
      assert.equal(review.descriptions.R075733, "Shared page copy");
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  },
);
