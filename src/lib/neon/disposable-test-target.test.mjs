import assert from "node:assert/strict";
import test from "node:test";
import { assertDisposableNeonTestTarget } from "./disposable-test-target.mjs";

const url =
  "postgres://tester:secret@ep-square-leaf-aobruyvf.c-2.ap-southeast-1.aws.neon.tech/earnest_audit_acceptance_20260927";
const env = {
  ASTRA_TEST_DATABASE_CONFIRMED: "true",
  ASTRA_TEST_BRANCH_ID: "br-young-breeze-ao85rtx1",
};
const identity = {
  database_name: "earnest_audit_acceptance_20260927",
  branch_id: "br-young-breeze-ao85rtx1",
  endpoint_id: "ep-square-leaf-aobruyvf",
};
const query = async () => [identity];

test("accepts an explicitly confirmed disposable Neon database with server-attested identity", async () => {
  assert.deepEqual(await assertDisposableNeonTestTarget(url, { env, query }), identity);
});

test("rejects missing confirmation and non-disposable database names before querying", async () => {
  let queried = false;
  const spy = async () => {
    queried = true;
    return [identity];
  };
  await assert.rejects(
    assertDisposableNeonTestTarget(url, {
      env: { ...env, ASTRA_TEST_DATABASE_CONFIRMED: "" },
      query: spy,
    }),
  );
  await assert.rejects(
    assertDisposableNeonTestTarget(url.replace("earnest_audit_acceptance_20260927", "neondb"), {
      env,
      query: spy,
    }),
  );
  assert.equal(queried, false);
});

test("rejects a false branch identity or mismatched endpoint reported by Neon", async () => {
  await assert.rejects(
    assertDisposableNeonTestTarget(url, {
      env: { ...env, ASTRA_TEST_BRANCH_ID: "br-quiet-hat-aoxbj2ue" },
      query,
    }),
  );
  await assert.rejects(
    assertDisposableNeonTestTarget(url, {
      env,
      query: async () => [{ ...identity, endpoint_id: "ep-different" }],
    }),
  );
});
