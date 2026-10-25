import test from "node:test";
import assert from "node:assert/strict";
import { decideOwnerTarget, ownerValues } from "../../src/lib/mls/owner-publication.mjs";
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
