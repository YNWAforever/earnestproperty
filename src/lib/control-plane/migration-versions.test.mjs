import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { MIGRATION_VERSIONS, pendingMigrations } from "./migration-versions.js";

const root = process.cwd();

function migrationFilesOnDisk() {
  return readdirSync(join(root, "neon/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

// The whole point of the manifest is to be trustworthy. A list that silently
// falls behind neon/migrations would report "0 pending" while production was
// missing a column -- which is exactly the failure it exists to prevent, only
// now with a green tick next to it.
test("the manifest matches neon/migrations exactly", () => {
  assert.deepEqual(
    [...MIGRATION_VERSIONS],
    migrationFilesOnDisk(),
    "MIGRATION_VERSIONS in src/lib/control-plane/migration-versions.js is out of sync with " +
      "neon/migrations. Add the new migration's filename to the list -- the control-plane " +
      "health check diffs it against the app_migrations table to spot databases that are " +
      "behind the code.",
  );
});

test("versions are stored the way apply-migrations.mjs records them", () => {
  // scripts/neon/apply-migrations.mjs does INSERT INTO app_migrations (version)
  // with the bare filename, extension included. Strip the .sql here and every
  // migration would read as pending forever.
  for (const version of MIGRATION_VERSIONS) {
    assert.match(version, /^\d{14}_[a-z0-9_]+\.sql$/, `${version} is not a migration filename`);
  }
});

test("the manifest is ordered so it can be read as apply order", () => {
  assert.deepEqual([...MIGRATION_VERSIONS], [...MIGRATION_VERSIONS].sort());
});

test("pendingMigrations reports what the database is missing", () => {
  const all = [...MIGRATION_VERSIONS];
  assert.deepEqual(pendingMigrations(all), [], "a fully migrated database has nothing pending");
  assert.deepEqual(pendingMigrations([]), all, "an empty database is missing everything");

  const withoutLast = all.slice(0, -1);
  assert.deepEqual(pendingMigrations(withoutLast), [all[all.length - 1]]);
});

// A database carrying a version this build has never heard of is the normal
// state during a rollback, or while an older deploy is briefly still serving.
// Reporting it would cry wolf in exactly the moments the signal needs to mean
// something.
test("unknown versions in the database are not reported as pending", () => {
  const applied = [...MIGRATION_VERSIONS, "20990101000000_from_the_future.sql"];
  assert.deepEqual(pendingMigrations(applied), []);
});

test("the migration that broke 代理管理 is covered", () => {
  // 20260802100000_agent_specialties.sql adds staff_users.specialties, which
  // admin-data.server.ts selects by name. It sat unapplied in production for
  // eleven days while the health check reported healthy.
  assert.ok(
    MIGRATION_VERSIONS.includes("20260802100000_agent_specialties.sql"),
    "the agent_specialties migration must be tracked",
  );
});
