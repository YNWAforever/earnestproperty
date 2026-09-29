import { PGlite } from "@electric-sql/pglite";
import { buildAdminPageQuery } from "../src/lib/neon/admin-pagination-query.ts";
import { cpus, totalmem, platform, release } from "node:os";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";

const value = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? fallback : Number(process.argv[index + 1]);
};
const conversations = value("--conversations", 1000);
const messages = value("--messages", 20);
const readers = value("--readers", 1);
const runs = value("--runs", 7);
const analyze = process.argv.includes("--analyze");
const outIndex = process.argv.indexOf("--out");
const out = outIndex < 0 ? null : process.argv[outIndex + 1];
if (
  ![conversations, messages, readers, runs].every(Number.isSafeInteger) ||
  conversations < 1 ||
  conversations > 10000 ||
  messages < 1 ||
  messages > 200 ||
  ![1, 10].includes(readers) ||
  runs < 3 ||
  runs > 30
) {
  throw new Error(
    "Use bounded synthetic dimensions: conversations 1-10000, messages 1-200, readers 1/10, runs 3-30",
  );
}
const actor = { staffId: "11111111-1111-4111-8111-111111111111", roles: ["agent"] };
const other = "22222222-2222-4222-8222-222222222222";
const db = new PGlite();
const initStart = performance.now();
try {
  await db.exec(`
    CREATE TABLE staff_users(id uuid PRIMARY KEY,name_zh text,name_en text);
    CREATE TABLE crm_contacts(id uuid PRIMARY KEY,name text,phone text,opted_out_whatsapp boolean);
    CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY,contact_id uuid,status text,
      assigned_agent_id uuid,last_message_at timestamptz,last_inbound_at timestamptz,
      created_at timestamptz,updated_at timestamptz);
    CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY,conversation_id uuid,text text,
      direction text,created_at timestamptz);
    CREATE TABLE inquiries(id uuid PRIMARY KEY,conversation_id uuid,source text,status text,
      public_listing_no text,placement_source text,requested_staff_id uuid,
      enquiry_owner_staff_id uuid,first_human_response_at timestamptz,
      association_review boolean,provider_thread_review boolean,updated_at timestamptz);
    CREATE TABLE whatsapp_enquiry_reference_links(event_id uuid,ref_index int,conversation_id uuid,
      inquiry_id uuid,source text,external_listing_id text,created_at timestamptz);
    CREATE FUNCTION wa_can_read_conversation(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=$2 AND assigned_agent_id=$1) $$;
    CREATE FUNCTION wa_can_reply_enquiry(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT $2 IS NOT NULL $$;
    CREATE FUNCTION wa_can_correct_enquiry(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT false $$;
    INSERT INTO staff_users VALUES ('11111111-1111-4111-8111-111111111111','同事甲','Agent A'),
      ('22222222-2222-4222-8222-222222222222','同事乙','Agent B');
  `);
  const convId = "(('aaaaaaaa-aaaa-4aaa-8aaa-' || lpad(g::text,12,'0'))::uuid)";
  const inqId = "(('bbbbbbbb-bbbb-4bbb-8bbb-' || lpad(g::text,12,'0'))::uuid)";
  await db.exec(`
    INSERT INTO whatsapp_conversations
    SELECT ${convId},NULL,'open',
      CASE WHEN g % 20 = 0 THEN '${other}'::uuid ELSE '${actor.staffId}'::uuid END,
      '2026-09-01'::timestamptz + g * interval '1 second',
      '2026-09-01'::timestamptz + g * interval '1 second',
      '2026-09-01'::timestamptz,'2026-09-01'::timestamptz + g * interval '1 second'
    FROM generate_series(1,${conversations}) g;
    INSERT INTO inquiries
    SELECT ${inqId},${convId},'whatsapp','new',
      'A' || lpad(g::text,6,'0'),'28hse',NULL,NULL,NULL,false,false,
      '2026-09-01'::timestamptz + g * interval '1 second'
    FROM generate_series(1,${conversations}) g;
    INSERT INTO whatsapp_enquiry_reference_links
    SELECT md5('ref:'||g)::uuid,0,${convId},${inqId},'28hse',g::text,
      '2026-09-01'::timestamptz
    FROM generate_series(1,${conversations}) g;
  `);
  await db.exec(`
    INSERT INTO whatsapp_messages
    SELECT md5(g::text || ':' || m::text)::uuid,
      ('aaaaaaaa-aaaa-4aaa-8aaa-' || lpad(g::text,12,'0'))::uuid,
      'Synthetic enquiry ' || g::text || ' message ' || m::text,
      CASE WHEN m % 2=0 THEN 'outbound' ELSE 'inbound' END,
      '2026-09-01'::timestamptz + g * interval '1 second' + m * interval '1 millisecond'
    FROM generate_series(1,${conversations}) g
    CROSS JOIN generate_series(1,${messages}) m;
    CREATE INDEX whatsapp_conversations_agent_activity_idx
      ON whatsapp_conversations(assigned_agent_id,last_message_at DESC,id DESC);
    CREATE INDEX whatsapp_messages_conversation_created_idx
      ON whatsapp_messages(conversation_id,created_at DESC,id DESC);
    CREATE INDEX inquiries_conversation_updated_idx
      ON inquiries(conversation_id,updated_at DESC,id DESC);
    CREATE INDEX enquiry_ref_inquiry_created_idx
      ON whatsapp_enquiry_reference_links(inquiry_id,created_at DESC);
    ANALYZE;
  `);
  const build = buildAdminPageQuery({ resource: "conversations", limit: 20 }, actor);
  const samples = [];
  let total = 0,
    payloadBytes = 0;
  await db.query(build.statement, build.params);
  for (let run = 0; run < runs; run++) {
    const wave = await Promise.all(
      Array.from({ length: readers }, async () => {
        const started = performance.now();
        const result = await db.query(build.statement, build.params);
        return { ms: performance.now() - started, row: result.rows[0] };
      }),
    );
    for (const sample of wave) {
      samples.push(sample.ms);
      total = sample.row.total;
      payloadBytes = Buffer.byteLength(JSON.stringify(sample.row), "utf8");
    }
  }
  const sorted = samples.toSorted((a, b) => a - b);
  const quantile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  const plan = await db.query(
    (analyze ? "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " : "EXPLAIN (FORMAT JSON) ") +
      build.statement,
    build.params,
  );
  const planValue = plan.rows[0]?.["QUERY PLAN"] ?? null;
  const scans = [];
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (node["Node Type"]?.includes("Scan") && node["Relation Name"]) {
      scans.push({
        node: node["Node Type"],
        relation: node["Relation Name"],
        rows: node["Actual Rows"] ?? null,
        loops: node["Actual Loops"] ?? null,
        observedRows:
          node["Actual Rows"] == null ? null : node["Actual Rows"] * node["Actual Loops"],
      });
    }
    for (const child of node.Plans ?? []) walk(child);
  }
  walk(planValue?.[0]?.Plan);
  const result = {
    environment: "PGlite WASM single connection; synthetic, not Neon multi-session",
    hardware: {
      platform: platform(),
      release: release(),
      cpu: cpus()[0]?.model,
      cpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    dataset: {
      conversations,
      messagesPerConversation: messages,
      messageRows: conversations * messages,
      actorVisible: conversations - Math.floor(conversations / 20),
    },
    workload: { readers, runs, samples: samples.length, queryCountPerRead: 1, pageLimit: 20 },
    measurements: {
      p50Ms: quantile(0.5),
      p95Ms: quantile(0.95),
      payloadBytes,
      total,
      fixtureMs: performance.now() - initStart,
    },
    plan: analyze ? planValue : null,
    scanSummary: scans,
    limitations: [
      "PGlite serializes overlapping requests",
      "permission functions are simplified fixture stubs",
      "receipt persistence, queue lag and browser freshness are not measured",
    ],
  };
  const serialized = JSON.stringify(result, null, 2);
  if (out) await writeFile(out, serialized, "utf8");
  console.log(
    JSON.stringify({
      dataset: result.dataset,
      workload: result.workload,
      measurements: result.measurements,
      output: out,
    }),
  );
} finally {
  await db.close();
}
