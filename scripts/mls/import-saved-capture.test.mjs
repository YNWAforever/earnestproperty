import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  buildSavedImportPlan,
  assertImportTarget,
  buildSavedPayload,
} from "../../src/lib/mls/saved-capture-import.mjs";
import { decodeSnapshot } from "../../src/lib/mls/ingestion-contract.mjs";
import { evaluateSnapshotGate } from "../../src/lib/mls/source-snapshot-gates.mjs";

export function sampleRow(id = "9000001", extra = {}) {
  return {
    source: "28hse",
    source_id: id,
    source_url: `https://www.28hse.com/buy/apartment/property-${id}`,
    deal_type: "sale",
    agent_listing_ref: "A123456",
    title: "本地測試樓盤",
    estate: "測試屋苑",
    district: "測試區",
    price_hkd: 4680000,
    rent_hkd: null,
    saleable_area_sqft: 500,
    gross_area_sqft: null,
    bedrooms: "2",
    bathrooms: "1",
    floor_level: "中層",
    description: "代理提供的單位詳情。",
    feature_tags: ["有露台"],
    photos: [],
    ...extra,
  };
}

test("maps saved details and local media without guessing missing fields or making network calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "earnest-import-unit-"));
  try {
    await mkdir(join(dir, "photos/9000001"), { recursive: true });
    const path = join(dir, "photos/9000001/01.png");
    await writeFile(
      path,
      await sharp({ create: { width: 400, height: 300, channels: 3, background: "#abcdef" } })
        .png()
        .toBuffer(),
    );
    const row = sampleRow(undefined, {
      photos: [
        { local_path: path, original_url: "https://i1.28hse.com/test.png", watermark: null },
      ],
      gross_area_sqft: null,
    });
    const plan = await buildSavedImportPlan([row], {
      captureRoot: dir,
      capturedAt: "2026-10-25T08:00:00Z",
    });
    assert.equal(plan.rows.length, 1);
    assert.deepEqual(plan.rows[0].failures, []);
    assert.equal(plan.rows[0].record.agency_property_no, "A123456");
    assert.equal(plan.rows[0].record.gross_area, null);
    assert.equal(plan.rows[0].photos[0].pathname.startsWith("mls/"), true);
    const payload = buildSavedPayload(plan.rows, {
      parserVersion: "fixture-v2",
      stamp: new Date().toISOString(),
    });
    const batch = decodeSnapshot(payload, { controlledPatch: true });
    const gate = evaluateSnapshotGate(batch, null, {}, { controlledPatch: true });
    assert.equal(gate.allowed, true);
    assert.equal(gate.full, false);
    assert.equal(gate.inferAbsence, false);
    const branded = await buildSavedImportPlan(
      [
        sampleRow(undefined, {
          photos: [
            {
              local_path: path,
              original_url: "https://i1.28hse.com/test.png",
              watermark: "28Hse.com logo",
            },
          ],
        }),
      ],
      { captureRoot: dir },
    );
    assert.ok(!branded.rows[0].failures.includes("source_branded_photos"));
    assert.ok(branded.rows[0].warnings.includes("owner_approved_source_watermark"));
    const escaped = await buildSavedImportPlan(
      [
        sampleRow(undefined, {
          photos: [{ local_path: "/etc/passwd", original_url: "https://i1.28hse.com/test.png" }],
        }),
      ],
      { captureRoot: dir },
    );
    assert.ok(escaped.rows[0].failures.includes("photo_outside_listing_directory"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid and duplicate source IDs are reported before any writes", async () => {
  const plan = await buildSavedImportPlan([sampleRow(), sampleRow(), sampleRow("../../bad")], {
    captureRoot: "/tmp",
  });
  assert.ok(plan.rows[1].failures.includes("duplicate_source_identity"));
  assert.ok(plan.rows[2].failures.includes("invalid_source_identity"));
  assert.ok(plan.rows[0].failures.includes("photos_missing"));
});

test("apply is restricted to an explicitly selected loopback database, never production fallbacks", () => {
  assert.throws(() => assertImportTarget({}), /IMPORT_DATABASE_URL/);
  assert.throws(
    () =>
      assertImportTarget({
        IMPORT_DATABASE_URL: "postgres://u:p@production.neon.tech/db",
        IMPORT_TARGET_ENV: "development",
      }),
    /local|loopback/,
  );
  assert.throws(
    () =>
      assertImportTarget({
        IMPORT_DATABASE_URL: "postgres://u:p@localhost/db",
        IMPORT_TARGET_ENV: "production",
      }),
    /development/,
  );
  assert.throws(
    () =>
      assertImportTarget({
        IMPORT_DATABASE_URL: "postgres://u:p@localhost/db?host=remote",
        IMPORT_TARGET_ENV: "development",
      }),
    /parameters/,
  );
  assert.equal(
    assertImportTarget({
      IMPORT_DATABASE_URL: "postgres://u:p@127.0.0.1:5432/import_test",
      IMPORT_TARGET_ENV: "development",
    }).hostname,
    "127.0.0.1",
  );
});

test("owner sold exclusion and exact agency replacements are encoded without widening update authority", async () => {
  const rows = [
    sampleRow("4028435", { sold_label: true }),
    sampleRow("4029337", { agent_listing_ref: "B059801" }),
    sampleRow("4034694", { agent_listing_ref: "R068782" }),
    sampleRow("4015403", { agent_listing_ref: "B048068" }),
  ];
  const plan = await buildSavedImportPlan(rows, { captureRoot: "/tmp" });
  assert.deepEqual(
    plan.rows.map((row) => row.action),
    ["skip", "update", "update", "update"],
  );
  assert.deepEqual(plan.rows[0].failures, []);
  const wrong = await buildSavedImportPlan(
    [sampleRow("4029337", { agent_listing_ref: "A999999" })],
    { captureRoot: "/tmp" },
  );
  assert.ok(wrong.rows[0].failures.includes("owner_update_reference_mismatch"));
  const sold = await buildSavedImportPlan([sampleRow("9000042", { sold_label: true })], {
    captureRoot: "/tmp",
  });
  assert.ok(sold.rows[0].failures.includes("not_active_new_listing"));
});

test("fixture UI is retired and homepage cards retain first-party detail links", async () => {
  const { readFile, access } = await import("node:fs/promises");
  const source = await readFile(new URL("../../src/routes/index.tsx", import.meta.url), "utf8");
  assert.ok(!source.includes("SavedListingsPreview"));
  assert.ok(!source.includes("savedListingsPreview"));
  assert.ok(source.includes('to="/property/$listingNo"'));
  assert.ok(!source.includes("www.28hse.com"));
  await assert.rejects(() =>
    access(new URL("../../src/content/28hse-preview.json", import.meta.url)),
  );
});

test("default CLI dry-run ignores production credentials and performs no network work", async () => {
  const { runSavedImport } = await import("./import-saved-capture.mjs");
  const { readFile } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "earnest-offline-cli-"));
  const fetchBefore = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw Error("NETWORK_FORBIDDEN");
  };
  try {
    const dir = join(root, "photos/9000001");
    await mkdir(dir, { recursive: true });
    const photo = join(dir, "main.png");
    await writeFile(
      photo,
      await sharp({ create: { width: 400, height: 300, channels: 3, background: "#abcdef" } })
        .png()
        .toBuffer(),
    );
    const input = join(root, "input.json"),
      report = join(root, "report.md");
    await writeFile(
      input,
      JSON.stringify([
        sampleRow(undefined, {
          photos: [
            {
              local_path: photo,
              original_url: "https://i1.28hse.com/offline.png",
              is_main: true,
              watermark: "28Hse.com (approved)",
            },
          ],
        }),
      ]),
    );
    const result = await runSavedImport(["--input", input, "--report", report], {
      env: {
        DATABASE_URL: "postgres://forbidden-production.invalid/db",
        DATABASE_URL_UNPOOLED: "postgres://forbidden-production.invalid/db",
        BLOB_READ_WRITE_TOKEN: "private-unused-token",
      },
    });
    assert.equal(result.mode, "dry-run");
    assert.equal(result.creates, 1);
    assert.equal(result.validationFailures, 0);
    assert.equal(networkCalls, 0);
    const markdown = await readFile(report, "utf8");
    assert.ok(markdown.includes("DRY-RUN"));
    assert.ok(!markdown.includes("private-unused-token"));
    assert.ok(!markdown.includes("forbidden-production.invalid"));
  } finally {
    globalThis.fetch = fetchBefore;
    await rm(root, { recursive: true, force: true });
  }
});
