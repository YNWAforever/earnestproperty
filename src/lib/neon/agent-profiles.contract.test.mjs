import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("agent profile migration adds publish controls and a unique public slug", () => {
  const migration = "neon/migrations/20260710090000_agent_profiles.sql";
  assert.ok(existsSync(join(root, migration)), "agent profile migration must exist");

  const sql = read(migration);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS public_slug TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS job_title TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS show_on_website BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS staff_users_public_slug_unique\s+ON staff_users \(public_slug\)\s+WHERE public_slug IS NOT NULL/i,
  );
});

test("public agent helpers select only published active safe profiles", () => {
  const types = read("src/lib/neon/public-data.types.ts");
  const server = read("src/lib/neon/public-data.server.ts");
  const client = read("src/lib/neon/public-data.ts");

  assert.match(types, /export type NeonPublicAgentProfile = \{/);
  assert.match(types, /public_slug: string \| null;/);
  assert.match(types, /job_title: string \| null;/);
  assert.doesNotMatch(types, /NeonPublicAgentProfile[\s\S]*?(email|auth_user_id)/);

  assert.match(server, /const publicAgentProfileColumns = `/);
  assert.match(server, /export async function listPublicAgentProfiles\(/);
  assert.match(server, /export async function fetchPublicAgentProfileBySlug\(/);
  assert.match(server, /s\.active = true\s+AND s\.show_on_website = true/);
  assert.match(server, /ORDER BY s\.display_order ASC, COALESCE\(s\.name_zh, s\.name_en\) ASC NULLS LAST/);
  assert.doesNotMatch(
    server.match(/const publicAgentProfileColumns = `[\s\S]*?`;/)?.[0] ?? "",
    /\b(email|auth_user_id|active|show_on_website)\b/,
  );

  assert.match(client, /export const fetchNeonPublicAgentProfiles/);
  assert.match(client, /export const fetchNeonPublicAgentProfileBySlug/);
});

test("property public data only joins assigned agents that are active and published", () => {
  const server = read("src/lib/neon/public-data.server.ts");

  assert.match(
    server,
    /const publicAgentJoin =\s*`LEFT JOIN staff_users s ON s\.id = p\.agent_id\s+AND s\.active = true\s+AND s\.show_on_website = true`/,
  );
  assert.ok(
    (server.match(/\$\{publicAgentJoin\}/g) ?? []).length >= 5,
    "every public property query must use the published-agent join",
  );
});

test("agent profile admin mutations are manager/admin only, normalize slugs, and have no delete API", () => {
  const types = read("src/lib/neon/admin-data.types.ts");
  const client = read("src/lib/neon/admin-data.ts");
  const server = read("src/lib/neon/admin-data.server.ts");

  assert.match(types, /export type AdminAgentProfileInput = \{/);
  assert.match(types, /auth_user_id: string \| null;/);
  assert.match(types, /email: string \| null;/);
  assert.match(types, /public_slug: string \| null;/);

  for (const name of [
    "fetchAdminAgentProfiles",
    "fetchAdminAgentProfile",
    "saveAdminAgentProfile",
  ]) {
    const pattern = new RegExp(`export\\s+(?:async\\s+function|const)\\s+${name}\\b`);
    assert.match(client, pattern, `admin data wrapper must export ${name}`);
    assert.match(server, pattern, `admin server data must export ${name}`);
  }

  assert.match(client, /fetchAdminAgentProfilesServer[\s\S]*?requireStaff\(\["admin", "manager"\]\)/);
  assert.match(client, /saveAdminAgentProfileServer[\s\S]*?requireStaff\(\["admin", "manager"\]\)/);
  assert.match(server, /function normalizeAgentPublicSlug\(/);
  assert.match(server, /toLowerCase\(\)[\s\S]*?replace\(\/\[\^a-z0-9\]\+\/g, "-"\)/);
  assert.match(server, /function agentProfileSlugConflictError\(/);
  assert.match(server, /staff_users_public_slug_unique/);
  assert.doesNotMatch(client, /deleteAdminAgentProfile/);
  assert.doesNotMatch(server, /deleteAdminAgentProfile/);
});
