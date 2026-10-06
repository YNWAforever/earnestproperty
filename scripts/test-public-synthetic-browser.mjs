/** Isolated public browser acceptance. Never accepts a remote website target. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { neon } from "@neondatabase/serverless";
import { assertDisposableNeonTestTarget } from "../src/lib/neon/disposable-test-target.mjs";

assert.ok(
  !process.env.PLAYWRIGHT_BASE_URL,
  "Unset PLAYWRIGHT_BASE_URL; this runner starts its own local app",
);
const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
assert.ok(databaseUrl, "A disposable acceptance DATABASE_URL is required");
const identity = await assertDisposableNeonTestTarget(databaseUrl);
console.log("Verified synthetic database:", JSON.stringify(identity));
const sql = neon(databaseUrl);
const images = ["/logo-mark.png", "/favicon.svg"];
const rows = Array.from({ length: 27 }, (_, index) => ({
  id: randomUUID(),
  listing_no: `SYNC-AUDIT-PAGE-${index + 1}`,
  canonical_property_no: `B98${String(index + 1).padStart(4, "0")}`,
  title_zh: `合成驗收樓盤 ${index + 1}`,
  deal_type: "sale",
  status: "active",
  price: 6_000_000 + index * 10_000,
  rent: null,
  source_updated_at: "2026-09-27",
  images,
}));
rows.push(
  {
    ...rows[0],
    id: randomUUID(),
    listing_no: "SYNC-AUDIT-OLD",
    canonical_property_no: "A074714",
    title_zh: "合成舊售盤",
    source_updated_at: "2026-09-01",
  },
  {
    ...rows[0],
    id: randomUUID(),
    listing_no: "SYNC-AUDIT-OFFLINE",
    canonical_property_no: "A074714",
    title_zh: "合成已下架售盤",
    status: "offline",
    source_updated_at: "2026-09-28",
  },
  {
    ...rows[0],
    id: randomUUID(),
    listing_no: "SYNC-AUDIT-RENT",
    canonical_property_no: "A074714",
    title_zh: "合成現有租盤",
    deal_type: "rent",
    price: null,
    rent: 18_000,
    source_updated_at: "2026-09-29",
  },
);
const propertyIds = rows.map((row) => row.id);
const publicNumbers = [...new Set(rows.map((row) => row.canonical_property_no))];
let seeded = false;
let server;
let browser;
let serverOutput = "";
let interrupted = false;
const stop = () => {
  interrupted = true;
  browser?.kill();
  server?.kill();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const exitOf = (child) =>
  new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
try {
  // Lock + empty check + insert are atomic. No inherited property snapshot is allowed.
  await sql.transaction((tx) => [
    tx.query("LOCK TABLE properties, property_public_groups IN SHARE ROW EXCLUSIVE MODE"),
    tx.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM properties) OR EXISTS (SELECT 1 FROM property_public_groups)
        OR EXISTS (SELECT 1 FROM inquiries) THEN
        RAISE EXCEPTION 'Public browser fixture requires an empty acceptance property/inquiry dataset';
      END IF;
    END $$`),
    tx.query(
      `INSERT INTO properties
      (id, listing_no, canonical_property_no, title_zh, deal_type, status, price, rent,
       source_updated_at, images, district_slug, estate_id, saleable_area, bedrooms, description)
      SELECT x.id::uuid, x.listing_no, x.canonical_property_no, x.title_zh,
        x.deal_type::deal_type, x.status::property_status, x.price, x.rent,
        x.source_updated_at::date, x.images, 'sham-tseng',
        (SELECT id FROM estates WHERE slug='bellagio'), 500, 2,
        'Synthetic audit acceptance fixture. No real listing or recipient.'
      FROM jsonb_to_recordset($1::jsonb) AS x(id text, listing_no text,
        canonical_property_no text, title_zh text, deal_type text, status text,
        price numeric, rent numeric, source_updated_at text, images text[])`,
      [JSON.stringify(rows)],
    ),
  ]);
  seeded = true;
  const [seed] = await sql.query(`SELECT (SELECT count(*)::int FROM properties) AS properties,
    (SELECT count(*)::int FROM property_public_groups) AS groups,
    (SELECT count(*)::int FROM property_public_members) AS members`);
  assert.deepEqual(seed, { properties: 30, groups: 28, members: 30 });
  console.log("Synthetic fixture:", JSON.stringify(seed));

  const port = await new Promise((done, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const selected = probe.address().port;
      probe.close((error) => (error ? reject(error) : done(selected)));
    });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const report = resolve("test-results/public-synthetic-report.json");
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DATABASE_URL_UNPOOLED: databaseUrl,
    NEON_BRANCH: identity.branch_id,
    PLAYWRIGHT_BASE_URL: baseUrl,
    EARNEST_SYNTHETIC_PUBLIC_FIXTURE: "true",
    PLAYWRIGHT_JSON_OUTPUT_FILE: report,
    EP_WA_ENQUIRY_MODE: "off",
    EP_WA_TRACKED_LINKS_ENABLED: "false",
    EP_WA_ROUTING_ENABLED: "false",
    EP_WA_SERVICE_AUTOMATION_ENABLED: "false",
    EP_WA_STAFF_NOTIFICATIONS_ENABLED: "false",
    OPS_WAKE_URL: "",
    WOZTELL_ENABLED: "false",
    // Example-only number, inspected as href text; no WhatsApp link is opened.
    VITE_CONTACT_WHATSAPP_PHONE: "85200000000",
    VITE_CONTACT_PHONE_DISPLAY: "Synthetic fixture",
    VITE_CONTACT_PHONE_TEL: "+85200000000",
  };
  // No server reuse: the app must receive exactly the attested database URL.
  server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const serverDone = exitOf(server);
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => {
      serverOutput = (serverOutput + chunk).slice(-12_000);
    });
  }
  const deadline = Date.now() + 150_000;
  let ready = false;
  while (Date.now() < deadline && server.exitCode === null && !interrupted) {
    try {
      const response = await fetch(`${baseUrl}/mortgage`, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        await response.arrayBuffer();
        ready = true;
        break;
      }
    } catch {
      /* Vite may still be compiling the first SSR request. */
    }
    await delay(1_000);
  }
  assert.ok(ready && !interrupted, "Local synthetic app did not become ready");
  for (const path of [
    "/",
    "/listings?deal=sale",
    "/property/A074714",
    "/estate/bellagio",
    "/contact",
  ]) {
    const started = Date.now();
    const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(45_000) });
    assert.equal(response.status, 200, `Warmup failed: ${path}`);
    await response.arrayBuffer();
    console.log(`Local warmup ${path}: ${Date.now() - started} ms (development only)`);
  }
  console.log("Own local app ready; browser requests are restricted to GET/HEAD/OPTIONS.");
  await mkdir("test-results", { recursive: true });
  browser = spawn(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "e2e/a11y.spec.ts",
      "e2e/public-acceptance.spec.ts",
      "e2e/audit-public-identity.spec.ts",
      "--workers=1",
      "--reporter=list,json",
      "--trace=retain-on-failure",
    ],
    { env, stdio: "inherit" },
  );
  const code = await exitOf(browser);
  browser = undefined;
  assert.equal(code, 0, "Synthetic browser acceptance failed; inspect test-results");
  const result = JSON.parse(await readFile(report, "utf8"));
  console.log("Browser result:", JSON.stringify(result.stats));
  assert.equal(result.stats.skipped, 0, "Synthetic acceptance must never pass with skipped tests");
  assert.equal(result.stats.unexpected, 0);
  assert.ok(result.stats.expected >= 20, "Expected public acceptance cases were not all collected");
  server.kill();
  await serverDone;
  server = undefined;
} finally {
  browser?.kill();
  server?.kill();
  if (seeded) {
    // Delete only the IDs created by this run. FK constraints protect unexpected references.
    await assertDisposableNeonTestTarget(databaseUrl);
    await sql.transaction((tx) => [
      tx.query("DELETE FROM properties WHERE id = ANY($1::uuid[])", [propertyIds]),
      tx.query(
        `DELETE FROM property_public_groups WHERE public_listing_no = ANY($1::text[])
        AND NOT EXISTS (SELECT 1 FROM property_public_members WHERE property_public_members.public_listing_no = property_public_groups.public_listing_no)`,
        [publicNumbers],
      ),
    ]);
    const [remaining] = await sql.query(`SELECT
      (SELECT count(*)::int FROM properties) AS properties,
      (SELECT count(*)::int FROM property_public_groups) AS groups,
      (SELECT count(*)::int FROM property_public_members) AS members,
      (SELECT count(*)::int FROM inquiries) AS inquiries`);
    console.log("After exact fixture cleanup:", JSON.stringify(remaining));
    assert.deepEqual(remaining, { properties: 0, groups: 0, members: 0, inquiries: 0 });
  }
  // Avoid printing application logs that could contain environment or provider data.
  if (serverOutput.includes("EADDRINUSE")) console.error("Local fixture server port was occupied.");
}
