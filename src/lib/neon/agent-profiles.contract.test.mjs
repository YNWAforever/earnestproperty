import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

/**
 * Load public-data.server.ts as a data: URL module with getSql stubbed out.
 *
 * A data: URL has no filesystem location, so every relative import in the module
 * has to be inlined as its own data: URL too — otherwise Node throws
 * ERR_UNSUPPORTED_RESOLVE_REQUEST the moment a new sibling import is added.
 * Rewriting every "./x" specifier keeps this harness working as the module's
 * imports change, rather than needing a hand-written case per sibling.
 */
function inlineRelativeImports(source, dir) {
  return source.replace(/from "\.\/([\w.-]+?)(?:\.js)?"/g, (match, name) => {
    for (const candidate of [`${name}.ts`, `${name}.js`]) {
      const path = join(root, dir, candidate);
      if (!existsSync(path)) continue;
      const code = readFileSync(path, "utf8");
      return `from "${dataUrl(candidate.endsWith(".ts") ? transpile(code) : code)}"`;
    }
    return match;
  });
}

async function importPublicDataServerWithInjectedQuery(query) {
  globalThis.__agentProfileContractQuery = query;

  const dbUrl = dataUrl(
    "export const getSql = () => ({ query: (...args) => globalThis.__agentProfileContractQuery(...args) });",
  );
  const executable = inlineRelativeImports(
    transpile(read("src/lib/neon/public-data.server.ts"))
      .replace('import "@tanstack/react-start/server-only";', "")
      .replace('from "./db.server"', `from "${dbUrl}"`),
    "src/lib/neon",
  );

  return import(dataUrl(executable));
}

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
  assert.match(server, /to_jsonb\(s\)\s*->>\s*'show_on_website'/);
  assert.match(server, /to_jsonb\(s\)\s*->>\s*'public_slug'\s+AS agent_public_slug/);
  assert.match(server, /to_jsonb\(s\)\s*->>\s*'job_title'\s+AS agent_job_title/);
  assert.match(
    server,
    /ORDER BY COALESCE\(\(to_jsonb\(s\)\s*->>\s*'display_order'\)::integer, 0\) ASC/,
  );
  assert.doesNotMatch(
    server,
    /\bs\.(?:public_slug|job_title|show_on_website|display_order)\b/,
    "public SQL must remain valid before the agent-profile migration adds these columns",
  );
  assert.doesNotMatch(
    server,
    /agent-profile-rollout/,
    "public rollout handling must stay self-contained in the owned server module",
  );
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
    /const publicAgentJoin =\s*`LEFT JOIN staff_users s ON s\.id = p\.agent_id[\s\S]*?to_jsonb\(s\)\s*->>\s*'show_on_website'/,
  );
  assert.ok(
    (server.match(/\$\{publicAgentJoin\}/g) ?? []).length >= 5,
    "every public property query must use the published-agent join",
  );
});

test("public agent list and detail only hide recognized profile-column rollout errors", async () => {
  let databaseError;
  const server = await importPublicDataServerWithInjectedQuery(async () => {
    throw databaseError;
  });

  for (const column of ["public_slug", "job_title", "show_on_website", "display_order"]) {
    databaseError = Object.assign(new Error(`column s.${column} does not exist`), {
      code: "42703",
      column,
    });
    assert.deepEqual(await server.listPublicAgentProfiles(), [], `${column} list fallback`);
    assert.equal(
      await server.fetchPublicAgentProfileBySlug({ slug: "agent-one" }),
      null,
      `${column} detail fallback`,
    );
  }

  databaseError = Object.assign(
    new Error('column s.email does not exist; query context includes "public_slug"'),
    { code: "42703" },
  );
  await assert.rejects(server.listPublicAgentProfiles(), (error) => error === databaseError);
  await assert.rejects(
    server.fetchPublicAgentProfileBySlug({ slug: "agent-one" }),
    (error) => error === databaseError,
  );

  databaseError = Object.assign(new Error("column s.show_on_website does not exist"), {
    code: "XX000",
  });
  await assert.rejects(server.listPublicAgentProfiles(), (error) => error === databaseError);
});

test("agent profile admin mutations are manager/admin only, normalize slugs, and have no delete API", () => {
  const types = read("src/lib/neon/admin-data.types.ts");
  const client = read("src/lib/neon/admin-data.ts");
  const server = read("src/lib/neon/admin-data.server.ts");

  assert.match(types, /export type AdminAgentProfileInput = \{/);
  assert.match(types, /auth_user_id: string \| null;/);
  assert.match(types, /email: string \| null;/);
  assert.match(types, /public_slug: string \| null;/);
  assert.match(types, /export type AdminAgentProfileMutationInput =/);

  for (const name of [
    "fetchAdminAgentProfiles",
    "fetchAdminAgentProfile",
    "saveAdminAgentProfile",
  ]) {
    const pattern = new RegExp(`export\\s+(?:async\\s+function|const)\\s+${name}\\b`);
    assert.match(client, pattern, `admin data wrapper must export ${name}`);
    assert.match(server, pattern, `admin server data must export ${name}`);
  }

  assert.match(
    client,
    /fetchAdminAgentProfilesServer[\s\S]*?requireStaff\(\["admin", "manager"\]\)/,
  );
  assert.match(client, /saveAdminAgentProfileServer[\s\S]*?requireStaff\(\["admin", "manager"\]\)/);
  assert.match(
    client,
    /fetchAdminAgentEditorContextServer[\s\S]*?const staff = await requireStaff\(\["admin", "manager"\]\)[\s\S]*?deriveAgentProfileEditorContext\(staff\.roles\)/,
  );
  assert.match(server, /function normalizeAgentPublicSlug\(/);
  assert.match(server, /toLowerCase\(\)[\s\S]*?replace\(\/\[\^a-z0-9\]\+\/g, "-"\)/);
  assert.match(server, /function agentProfileSlugConflictError\(/);
  assert.match(server, /staff_users_public_slug_unique/);
  assert.doesNotMatch(client, /deleteAdminAgentProfile/);
  assert.doesNotMatch(server, /deleteAdminAgentProfile/);
});

test("agent CMS deployment note requires migrations before full profile enablement", () => {
  const note = "docs/deployment/property-conversion-suite.md";
  assert.equal(existsSync(join(root, note)), true, "deployment note must exist");
  const source = read(note);
  assert.match(source, /npm run neon:migrate/);
  assert.match(source, /before/i);
  assert.match(source, /agent CMS|agent profiles/i);
});

test("the unique-constraint migration is idempotent", () => {
  const sql = read("neon/migrations/20260801090000_staff_public_slug_unique.sql");

  // apply-migrations.mjs runs statements one at a time with no transaction and only
  // records the version after all succeed. A bare ADD CONSTRAINT that collides with
  // 20260622060000's inline faqs_scope_question_key therefore commits statement 1,
  // fails statement 2, and wedges every retry on statement 1.
  //
  // Strip the guarded blocks, then assert nothing is left unguarded. A naive
  // /^\s*ALTER TABLE/m matches at any indentation -- including inside the DO
  // block -- so it cannot tell a wrapped statement from a bare one.
  const unguarded = sql.replace(/DO \$\$[\s\S]*?END \$\$;/g, "");
  assert.doesNotMatch(
    unguarded,
    /ALTER TABLE/,
    "every ALTER TABLE must sit inside a DO $$ ... EXCEPTION guard",
  );
  assert.equal(sql.match(/WHEN duplicate_object THEN NULL/g)?.length, 2);
  assert.equal(sql.match(/WHEN duplicate_table THEN NULL/g)?.length, 2);

  // A unique_violation from real duplicate rows must still fail loudly rather than
  // silently skipping constraint creation.
  assert.doesNotMatch(sql, /WHEN unique_violation/);
  assert.doesNotMatch(sql, /WHEN others/);
});

test("agent languages migration is additive, nullable, and never dropped", () => {
  const migration = "neon/migrations/20260830150000_agent_languages.sql";
  assert.ok(existsSync(join(root, migration)), "agent languages migration must exist");

  const sql = read(migration);
  assert.match(sql, /ALTER TABLE staff_users/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS languages TEXT\[\]/);
  // Deliberately no NOT NULL / DEFAULT, unlike specialties/served_estate_slugs
  // -- a language is either recorded by a human or it isn't, and this plan's
  // ground truth explicitly calls the DB-level column nullable.
  assert.doesNotMatch(sql, /languages TEXT\[\]\s+NOT NULL/);
  assert.doesNotMatch(sql, /DROP COLUMN/);
});

test("languages thread all the way through the public agent-profile type layer", () => {
  const types = read("src/lib/neon/public-data.types.ts");
  const server = read("src/lib/neon/public-data.server.ts");

  assert.match(
    types,
    /export type NeonPublicAgentProfile = \{[\s\S]*?languages: string\[\];[\s\S]*?\};/,
  );

  const projection = server.match(/const publicAgentProfileColumns = `[\s\S]*?`;/)?.[0] ?? "";
  assert.match(projection, /AS agent_languages/);
  // Guarded the same way public_slug/job_title/etc. are (to_jsonb, never a
  // raw `s.languages` reference) -- see the "public SQL must remain valid
  // before the agent-profile migration adds these columns" test above for
  // why a bare column reference in this projection would be a parse-time
  // regression on an unmigrated database. jsonb_typeof guards the extra
  // wrinkle a NULLABLE array column has that specialties/served_estate_slugs
  // (NOT NULL DEFAULT '{}') never needed to: a real column holding SQL NULL
  // serializes as JSON `null` via to_jsonb, which jsonb_array_elements_text
  // errors on if passed directly (it is a scalar, not an array).
  assert.doesNotMatch(projection, /\bs\.languages\b/);
  assert.match(projection, /jsonb_typeof\(to_jsonb\(s\)->'languages'\)\s*=\s*'array'/);

  const mapper = server.match(/function mapPublicAgentProfile\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(mapper, /languages:\s*textArrayOrNull\(row\.agent_languages\)\s*\?\?\s*\[\]/);
});

test("listPublicAgentProfiles maps a real languages array and defaults a missing one to []", async () => {
  const baseRow = {
    agent_id: "agent-1",
    agent_public_slug: "agent-one",
    agent_name_zh: "陳大文",
    agent_name_en: null,
    agent_job_title: null,
    agent_phone: null,
    agent_whatsapp: null,
    agent_licence_no: null,
    agent_avatar_url: null,
    agent_branch: null,
    agent_bio: null,
    agent_specialties: [],
    agent_served_estate_slugs: [],
  };

  const withLanguages = await importPublicDataServerWithInjectedQuery(async () => [
    { ...baseRow, agent_languages: ["粵語", "英語"] },
  ]);
  const [profileWithLanguages] = await withLanguages.listPublicAgentProfiles();
  assert.deepEqual(profileWithLanguages.languages, ["粵語", "英語"]);

  const withoutLanguages = await importPublicDataServerWithInjectedQuery(async () => [
    { ...baseRow, agent_languages: null },
  ]);
  const [profileWithoutLanguages] = await withoutLanguages.listPublicAgentProfiles();
  assert.deepEqual(profileWithoutLanguages.languages, []);
});
