import assert from "node:assert/strict";
import test from "node:test";
import { applyIngestionMigration, MIGRATION } from "./migrate-ingestion-v2.mjs";
import { MIGRATION_VERSIONS } from "../../src/lib/control-plane/migration-versions.js";
const previous = MIGRATION_VERSIONS.filter((v) => v !== MIGRATION).map((version) => ({ version }));
test("transactional migration registers only after DDL and rolls back failure", async () => {
  const calls = [];
  const c = {
    query: async (q) => {
      calls.push(q);
      if (q.startsWith("SELECT version")) return { rows: previous };
      if (q === "BAD DDL") throw new Error("fixture failure");
      return { rows: [] };
    },
  };
  await assert.rejects(applyIngestionMigration(c, "BAD DDL"), /fixture failure/);
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.ok(!calls.some((q) => q.startsWith("INSERT INTO app_migrations")));
  calls.length = 0;
  await applyIngestionMigration(c, "GOOD DDL");
  assert.equal(calls.at(-1), "COMMIT");
  assert.ok(
    calls.indexOf("GOOD DDL") < calls.findIndex((q) => q.startsWith("INSERT INTO app_migrations")),
  );
});
test("missing prior migration prevents DDL and existing receipt prevents reapply", async () => {
  let ddl = 0;
  const c = {
    query: async (q) => {
      if (q === "DDL") ddl++;
      return { rows: q.startsWith("SELECT version") ? [] : [] };
    },
  };
  await assert.rejects(applyIngestionMigration(c, "DDL"), /PREREQUISITE/);
  assert.equal(ddl, 0);
  c.query = async (q) => ({
    rows: q.startsWith("SELECT version") ? [...previous, { version: MIGRATION }] : [],
  });
  assert.equal((await applyIngestionMigration(c, "DDL")).status, "already_applied");
});

test("COMMIT acknowledgement failure remains unknown and never attempts rollback", async () => {
  const calls = [];
  const client = {
    query: async (q) => {
      calls.push(q);
      if (q.startsWith("SELECT version")) return { rows: previous };
      if (q === "COMMIT") throw new Error("timeout");
      return { rows: [] };
    },
  };
  await assert.rejects(applyIngestionMigration(client, "DDL"), /OUTCOME_UNKNOWN/);
  assert.equal(calls.at(-1), "COMMIT");
  assert.ok(!calls.includes("ROLLBACK"));
});
