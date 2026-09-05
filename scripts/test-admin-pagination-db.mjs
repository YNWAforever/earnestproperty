import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { buildAdminPageQuery } from "../src/lib/neon/admin-pagination-query.ts";
import { finishAdminPage } from "../src/lib/neon/admin-pagination.ts";
const url = process.env.ADMIN_PAGING_TEST_DATABASE_URL;
if (!url || process.env.ADMIN_PAGING_TEST_DATABASE_APPROVED !== "disposable") {
  console.error("Paging DB suite not run: explicit disposable URL and approval required.");
  process.exit(2);
}
if ([process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED].includes(url))
  throw Error("Refusing application URL");
const sql = neon(url),
  schema = "paging_test_" + randomUUID().replaceAll("-", ""),
  actor = { staffId: randomUUID(), roles: ["admin"] },
  other = randomUUID(),
  conversation = randomUUID();
const run = async (statement, params = []) =>
  (
    await sql.transaction([
      sql.query(`SET LOCAL search_path TO ${schema}`),
      sql.query(statement, params),
    ])
  ).at(-1);
let created = false;
try {
  await sql.query(`CREATE SCHEMA ${schema}`);
  created = true;
  for (const statement of [
    "CREATE TABLE crm_contacts(id uuid PRIMARY KEY,name text,phone text,email text,opt_in_whatsapp boolean,opted_out_whatsapp boolean,created_at timestamptz)",
    "CREATE TABLE properties(id uuid PRIMARY KEY,listing_no text,title_zh text)",
    "CREATE TABLE crm_leads(id uuid PRIMARY KEY,contact_id uuid,property_id uuid,stage text,intent text,budget_min integer,budget_max integer,source text,note text,created_at timestamptz,assigned_agent_id uuid)",
    "CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY,contact_id uuid,assigned_agent_id uuid,status text,last_message_at timestamptz,last_inbound_at timestamptz,updated_at timestamptz,created_at timestamptz DEFAULT now())",
    "CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY,conversation_id uuid,direction text,message_type text,text text,status text,error text,created_at timestamptz)",
    "CREATE TABLE estates(id uuid PRIMARY KEY,slug text,name_zh text,name_en text,district_slug text,developer text,updated_at timestamptz,created_at timestamptz DEFAULT now())",
    "CREATE TABLE cms_content_revisions(id uuid PRIMARY KEY,resource_id uuid,resource_type text,state text,draft_retired_at timestamptz,created_by uuid,version_number integer,payload jsonb,created_at timestamptz,browse_created_at timestamptz DEFAULT now())",
  ])
    await run(statement);
  await run(
    `INSERT INTO crm_contacts SELECT md5('contact'||n)::uuid,'contact '||n,'phone '||n,NULL,n%2=0,false,'2026-09-05T00:00:00.123456Z' FROM generate_series(1,10000)n`,
  );
  await run(
    `INSERT INTO crm_leads SELECT md5('lead'||n)::uuid,md5('contact'||n)::uuid,NULL,CASE WHEN n=10000 THEN 'old-match' ELSE 'new' END,'buy',NULL,NULL,'website',NULL,'2026-09-05T00:00:00.123456Z',CASE WHEN n%2=0 THEN $1::uuid ELSE $2::uuid END FROM generate_series(1,10000)n`,
    [actor.staffId, other],
  );
  await run(
    `INSERT INTO whatsapp_conversations VALUES($1::uuid,md5('contact1')::uuid,$2::uuid,'open',now(),now(),now(),now())`,
    [conversation, actor.staffId],
  );
  await run(
    `INSERT INTO whatsapp_messages SELECT md5('message'||n)::uuid,$1::uuid,'inbound','text','message '||n,'received',NULL,'2026-09-05T00:00:00.123456Z' FROM generate_series(1,100000)n`,
    [conversation],
  );
  await run(
    `INSERT INTO estates(id,slug,name_zh,name_en,district_slug,developer,updated_at) SELECT md5('estate'||n)::uuid,'estate-'||n,'estate '||n,NULL,'district',NULL,'2026-09-05T00:00:00.123456Z' FROM generate_series(1,1000)n`,
  );
  for (const table of ["crm_contacts", "crm_leads", "whatsapp_messages", "estates"])
    await run(`ANALYZE ${table}`);
  for (const [resource, count] of [
    ["leads", 10000],
    ["contacts", 10000],
    ["estates", 1000],
    ["messages", 100000],
  ]) {
    const input = {
      resource,
      ...(resource === "messages" ? { conversationId: conversation } : {}),
    };
    const query = buildAdminPageQuery(input, actor);
    const start = performance.now();
    const result = (await run(query.statement, query.params))[0];
    const elapsed = Math.round(performance.now() - start);
    assert.equal(result.total, count);
    assert.equal(result.rows.length, 51);
    const first = finishAdminPage(result.rows, 50, query.binding, count);
    const secondQuery = buildAdminPageQuery({ ...input, cursor: first.nextCursor }, actor);
    const second = (await run(secondQuery.statement, secondQuery.params))[0];
    assert.equal(second.rows.length, 51);
    assert.ok(second.rows.every((r) => !first.rows.some((p) => p.id === r.id)));
    const plan = await run(
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query.statement,
      query.params,
    );
    const detail = plan[0]["QUERY PLAN"][0];
    console.log(
      JSON.stringify({
        resource,
        count,
        responseRows: first.rows.length,
        responseBytes: Buffer.byteLength(JSON.stringify(first)),
        roundTripMs: elapsed,
        executionMs: detail["Execution Time"],
        plan: detail.Plan,
      }),
    );
  }
  const filtered = buildAdminPageQuery({ resource: "leads", stage: "old-match" }, actor);
  assert.equal((await run(filtered.statement, filtered.params))[0].total, 1);
  const scoped = buildAdminPageQuery({ resource: "leads" }, { ...actor, roles: ["agent"] });
  assert.equal((await run(scoped.statement, scoped.params))[0].total, 5000);
  const denied = buildAdminPageQuery(
    { resource: "messages", conversationId: conversation },
    { staffId: other, roles: ["agent"] },
  );
  const empty = (await run(denied.statement, denied.params))[0];
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.rows, []);
  await run(
    "CREATE INDEX paging_messages_order ON whatsapp_messages(conversation_id,created_at DESC,id DESC)",
  );
  const optimized = buildAdminPageQuery(
    { resource: "messages", conversationId: conversation },
    actor,
  );
  const samples = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    await run(optimized.statement, optimized.params);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const optimizedPlan = (
    await run("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + optimized.statement, optimized.params)
  )[0]["QUERY PLAN"][0];
  console.log(
    JSON.stringify({
      resource: "messages-indexed",
      samples: 20,
      p95Ms: Math.round(samples[18]),
      executionMs: optimizedPlan["Execution Time"],
      plan: optimizedPlan.Plan,
    }),
  );
  console.log(
    "PASS full-dataset filters, bounded pages, tied boundary, actor scoping and message authorization",
  );
} finally {
  if (created) await sql.query(`DROP SCHEMA ${schema} CASCADE`);
}
