import { expect, test } from "bun:test";

import { maybePruneExpiredRateLimitBuckets } from "./rate-limit-prune";

test("bucket pruning runs only during a selected request", async () => {
  const statements: string[] = [];
  const query = async (statement: string) => {
    statements.push(statement);
  };

  await maybePruneExpiredRateLimitBuckets(query, () => false);
  expect(statements).toHaveLength(0);

  await maybePruneExpiredRateLimitBuckets(query, () => true);
  expect(statements).toHaveLength(1);
  expect(statements[0]).toContain("window_start < now() - interval '1 day'");
  expect(statements[0]).toContain("LIMIT 1000");
});

test("a cleanup failure is reported without blocking an allowed request", async () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (message) => warnings.push(String(message));
  try {
    const attempted = await maybePruneExpiredRateLimitBuckets(
      async () => {
        throw new Error("cleanup unavailable");
      },
      () => true,
    );
    expect(attempted).toBe(false);
    expect(warnings).toEqual(["[rate-limit] Expired bucket cleanup failed."]);
  } finally {
    console.warn = originalWarn;
  }
});
