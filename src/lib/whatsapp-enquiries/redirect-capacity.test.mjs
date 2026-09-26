import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  redirectBucketKey,
  redirectCapacity,
  redirectCapacityDecision,
  maybePruneRedirectBuckets,
} from "./redirect-capacity.ts";
import { trackedRedirect } from "../neon/whatsapp-enquiries.server.ts";

test("more than 300 registered opens fit a campaign while a hot link is bounded", () => {
  const config = redirectCapacity({});
  assert.equal(config.registeredPerLinkPerMinute, 600);
  assert.equal(redirectCapacityDecision(301, 301, config), "allowed");
  assert.equal(redirectCapacityDecision(601, 601, config), "link_limited");
  assert.equal(redirectCapacityDecision(5001, 1, config), "global_limited");
  assert.notEqual(
    redirectBucketKey("registered", "link-a"),
    redirectBucketKey("registered", "link-b"),
  );
  const shards = new Set(
    Array.from({ length: 1000 }, (_, i) => redirectBucketKey("global", "code-" + i)),
  );
  assert.ok(shards.size <= 32);
});
test("capacity values are bounded even when env is malformed", () => {
  assert.deepEqual(
    redirectCapacity({
      EP_WA_REDIRECT_LINK_PER_MIN: "-1",
      EP_WA_REDIRECT_GLOBAL_SHARD_PER_MIN: "100000000",
    }),
    redirectCapacity({}),
  );
});
test("retention prunes only on a bounded active-traffic interval", async () => {
  let calls = 0;
  const query = async (sql) => {
    calls++;
    assert.match(sql, /LIMIT 1000/);
    assert.match(sql, /window_start < now\(\) - interval '1 day'/);
  };
  assert.equal(await maybePruneRedirectBuckets(query, 999), false);
  assert.equal(await maybePruneRedirectBuckets(query, 1000), true);
  assert.equal(await maybePruneRedirectBuckets(query, 1001), false);
  assert.equal(calls, 1);
});

test("retention SQL and index migration preserve current counters", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE whatsapp_link_rate_buckets (
      bucket_key text PRIMARY KEY, window_start timestamptz NOT NULL, request_count integer NOT NULL
    );`);
    const migration = readFileSync(
      new URL(
        "../../../neon/migrations/20260927100000_whatsapp_redirect_bucket_retention.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(`INSERT INTO whatsapp_link_rate_buckets(bucket_key,window_start,request_count)
      VALUES ('old',now()-interval '2 days',1),('current',now(),2)`);
    assert.equal(await maybePruneRedirectBuckets((sql) => db.query(sql), 1000), true);
    const rows = (await db.query("SELECT bucket_key FROM whatsapp_link_rate_buckets")).rows;
    assert.deepEqual(
      rows.map((row) => row.bucket_key),
      ["current"],
    );
  } finally {
    await db.close();
  }
});

test("prefetch causes no rate read or reference mint", async () => {
  let reads = 0;
  const response = await trackedRedirect(
    new Request("https://fixture/w/abcdefghijklmnop", { method: "HEAD" }),
    "abcdefghijklmnop",
    async () => {
      reads++;
      return [];
    },
  );
  assert.equal(response.status, 204);
  assert.equal(reads, 0);
});
test("a registered limited link falls back with its offering context, without an open", async () => {
  const old = { ...process.env };
  Object.assign(process.env, {
    EP_WA_TRACKED_LINKS_ENABLED: "true",
    EP_WA_COMPANY_CHANNEL_ID: "fixture",
    EP_WA_COMPANY_PHONE: "85212345678",
  });
  let buckets = 0,
    opens = 0;
  const query = async (sql) => {
    if (sql.includes("request_count")) return [{ request_count: ++buckets === 1 ? 1 : 601 }];
    if (sql.includes("JOIN whatsapp_tracking_link_versions"))
      return [
        {
          id: "11111111-1111-4111-8111-111111111111",
          code: "abcdefghijklmnop",
          version: 1,
          property_id: "22222222-2222-4222-8222-222222222222",
          public_listing_no: "A074714",
          deal_type: "sale",
          enabled: true,
          channel_id: "fixture",
        },
      ];
    if (sql.includes("FROM properties")) return [{ title_zh: "星堤三房", agent_id: null }];
    if (sql.includes("INSERT INTO whatsapp_link_opens")) opens++;
    return [];
  };
  try {
    const response = await trackedRedirect(
      new Request("https://fixture/w/abcdefghijklmnop"),
      "abcdefghijklmnop",
      query,
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("X-WA-Tracking"), "untracked");
    assert.match(decodeURIComponent(response.headers.get("Location")), /A074714/);
    assert.match(decodeURIComponent(response.headers.get("Location")), /星堤三房/);
    assert.equal(opens, 0);
  } finally {
    process.env = old;
  }
});
