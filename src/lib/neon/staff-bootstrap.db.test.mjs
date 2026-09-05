import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { neon } from "@neondatabase/serverless";
import { createStaffAccessResolver } from "./auth.server.ts";

// Never load .env or fall back to an application/production connection.
const databaseUrl = process.env.TEST_DATABASE_URL;
const confirmed = process.env.STAFF_BOOTSTRAP_TEST_DATABASE_CONFIRMED === "true";

test(
  "disposable database: bootstrap race, disabled profile and atomic rollback",
  {
    skip:
      !databaseUrl || !confirmed
        ? "Requires explicitly disposable TEST_DATABASE_URL and STAFF_BOOTSTRAP_TEST_DATABASE_CONFIRMED=true"
        : false,
  },
  async () => {
    assert.notEqual(
      databaseUrl,
      process.env.DATABASE_URL,
      "test connection must differ from application DATABASE_URL",
    );
    assert.notEqual(
      databaseUrl,
      process.env.DATABASE_URL_UNPOOLED,
      "test connection must differ from application DATABASE_URL_UNPOOLED",
    );
    const sql = neon(databaseUrl);
    const schema = `bootstrap_test_${randomUUID().replaceAll("-", "")}`;
    // Only identifiers are rewritten; all production predicates and transaction
    // statements run unchanged against isolated synthetic fixture tables.
    const qualify = (statement) =>
      statement
        .replaceAll('neon_auth."user"', `"${schema}".auth_user`)
        .replaceAll(/\bstaff_users\b/g, `"${schema}".staff_users`)
        .replaceAll(/\bstaff_roles\b/g, `"${schema}".staff_roles`);
    const queryRows = (statement, params = []) => sql.query(qualify(statement), params);
    const transactionRows = (statements, options) =>
      sql.transaction(
        (tx) =>
          statements.map(({ statement, params = [] }) => tx.query(qualify(statement), params)),
        options,
      );
    const oldAllowlist = process.env.ADMIN_BOOTSTRAP_EMAILS;
    await sql.query(`CREATE SCHEMA "${schema}"`);
    try {
      await sql.query(
        `CREATE TABLE "${schema}".staff_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id text UNIQUE, email text, name_en text, name_zh text, active boolean NOT NULL DEFAULT true, updated_at timestamptz DEFAULT now())`,
      );
      await sql.query(
        `CREATE TABLE "${schema}".staff_roles (staff_user_id uuid REFERENCES "${schema}".staff_users(id), role text NOT NULL, PRIMARY KEY (staff_user_id, role))`,
      );
      await sql.query(
        `CREATE TABLE "${schema}".auth_user (id text PRIMARY KEY, email text, "emailVerified" boolean)`,
      );
      await queryRows(
        `INSERT INTO neon_auth."user" VALUES ('owner-a', 'a@example.test', true), ('owner-b', 'b@example.test', true)`,
      );
      process.env.ADMIN_BOOTSTRAP_EMAILS = "a@example.test,b@example.test";
      const request = new Request("https://earnest.test/admin");
      const resolver = (id, email, query = queryRows) =>
        createStaffAccessResolver({
          queryRows: query,
          transactionRows,
          getSession: async () => ({ user: { id, email, name: "Synthetic Owner" }, session: {} }),
        });
      const a = () => resolver("owner-a", "a@example.test").requireStaffAccess(request);
      const b = () => resolver("owner-b", "b@example.test").requireStaffAccess(request);
      // Hold both callers after their preflight snapshot, proving the transaction
      // must reject one even though both saw an eligible empty database.
      let arrivals = 0;
      let release;
      const barrier = new Promise((resolve) => {
        release = resolve;
      });
      const raceQuery = async (statement, params) => {
        const rows = await queryRows(statement, params);
        if (statement.includes("FROM staff_users s") && !statement.includes("s.active = true")) {
          if (++arrivals === 2) release();
          await barrier;
        }
        return rows;
      };
      const results = await Promise.allSettled([
        resolver("owner-a", "a@example.test", raceQuery).requireStaffAccess(request),
        resolver("owner-b", "b@example.test", raceQuery).requireStaffAccess(request),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const loser = results.find((result) => result.status === "rejected");
      assert.equal(loser.reason.status, 403);
      assert.equal((await queryRows("SELECT * FROM staff_users")).length, 1);
      assert.equal((await queryRows("SELECT * FROM staff_roles")).length, 1);
      await queryRows("DELETE FROM staff_roles");
      await queryRows("DELETE FROM staff_users");

      await queryRows("INSERT INTO staff_users (email, active) VALUES ('a@example.test', false)");
      await assert.rejects(a(), (error) => error instanceof Response && error.status === 403);
      assert.equal((await queryRows("SELECT auth_user_id FROM staff_users"))[0].auth_user_id, null);
      assert.equal((await queryRows("SELECT * FROM staff_roles")).length, 0);
      await queryRows("DELETE FROM staff_users");

      // Force failure between staff creation and role persistence; both roll back.
      await queryRows(
        "ALTER TABLE staff_roles ADD CONSTRAINT synthetic_role_failure CHECK (role <> 'admin')",
      );
      await assert.rejects(b());
      assert.equal((await queryRows("SELECT * FROM staff_users")).length, 0);
      assert.equal((await queryRows("SELECT * FROM staff_roles")).length, 0);
      await queryRows("ALTER TABLE staff_roles DROP CONSTRAINT synthetic_role_failure");
      await queryRows("INSERT INTO staff_users (email) VALUES ('a@example.test')");
      assert.equal((await a()).bootstrap, true);
      assert.equal(
        (await queryRows("SELECT * FROM staff_users")).length,
        1,
        "reuse the existing roleless profile",
      );
      assert.equal((await queryRows("SELECT * FROM staff_roles")).length, 1);
    } finally {
      if (oldAllowlist === undefined) delete process.env.ADMIN_BOOTSTRAP_EMAILS;
      else process.env.ADMIN_BOOTSTRAP_EMAILS = oldAllowlist;
      await sql.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
  },
);
