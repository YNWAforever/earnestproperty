import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const routePath = join(root, "src/routes/admin.operations.tsx");
const shellPath = join(root, "src/components/admin/AdminShell.tsx");

test("Operations route and sidebar expose only the capability-gated shell", () => {
  assert.equal(existsSync(routePath), true, "Operations route should exist");
  const routeSource = readFileSync(routePath, "utf8");
  const shellSource = readFileSync(shellPath, "utf8");

  assert.match(routeSource, /createFileRoute\("\/admin\/operations"\)/);
  assert.match(routeSource, /robots:\s*"noindex, nofollow"/);
  assert.match(routeSource, /resolveOperationsRouteState/);
  assert.match(routeSource, /search:\s*\{ tab:/);
  assert.match(shellSource, /to: "\/admin\/operations"/);
  assert.match(shellSource, /label: "系統營運"/);
  assert.match(shellSource, /ServerCog|Activity/);
});

test("Operations route integration contracts keep health loading least-privileged and accessible", () => {
  const routeSource = readFileSync(routePath, "utf8");
  const shellSource = readFileSync(shellPath, "utf8");

  assert.match(routeSource, /import \{ fetchOperationsHealth \}/);
  assert.match(routeSource, /fetchOperationsHealth\(\)/);
  assert.doesNotMatch(routeSource, /fetchOperations(?:Jobs|Audit|Migrations)/);
  assert.match(routeSource, /aria-live="polite"/);
  assert.match(routeSource, /<Tabs\.List[^>]*aria-label="Operations tabs"/);
  assert.match(
    shellSource,
    /to: "\/admin\/operations",[\s\S]*?includeSearch: false/,
  );
  assert.match(
    shellSource,
    /includeSearch:\s*\("includeSearch" in item \? item\.includeSearch : true\)/,
  );
});
