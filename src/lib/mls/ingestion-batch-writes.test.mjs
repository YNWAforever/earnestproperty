import test from "node:test";
import assert from "node:assert/strict";
import { writeSyncFields, writeReviewRows } from "./ingestion-batch-writes.mjs";
test("field provenance batches preserve null and numeric JSON values", async () => {
  const calls = [];
  const rows = [
    { property_id: "p", field_name: "price", last_published_value: 0 },
    { property_id: "p", field_name: "description", last_published_value: null },
  ];
  await writeSyncFields(async (...args) => calls.push(args), rows);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0][1][0]), rows);
  assert.match(calls[0][0], /DO UPDATE/);
});
test("legacy adoption never replaces existing ownership", async () => {
  let sql;
  await writeSyncFields(async (s) => (sql = s), [{ field_name: "price" }], true);
  assert.match(sql, /DO NOTHING/);
  assert.doesNotMatch(sql, /DO UPDATE/);
});
test("reviews retain the last observation for duplicate keys and use bounded batches", async () => {
  const calls = [];
  const rows = Array.from({ length: 501 }, (_, i) => ({
    review_key: String(i),
    observation_id: "old",
  }));
  rows.push({ review_key: "0", observation_id: "new" });
  await writeReviewRows(async (...a) => calls.push(a), rows);
  assert.equal(calls.length, 3);
  assert.equal(JSON.parse(calls[0][1][0])[0].observation_id, "new");
  assert.equal(
    calls.reduce((n, c) => n + JSON.parse(c[1][0]).length, 0),
    501,
  );
});
test("empty batches issue no query and database errors propagate", async () => {
  await writeSyncFields(() => assert.fail(), []);
  await writeReviewRows(() => assert.fail(), []);
  await assert.rejects(
    () =>
      writeSyncFields(async () => {
        throw Error("write failed");
      }, [{}]),
    /write failed/,
  );
});
