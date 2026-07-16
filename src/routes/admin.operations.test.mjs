import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const routePath = join(root, "src/routes/admin.operations.tsx");
const shellPath = join(root, "src/components/admin/AdminShell.tsx");

test("Operations route and sidebar expose the capability-gated center", () => {
  assert.equal(existsSync(routePath), true, "Operations route should exist");
  const routeSource = readFileSync(routePath, "utf8");
  const shellSource = readFileSync(shellPath, "utf8");

  assert.match(routeSource, /createFileRoute\("\/admin\/operations"\)/);
  assert.match(routeSource, /robots:\s*"noindex, nofollow"/);
  assert.match(routeSource, /resolveOperationsRouteState/);
  assert.match(routeSource, /search:\s*\{ tab:/);
  assert.match(shellSource, /to: "\/admin\/operations"/);
  assert.match(shellSource, /to: "\/admin\/operations",[\s\S]*?label:/);
  assert.match(shellSource, /ServerCog|Activity/);
});

test("Operations route integration contracts gate protected reads and remain accessible", () => {
  const routeSource = readFileSync(routePath, "utf8");
  const shellSource = readFileSync(shellPath, "utf8");

  assert.match(routeSource, /fetchOperationsHealth/);
  assert.match(routeSource, /fetchOperationsHealth\(\)/);
  assert.match(routeSource, /currentHealth\.capabilities\.jobsRead[\s\S]*fetchOperationsJobs/);
  assert.match(routeSource, /currentHealth\.capabilities\.migrationsPlan[\s\S]*fetchOperationsMigrations/);
  assert.doesNotMatch(routeSource, /fetchOperationsAudit/);
  assert.match(routeSource, /activeTab === "jobs"[\s\S]*health\.capabilities\.jobsRead/);
  assert.match(routeSource, /AdminOperationsOverview/);
  assert.match(routeSource, /AdminOperationsJobs/);
  assert.match(routeSource, /aria-live="polite"/);
  assert.match(routeSource, /<Tabs\.List[^>]*aria-label="Operations tabs"/);
  assert.match(shellSource, /to: "\/admin\/operations",[\s\S]*?includeSearch: false/);
  assert.match(shellSource, /includeSearch:\s*\("includeSearch" in item \? item\.includeSearch : true\)/);
});
