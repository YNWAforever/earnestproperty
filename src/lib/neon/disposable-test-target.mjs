import assert from "node:assert/strict";
import { neon } from "@neondatabase/serverless";

/**
 * Guard DB suites that create temporary synthetic schemas. The branch ID is
 * checked against Neon's own server setting, never trusted from an env label
 * alone. Production's default "neondb" cannot pass the disposable DB name rule.
 */
export async function assertDisposableNeonTestTarget(url, { env = process.env, query } = {}) {
  assert.equal(
    env.ASTRA_TEST_DATABASE_CONFIRMED,
    "true",
    "Explicit disposable test database confirmation is required",
  );
  const expectedBranch = env.ASTRA_TEST_BRANCH_ID ?? "";
  assert.match(expectedBranch, /^br-[a-z0-9-]+$/, "A real Neon branch ID is required");

  const target = new URL(url);
  assert.match(target.hostname, /\.neon\.tech$/, "A Neon database endpoint is required");
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  assert.match(
    databaseName,
    /^earnest_audit_acceptance_[0-9]{8}$/,
    "Only a named Earnest audit acceptance database is allowed",
  );

  const runQuery = query ?? ((statement) => neon(url).query(statement));
  const [identity] = await runQuery(
    "SELECT current_database() AS database_name, current_setting('neon.branch_id', true) AS branch_id, current_setting('neon.endpoint_id', true) AS endpoint_id",
  );
  assert.ok(identity, "Neon returned no database identity");
  assert.equal(identity.database_name, databaseName, "Database name differs from connection URL");
  assert.equal(identity.branch_id, expectedBranch, "Neon branch differs from declared test branch");
  assert.ok(
    target.hostname.startsWith(`${identity.endpoint_id}.`) ||
      target.hostname.startsWith(`${identity.endpoint_id}-pooler.`),
    "Neon endpoint differs from connection URL",
  );
  return identity;
}
