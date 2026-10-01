import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "@neondatabase/serverless";
import { assertDisposableNeonTestTarget } from "../neon/disposable-test-target.mjs";
export async function openSyncTestDatabase(migrations = []) {
  const connectionString = process.env.ASTRA_TEST_DATABASE_URL;
  await assertDisposableNeonTestTarget(connectionString);
  const schema = "sync_ops_" + randomUUID().replaceAll("-", "");
  const client = new Client({ connectionString });
  await client.connect();
  const query = async (s, p = []) => (await client.query(s, p)).rows;
  const close = async () => {
    await query("ROLLBACK");
    await query("RESET search_path");
    await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  };
  try {
    await query(`CREATE SCHEMA ${schema}`);
    await query(`SET search_path TO ${schema},public,pg_catalog`);
    await query(
      "CREATE TABLE properties(LIKE public.properties INCLUDING DEFAULTS INCLUDING CONSTRAINTS);ALTER TABLE properties ADD PRIMARY KEY(id);CREATE UNIQUE INDEX properties_listing_no_key ON properties(listing_no)",
    );
    await query(
      "CREATE TABLE media_assets(LIKE public.media_assets INCLUDING DEFAULTS INCLUDING CONSTRAINTS);ALTER TABLE media_assets ADD PRIMARY KEY(id);CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean);CREATE TABLE staff_roles(staff_user_id uuid,role text);CREATE TABLE audit_logs(actor_id uuid,action text,subject_type text,subject_id uuid,metadata jsonb)",
    );
    for (const name of [
      "20260817120000_dual_source_listing_sync.sql",
      "20260906040000_property_public_identity.sql",
      "20260906090000_canonical_property_identity.sql",
      "20260906120000_admin_property_management.sql",
      "20260907120000_propertyhk_ingestion_v2.sql",
      ...migrations,
    ])
      await query(readFileSync("neon/migrations/" + name, "utf8"));
    const createClient = (config) => {
      const c = new Client(config),
        connect = c.connect.bind(c);
      c.connect = async () => {
        await connect();
        await c.query(`SET search_path TO ${schema},public,pg_catalog`);
      };
      return c;
    };
    return { client, query, close, schema, connectionString, createClient };
  } catch (e) {
    await close();
    throw e;
  }
}
