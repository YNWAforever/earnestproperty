import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const packagePath = join(root, "package.json");
const routePath = join(root, "src/routes/admin.operations.tsx");
const shellPath = join(root, "src/components/admin/AdminShell.tsx");

test("Operations package script runs the focused route, library, and component suites", () => {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));

  assert.equal(
    packageJson.scripts["test:operations"],
    "node --test src/lib/admin/operations/operations.test.mjs src/routes/admin.operations.test.mjs && bun test src/components/admin/operations/operations-components.test.tsx",
  );
});

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
  assert.match(
    routeSource,
    /currentHealth\.capabilities\.migrationsPlan[\s\S]*fetchOperationsMigrations/,
  );
  assert.match(routeSource, /refreshedTab !== "overview"/);
  assert.match(routeSource, /\}, \[pulse, search\.tab\]\);/);
  assert.doesNotMatch(routeSource, /fetchOperationsAudit/);
  assert.match(routeSource, /AdminOperationsAudit/);
  assert.match(routeSource, /activeTab === "audit"[\s\S]*health\.capabilities\.auditRead/);
  assert.match(routeSource, /revision=\{mutationRevision\}/);
  assert.match(routeSource, /activeTab === "jobs"[\s\S]*health\.capabilities\.jobsRead/);
  assert.match(
    routeSource,
    /tab === "migrations"[\s\S]*activeTab === "migrations"[\s\S]*health\.capabilities\.migrationsPlan[\s\S]*AdminOperationsMigrations/,
  );
  assert.match(routeSource, /safeOperationsRefreshError/);
  assert.match(routeSource, /AdminOperationsOverview/);
  assert.match(routeSource, /AdminOperationsJobs/);
  assert.match(routeSource, /aria-live="polite"/);
  assert.match(routeSource, /<Tabs\.List[^>]*aria-label="Operations tabs"/);
  assert.match(shellSource, /to: "\/admin\/operations",[\s\S]*?includeSearch: false/);
  assert.match(
    shellSource,
    /includeSearch:\s*\(?"includeSearch" in item \? item\.includeSearch : true\)?/,
  );
});
