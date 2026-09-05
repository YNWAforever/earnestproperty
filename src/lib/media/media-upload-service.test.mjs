import assert from "node:assert/strict";
import test from "node:test";
import { createMediaUploadService } from "./media-upload-service.ts";
const file = new File(["image"], "a.png", { type: "image/png" });
const input = { file, ownerType: "cms", staffId: "alice", uploadId: "id1" };
function fixture() {
  const rows = new Map();
  let puts = 0;
  let fail = false;
  let unknown = false;
  let failClaim = false;
  const repo = {
    async claim(input) {
      if (failClaim) throw new Error("database secret");
      const existing = rows.get(input.id);
      if (existing) return { intent: existing, fresh: false };
      rows.set(input.id, { ...input });
      return { intent: rows.get(input.id), fresh: true };
    },
    async complete(intent, url) {
      if (fail) throw new Error("database secret");
      rows.get(intent.id).url = url;
    },
  };
  const upload = createMediaUploadService({
    repo,
    secret: "test-only",
    put: async ({ pathname }) => {
      puts++;
      if (unknown) throw new Error("provider secret");
      return { url: "https://blob.test/a", pathname };
    },
  });
  return {
    upload,
    rows,
    get puts() {
      return puts;
    },
    fail: (v) => (fail = v),
    unknown: () => (unknown = true),
    failClaim: () => (failClaim = true),
  };
}
test("Blob success and metadata failure recover with signed receipt without another PUT", async () => {
  const f = fixture();
  f.fail(true);
  const first = await f.upload(input);
  assert.equal(first.error, "UPLOAD_METADATA_PENDING");
  assert.ok(first.receipt);
  f.fail(false);
  const recovered = await f.upload({ ...input, receipt: first.receipt });
  assert.equal(recovered.ok, true);
  assert.equal(f.puts, 1);
  assert.deepEqual(await f.upload(input), recovered);
  assert.equal(f.puts, 1);
});
test("concurrent retries cross provider boundary once", async () => {
  const f = fixture();
  await Promise.all([f.upload(input), f.upload(input)]);
  assert.equal(f.puts, 1);
});
test("ambiguous provider failure is explicit and never resent", async () => {
  const f = fixture();
  f.unknown();
  const first = await f.upload(input);
  assert.equal(first.error, "UPLOAD_OUTCOME_UNKNOWN");
  assert.equal((await f.upload(input)).error, "UPLOAD_OUTCOME_UNKNOWN");
  assert.equal(f.puts, 1);
  assert.ok(!JSON.stringify(first).includes("secret"));
});
test("intent must persist before provider dispatch", async () => {
  const f = fixture();
  f.failClaim();
  await assert.rejects(f.upload(input));
  assert.equal(f.puts, 0);
});
test("receipt cannot change actor, file, or upload identity", async () => {
  const f = fixture();
  f.fail(true);
  const first = await f.upload(input);
  f.fail(false);
  assert.equal(
    (await f.upload({ ...input, staffId: "bob", receipt: first.receipt })).error,
    "UPLOAD_ID_CONFLICT",
  );
  assert.equal(
    (
      await f.upload({
        ...input,
        file: new File(["other"], "b.png", { type: "image/png" }),
        receipt: first.receipt,
      })
    ).error,
    "UPLOAD_ID_CONFLICT",
  );
  assert.equal(
    (await f.upload({ ...input, receipt: first.receipt + "x" })).error,
    "INVALID_UPLOAD_RECEIPT",
  );
  assert.equal(f.puts, 1);
});
