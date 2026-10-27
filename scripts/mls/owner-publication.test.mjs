import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  decideOwnerTarget,
  ownerDecision,
  ownerReportItems,
  ownerValues,
  sameField,
} from "../../src/lib/mls/owner-publication.mjs";
const row = {
  id: "123",
  deal: "sale",
  record: { agency_property_no: "B047469", title: "Latest", price: 5000000, rent: null },
  extras: { address: null, features: [] },
  photos: Array.from({ length: 12 }, () => ({})),
  failures: [],
};
test("matches company ref plus deal and requires explicit ambiguity choices", () => {
  const candidates = [
    { id: "00000000-0000-4000-8000-000000000001", status: "inactive" },
    { id: "00000000-0000-4000-8000-000000000002", status: "inactive" },
  ];
  assert.equal(decideOwnerTarget(row, { candidates }, {}).action, "held");
  assert.equal(
    decideOwnerTarget(row, { candidates }, { B047469: "00000000-0000-4000-8000-000000000002" })
      .target.id,
    "00000000-0000-4000-8000-000000000002",
  );
  assert.equal(decideOwnerTarget(row, { candidates }, { B047469: "other" }).action, "held");
  assert.equal(decideOwnerTarget(row, { candidates: [] }, {}).action, "create");
  assert.equal(decideOwnerTarget({ ...row, id: "4028435" }, { candidates }, {}).action, "skip");
});
test("same capture hash stays published after staff sets the listing inactive or draft", () => {
  const hash = "a".repeat(64);
  const target = {
    id: "00000000-0000-4000-8000-000000000001",
    status: "inactive",
    canonical_property_no: "B047469",
    public_listing_no: "B047469",
    row_hash: "staff-changed",
  };
  const captured = {
    ...row,
    fingerprint: "f".repeat(64),
    failures: [],
  };
  const snapshot = {
    candidates: [target],
    groups: [],
    overrides: [],
    fields: [],
    conflicts: [],
    reviews: [],
    links: [],
    audits: [
      {
        subject_id: target.id,
        metadata: {
          input_sha256: hash,
          capture_fingerprint: captured.fingerprint,
          after_row_hash: "published-row",
        },
      },
    ],
  };
  const resolution = {
    status: "unmatched-left-null",
    estate_id: null,
    district_slug: "sham-tseng",
  };
  for (const status of ["inactive", "draft", "active"]) {
    const decision = ownerDecision(
      captured,
      { ...snapshot, candidates: [{ ...target, status }] },
      resolution,
      {},
      hash,
    );
    assert.equal(decision.action, "already-published", status);
  }
  const nextBundle = ownerDecision(captured, snapshot, resolution, {}, "b".repeat(64));
  assert.equal(nextBundle.action, "update");
  const changedActive = ownerDecision(
    captured,
    { ...snapshot, candidates: [{ ...target, status: "active" }] },
    resolution,
    {},
    "b".repeat(64),
  );
  assert.equal(changedActive.action, "held");
  assert.equal(changedActive.reason, "active_row_changed_or_not_owner_published");
  const firstPublication = ownerDecision(
    captured,
    { ...snapshot, candidates: [{ ...target, status: "draft" }], audits: [] },
    resolution,
    {},
    hash,
  );
  assert.equal(firstPublication.action, "update");
});

test("source_updated_at uses the local calendar day, including east of UTC", () => {
  const day = new Date(2026, 9, 25);
  assert.equal(sameField(day, "2026-10-25", "source_updated_at"), true);
  assert.equal(sameField("2026-10-25", "2026-10-25", "source_updated_at"), true);
  assert.equal(sameField(null, null, "source_updated_at"), true);
  assert.equal(sameField(day, "2026-10-24", "source_updated_at"), false);
  const script = `
    import { sameField } from ${JSON.stringify(fileURLToPath(new URL("../../src/lib/mls/owner-publication.mjs", import.meta.url)))};
    const day = new Date(2026, 9, 25);
    const utcDay = day.toISOString().slice(0, 10);
    if (utcDay === "2026-10-25") {
      console.error("Asia/Hong_Kong did not move local midnight to the previous UTC day");
      process.exit(2);
    }
    if (!sameField(day, "2026-10-25", "source_updated_at")) {
      console.error("expected local 2026-10-25, UTC day was " + utcDay);
      process.exit(1);
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, TZ: "Asia/Hong_Kong" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("already-published report keeps the status staff left in place", () => {
  const item = {
    action: "already-published",
    reason: null,
    target: {
      id: "00000000-0000-4000-8000-000000000001",
      status: "inactive",
      listing_no: "SYNC-1",
      public_listing_no: "B047469",
      price: 4000000,
      rent: null,
      images: ["https://owned.example/one"],
    },
    row: {
      id: "4065990",
      deal: "sale",
      record: { agency_property_no: "B047469", price: 5000000, rent: null, title: "Latest" },
      photos: [{}, {}],
      extras: { address: null, features: [] },
      warnings: [],
      failures: [],
    },
    reviews: [],
    snapshot: { candidates: [] },
    resolution: { estate_id: null, district_slug: "sham-tseng" },
  };
  const report = ownerReportItems([item])[0];
  assert.equal(report.after.status, "inactive");
  assert.equal(report.after.photo_count, 1);
  assert.equal(report.after.images, "unchanged");
  const update = ownerReportItems([
    { ...item, action: "update", target: { ...item.target, status: "draft" } },
  ])[0];
  assert.equal(update.after.status, "active");
});

test("owner values preserve unmatched estates and explicitly blank unresolved districts", () => {
  const values = ownerValues(row, { estate_id: null, district_slug: null }, [
    "https://owned.invalid/one",
  ]);
  assert.equal(values.estate_id, null);
  assert.equal(values.district_slug, "");
  assert.equal(values.status, "active");
  assert.equal(values.price, 5000000);
  assert.equal(
    ownerValues(
      { ...row, id: "4044249" },
      { estate_id: null, district_slug: "new-catalog-district" },
      [],
    ).district_slug,
    "",
  );
});

test("owner CLI rejects unsafe choices, offline apply and unauthorized production before client creation", async () => {
  const { parseOwnerArgs, runOwnerPublication } = await import("./owner-publication.mjs");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { createHash } = await import("node:crypto");
  assert.throws(
    () => parseOwnerArgs(["--apply", "--offline-map", "/tmp/example.csv"]),
    /OFFLINE_CANNOT_APPLY/,
  );
  assert.throws(() => parseOwnerArgs(["--choose", "B047469=other"]), /CHOICE/);
  const root = await mkdtemp(join(tmpdir(), "owner-guards-"));
  try {
    const input = join(root, "capture.json");
    const bytes = Buffer.from("[]");
    await writeFile(input, bytes);
    const confirmation = createHash("sha256").update(bytes).digest("hex");
    let clients = 0,
      stores = 0;
    const ports = {
      createClient: () => {
        clients++;
        throw Error("NO_CLIENT");
      },
      createBlobStore: () => {
        stores++;
        throw Error("NO_BLOB");
      },
    };
    const env = {
      IMPORT_TARGET_ENV: "production",
      IMPORT_BLOB_TARGET_ENV: "production",
      IMPORT_DATABASE_URL:
        "postgres://synthetic:private@production.example.invalid/db?sslmode=require",
    };
    for (const flags of [[], [`--confirm-production=${"0".repeat(64)}`]])
      await assert.rejects(
        () => runOwnerPublication(["--input", input, ...flags], { env, ports }),
        /CONFIRM/,
      );
    await assert.rejects(
      () =>
        runOwnerPublication(["--apply", "--input", input, `--confirm-production=${confirmation}`], {
          env: { ...env, BLOB_READ_WRITE_TOKEN: "ordinary" },
          ports,
        }),
      /CREDENTIAL/,
    );
    assert.equal(clients, 0);
    assert.equal(stores, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("owner bundle binds complete ordered sale promotion evidence to the confirmed input bytes", async () => {
  const { parseOwnerCaptureInput, parseOwnerArgs } = await import("./owner-publication.mjs");
  const legacy = [{ source_id: "123" }];
  assert.deepEqual(parseOwnerCaptureInput(legacy).listings, legacy);
  assert.throws(
    () => parseOwnerCaptureInput(legacy, { requireHomepageInventory: true }),
    /REQUIRED/,
  );
  const snapshot = {
    schema_version: 1,
    source: "28hse_agent_540",
    scope: "agent:540",
    deal_type: "sale",
    complete: true,
    captured_at: new Date().toISOString(),
    advertised_count: 2,
    entries: [
      { source_id: "123", agent_listing_ref: "A000001", promotion_tier_raw: "置頂" },
      { source_id: "124", agent_listing_ref: "A000002", promotion_tier_raw: "黃金置頂盤" },
    ],
  };
  const parsed = parseOwnerCaptureInput({ listings: [], homepage_inventory: snapshot });
  assert.equal(parsed.homepageInventory.advertisedCount, 2);
  assert.deepEqual(
    parsed.homepageInventory.entries.map((e) => e.promotionTier),
    ["pinned", "gold"],
  );
  assert.equal(parsed.homepageInventory.capturedAt, snapshot.captured_at);
  assert.throws(
    () =>
      parseOwnerCaptureInput({
        listings: [],
        homepage_inventory: { ...snapshot, complete: false },
      }),
    /INCOMPLETE/,
  );
  assert.throws(
    () =>
      parseOwnerCaptureInput({
        listings: [],
        homepage_inventory: { ...snapshot, captured_at: "2026-01-01T00:00:00Z" },
      }),
    /TIME_INVALID/,
  );
  assert.equal(parseOwnerArgs(["--require-homepage-inventory"]).requireHomepageInventory, true);
});
