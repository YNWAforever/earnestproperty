import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("transaction routes exist and export a Route", () => {
  for (const [path, routePath] of [
    ["src/routes/admin.transactions.tsx", "/admin/transactions"],
    ["src/routes/admin.transactions_.$id.tsx", "/admin/transactions_/$id"],
    ["src/routes/admin.transactions_.new.tsx", "/admin/transactions_/new"],
  ]) {
    const source = read(path);
    assert.match(source, /export const Route = createFileRoute/, `${path} must export Route`);
    assert.match(source, new RegExp(`createFileRoute\\("${routePath.replace(/\$/g, "\\$")}"\\)`));
    assert.match(source, /"robots", content: "noindex"/, `${path} must be noindexed`);
  }
});

test("verify and publish are gated behind the new granular permissions, drafting is not", () => {
  const source = read("src/lib/neon/admin-transactions.ts");
  assert.match(source, /requireStaffPermission\(getRequest\(\), "transaction\.verify"\)/);
  assert.match(source, /requireStaffPermission\(getRequest\(\), "transaction\.publish"\)/);
  // unpublish shares the publish permission -- it's the inverse of the same action.
  const unpublishStart = source.indexOf("const unpublishAdminTransactionServer");
  assert.notEqual(unpublishStart, -1);
  assert.match(
    source.slice(unpublishStart, unpublishStart + 300),
    /requireStaffPermission\(getRequest\(\), "transaction\.publish"\)/,
  );
});

test("the two new permissions are declared and granted to manager, not agent", () => {
  const source = read("src/lib/control-plane/permissions.ts");
  assert.match(source, /"transaction\.verify"/);
  assert.match(source, /"transaction\.publish"/);
  const agentStart = source.indexOf("agent: new Set(");
  const agentEnd = source.indexOf("]", agentStart);
  const agentSet = source.slice(agentStart, agentEnd);
  assert.doesNotMatch(agentSet, /transaction\.(verify|publish)/);
});

test("the sidebar has a 成交管理 entry pointing at /admin/transactions", () => {
  const source = read("src/components/admin/AdminShell.tsx");
  assert.match(source, /to: "\/admin\/transactions", label: "成交管理"/);
});

test("every route file used above is registered in the generated route tree", () => {
  const routeTree = read("src/routeTree.gen.ts");
  for (const path of [
    "'/admin/transactions'",
    "'/admin/transactions/$id'",
    "'/admin/transactions/new'",
  ]) {
    assert.ok(
      routeTree.includes(path),
      `${path} missing from routeTree.gen.ts -- did you run npm run build after adding the route file?`,
    );
  }
});
