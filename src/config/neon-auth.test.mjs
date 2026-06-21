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

  const env = read(".env");
  assert.match(env, /^VITE_NEON_AUTH_URL=/m);

  const styles = read("src/styles.css");
  assert.match(styles, /@import ['"]@neondatabase\/neon-js\/ui\/tailwind['"]/);

  const authClient = read("src/auth.ts");
  assert.match(authClient, /createAuthClient/);
  assert.match(authClient, /BetterAuthReactAdapter/);
  assert.match(authClient, /VITE_NEON_AUTH_URL/);

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
