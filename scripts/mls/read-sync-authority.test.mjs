import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
const path = new URL("./read-sync-authority.mjs", import.meta.url);
async function module() {
  assert.ok(existsSync(path), "read-only authority helper missing");
  return import(path.href);
}
test("wrong target is rejected before creating a database connection", async () => {
  const m = await module();
  let calls = 0;
  await assert.rejects(
    () =>
      m.readSyncAuthority({
        env: {
          DATABASE_URL_UNPOOLED: "postgres://user:pass@wrong.neon.tech/neondb",
          PROPERTY_SYNC_EXPECTED_DATABASE_HOST: "approved.neon.tech",
        },
        createClient: () => {
          calls++;
        },
      }),
    /TARGET_UNVERIFIED/,
  );
  assert.equal(calls, 0);
});
test("canonical hash and current receipt identity both govern baseline acceptance", async () => {
  const m = await module();
  const payload = {
    source: "28hse",
    scraped_at: "2026-10-01T02:50:22.963602Z",
    meta: { scope_id: "agent:540", policy_version: "no-hermes-v2", parser_version: "python-v2.2" },
  };
  const authority = {
    source: "28hse_agent_540",
    scope_id: "agent:540",
    policy_version: "no-hermes-v2",
    parser_version: "python-v2.2",
    scraped_at: payload.scraped_at,
    payload_hash: m.canonicalHash(payload),
    receipt_id: "r",
    full_snapshot: true,
  };
  const receipt = { success: true, status: "success", full_snapshot: true, receipt_id: "r" };
  assert.equal(m.verifyAuthorityPayload(authority, payload, receipt), authority);
  for (const change of [
    { payload_hash: "a".repeat(64) },
    { receipt_id: "old" },
    { parser_version: "old" },
    { scope_id: "agent:other" },
  ])
    assert.throws(
      () => m.verifyAuthorityPayload({ ...authority, ...change }, payload, receipt),
      /AUTHORITY_MISMATCH/,
    );
});
