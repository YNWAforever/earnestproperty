import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
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
    assert.equal(escaped.rows[0].photos.length, 0);
    assert.ok(escaped.rows[0].failures.includes("photo_file_missing_or_invalid"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a moved bundle is read from its new photos directory, not the frozen absolute path", async () => {
  const origin = await mkdtemp(join(tmpdir(), "earnest-capture-origin-"));
  const relocated = await mkdtemp(join(tmpdir(), "earnest-capture-moved-"));
  const packed = await mkdtemp(join(tmpdir(), "earnest-capture-packed-"));
  let renamed = "";
  try {
    const id = "9000001";
    const realBytes = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#112233" },
    })
      .png()
      .toBuffer();
    const decoyBytes = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#abcdef" },
    })
      .png()
      .toBuffer();
    const realHash = createHash("sha256").update(realBytes).digest("hex");
    await mkdir(join(origin, "photos", id), { recursive: true });
    const storedPath = join(origin, "photos", id, "01.png");
    await writeFile(storedPath, decoyBytes);
    await mkdir(join(relocated, "photos", id), { recursive: true });
    await writeFile(join(relocated, "photos", id, "01.png"), realBytes);
    const absolute = await buildSavedImportPlan(
      [
        sampleRow(id, {
          photos: [
            {
              local_path: storedPath,
              original_url: "https://i1.28hse.com/test.png",
              is_main: true,
            },
          ],
        }),
      ],
      { captureRoot: relocated },
    );
    assert.deepEqual(absolute.rows[0].failures, []);
    assert.equal(absolute.rows[0].photos[0].hash, realHash);
    assert.equal(
      absolute.rows[0].photos[0].path,
      await realpath(join(relocated, "photos", id, "01.png")),
    );
    const relative = await buildSavedImportPlan(
      [
        sampleRow(id, {
          photos: [
            {
              local_path: `photos/${id}/01.png`,
              original_url: "https://i1.28hse.com/test.png",
              is_main: true,
            },
          ],
        }),
      ],
      { captureRoot: relocated },
    );
    assert.deepEqual(relative.rows[0].failures, []);
    assert.equal(relative.rows[0].photos[0].hash, realHash);
    await mkdir(join(packed, "photos", id), { recursive: true });
    const packedFile = join(packed, "photos", id, "01.png");
    await writeFile(packedFile, realBytes);
    renamed = join(tmpdir(), `earnest-capture-renamed-${Date.now()}`);
    await rename(packed, renamed);
    const moved = await buildSavedImportPlan(
      [
        sampleRow(id, {
          photos: [
            {
              local_path: packedFile,
              original_url: "https://i1.28hse.com/test.png",
              is_main: true,
            },
          ],
        }),
      ],
      { captureRoot: renamed },
    );
    assert.deepEqual(moved.rows[0].failures, []);
    assert.equal(moved.rows[0].photos[0].hash, realHash);
    assert.equal(
      moved.rows[0].photos[0].path,
      await realpath(join(renamed, "photos", id, "01.png")),
    );
    assert.notEqual(moved.rows[0].photos[0].path, storedPath);
  } finally {
    await rm(origin, { recursive: true, force: true });
    await rm(relocated, { recursive: true, force: true });
    await rm(packed, { recursive: true, force: true });
    if (renamed) await rm(renamed, { recursive: true, force: true });
  }
});

test("estate encyclopedia stays out of the unit description", async () => {
  const plan = await buildSavedImportPlan([
    sampleRow("9000002", {
      description: "帝濤灣 海琴軒，中層，實用面積 670 平方呎，3 房，1 浴室。",
      block_unit: "1座 中層",
      primary_school_net: "62校網(荃灣區)",
      developer: "新鴻基地產",
      management_company: "新鴻基地產物業",
      occupation_date: "1999",
      estate_intro: "屋苑介紹長文",
      estate_units: "856伙",
      estate_blocks: "9座",
      feature_tags: ["有露台", "望海景"],
      photos: [],
    }),
  ]);
  const row = plan.rows[0];
  assert.equal(row.record.description, "帝濤灣 海琴軒，中層，實用面積 670 平方呎，3 房，1 浴室。");
  assert.doesNotMatch(row.record.description, /發展商|屋苑介紹|小學校網|座數及單位/);
  assert.deepEqual(row.extras.features, ["有露台", "望海景"]);
});

test("ordinary rental terms survive the saved-capture import", async () => {
  const description = "租金包括：管理費及差餉。可即時入住。\n管理費：已包括。";
  const plan = await buildSavedImportPlan([
    sampleRow("9000002", {
      description,
      developer: "新鴻基地產",
      occupation_date: "1999",
      estate_units: "856伙",
    }),
  ]);
  assert.equal(plan.rows[0].record.description, description);
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
    /development|PRODUCTION|CONFIRMATION/,
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
