import test from "node:test";
import assert from "node:assert/strict";
const m = () => import("./migrate-sync-operations.mjs");
test("sync migrations verify exact bytes server target and prerequisites before apply", async () => {
  const { runSyncMigrations, requiredVersions, MIGRATIONS } = await m();
  let commands = [];
  const client = {
    query: async (s, p = []) => {
      commands.push(s);
      if (s.includes("current_database"))
        return { rows: [{ database: "neondb", branch: "br-fixture" }] };
      if (s.includes("SELECT version"))
        return { rows: requiredVersions.map((version) => ({ version })) };
      return { rows: [] };
    },
  };
  const opts = {
    client,
    expectedBranch: "br-fixture",
    ddl: Object.fromEntries(MIGRATIONS.map((x) => [x.file, x.ddl])),
  };
  const check = await runSyncMigrations(opts);
  assert.equal(check.status, "checked");
  assert.ok(!commands.some((s) => s.includes("CREATE TABLE") || s.startsWith("INSERT")));
  commands = [];
  await assert.rejects(
    runSyncMigrations({ ...opts, expectedBranch: "br-wrong", apply: true }),
    /SERVER_TARGET_MISMATCH/,
  );
  assert.ok(!commands.some((s) => s.includes("CREATE TABLE")));
  commands = [];
  client.query = async (s) => {
    commands.push(s);
    return s.includes("current_database")
      ? { rows: [{ database: "neondb", branch: "br-fixture" }] }
      : { rows: [] };
  };
  await assert.rejects(
    runSyncMigrations({ ...opts, apply: true }),
    /MIGRATION_PREREQUISITE_MISSING/,
  );
});
test("lost migration COMMIT response is unknown duplicate skips and failed DDL rolls back", async () => {
  const { runSyncMigrations, requiredVersions, MIGRATIONS } = await m();
  let commands = [];
  let fail = "commit";
  const client = {
    query: async (s, p = []) => {
      commands.push(s);
      if (s.includes("current_database"))
        return { rows: [{ database: "neondb", branch: "br-fixture" }] };
      if (s.includes("SELECT version"))
        return {
          rows: [
            ...requiredVersions,
            ...(fail === "duplicate" ? MIGRATIONS.map((x) => x.file) : []),
          ].map((version) => ({ version })),
        };
      if (s === "COMMIT" && fail === "commit") throw Error("ack lost");
      if (s.includes("CREATE TABLE") && fail === "ddl") throw Error("ddl failure");
      return { rows: [] };
    },
  };
  const opts = {
    client,
    expectedBranch: "br-fixture",
    ddl: Object.fromEntries(MIGRATIONS.map((x) => [x.file, x.ddl])),
    apply: true,
  };
  await assert.rejects(runSyncMigrations(opts), /COMMIT_OUTCOME_UNKNOWN/);
  assert.ok(!commands.includes("ROLLBACK"));
  fail = "duplicate";
  commands = [];
  assert.equal((await runSyncMigrations(opts)).applied.length, 0);
  assert.ok(!commands.some((s) => s.includes("CREATE TABLE")));
  fail = "ddl";
  commands = [];
  await assert.rejects(runSyncMigrations(opts), /ddl failure/);
  assert.ok(commands.includes("ROLLBACK"));
  await assert.rejects(
    runSyncMigrations({ ...opts, ddl: { ...opts.ddl, [MIGRATIONS[0].file]: "changed" } }),
    /MIGRATION_BYTES_CHANGED/,
  );
});
