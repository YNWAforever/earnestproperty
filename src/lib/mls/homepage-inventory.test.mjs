import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const now = Date.parse("2026-10-27T04:00:00.000Z");
const capturedAt = "2026-10-27T03:00:00.123456Z";
const inputSha256 = "a".repeat(64);
const input = (changes = {}) => ({
  schema_version: 1,
  source: "28hse_agent_540",
  scope: "agent:540",
  deal_type: "sale",
  complete: true,
  advertised_count: 3,
  captured_at: capturedAt,
  entries: [
    { source_id: "100", agent_listing_ref: "A000001", promotion_tier_raw: "置頂" },
    { source_id: "101", agent_listing_ref: "A000001", promotion_tier_raw: "黃金" },
    { source_id: "102", agent_listing_ref: "B000002", promotion_tier_raw: null },
  ],
  ...changes,
});

test("a complete sale inventory retains paid grades, source order and distinct ads for one ref", async () => {
  const { normalizeHomepageInventory } = await import("./homepage-inventory.mjs");
  const result = normalizeHomepageInventory(input(), { now });
  assert.equal(result.capturedAt, capturedAt);
  assert.equal(result.advertisedCount, 3);
  assert.deepEqual(result.entries, [
    {
      sourceId: "100",
      ref: "A000001",
      position: 1,
      promotionTier: "pinned",
      promotionTierRaw: "置頂",
    },
    {
      sourceId: "101",
      ref: "A000001",
      position: 2,
      promotionTier: "gold",
      promotionTierRaw: "黃金",
    },
    {
      sourceId: "102",
      ref: "B000002",
      position: 3,
      promotionTier: "normal",
      promotionTierRaw: null,
    },
  ]);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  const reordered = input();
  reordered.entries.reverse();
  assert.notEqual(result.fingerprint, normalizeHomepageInventory(reordered, { now }).fingerprint);
});

test("invalid or incomplete source evidence cannot replace current inventory", async () => {
  const { normalizeHomepageInventory } = await import("./homepage-inventory.mjs");
  const badEntries = [
    [{ source_id: "100", agent_listing_ref: "A000001" }],
    [{ source_id: "100", agent_listing_ref: "A000001", promotion_tier_raw: "鑽石" }],
    [{ source_id: "100", agent_listing_ref: "A000001", promotion_tier_raw: 1 }],
    [{ source_id: "bad-id", agent_listing_ref: "A000001", promotion_tier_raw: null }],
    [{ source_id: "100", agent_listing_ref: "a000001", promotion_tier_raw: null }],
    [input().entries[0], input().entries[0]],
  ];
  for (const entries of badEntries)
    assert.throws(() =>
      normalizeHomepageInventory(input({ entries, advertised_count: entries.length }), { now }),
    );
  for (const changes of [
    { schema_version: 2 },
    { source: "propertyhk" },
    { scope: "agent:541" },
    { deal_type: "rent" },
    { complete: false },
    { advertised_count: 2 },
    { advertised_count: "3" },
    { entries: null },
    { entries: Array(10001).fill(input().entries[0]), advertised_count: 10001 },
    { captured_at: "2026-10-25T15:59:59Z" },
    { captured_at: "2026-10-27T04:05:01Z" },
    { captured_at: "2026-10-27T03:00:00+00:00" },
    { captured_at: "2026-02-30T03:00:00Z" },
  ])
    assert.throws(() => normalizeHomepageInventory(input(changes), { now }));
  assert.equal(
    normalizeHomepageInventory(input({ entries: [], advertised_count: 0 }), { now }).entries.length,
    0,
  );
});

async function database() {
  const db = new PGlite();
  await db.exec(`CREATE TYPE deal_type AS ENUM('sale','rent');
    CREATE TABLE listing_sync_runs (
      id uuid PRIMARY KEY, scheduled_for date NOT NULL, started_at timestamptz DEFAULT now(),
      finished_at timestamptz, mode text NOT NULL CHECK(mode IN ('shadow','publish')),
      status text NOT NULL CHECK(status IN ('running','healthy')), parser_version text NOT NULL,
      counts jsonb NOT NULL DEFAULT '{}'
    );
    CREATE TABLE listing_source_observations (
      id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES listing_sync_runs(id),
      source text NOT NULL, external_listing_id text NOT NULL, deal_type deal_type NOT NULL,
      source_url text NOT NULL, property_no_raw text, property_no_normalized text,
      payload jsonb NOT NULL, media_candidates jsonb DEFAULT '[]', content_hash text NOT NULL,
      validation_state text NOT NULL CHECK(validation_state IN ('valid','quarantined')),
      quarantine_reasons text[] DEFAULT '{}', parse_warnings text[] DEFAULT '{}',
      discovered_at timestamptz NOT NULL, fetched_at timestamptz NOT NULL,
      UNIQUE(run_id,source,external_listing_id,deal_type)
    );
    CREATE TABLE mls_source_promotion_tiers (
      source text NOT NULL, external_listing_id text NOT NULL, deal_type deal_type NOT NULL,
      promotion_tier text NOT NULL CHECK(promotion_tier IN ('gold','pinned','normal','unknown')),
      promotion_tier_raw text, observed_at timestamptz NOT NULL, snapshot_complete boolean NOT NULL,
      observation_id uuid REFERENCES listing_source_observations(id), updated_at timestamptz DEFAULT now(),
      PRIMARY KEY(source,external_listing_id,deal_type)
    );
    CREATE TABLE properties(id text PRIMARY KEY,title_zh text);
    CREATE TABLE property_source_links(property_id text,external_listing_id text);
    CREATE TABLE mls_source_state(property_id text,external_listing_id text);
    INSERT INTO properties VALUES('original','Keep canonical title');
    INSERT INTO property_source_links VALUES('original','100');
    INSERT INTO mls_source_state VALUES('original','100');`);
  return db;
}

test("immutable snapshot writes preserve original time and leave raw ad identities untouched", async () => {
  const { normalizeHomepageInventory, saveHomepageInventory, HOMEPAGE_INVENTORY_PARSER } =
    await import("./homepage-inventory.mjs");
  const db = await database();
  try {
    const inventory = normalizeHomepageInventory(input(), { now });
    const saved = await saveHomepageInventory(db, inventory, { inputSha256 });
    assert.equal(saved.replayed, false);
    assert.equal(saved.count, 3);
    const { rows: runs } = await db.query("SELECT * FROM listing_sync_runs");
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "healthy");
    assert.equal(runs[0].parser_version, HOMEPAGE_INVENTORY_PARSER);
    assert.deepEqual(runs[0].counts, {
      homepage_inventory: true,
      full_snapshot: true,
      source: "28hse_agent_540",
      scope: "agent:540",
      deal_type: "sale",
      captured_at: capturedAt,
      advertised_count: 3,
      fingerprint: inventory.fingerprint,
      input_sha256: inputSha256,
    });
    const { rows } = await db.query(`SELECT external_listing_id,property_no_normalized,payload,
      to_char(fetched_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stamp
      FROM listing_source_observations ORDER BY external_listing_id`);
    assert.deepEqual(
      rows.map((r) => [
        r.external_listing_id,
        r.property_no_normalized,
        r.payload.homepage_inventory.position,
        r.stamp,
      ]),
      [
        ["homepage-inventory-100", "A000001", 1, capturedAt],
        ["homepage-inventory-101", "A000001", 2, capturedAt],
        ["homepage-inventory-102", "B000002", 3, capturedAt],
      ],
    );
    const { rows: tiers } = await db.query(
      "SELECT t.promotion_tier,t.snapshot_complete,o.property_no_normalized AS ref FROM mls_source_promotion_tiers t JOIN listing_source_observations o ON o.id=t.observation_id ORDER BY t.external_listing_id",
    );
    assert.deepEqual(tiers, [
      { promotion_tier: "pinned", snapshot_complete: true, ref: "A000001" },
      { promotion_tier: "gold", snapshot_complete: true, ref: "A000001" },
      { promotion_tier: "normal", snapshot_complete: true, ref: "B000002" },
    ]);
    assert.deepEqual((await db.query("SELECT * FROM properties")).rows, [
      { id: "original", title_zh: "Keep canonical title" },
    ]);
    assert.deepEqual((await db.query("SELECT * FROM property_source_links")).rows, [
      { property_id: "original", external_listing_id: "100" },
    ]);
    assert.deepEqual((await db.query("SELECT * FROM mls_source_state")).rows, [
      { property_id: "original", external_listing_id: "100" },
    ]);
    const repeat = await saveHomepageInventory(db, inventory, { inputSha256 });
    assert.deepEqual(repeat, { runId: saved.runId, replayed: true, count: 3 });
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM listing_source_observations")).rows[0].n,
      3,
    );
  } finally {
    await db.close();
  }
});

test("older or same-time changed snapshots cannot overwrite current inventory; new reused IDs retain distinct immutable refs", async () => {
  const { normalizeHomepageInventory, saveHomepageInventory } =
    await import("./homepage-inventory.mjs");
  const db = await database();
  try {
    const original = normalizeHomepageInventory(input(), { now });
    await saveHomepageInventory(db, original, { inputSha256 });
    const changed = input();
    changed.entries[0].agent_listing_ref = "C000003";
    await assert.rejects(
      () =>
        saveHomepageInventory(db, normalizeHomepageInventory(changed, { now }), { inputSha256 }),
      /STALE/,
    );
    const older = normalizeHomepageInventory(input({ captured_at: "2026-10-27T02:59:59Z" }), {
      now,
    });
    await assert.rejects(() => saveHomepageInventory(db, older, { inputSha256 }), /STALE/);
    changed.captured_at = "2026-10-27T03:30:00Z";
    await saveHomepageInventory(db, normalizeHomepageInventory(changed, { now }), {
      inputSha256: "b".repeat(64),
    });
    assert.deepEqual(
      (
        await db.query(
          "SELECT property_no_normalized ref FROM listing_source_observations WHERE external_listing_id='homepage-inventory-100' ORDER BY fetched_at",
        )
      ).rows,
      [{ ref: "A000001" }, { ref: "C000003" }],
    );
    assert.deepEqual((await db.query("SELECT * FROM property_source_links")).rows, [
      { property_id: "original", external_listing_id: "100" },
    ]);
    await assert.rejects(() => saveHomepageInventory(db, original, { inputSha256 }), /STALE/);
  } finally {
    await db.close();
  }
});

test("verified empty inventory is a healthy snapshot and retires prior membership without deleting evidence", async () => {
  const { normalizeHomepageInventory, saveHomepageInventory } =
    await import("./homepage-inventory.mjs");
  const db = await database();
  try {
    await saveHomepageInventory(db, normalizeHomepageInventory(input(), { now }), { inputSha256 });
    const empty = normalizeHomepageInventory(
      input({ captured_at: "2026-10-27T03:30:00Z", advertised_count: 0, entries: [] }),
      { now },
    );
    const result = await saveHomepageInventory(db, empty, { inputSha256 });
    assert.equal(result.count, 0);
    assert.equal(
      (
        await db.query("SELECT count(*)::int n FROM listing_source_observations WHERE run_id=$1", [
          result.runId,
        ])
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM listing_source_observations")).rows[0].n,
      3,
    );
    assert.equal(
      (
        await db.query("SELECT counts->>'advertised_count' n FROM listing_sync_runs WHERE id=$1", [
          result.runId,
        ])
      ).rows[0].n,
      "0",
    );
  } finally {
    await db.close();
  }
});

test("late SQL failure rolls back every snapshot and tier write", async () => {
  const { normalizeHomepageInventory, saveHomepageInventory } =
    await import("./homepage-inventory.mjs");
  const db = await database();
  try {
    await db.exec(
      "ALTER TABLE mls_source_promotion_tiers ADD CONSTRAINT fail_gold CHECK(promotion_tier<>'gold')",
    );
    const entries = Array.from({ length: 251 }, (_, i) => ({
      source_id: String(1000 + i),
      agent_listing_ref: "A000001",
      promotion_tier_raw: i === 250 ? "黃金" : null,
    }));
    await assert.rejects(
      () =>
        saveHomepageInventory(
          db,
          normalizeHomepageInventory(input({ entries, advertised_count: 251 }), { now }),
          { inputSha256 },
        ),
      /fail_gold/,
    );
    for (const table of [
      "listing_sync_runs",
      "listing_source_observations",
      "mls_source_promotion_tiers",
    ])
      assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("larger inventories use bounded batches and do not lose boundary entries", async () => {
  const { normalizeHomepageInventory, saveHomepageInventory } =
    await import("./homepage-inventory.mjs");
  const db = await database();
  let queries = 0;
  const client = {
    query: async (...args) => {
      queries += 1;
      return db.query(...args);
    },
  };
  try {
    const entries = Array.from({ length: 251 }, (_, i) => ({
      source_id: String(1000 + i),
      agent_listing_ref: "A000001",
      promotion_tier_raw: i === 250 ? "黃金" : null,
    }));
    await saveHomepageInventory(
      client,
      normalizeHomepageInventory(input({ entries, advertised_count: 251 }), { now }),
      { inputSha256 },
    );
    assert.ok(queries <= 12, `251 entries needed ${queries} SQL requests`);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM listing_source_observations")).rows[0].n,
      251,
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT t.promotion_tier,o.payload#>>'{homepage_inventory,position}' position FROM mls_source_promotion_tiers t JOIN listing_source_observations o ON o.id=t.observation_id WHERE t.external_listing_id='homepage-inventory-1250'",
        )
      ).rows,
      [{ promotion_tier: "gold", position: "251" }],
    );
  } finally {
    await db.close();
  }
});

test("lost commit acknowledgement reports unknown without retrying or deleting committed evidence", async () => {
  const { normalizeHomepageInventory, saveHomepageInventory } =
    await import("./homepage-inventory.mjs");
  const db = await database();
  let commits = 0;
  const client = {
    query: async (sql, ...args) => {
      const result = await db.query(sql, ...args);
      if (sql === "COMMIT") {
        commits += 1;
        throw Error("connection lost after commit");
      }
      return result;
    },
  };
  try {
    const inventory = normalizeHomepageInventory(input(), { now });
    await assert.rejects(
      () => saveHomepageInventory(client, inventory, { inputSha256 }),
      /HOMEPAGE_INVENTORY_COMMIT_UNKNOWN/,
    );
    assert.equal(commits, 1);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM listing_sync_runs WHERE status='healthy'"))
        .rows[0].n,
      1,
    );
    assert.equal((await saveHomepageInventory(db, inventory, { inputSha256 })).replayed, true);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM listing_source_observations")).rows[0].n,
      3,
    );
  } finally {
    await db.close();
  }
});

test("a missing authorization hash or altered normalized evidence fails before any SQL", async () => {
  const { normalizeHomepageInventory, saveHomepageInventory } =
    await import("./homepage-inventory.mjs");
  const client = { query: async () => assert.fail("invalid input must not query the database") };
  const inventory = normalizeHomepageInventory(input(), { now });
  await assert.rejects(() => saveHomepageInventory(client, inventory, {}), /INPUT_HASH_REQUIRED/);
  const changed = structuredClone(inventory);
  changed.entries[0].ref = "C000003";
  await assert.rejects(
    () => saveHomepageInventory(client, changed, { inputSha256 }),
    /FINGERPRINT_MISMATCH/,
  );
});
