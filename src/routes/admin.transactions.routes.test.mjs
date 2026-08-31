import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("admin.transactions.tsx lists transactions, links to new/edit, and applies agent scoping server-side", () => {
  const source = read("src/routes/admin.transactions.tsx");
  assert.match(source, /fetchAdminTransactionsFiltered/);
  assert.match(source, /to="\/admin\/transactions\/new"/);
  assert.match(source, /to="\/admin\/transactions\/\$id"/);
});

test("admin.transactions.tsx shows verification/publish status per row", () => {
  const source = read("src/routes/admin.transactions.tsx");
  assert.match(source, /verification_state/);
  assert.match(source, /published/);
});

test("admin.transactions.tsx route is registered with noindex", () => {
  const source = read("src/routes/admin.transactions.tsx");
  assert.match(source, /content: "noindex"/);
});
