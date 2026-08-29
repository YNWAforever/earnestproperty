import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Neon Auth TanStack Router integration is wired", () => {
  const packageJson = JSON.parse(read("package.json"));
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  assert.ok(dependencies["@neondatabase/neon-js"], "@neondatabase/neon-js must be installed");
  assert.ok(dependencies["@neondatabase/auth-ui"], "@neondatabase/auth-ui must be installed");
  assert.ok(existsSync(".neon"), ".neon context file must exist");

  // .env itself is gitignored (untracked since ad60b7d) and won't exist in a
  // fresh checkout (CI included) -- .env.example is the tracked source of
  // truth for which vars this integration expects.
  const envExample = read(".env.example");
  assert.match(envExample, /^VITE_NEON_AUTH_URL=/m);

  const styles = read("src/styles.css");
  assert.match(styles, /@import ['"]@neondatabase\/neon-js\/ui\/tailwind['"]/);

  const authClient = read("src/auth.ts");
  assert.match(authClient, /createAuthClient/);
  assert.match(authClient, /BetterAuthReactAdapter/);
  assert.match(authClient, /VITE_NEON_AUTH_URL/);
  assert.match(authClient, /withStaffAuthHeaders/);
  assert.match(authClient, /getSession/);
  assert.match(authClient, /sessionTokenFromValue/);
  assert.match(authClient, /readStaffAuthToken/);
  assert.match(authClient, /authorization/);

  const rootRoute = read("src/routes/__root.tsx");
  assert.match(rootRoute, /NeonAuthUIProvider/);
  assert.match(rootRoute, /authClient/);
  assert.match(rootRoute, /from ["']@neondatabase\/auth-ui["']/);
  assert.match(rootRoute, /defaultTheme=["']light["']/);

  const authRoute = read("src/routes/auth.$pathname.tsx");
  assert.match(authRoute, /createFileRoute\(["']\/auth\/\$pathname["']\)/);
  assert.match(authRoute, /AuthView/);
  assert.match(authRoute, /from ["']@neondatabase\/auth-ui["']/);

  const accountRoute = read("src/routes/account.$pathname.tsx");
  assert.match(accountRoute, /createFileRoute\(["']\/account\/\$pathname["']\)/);
  assert.match(accountRoute, /AccountView/);
  assert.match(accountRoute, /from ["']@neondatabase\/auth-ui["']/);
});

test("admin auth headers read the staff token from the session, not the broken JWT endpoint", () => {
  const authClient = read("src/auth.ts");

  // The installed @neondatabase/auth SDK's getJWTToken() always 404s (its
  // better-auth client derives "/get-j-w-t-token" instead of "/get-jwt-token"
  // -- see the comment on readStaffAuthToken in src/auth.ts). readStaffAuthToken
  // must go straight to getSession() rather than attempting it first.
  const readStaffAuthTokenBody = authClient.match(
    /async function readStaffAuthToken\(\) \{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(readStaffAuthTokenBody, "readStaffAuthToken must be defined in src/auth.ts");
  assert.doesNotMatch(readStaffAuthTokenBody, /client\.getJWTToken/);
  assert.match(authClient, /getSession\?\.\(\)\.catch/);
  assert.match(authClient, /sessionTokenFromValue\(session\)/);
  assert.match(authClient, /headers\.set\("authorization", `Bearer \$\{token\}`\)/);
});

test("admin server functions forward Neon Auth JWTs and verify them on the server", () => {
  const adminData = read("src/lib/neon/admin-data.ts");
  const serverAuth = read("src/lib/neon/auth.server.ts");

  assert.match(adminData, /withStaffAuthHeaders/);
  assert.match(adminData, /fetchAdminOverviewServer/);
  assert.match(adminData, /saveAdminPropertyServer/);
  assert.match(serverAuth, /verifyNeonJwt/);
  assert.match(serverAuth, /crypto\.subtle\.verify/);
  assert.match(serverAuth, /Ed25519/);
  assert.match(serverAuth, /staffRolesFromValue/);
  assert.match(serverAuth, /array_to_json/);
  assert.match(serverAuth, /getBearerToken/);
  assert.match(serverAuth, /neon_auth\.jwks/);
  assert.match(serverAuth, /neon_auth\.session/);
  assert.match(serverAuth, /expiresAt/);
  assert.match(serverAuth, /neon_auth\."user"/);
});
