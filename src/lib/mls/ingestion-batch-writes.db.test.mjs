import test from "node:test";
import assert from "node:assert/strict";
import { writeSyncFields } from "./ingestion-batch-writes.mjs";
import { onDbTarget, targetClientPorts } from "../../../scripts/acceptance/owned-postgres-test.mjs";

// Owned Docker Postgres by default; ASTRA_TEST_DATABASE_URL (behind the disposable guard) keeps
// the on-demand Neon run of property-sync-acceptance.yml. In CI a missing database fails.
const neonRun = { urlVar: "ASTRA_TEST_DATABASE_URL" };
test(
  "batched SQL preserves JSON null, numeric zero and existing adopted ownership",
  onDbTarget(async (target) => {
    const { connectionString: url, createClient: newClient } = await targetClientPorts(target);
    const c = newClient({ connectionString: url });
    c.neonConfig.webSocketConstructor = globalThis.WebSocket;
    await c.connect();
    const q = async (s, p = []) => (await c.query(s, p)).rows;
    try {
      await q("BEGIN");
      await q(
        "CREATE TEMP TABLE property_sync_fields(property_id uuid,field_name text,last_published_value jsonb,winning_observation_id uuid,selection_reason text,policy_version text,updated_at timestamptz,PRIMARY KEY(property_id,field_name)) ON COMMIT DROP",
      );
      const base = {
        property_id: "00000000-0000-4000-8000-000000000001",
        winning_observation_id: null,
        selection_reason: "manual_override",
        policy_version: "no-hermes-v2",
      };
      await writeSyncFields(q, [
        { ...base, field_name: "description", last_published_value: null },
        { ...base, field_name: "price", last_published_value: 0 },
      ]);
      assert.equal(
        (
          await q(
            "SELECT last_published_value='null'::jsonb AS json_null FROM property_sync_fields WHERE field_name='description'",
          )
        )[0].json_null,
        true,
      );
      await writeSyncFields(q, [{ ...base, field_name: "price", last_published_value: 999 }], true);
      assert.equal(
        (
          await q("SELECT last_published_value FROM property_sync_fields WHERE field_name='price'")
        )[0].last_published_value,
        0,
      );
      await q("ROLLBACK");
    } finally {
      await c.end();
    }
  }, neonRun),
);
