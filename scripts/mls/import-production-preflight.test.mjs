import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import sharp from "sharp";
import { runSavedImport } from "./import-saved-capture.mjs";
import {
  REQUIRED_IMPORT_SCHEMA,
  REQUIRED_IMPORT_KEYS,
  REQUIRED_IMPORT_TRIGGERS,
  inspectImportReadOnly,
  normalizeIndexColumns,
} from "../../src/lib/mls/saved-capture-preflight.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const productionEnv = () => ({
  IMPORT_TARGET_ENV: "production",
  IMPORT_BLOB_TARGET_ENV: "production",
  IMPORT_DATABASE_URL:
    "postgres://synthetic:private@production.example.invalid/neondb?sslmode=require",
  IMPORT_BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_syntheticstore_private",
  IMPORT_BLOB_STORE_ID: "syntheticstore",
  IMPORT_BLOB_HOST: "syntheticstore.public.blob.vercel-storage.com",
});
const estateId = "00000000-0000-4000-8000-000000000010";
const refs = ["B059801", "R068782", "B048068"];
function fakeClient({
  missingSchema = false,
  missingPolicy = false,
  conflict = false,
  stringIndexes = false,
  missingApproval = false,
} = {}) {
  let inReadOnly = false;
  const queries = [];
  const policy = {
    source: "28hse_agent_540",
    scope_id: "agent:540",
    policy_version: "no-hermes-v2",
    parser_version: "python-v2.2",
    owner: "no-hermes-v2",
    publish_enabled: true,
    bootstrap_approved_at: "2026-10-25T00:00:00Z",
    bootstrap_approved_by: "owner",
    config: {
      ...(!missingApproval
        ? {
            saved_capture_import: {
              parser_version: "saved-capture-import-v1",
              approved: true,
              approved_by: "owner",
            },
          }
        : {}),
      company_number_identity: {
        version: "company-number-v1",
        approved: true,
        approved_by: "owner",
      },
      estate_mappings: { 測試屋苑: { estate_id: estateId, district_slug: "test" } },
    },
  };
  return {
    queries,
    connect: async () => {},
    end: async () => {},
    query: async (sql, params = []) => {
      queries.push(sql);
      if (sql.startsWith("BEGIN")) {
        assert.match(sql, /READ ONLY/);
        inReadOnly = true;
        return { rows: [] };
      }
      if (sql === "ROLLBACK") {
        assert.equal(inReadOnly, true);
        inReadOnly = false;
        return { rows: [] };
      }
      assert.equal(inReadOnly, true, "all preflight reads are inside READ ONLY");
      assert.match(sql, /^(SELECT|SHOW)\b/);
      assert.ok(!/\bFOR\s+(UPDATE|SHARE)\b/.test(sql));
      if (sql === "SHOW transaction_read_only") return { rows: [{ transaction_read_only: "on" }] };
      if (sql.includes("import_preflight_columns"))
        return {
          rows: missingSchema
            ? []
            : Object.entries(REQUIRED_IMPORT_SCHEMA).flatMap(([table_name, columns]) =>
                columns.map((column_name) => ({ table_name, column_name })),
              ),
        };
      if (sql.includes("import_preflight_keys"))
        return {
          rows: REQUIRED_IMPORT_KEYS.map(([table_name, columns]) => ({
            table_name,
            columns: stringIndexes ? `{${columns.join(",")}}` : columns,
            valid: true,
          })),
        };
      if (sql.includes("import_preflight_triggers"))
        return {
          rows: REQUIRED_IMPORT_TRIGGERS.map((trigger_name) => ({ trigger_name, enabled: true })),
        };
      if (sql.includes("FROM mls_ingestion_policies"))
        return { rows: missingPolicy ? [] : [policy] };
      if (sql.includes("saved_capture_estates"))
        return {
          rows: [{ id: estateId, slug: "test", name_zh: "測試屋苑", district_slug: "test" }],
        };
      if (sql.includes("saved_capture_districts"))
        return { rows: [{ id: estateId, slug: "test", name_zh: "測試區", name_en: "Test" }] };
      if (sql.includes("import_preflight_owner_targets"))
        return {
          rows: refs.map((public_listing_no, index) => ({
            id: `00000000-0000-4000-8000-00000000000${index + 1}`,
            public_listing_no,
            canonical_property_no: public_listing_no,
            status: "active",
            open_reviews: conflict,
            overrides: false,
            conflicts: false,
            review_required: false,
          })),
        };
      if (sql.includes("FROM property_source_links")) return { rows: [] };
      if (sql.startsWith("SELECT id,district_slug FROM estates"))
        return { rows: [{ id: estateId, district_slug: "test" }] };
      throw Error(`Unexpected fake SQL: ${sql}`);
    },
  };
}
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "earnest-production-guards-"));
  try {
    const dir = join(root, "photos/9000001");
    await mkdir(dir, { recursive: true });
    const photo = join(dir, "01.png");
    await writeFile(
      photo,
      await sharp({ create: { width: 400, height: 300, channels: 3, background: "#abcdef" } })
        .png()
        .toBuffer(),
    );
    const input = join(root, "frozen.json"),
      report = join(root, "review.md");
    const bytes = Buffer.from(
      JSON.stringify([
        {
          source: "28hse",
          source_id: "9000001",
          source_url: "https://www.28hse.com/buy/apartment/property-9000001",
          deal_type: "sale",
          agent_listing_ref: "A123456",
          title: "測試樓盤",
          estate: "測試屋苑",
          district: "測試區",
          price_hkd: 4680000,
          description: "單位詳情",
          photos: [
            { local_path: photo, original_url: "https://i1.28hse.com/local.png", is_main: true },
          ],
        },
      ]),
    );
    await writeFile(input, bytes);
    await run({ root, input, report, bytes, confirmation: hash(bytes) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("production guards reject missing/wrong hashes and ordinary credentials before any client construction", async () =>
  fixture(async ({ input, report, confirmation }) => {
    let clients = 0,
      stores = 0;
    const ports = {
      createClient: () => {
        clients++;
        throw Error("NO_CONNECTION");
      },
      createBlobStore: () => {
        stores++;
        throw Error("NO_BLOB");
      },
    };
    const args = ["--apply", "--input", input, "--report", report];
    for (const [env, flags] of [
      [productionEnv(), []],
      [productionEnv(), [`--confirm-production=${"0".repeat(64)}`]],
      [
        { ...productionEnv(), IMPORT_BLOB_TARGET_ENV: "development" },
        [`--confirm-production=${confirmation}`],
      ],
      [
        {
          ...productionEnv(),
          IMPORT_DATABASE_URL: undefined,
          DATABASE_URL: "postgres://ordinary.invalid/db",
        },
        [`--confirm-production=${confirmation}`],
      ],
      [
        {
          ...productionEnv(),
          IMPORT_BLOB_READ_WRITE_TOKEN: undefined,
          BLOB_READ_WRITE_TOKEN: "ordinary-token",
        },
        [`--confirm-production=${confirmation}`],
      ],
      [
        { ...productionEnv(), IMPORT_BLOB_STORE_ID: undefined },
        [`--confirm-production=${confirmation}`],
      ],
      [
        { ...productionEnv(), IMPORT_BLOB_HOST: "another.public.blob.vercel-storage.com" },
        [`--confirm-production=${confirmation}`],
      ],
    ])
      await assert.rejects(() => runSavedImport([...args, ...flags], { env, ports }));
    assert.equal(clients, 0);
    assert.equal(stores, 0);
  }));

test("preflight uses verified READ ONLY + rollback, reports missing items and never constructs Blob or apply", async () =>
  fixture(async ({ input, report, confirmation }) => {
    const client = fakeClient({ missingSchema: true });
    let stores = 0,
      applies = 0;
    const result = await runSavedImport(
      ["--preflight", "--input", input, "--report", report, `--confirm-production=${confirmation}`],
      {
        env: {
          IMPORT_TARGET_ENV: "production",
          IMPORT_BLOB_TARGET_ENV: "production",
          IMPORT_DATABASE_URL: productionEnv().IMPORT_DATABASE_URL,
        },
        ports: {
          createClient: () => client,
          createBlobStore: () => {
            stores++;
            throw Error("NO_BLOB");
          },
          apply: () => {
            applies++;
            throw Error("NO_APPLY");
          },
        },
      },
    );
    assert.equal(result.mode, "preflight");
    assert.equal(result.preflight.ready, false);
    assert.ok(result.preflight.missingItems.some((item) => item.code === "schema_column_missing"));
    assert.equal(client.queries.at(-1), "ROLLBACK");
    assert.equal(stores, 0);
    assert.equal(applies, 0);
    const markdown = await readFile(report, "utf8");
    assert.ok(markdown.includes(confirmation));
    assert.ok(markdown.includes("schema_column_missing"));
  }));

test("production DB dry-run performs full validation in read-only mode; frozen bytes remain authoritative", async () =>
  fixture(async ({ input, report, confirmation }) => {
    const client = fakeClient();
    let stores = 0;
    const result = await runSavedImport(
      ["--input", input, "--report", report, `--confirm-production=${confirmation}`],
      {
        env: productionEnv(),
        ports: {
          createClient: () => client,
          createBlobStore: () => {
            stores++;
            throw Error("NO_BLOB");
          },
        },
      },
    );
    assert.equal(result.mode, "dry-run");
    assert.equal(result.preflight.ready, true);
    assert.equal(result.inputSha256, confirmation);
    assert.equal(stores, 0);
    assert.equal(client.queries.at(-1), "ROLLBACK");
    await writeFile(input, "[]");
    await assert.rejects(
      () =>
        runSavedImport(
          ["--apply", "--input", input, "--report", report, `--confirm-production=${confirmation}`],
          {
            env: productionEnv(),
            ports: {
              createClient: () => {
                throw Error("MUST_NOT_CONNECT");
              },
            },
          },
        ),
      /CONFIRM/,
    );
  }));

test("missing policy, identity/mapping and owner conflicts become report items, never SQL writes", async () => {
  for (const options of [{ missingPolicy: true }, { conflict: true }, { missingApproval: true }]) {
    const client = fakeClient(options);
    const result = await inspectImportReadOnly(
      client,
      { rows: [{ record: { estate: "測試屋苑" }, action: "create", failures: [] }] },
      { fullDryRun: false },
    );
    assert.equal(result.ready, false);
    assert.ok(result.missingItems.length);
    assert.equal(client.queries.at(-1), "ROLLBACK");
  }
});

test("authorized production apply requires all dedicated credentials and passes only after read-only preflight", async () =>
  fixture(async ({ input, report, confirmation }) => {
    const client = fakeClient();
    let applies = 0,
      stores = 0;
    const result = await runSavedImport(
      ["--apply", "--input", input, "--report", report, `--confirm-production=${confirmation}`],
      {
        env: productionEnv(),
        ports: {
          createClient: () => client,
          createBlobStore: ({ token }) => {
            assert.equal(client.queries.at(-1), "ROLLBACK");
            assert.equal(token, productionEnv().IMPORT_BLOB_READ_WRITE_TOKEN);
            stores++;
            return {
              put: () => {
                throw Error("NO_REAL_BLOB_WRITES");
              },
            };
          },
          apply: async (_client, plan) => {
            assert.equal(plan.rows.length, 1);
            applies++;
            return { held: [], created: 1 };
          },
        },
      },
    );
    assert.equal(result.mode, "apply");
    assert.equal(applies, 1);
    assert.equal(stores, 1);
  }));

test("estate resolution is exact, district-scoped, nullable, alias-aware and detects ambiguity", async () => {
  const { resolveSavedEstate } = await import("../../src/lib/mls/saved-capture-estates.mjs");
  const { buildEstateMappingProposal } = await import("./propose-estate-mappings.mjs");
  const districts = [{ slug: "test", name_zh: "測試區" }];
  const estates = [
    { id: estateId, slug: "test", name_zh: "屋苑", aliases: ["別名"], district_slug: "test" },
  ];
  const record = { estate: "別名", district: "測試區" };
  assert.equal(resolveSavedEstate(record, {}, estates, districts).estate_id, estateId);
  assert.equal(
    resolveSavedEstate({ ...record, estate: "屋苑 第一期" }, {}, estates, districts).estate_id,
    null,
  );
  assert.equal(
    resolveSavedEstate({ ...record, district: "外區" }, {}, estates, districts).district_slug,
    null,
  );
  assert.equal(
    resolveSavedEstate(record, {}, [...estates, { ...estates[0], id: "other" }], districts).status,
    "ambiguous",
  );
  const proposal = buildEstateMappingProposal(
    [
      { ...record, source_id: "1" },
      { ...record, estate: "未知", source_id: "2" },
    ],
    { estates, districts },
  );
  assert.equal(proposal.stats.matched, 1);
  assert.equal(proposal.stats.unmatched_left_null, 1);
  assert.deepEqual(
    proposal,
    buildEstateMappingProposal(
      [
        { ...record, source_id: "1" },
        { ...record, estate: "未知", source_id: "2" },
      ],
      { estates, districts },
    ),
  );
});

test("unique keys accept pg arrays, Neon name[] text, primary and partial indexes", async () => {
  assert.deepEqual(normalizeIndexColumns('{"source","external_listing_id","deal_type"}'), [
    "source",
    "external_listing_id",
    "deal_type",
  ]);
  assert.deepEqual(normalizeIndexColumns('["listing_no"]'), ["listing_no"]);
  assert.deepEqual(normalizeIndexColumns(null), []);
  for (const stringIndexes of [false, true]) {
    const result = await inspectImportReadOnly(fakeClient({ stringIndexes }), {
      rows: [{ action: "create", id: "1", record: { estate: "測試屋苑", district: "測試區" } }],
    });
    assert.equal(result.ready, true, JSON.stringify(result.missingItems));
  }
});

test("secondary parser approval never authorizes ordinary daily sync or a different source/parser", async () => {
  const { isApprovedSavedCapture } = await import("../../src/lib/mls/saved-capture-policy.mjs");
  const policy = {
    config: {
      saved_capture_import: {
        parser_version: "saved-capture-import-v1",
        approved: true,
        approved_by: "owner",
      },
    },
  };
  const batch = {
    source: "28hse_agent_540",
    scopeId: "agent:540",
    parserVersion: "saved-capture-import-v1",
  };
  assert.equal(
    isApprovedSavedCapture(policy, batch, { controlledPatch: true, savedCaptureImport: true }),
    true,
  );
  for (const options of [{}, { controlledPatch: true }, { savedCaptureImport: true }])
    assert.equal(isApprovedSavedCapture(policy, batch, options), false);
  assert.equal(
    isApprovedSavedCapture(
      policy,
      { ...batch, parserVersion: "python-v2.2" },
      { controlledPatch: true, savedCaptureImport: true },
    ),
    false,
  );
  assert.equal(
    isApprovedSavedCapture(
      policy,
      { ...batch, source: "propertyhk" },
      { controlledPatch: true, savedCaptureImport: true },
    ),
    false,
  );
  const sql = await readFile(
    new URL("./sql/prepare-28hse-saved-import-policy.sql", import.meta.url),
    "utf8",
  );
  assert.ok(!/SET\s+parser_version|INSERT INTO|DELETE FROM/.test(sql));
  assert.match(sql, /DROP CONSTRAINT IF EXISTS mls_receipt_policy_parser_fk/);
  assert.match(sql, /NOT receipt.full_snapshot/);
  assert.match(sql, /NOT \(config \? 'saved_capture_import'\)/);
});

test("Neon WebSocket driver is selectable without connecting; default remains pg", async () => {
  const { createSavedImportClient } = await import("./saved-import-driver.mjs");
  const config = { connectionString: productionEnv().IMPORT_DATABASE_URL };
  const native = await createSavedImportClient(config);
  const neon = await createSavedImportClient(config, "neon-ws");
  assert.equal(typeof native.connect, "function");
  assert.equal(typeof neon.neonConfig.webSocketConstructor, "function");
  await assert.rejects(() => createSavedImportClient(config, "http"), /DRIVER_INVALID/);
});
