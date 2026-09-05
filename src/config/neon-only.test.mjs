import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("runtime no longer depends on Supabase", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies["@supabase/supabase-js"], undefined);
  assert.equal(existsSync(join(root, "src/integrations/supabase")), false);
  assert.equal(existsSync(join(root, "src/hooks/use-auth.tsx")), false);
  assert.equal(existsSync(join(root, "src/hooks/use-roles.tsx")), false);
});

test("public queries are Neon-only with no Supabase fallback", () => {
  const queries = read("src/lib/queries.ts");
  const publicData = read("src/lib/neon/public-data.server.ts");
  const mlsSync = read("src/routes/api.mls-sync.ts");

  assert.doesNotMatch(queries, /supabase/i);
  assert.doesNotMatch(publicData, /profiles:\s*null/);
  assert.doesNotMatch(mlsSync, /supabase/i);
});

test("Neon auth remains the only auth provider", () => {
  const auth = read("src/auth.ts");
  const rootRoute = read("src/routes/__root.tsx");

  assert.match(auth, /createAuthClient/);
  assert.match(auth, /VITE_NEON_AUTH_URL/);
  assert.match(rootRoute, /PrivateAuthProvider/);
  assert.match(read("src/components/auth/PrivateAuthProvider.tsx"), /NeonAuthUIProvider/);
  assert.doesNotMatch(rootRoute, /supabase/i);
});
