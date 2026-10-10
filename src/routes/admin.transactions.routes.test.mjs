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

test("admin.transactions_.new.tsx renders TransactionForm and opens the new attribution editor on save", () => {
  const source = read("src/routes/admin.transactions_.new.tsx");
  assert.match(source, /<TransactionForm/);
  assert.match(source, /to: "\/admin\/transactions\/\$id"/);
});

test("admin.transactions_.$id.tsx fetches the transaction, shows a not-found state, and renders TransactionForm", () => {
  const source = read("src/routes/admin.transactions_.$id.tsx");
  assert.match(source, /fetchAdminTransaction/);
  assert.match(source, /<TransactionForm/);
  assert.match(source, /找不到此成交記錄|無權限編輯/);
});

test("transaction editor gates the private attribution panel by resolved staff role", () => {
  const source = read("src/routes/admin.transactions_.$id.tsx");
  assert.match(source, /useStaffSession/);
  assert.match(source, /canSeeFinance/);
  assert.match(source, /<TransactionAttributionEditor/);
});

test("both transaction routes pass canVerify from the admin-or-manager check", () => {
  const edit = read("src/routes/admin.transactions_.$id.tsx");
  assert.match(edit, /canVerify=\{canSeeFinance\}/);
  const create = read("src/routes/admin.transactions_.new.tsx");
  assert.match(create, /useStaffSession/);
  assert.match(create, /includes\("admin"\)\s*\|\|\s*staffSession\.roles\.includes\("manager"\)/);
  assert.match(create, /canVerify=\{canVerify\}/);
});
