import { expect, test } from "bun:test";
import { runPropertyBulkChunks } from "./property-bulk-client";
const input = {
  items: Array.from({ length: 12 }, (_, i) => ({ propertyNo: `P${i}`, expectedVersion: "v" })),
  scope: "sale" as const,
  action: { type: "status" as const, status: "offline" as const },
};
test("bounded chunks report partial results without retrying successes", async () => {
  const sizes: number[] = [];
  const results = await runPropertyBulkChunks(input, async (batch) => {
    sizes.push(batch.items.length);
    return batch.items.map((x) => ({
      propertyNo: x.propertyNo,
      ok: x.propertyNo !== "P3",
      error: x.propertyNo === "P3" ? "Conflict" : undefined,
    }));
  });
  expect(sizes).toEqual([5, 5, 2]);
  expect(results.filter((r) => r.ok)).toHaveLength(11);
  expect(results.filter((r) => !r.ok)).toHaveLength(1);
});
test("uncertain request stops subsequent chunks and never retries", async () => {
  let calls = 0;
  const results = await runPropertyBulkChunks(input, async (batch) => {
    calls++;
    if (calls === 2) throw Error("network");
    return batch.items.map((x) => ({ propertyNo: x.propertyNo, ok: true }));
  });
  expect(calls).toBe(2);
  expect(results.filter((r) => r.ok)).toHaveLength(5);
  expect(results.filter((r) => r.uncertain)).toHaveLength(5);
  expect(results.filter((r) => !r.ok && !r.uncertain)).toHaveLength(2);
});
test("malformed response is uncertain rather than silently successful", async () => {
  const results = await runPropertyBulkChunks(
    { ...input, items: input.items.slice(0, 2) },
    async () => [{ propertyNo: "wrong", ok: true }],
  );
  expect(results.every((r) => r.uncertain)).toBe(true);
});

test("server-reported uncertain save stops later chunks", async () => {
  let calls = 0;
  const results = await runPropertyBulkChunks(input, async (batch) => {
    calls++;
    return batch.items.map((x, i) => ({
      propertyNo: x.propertyNo,
      ok: false,
      uncertain: i === 0,
      error: "核對結果",
    }));
  });
  expect(calls).toBe(1);
  expect(results).toHaveLength(12);
  expect(results[0].uncertain).toBe(true);
  expect(results[5].error).toContain("尚未提交");
});
